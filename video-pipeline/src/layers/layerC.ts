import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, probeDuration, encodeArgs } from '../util/ffmpeg';
import type { Shot, Storyboard } from '../types';

/**
 * C 层：现成素材。
 *
 * 刻意做成「本地库优先」而不是每次调素材站 API：
 *  - 免费素材站的关键词匹配质量很一般，人工挑一次好过每次碰运气
 *  - 跑几十条片之后本地库就够用了，之后完全离线
 *  - 不受 API 限流和条款变更影响
 *
 * 库的结构：
 *   assets/library/
 *     index.json          ← { "file.mp4": ["城市","夜景","东京"] }
 *     city-night-01.mp4
 *     ...
 *
 * index.json 手工维护就行，几十条素材的量不值得上数据库。
 */

export interface LibraryIndex {
  [file: string]: string[];
}

export function loadLibrary(libDir: string): LibraryIndex {
  const f = path.join(libDir, 'index.json');
  if (!fs.existsSync(f)) return {};
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as LibraryIndex;
  } catch (e) {
    throw new Error(`素材库索引解析失败 ${f}：${(e as Error).message}`);
  }
}

/** 按 tag 交集打分检索，返回最匹配的一条。命中数相同时取文件名字典序靠前的，保证可复现 */
export function findInLibrary(index: LibraryIndex, tags: string[]): string | null {
  let best: { file: string; score: number } | null = null;
  for (const [file, fileTags] of Object.entries(index)) {
    const score = tags.filter((t) => fileTags.includes(t)).length;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && file < best.file)) {
      best = { file, score };
    }
  }
  return best?.file ?? null;
}

/**
 * 把素材裁成目标时长和尺寸。
 *
 * 时长处理策略（重要）：
 *  - 素材比需要的长 → 从中段截取（开头结尾往往有淡入淡出或者不稳定的镜头）
 *  - 素材比需要的短 → 循环播放，而不是变速。变速会让运动看起来不自然，
 *    循环在解说片里几乎察觉不到，因为观众注意力在文案上。
 */
export async function renderLayerC(
  shot: Shot,
  sb: Storyboard,
  srcAbs: string,
  outFile: string,
  crf: number,
  preset: string,
): Promise<void> {
  const { width: W, height: H, fps } = sb;
  const need = shot.duration;

  let srcDur = 0;
  try {
    srcDur = await probeDuration(srcAbs);
  } catch {
    srcDur = 0; // 静态图会走到这里
  }

  const vf = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W}:${H}`,
    `fps=${fps}`,
    'format=yuv420p',
  ].join(',');

  const args: string[] = ['-y', '-loglevel', 'error'];

  if (srcDur <= 0) {
    // 当静图用，套一个极轻的缓推免得画面完全死掉
    args.push('-loop', '1', '-i', srcAbs);
  } else if (srcDur >= need + 0.2) {
    const ss = Math.max(0, (srcDur - need) / 2);
    args.push('-ss', ss.toFixed(3), '-i', srcAbs);
  } else {
    args.push('-stream_loop', '-1', '-i', srcAbs);
  }

  args.push('-t', String(need), '-vf', vf, '-an', '-r', String(fps), ...encodeArgs(crf, preset), outFile);
  await run(args);
}

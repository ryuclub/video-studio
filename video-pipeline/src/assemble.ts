import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, encodeArgs } from './util/ffmpeg';
import { TRANSITION_PRESETS } from './types';
import type { ShotResult, Storyboard, TransitionSpec } from './types';

/**
 * 把渲好的单镜拼成成片。
 *
 * ── 为什么是分段策略而不是一条 xfade 链 ──────────────────────
 * 最直觉的写法是把所有镜头串成一条 xfade 链，硬切处用一个极短的 fade 代替。
 * 这条路踩过坑：**xfade 的 duration 小于约 0.1 秒时会静默丢弃前一段**，
 * 不报错、退出码 0，直到你 ffprobe 成片才发现 43 秒的片子只剩 5 秒。
 *
 * 所以改成：按「真转场」把时间轴切成若干段，
 *   - 段内全是硬切 → concat demuxer，-c copy 零重编码，几秒钟拼完
 *   - 段之间才用 xfade，且强制最短 0.1 秒
 * 副作用是快得多：4 分钟的片只有转场附近那几秒需要重编码。
 */

const MIN_XFADE = 0.1;

export interface TimelineEntry {
  id: string;
  start: number;
  end: number;
  /** 与 storyboard 里 start 字段的差值。转场会让后续镜头整体前移 */
  drift: number;
}

export async function assemble(
  sb: Storyboard,
  results: ShotResult[],
  projectRoot: string,
  buildDir: string,
  outFile: string,
  crf: number,
  preset: string,
): Promise<TimelineEntry[]> {
  // 第 i 个元素 = 第 i 个镜头「出点」的转场；最后一个恒为 null
  const trans: (TransitionSpec | null)[] = sb.shots.map((s) =>
    resolveTransition(s.transition === undefined ? (sb.defaultTransition ?? null) : s.transition),
  );
  trans[trans.length - 1] = null;

  const segments: { shots: ShotResult[]; outTransition: TransitionSpec | null }[] = [];
  let cur: ShotResult[] = [];
  for (let i = 0; i < results.length; i++) {
    cur.push(results[i]!);
    const t = trans[i];
    if (t && t.duration > 0) {
      const d = Math.max(MIN_XFADE, t.duration);
      if (d !== t.duration) {
        console.warn(`  ⚠ 转场时长 ${t.duration}s 太短，已提升到 ${MIN_XFADE}s（xfade 的下限）`);
      }
      segments.push({ shots: cur, outTransition: { type: t.type, duration: d } });
      cur = [];
    }
  }
  if (cur.length) segments.push({ shots: cur, outTransition: null });

  const segDir = path.join(buildDir, 'segments');
  fs.mkdirSync(segDir, { recursive: true });

  const segFiles: { file: string; duration: number; outTransition: TransitionSpec | null }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const f = path.join(segDir, `seg${String(i).padStart(3, '0')}.mp4`);
    await concatDemux(seg.shots, buildDir, f, i);
    segFiles.push({
      file: f,
      duration: seg.shots.reduce((a, s) => a + s.duration, 0),
      outTransition: seg.outTransition,
    });
  }

  const videoOnly = path.join(buildDir, 'video-only.mp4');
  if (segFiles.length === 1) {
    fs.copyFileSync(segFiles[0]!.file, videoOnly);
  } else {
    await xfadeSegments(segFiles, videoOnly, sb, crf, preset);
  }

  await muxAudioAndSubs(sb, projectRoot, videoOnly, outFile, crf, preset);

  return computeTimeline(sb, results, trans);
}

/**
 * 算出每个镜头在成片里的真实起止时间。
 *
 * 这一步不是锦上添花：每加一个转场，其后所有镜头都会前移一个 duration。
 * 分镜表里的 start 是「各镜头 duration 顺序累加」的理想值，跟成片对不上。
 * 字幕、注记叠加、竖版切条都依赖真实时间轴，所以写到 build/timeline.json 里。
 */
function computeTimeline(
  sb: Storyboard,
  results: ShotResult[],
  trans: (TransitionSpec | null)[],
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let t = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const start = t;
    const end = start + r.duration;
    out.push({
      id: r.id,
      start: round3(start),
      end: round3(end),
      drift: round3(start - (sb.shots[i]?.start ?? start)),
    });
    const tr = trans[i];
    // 下一镜的起点 = 本镜终点 - 转场交叠时长
    t = end - (tr && tr.duration > 0 ? Math.max(MIN_XFADE, tr.duration) : 0);
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 无损拼接一段内的硬切镜头 */
async function concatDemux(
  shots: ShotResult[],
  buildDir: string,
  outFile: string,
  segIndex: number,
): Promise<void> {
  const listFile = path.join(buildDir, `concat-${segIndex}.txt`);
  const lines = shots.map((r) => `file '${toConcatPath(r.file)}'`);
  fs.writeFileSync(listFile, lines.join('\n') + '\n', 'utf8');
  await run([
    '-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-fflags', '+genpts',
    '-c', 'copy',
    outFile,
  ]);
}

/** concat demuxer 的路径转义：统一正斜杠，单引号要转义 */
function toConcatPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

/**
 * 转场可以写预设名（`"transition": "crossfade"`）也可以写完整对象。
 * 预设名对齐 fx-kit 的特效 id —— 02 交叉溶解 / 03 横扫切换 / 04 闪白。
 */
function resolveTransition(t: TransitionSpec | string | null | undefined): TransitionSpec | null {
  if (!t) return null;
  if (typeof t !== 'string') return t;
  const preset = TRANSITION_PRESETS[t];
  if (!preset) {
    throw new Error(
      `未知的转场预设「${t}」。可用：${Object.keys(TRANSITION_PRESETS).join(' / ')}，` +
        '或者直接写 { "type": "xfade 的转场名", "duration": 秒 }',
    );
  }
  return preset;
}

/** 段与段之间做 xfade */
async function xfadeSegments(
  segs: { file: string; duration: number; outTransition: TransitionSpec | null }[],
  outFile: string,
  sb: Storyboard,
  crf: number,
  preset: string,
): Promise<void> {
  const inputs: string[] = [];
  for (const s of segs) inputs.push('-i', s.file);

  const parts: string[] = [];
  let cur = '0:v';
  let acc = segs[0]!.duration;

  for (let i = 1; i < segs.length; i++) {
    const t = segs[i - 1]!.outTransition!;
    const label = i === segs.length - 1 ? 'vout' : `v${i}`;
    const offset = acc - t.duration;
    parts.push(
      `[${cur}][${i}:v]xfade=transition=${t.type}:duration=${t.duration}:offset=${offset.toFixed(4)}[${label}]`,
    );
    acc = acc - t.duration + segs[i]!.duration;
    cur = label;
  }

  await run([
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vout]',
    '-r', String(sb.fps),
    ...encodeArgs(crf, preset),
    outFile,
  ]);
}

/**
 * 合入音轨 + 烧录字幕。
 * 没有字幕要烧时走 -c:v copy，省掉一次全片重编码。
 */
async function muxAudioAndSubs(
  sb: Storyboard,
  projectRoot: string,
  videoOnly: string,
  outFile: string,
  crf: number,
  preset: string,
): Promise<void> {
  const audioAbs = sb.audio ? path.resolve(projectRoot, sb.audio) : null;
  const hasAudio = !!audioAbs && fs.existsSync(audioAbs);
  const subAbs = sb.subtitle ? path.resolve(projectRoot, sb.subtitle) : null;
  const needBurn = !!subAbs && fs.existsSync(subAbs);

  if (!hasAudio && !needBurn) {
    fs.copyFileSync(videoOnly, outFile);
    return;
  }

  const args: string[] = ['-y', '-loglevel', 'error', '-i', videoOnly];
  if (hasAudio) args.push('-i', audioAbs!);

  if (needBurn) {
    args.push('-vf', `subtitles=${escapeForFilter(subAbs!)}`, ...encodeArgs(crf, preset));
  } else {
    args.push('-c:v', 'copy');
  }

  if (hasAudio) {
    args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  } else {
    args.push('-an');
  }

  args.push(outFile);
  await run(args);
}

/**
 * subtitles 滤镜的路径转义 —— Windows 上最常见的坑。
 * 反斜杠要转成正斜杠，盘符的冒号必须转义，
 * 否则 ffmpeg 会把 C: 当成滤镜参数分隔符，报一个完全看不懂的错。
 */
function escapeForFilter(p: string): string {
  const norm = p.replace(/\\/g, '/');
  return `'${norm.replace(/'/g, "\\'").replace(/:/g, '\\:')}'`;
}

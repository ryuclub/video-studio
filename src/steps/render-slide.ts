import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import type { RenderProfile, SlideScript, SlideTimeline, Timeline } from '../types.js';
import { buildSlideAss, buildSrt, PAPER_HEX } from '../lib/slides.js';
import { ffmpeg, durationMs, log } from '../lib/util.js';
import { buildAudioMix, assertAudioContinuous } from './render.js';

/**
 * PPT 风的渲染：一遍就够。
 *
 * 空镜风要四遍（归一化镜头 → concat → 混音 → 调色烧字幕），因为画面是几十条
 * 参数各异的素材。PPT 风的画面是一张纯色底，没有素材、没有运镜、没有调色，
 * 所以只剩「纯色源 + 烧字幕 + 搬运音轨」一步。
 *
 * 实际收益比省一遍编码大得多：近静止画面对 x264 极其友好，
 * 4–5 分钟的片子编码一分钟出头、体积几 MB，而且完全不碰 Pexels。
 *
 * 音轨复用空镜风那套 —— buildAudioMix 单独跑一遍是必须的，
 * loudnorm 和 libx264 挤在同一次 run 会整块丢音频，两种风格都会踩。
 */

function escapeForFilter(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function renderSlide(
  dir: string,
  script: SlideScript,
  tl: SlideTimeline,
  p: RenderProfile,
): Promise<string> {
  const assFile = path.join(dir, `subtitle_${p.name}.ass`);
  fs.writeFileSync(assFile, buildSlideAss(script, tl, p), 'utf8');
  fs.writeFileSync(path.join(dir, `subtitle_${p.name}.srt`), buildSrt(script, tl, p), 'utf8');

  const audioMs = await durationMs(tl.audioFile);
  const targetMs = Math.max(audioMs, tl.totalMs);
  // buildAudioMix 只用到 audioFile，喂一个形状兼容的对象即可
  const mixFile = await buildAudioMix(dir, { audioFile: tl.audioFile, totalMs: targetMs, lines: [] } as Timeline, targetMs);

  const outFile = path.join(dir, `${p.name}.mp4`);
  log('render', `[${p.name}] ${script.slides.length} 屏 / 纯色底 ${PAPER_HEX}`);

  await ffmpeg([
    '-f', 'lavfi',
    '-i', `color=c=${PAPER_HEX}:s=${p.width}x${p.height}:r=${CONFIG.fps}`,
    '-i', mixFile,
    '-filter_complex', `[0:v]subtitles='${escapeForFilter(assFile)}'[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', CONFIG.preset, '-crf', CONFIG.crf,
    '-c:a', 'copy',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-t', (targetMs / 1000).toFixed(3),
    outFile,
  ]);

  await assertAudioContinuous(outFile);
  const outMs = await durationMs(outFile);
  if (outMs < audioMs - 250) {
    throw new Error(`成片 ${(outMs / 1000).toFixed(2)}s 短于音频 ${(audioMs / 1000).toFixed(2)}s，结尾被截断了`);
  }
  const sizeMb = (fs.statSync(outFile).size / 1e6).toFixed(1);
  log('render', `完成 ${(outMs / 1000).toFixed(1)}s / ${sizeMb}MB → ${outFile}`);
  return outFile;
}

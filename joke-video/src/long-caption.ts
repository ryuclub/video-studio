// ── 长片的字幕：屏上的字和 .srt 从这一个地方来 ─────────────────────────
//
// **这不是省事，是防漂。** 出帧脚本（`tools/long-frames.mts`）把字画在画面上，
// `npm run audio` 把同一批字写成 `.srt` —— **两处各算一套的话，屏上的字和 .srt
// 会慢慢对不上**，而且不报错，只有把片子和字幕摆在一起看的人才发现。
// （`xinli-text.ts` 顶上那条注释记着同一个教训。）
//
// ⚠ **不要拿 `shuoshu-srt.ts` 的 `toSrt()` 来出长片的 srt。**
// 那个函数里裹着 `tidyCaption()`，规则是「去尾标点 ＋ **句中句号换逗号**」——
// 那是短片／说书那条线的频道规范，而**长片明文不照搬**
// （`horse/长片_出片方案.md` §四之三：长句里逗号是断句的手，句中的标点照留）。
// 套上去不报错，只是一整篇的句号被悄悄换成逗号。这儿只借它的 `stamp()`。

import { stamp } from './shuoshu-srt.js';
import type { JokeCfg } from './types.js';
import type { Timeline } from './types.js';

/**
 * 引号：**扶正，不删。**
 *
 * 规范说的是「只去句末标点，**句中的照留**」，引号是句中标点。
 * 但稿子里写的是**半角直引号 `"`**（U+0022，开合同形、只有半个字宽），
 * 直接上屏在中文里是坏字形 —— 所以**照留，但扶正成「」**：
 * 稿子要的是「这是引用」，不是这个符号本身。
 *
 * ⚠ 曾经这儿是**整个删掉**：「他没说"你别这么想"，也没说"其实你挺好的"」
 * 删完变成「他没说你别这么想，也没说其实你挺好的」，引的话和说的话糊成一句。
 */
export const quotes = (s: string): string => {
  let open = true;
  return s.replace(/["“”]/g, () => ((open = !open) ? '」' : '「'));
};

/**
 * 去句末标点。**句中的照留**（2026-08-25 用户定）。
 *
 * 短片那条线的规矩是「结尾不留标点 ＋ 句中句号换逗号」，**长片不照搬**：
 * 长句里逗号是断句的手，去掉之后一整行读起来是平的。
 *
 * 收尾的右引号要留住 —— 「他没说「你别这么想」」这一小句的末尾是引号不是句号。
 */
export const stripTail = (s: string): string => s.replace(/[。！？，、；：]+$/, '').trim();

/** 一句话拆成几小句（按句末标点）。**旁白太长就逐句上**，不再一次铺三行 */
export const cutSentence = (s: string): string[] =>
  (s.match(/[^。！？]*[。！？]|[^。！？]+$/g) ?? [s]).map((x) => x.trim()).filter(Boolean);

/**
 * 一小句里再断行：≤18 字一行，最多两行（三行会顶到画面中间）。
 *
 * ⚠ **断行优先在标点后**（出片方案 §四之三 那三条自动规则之一）。
 * 从正中往两边找最近的标点，落在 [30%, 85%] 里才算数 ——
 * 太靠边的标点断出来是一长一短，比劈词还难看。找不到才退回对半砍。
 *
 * **18 字那条上限是软的**：按标点断出来可能是 11/19，19 字 × 40px ＝ 760px，
 * 在 1280 的画布上仍旧宽裕 —— **宁可行长不齐，也不要把词劈开**。
 */
const BREAK_AFTER = '，、；：。！？…—」』）';
export function wrapOne(text: string, max = 18): string[] {
  const chars = [...text];
  if (chars.length <= max) return [text];
  const mid = Math.ceil(chars.length / 2);
  const lo = Math.floor(chars.length * 0.3);
  const hi = Math.ceil(chars.length * 0.85);
  let cut = -1;
  for (let d = 0; d < chars.length; d++) {
    for (const i of [mid + d, mid - d]) {
      if (i < lo || i > hi) continue;
      if (BREAK_AFTER.includes(chars[i - 1])) {
        cut = i;
        break;
      }
    }
    if (cut > 0) break;
  }
  const at = cut > 0 ? cut : mid;
  return [chars.slice(0, at).join(''), chars.slice(at).join('')];
}

/**
 * 一句旁白摊成几小句 ＋ 各自占多长。
 *
 * **按字数摊**，跟出帧脚本挑「现在念到哪一小句」是同一个算法 ——
 * 两处只要有一处换了摊法，字幕就会比画面早一拍或晚一拍。
 */
export function narrParts(body: string, start: number, dur: number): Array<{ text: string; start: number; end: number }> {
  const parts = cutSentence(body);
  const chars = parts.map((p) => Math.max(1, [...p].length));
  const total = chars.reduce((a, b) => a + b, 0);
  const out: Array<{ text: string; start: number; end: number }> = [];
  let acc = start;
  for (let i = 0; i < parts.length; i++) {
    const d = (dur * chars[i]) / total;
    out.push({ text: parts[i], start: acc, end: acc + d });
    acc += d;
  }
  return out;
}

export interface LongCue {
  start: number;
  end: number;
  /** 已经断好行的文本（一或两行），跟屏上一模一样 */
  lines: string[];
  /** 旁白 / 台词 / 回忆 —— 出帧那头按它分层排版 */
  layer: string;
  who: string;
}

/**
 * 整片的字幕条。**出帧和 .srt 都从这儿拿。**
 *
 * ⚠ **时刻从对齐过的时间轴来**（`line.dur` 是 `npm run align` 回填的真实秒数）。
 * 没跑 align 的话时间轴退回 `estimateDur` 的估算值 —— **不报错，字幕照出，只是对不上**。
 */
export function longCues(cfg: JokeCfg, tl: Timeline): LongCue[] {
  const out: LongCue[] = [];
  for (const seg of tl.segments) {
    if (seg.kind !== 'line' || seg.lineIndex === undefined) continue;
    const line = cfg.lines[seg.lineIndex];
    if (!line) continue;
    const body = quotes((line.say ?? []).map((s) => s.text).join('') || line.text || '');
    if (!body) continue;
    const layer = (line as { _layer?: string })._layer ?? '旁白';
    const dur = line.silent ?? line.dur ?? seg.end - seg.start;
    if (layer === '旁白') {
      // 旁白逐句上：一小句一条
      for (const p of narrParts(body, seg.start, dur))
        out.push({ start: p.start, end: p.end, lines: wrapOne(stripTail(p.text)), layer, who: line.who });
    } else {
      // 台词整句一条 —— 它在屏上就是整块出现的，不逐句浮
      out.push({ start: seg.start, end: seg.start + dur, lines: wrapOne(stripTail(body), 15), layer, who: line.who });
    }
  }
  return out;
}

/**
 * 拼 .srt。
 *
 * ⚠ **带 UTF-8 BOM** —— Windows 上一堆播放器（PotPlayer、旧版 MPC）不认没 BOM 的
 * UTF-8，会按 GBK 解，中文全成乱码。（跟 `shuoshu-srt.ts` 的 `toSrt` 同一个理由。）
 *
 * ⚠ **文本不再过 `tidyCaption()`** —— 见本文件抬头那条：那是别的线的标点规范。
 * 这儿的字已经在 `longCues` 里按长片的规矩处理过了，**再洗一遍就是洗错**。
 */
export function longSrt(cues: LongCue[]): string {
  return (
    '﻿' +
    cues
      .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.lines.join('\n')}\n`)
      .join('\n')
  );
}

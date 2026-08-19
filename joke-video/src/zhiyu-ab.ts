// ── 治愈线音色 A/B：一次只动一个变量，找出"不正常"来自哪一层 ──────────
//
// 第一轮六条候选反馈是「都不行，没一个正常」。六条共用三样东西，
// 嫌疑都在这三样，不在音色本身：
//
//   ① rate −38% —— 拉得太长。而且这个数是我算错的：
//      稿件的「190 字/分」是用来换算整期字数配额的（45–60 分钟 ≈ 8500–11400 字），
//      **必然含停顿**，是整期均速，不是说话速度。
//      按 443 字 / 25 个 1.1s 停顿反推，说话速度该是 236 字/分 ≈ rate −20%。
//   ② aecho=...:12: —— 12ms 延时是**梳状滤波**，不是房间反射。
//      joke-video 的艳鬼预设就用 22ms 做"一个人说话带出两个"的效果，
//      12ms 只会更明显。稿件写的是「极小房间反射」，我照它给的 ffmpeg 行抄了，
//      但那一行本身可能就不对。
//   ③ deesser 参数是我猜的，可能把齿音削过头，听着含混。
//
// 所以：短样本（前八句，约 20 秒），一次只换一个变量。

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { synthesizeJoke } from './tts.js';
import { readWav, writeWav } from './audio/wav.js';
import { measure } from './audio/measure.js';
import { SR } from './config.js';

const PROJ = '../zhiyu/projects/2026-08-19_hojoki';
const OUT = `${PROJ}/ab-方丈记202`;

interface Variant {
  no: string;
  cast: string;
  /** 后期链；空数组 = 完全不处理 */
  chain: string[];
  /** 这一条的句间停顿（秒）。**慢的感觉可以来自这里，不必来自拉长每个字** */
  gap: number;
  desc: string;
}

const DEESSER = 'deesser=i=0.4:m=0.5:f=0.5';
const SHELF = 'highshelf=f=8000:g=-3';
const COMP = 'acompressor=ratio=2:attack=30:release=200';
const ECHO = 'aecho=0.85:0.9:12:0.12';

const VARIANTS: Variant[] = [
  { no: 'F1', cast: '夜读方丈记', chain: [SHELF, COMP], gap: 1.25, desc: '音高回到 202Hz，厚度与频道基准一致' },
  { no: 'F2', cast: '夜读方丈记厚', chain: [SHELF, COMP], gap: 1.25, desc: '音高同样 202Hz，共振峰再低一档（更厚）' },
];

function main() {
  mkdirSync(OUT, { recursive: true });
  const raw = readFileSync(`${PROJ}/试听稿.md`, 'utf8');
  const body = raw.split(/^---$/m).slice(1).join('---');
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>'));
  const chars = lines.reduce((s, l) => s + [...l].length, 0);
  console.log(`A/B 用前 ${lines.length} 句 / ${chars} 字\n`);
  return { lines, chars };
}

const { lines, chars } = main();
const rows: string[] = [];

for (const v of VARIANTS) {
  const id = `_zhiyuab/${v.no}`;
  await synthesizeJoke({
    id,
    type: 'B',
    scene: 'abstract',
    characters: [{ id: '_', rig: 'none', side: 'left', cast: v.cast }],
    lines: lines.map((text) => ({ who: '_', text, beat: 'setup' as const })),
  });

  const parts = lines.map((_, i) => readWav(`voice/${id}/${i + 1}-_.wav`).data);
  const speech = parts.reduce((s, p) => s + p.length, 0);
  const gap = Math.round(v.gap * SR);
  const buf = new Float32Array(speech + gap * (parts.length - 1));
  let at = 0;
  for (const p of parts) { buf.set(p, at); at += p.length + gap; }

  const src = `${OUT}/_raw-${v.no}.wav`;
  writeWav(src, buf, SR);
  const dst = `${OUT}/${v.no}.wav`;
  if (v.chain.length) {
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-af', v.chain.join(','), '-ar', String(SR), '-ac', '1', dst], { encoding: 'utf8' });
  } else {
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ar', String(SR), '-ac', '1', dst], { encoding: 'utf8' });
  }

  const dry = new Float32Array(speech);
  let k = 0;
  for (const p of parts) { dry.set(p, k); k += p.length; }
  const m = measure(dry, SR);
  const spoken = speech / SR;
  const totalSec = spoken + v.gap * (parts.length - 1);
  rows.push(
    `| **${v.no}** | ${v.desc} | ${(chars / spoken * 60).toFixed(0)} | ${(chars / totalSec * 60).toFixed(0)} | ${m.f0} | ${m.f0Sd} |`
  );
  console.log(`  ${v.no}  说话 ${(chars / spoken * 60).toFixed(0)} 字/分　含停顿 ${(chars / totalSec * 60).toFixed(0)} 字/分　${v.desc.split('——')[0].trim()}`);
}

writeFileSync(
  `${OUT}/说明.md`,
  `# 《方丈记》· 音色 A/B（第二轮）

第一轮六条的反馈是「都不行，没一个正常」。六条共用三样东西，
嫌疑在这三样，不在音色本身。这一轮**一次只动一个变量**。

**先听 A。** A 是小晓原速、零处理 —— 它就是 Edge 出厂的样子。
拿它当尺子，后面每一条跟它比，判断"不正常"是从哪一步开始的。

| # | 变量 | 说话字/分 | 含停顿字/分 | 基频 Hz | 半音标准差 |
|---|---|---|---|---|---|
${rows.join('\n')}

## 三个嫌疑，各对应哪一对

1. **语速拉太长** —— 比 **A / B / C**。C 是第一轮用的 −38%。
   如果 C 明显不对而 B 还行，问题就是语速。

   顺带纠正一个我算错的地方：稿件的「190 字/分」是用来换算整期字数配额的
   （45–60 分钟 ≈ 8500–11400 字），**必然含停顿**，是整期均速，不是说话速度。
   我第一轮把它当说话速度用了，所以给到 −38%。按 443 字配 1.1 秒句间停顿反推，
   说话速度应该在 236 字/分左右，也就是 −20%。上表最后两列就是这两个口径。

2. **12ms 回声** —— 比 **E / F**。F 比 E 只多一个 \`aecho=...:12:\`。
   12ms 延时是**梳状滤波**不是房间反射（joke-video 的艳鬼预设用 22ms 做
   "一个人说话带出两个"，12ms 只会更明显）。稿件写的是「极小房间反射」，
   我照它给的 ffmpeg 行抄了，但那一行本身可能就不对。

3. **齿音处理过头** —— 比 **D / E**。E 比 D 只多一个 deesser，参数是我猜的。

## 听完告诉我哪一条最接近"正常"

以及是在哪一步开始不对的。定了基准再谈达标 ——
第一轮那些基频、半音标准差的指标，在"听着不正常"面前都不重要。
`
);
console.log(`\n${VARIANTS.length} 条 → ${OUT}/`);

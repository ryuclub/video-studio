#!/usr/bin/env node
/**
 * 基频对比 —— 克隆音跟本人差几个半音
 *
 *   node voice-clone/基频对比.mjs <本人录音> <克隆音> [更多克隆音...]
 *
 * 方案 §六 第 1 条的判据：**差在 ±1 个半音以内**。
 *
 * ⚠ **只看比值，不看绝对值。** 自相关估 F0 对参数很敏感 ——
 * 2026-09-07 实测：同一段录音，阈值和搜索范围从松到紧，量出 111.5 / 121.2 / 130.1 / 131.1 Hz，
 * 差了 3 个半音。所以绝对值不能单独拿出来用，
 * 必须**同一套参数量两边**，只信「同一行里的差值」。
 *
 * 脚本用四组参数各量一遍。**看最严的那两组**（松参数会在低音上发生倍频错判）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SR = 32000;
const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (files.length < 2) {
  console.error('用法: node voice-clone/基频对比.mjs <本人录音> <克隆音> [更多...]');
  process.exit(2);
}
for (const f of files) if (!fs.existsSync(f)) { console.error('找不到: ' + f); process.exit(2); }

function load(f) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'], { maxBuffer: 1 << 30 });
  const n = b.length >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(i * 2) / 32768;
  return x;
}

/** 逐帧自相关。gate 按这份音频自己的语音电平定，不用绝对阈值 */
function f0(x, thr, lo, hi) {
  const W = Math.round(0.04 * SR), H = Math.round(0.02 * SR);
  const lagMin = Math.round(SR / hi), lagMax = Math.round(SR / lo);
  // 先定这份音频的「够响」线：帧电平的中位数
  const lv = [];
  for (let p = 0; p + W <= x.length; p += H) {
    let a = 0;
    for (let i = p; i < p + W; i++) a += x[i] * x[i];
    lv.push(db(Math.sqrt(a / W)));
  }
  const gate = [...lv].sort((a, b) => a - b)[Math.floor(lv.length * 0.55)];
  const out = [];
  let k2 = 0;
  for (let p = 0; p + W <= x.length; p += H, k2++) {
    if (lv[k2] < gate) continue;
    let best = 0, bl = 0;
    for (let l = lagMin; l <= lagMax; l++) {
      let s = 0, e1 = 0, e2 = 0;
      for (let i = 0; i + l < W; i++) { s += x[p + i] * x[p + i + l]; e1 += x[p + i] * x[p + i]; e2 += x[p + i + l] * x[p + i + l]; }
      const c = s / Math.sqrt(e1 * e2 + 1e-12);
      if (c > best) { best = c; bl = l; }
    }
    if (best >= thr) out.push(SR / bl);
  }
  out.sort((a, b) => a - b);
  return out;
}

const 组 = [
  ['0.45 / 60-300Hz', 0.45, 60, 300, false],
  ['0.60 / 60-300Hz', 0.60, 60, 300, false],
  ['0.60 / 80-300Hz', 0.60, 80, 300, true],
  ['0.70 / 80-260Hz', 0.70, 80, 260, true],
];

const 音 = files.map((f) => ({ name: path.basename(f), x: load(f) }));
console.log('');
console.log('基准（本人）: ' + 音[0].name);
console.log('─'.repeat(74));
const 严 = [];
for (const [名, thr, lo, hi, 是严] of 组) {
  const 值 = 音.map((a) => {
    const v = f0(a.x, thr, lo, hi);
    return v.length ? v[Math.floor(v.length * 0.5)] : NaN;
  });
  const 行 = 值.map((v, i) =>
    i === 0 ? `${v.toFixed(1)}Hz` : `${v.toFixed(1)}Hz(${(12 * Math.log2(v / 值[0]) > 0 ? '+' : '')}${(12 * Math.log2(v / 值[0])).toFixed(2)})`,
  );
  console.log((是严 ? '★ ' : '  ') + 名.padEnd(18) + 行.map((s) => s.padStart(20)).join(''));
  if (是严) 严.push(值);
}
console.log('─'.repeat(74));
console.log('  列: ' + 音.map((a, i) => `${i + 1}=${a.name}`).join('　'));
console.log('  括号里是相对本人的半音差。**只看 ★ 那两行** —— 松参数会在低音上倍频错判。');
console.log('');
for (let i = 1; i < 音.length; i++) {
  const d = 严.map((v) => 12 * Math.log2(v[i] / v[0]));
  const 均 = d.reduce((a, b) => a + b, 0) / d.length;
  const 过 = Math.abs(均) <= 1;
  console.log(`${音[i].name}: ${均 > 0 ? '+' : ''}${均.toFixed(2)} 半音  ${过 ? '✅ 在 ±1 以内' : '❌ 超出 ±1'}`);
}
console.log('');

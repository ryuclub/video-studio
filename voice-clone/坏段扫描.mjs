#!/usr/bin/env node
/**
 * 坏段扫描 —— 把一份录音里「不该拿去训练」的时间段列出来
 *
 *   node voice-clone/坏段扫描.mjs <音频文件>
 *
 * [`录音体检.mjs`](录音体检.mjs) 回答的是「这份录音整体能不能用」，
 * 这个回答的是「**哪几段要删**」。切分打标之后照着这份清单核对，
 * 把命中的小段丢掉 —— 方案 §三 那条「坏段要删」，靠这个落地。
 *
 * 抓三类（都是 2026-09-07 在《老石原音》上实际撞到的）：
 *
 * 1. **风声／低频突发** —— 300Hz 以下的能量压过人声主带。
 *    用户听出来的 06:58 就是这类：100~300Hz 占 68%，而 300~1k 只剩 11%。
 * 2. **持续无停顿** —— 一整段电平平得没有句间空隙。人说话必然有间隙，
 *    平的就不是人声（背景音乐、车过、某个一直响的东西）。
 *    09:30 那 30 秒就是：−21~−24dB 稳定不变，有声占比 0%。
 * 3. **人声塌陷** —— 这一段几乎没声了。降噪器压过头会造成，
 *    而**全片统计完全看不出来**（信噪比反而更好看），必须逐段看。
 *
 * ⚠ **列出来不等于坏。** 这是给人核对的线索，不是自动删除的依据 ——
 * 边界值总会误报几条，听一下再决定。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SR = 32000;
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file || !fs.existsSync(file)) {
  console.error('用法: node voice-clone/坏段扫描.mjs <音频文件>');
  process.exit(2);
}

const buf = execFileSync(
  'ffmpeg',
  ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-'],
  { maxBuffer: 1 << 30 },
);
const n = buf.length >> 1;
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2) / 32768;

const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const 时刻 = (s) =>
  String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function fft(re, im) {
  const M = re.length;
  for (let i = 1, j = 0; i < M; i++) {
    let b = M >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let L = 2; L <= M; L <<= 1) {
    const a = -2 * Math.PI / L, wr = Math.cos(a), wi = Math.sin(a), h = L >> 1;
    for (let i = 0; i < M; i += L) {
      let cr = 1, ci = 0;
      for (let k = 0; k < h; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + h] * cr - im[i + k + h] * ci;
        const vi = re[i + k + h] * ci + im[i + k + h] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + h] = ur - vr; im[i + k + h] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/* ---------- 逐秒：低频占比、电平、平坦度 ---------- */
const N = 4096;
const win = new Float64Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
const bin = SR / N;
const 秒 = [];
for (let s = 0; s + SR <= n; s += SR) {
  const mag = new Float64Array(N / 2);
  let c = 0;
  for (let o = 0; o + N <= SR; o += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + o + i] * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] += re[k] * re[k] + im[k] * im[k];
    c++;
  }
  let 低 = 0, 声 = 0;
  for (let k = Math.round(20 / bin); k < Math.round(300 / bin); k++) 低 += mag[k];
  for (let k = Math.round(300 / bin); k < Math.round(3000 / bin); k++) 声 += mag[k];
  // 这一秒内的 20ms 帧电平，用来看有没有句间空隙
  const w = Math.round(0.02 * SR), r = [];
  for (let p = s; p + w <= s + SR; p += w) {
    let a = 0;
    for (let i = p; i < p + w; i++) a += x[i] * x[i];
    r.push(db(Math.sqrt(a / w)));
  }
  r.sort((a, b) => a - b);
  秒.push({
    t: s / SR,
    lvl: db(Math.sqrt(mag.reduce((a, b) => a + b, 0) / mag.length) || 1e-12),
    低声比: 10 * Math.log10(低 / Math.max(声, 1e-30)),
    起伏: r[r.length - 1] - r[0],       // 这一秒里最响和最静差多少
    响: r[Math.floor(r.length * 0.9)],
  });
}

/* ---------- 判据（相对这份录音自己的常态，不用绝对阈值） ---------- */
const 比值 = 秒.map((o) => o.低声比).sort((a, b) => a - b);
const 常态低声比 = 比值[比值.length >> 1];
const 响值 = 秒.map((o) => o.响).sort((a, b) => a - b);
const 常态响 = 响值[Math.floor(响值.length * 0.6)];

const 命中 = [];
for (const o of 秒) {
  const 因 = [];
  if (o.低声比 > 常态低声比 + 8) 因.push('低频突发(风声)');
  if (o.起伏 < 8 && o.响 > 常态响 - 12) 因.push('持续无停顿');
  if (o.响 < 常态响 - 18) 因.push('人声塌陷');
  if (因.length) 命中.push({ t: o.t, 因 });
}

/* ---------- 合并成区间 ---------- */
const 段 = [];
for (const h of 命中) {
  const last = 段[段.length - 1];
  if (last && h.t - last.end <= 2) {
    last.end = h.t + 1;
    for (const f of h.因) if (!last.因.includes(f)) last.因.push(f);
  } else {
    段.push({ start: h.t, end: h.t + 1, 因: [...h.因] });
  }
}

console.log('');
console.log('坏段扫描  ' + file);
console.log(`总长 ${时刻(n / SR)}　常态低频/人声比 ${常态低声比.toFixed(1)}dB　常态语音电平 ${常态响.toFixed(1)}dB`);
console.log('─'.repeat(66));
if (!段.length) {
  console.log('没扫到明显的坏段。');
} else {
  for (const s of 段) {
    const 长 = s.end - s.start;
    console.log(
      `${时刻(s.start)} ~ ${时刻(s.end)}  ${String(长).padStart(3)}s   ${s.因.join('、')}`,
    );
  }
  const 总 = 段.reduce((a, s) => a + (s.end - s.start), 0);
  console.log('─'.repeat(66));
  console.log(`共 ${段.length} 段 / ${总} 秒，占全片 ${((总 / (n / SR)) * 100).toFixed(1)}%`);
}
console.log('');
console.log('⚠ 这是给人核对的线索，不是自动删除的依据 —— 听一下再决定。');
console.log('  切分打标之后，把落在这些区间里的小段丢掉即可。');
console.log('');

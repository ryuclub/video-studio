// ── BGM：Karplus-Strong 拨弦，做轻松的尤克里里循环 ─────────────────────
// 听得出是合成的，但零版权风险。想要更像真乐器：找一段无版权音乐放进 bgm/ 覆盖。

import { SR } from '../config.js';
import { add, biquad, gain, rngf } from './dsp.js';

/** 单根弦：Karplus-Strong */
function pluck(freq: number, dur: number, seed: number, damp = 0.996): Float32Array {
  const n = Math.floor(dur * SR);
  const N = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(N);
  const r = rngf(seed);
  for (let i = 0; i < N; i++) buf[i] = r() * 0.8;
  const out = new Float32Array(n);
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = buf[idx];
    const next = buf[(idx + 1) % N];
    const v = (cur + next) * 0.5 * damp;
    buf[idx] = v;
    out[i] = cur;
    idx = (idx + 1) % N;
  }
  // 起音软化，尾部淡出
  const a = Math.floor(0.004 * SR);
  for (let i = 0; i < a && i < n; i++) out[i] *= i / a;
  for (let i = 0; i < n; i++) out[i] *= Math.exp(-i / (0.9 * SR));
  return out;
}

const NOTE: Record<string, number> = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
};

/** 常用的四和弦进行（尤克里里高音区，听感轻快） */
const PROGRESSIONS: Record<string, string[][]> = {
  happy: [
    ['C4', 'E4', 'G4', 'C5'],
    ['A4', 'C5', 'E5', 'A5'],
    ['F4', 'A4', 'C5', 'F5'],
    ['G4', 'B4', 'D5', 'G5'],
  ],
  cheeky: [
    ['C4', 'E4', 'G4', 'C5'],
    ['G4', 'B4', 'D5', 'G5'],
    ['A4', 'C5', 'E5', 'A5'],
    ['F4', 'A4', 'C5', 'F5'],
  ],
};

/**
 * 生成一段 BGM。
 * @param dur 总时长（秒）
 * @param stopAt 骤停时刻（秒）。笑点处切掉 BGM 是最有效的笑点强化手段。
 */
export function makeBgm(dur: number, stopAt?: number, key = 'happy'): Float32Array {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  const prog = PROGRESSIONS[key] ?? PROGRESSIONS.happy;
  const bpm = 96;
  const beat = 60 / bpm;
  const bar = beat * 4;

  let t = 0;
  let barIdx = 0;
  while (t < dur) {
    const chord = prog[barIdx % prog.length];
    // 扫弦：每小节 1、2&、3、4& 位置，向下/向上交替
    const strums = [0, beat * 1.5, beat * 2, beat * 3.5];
    strums.forEach((off, si) => {
      const up = si % 2 === 1;
      const notes = up ? [...chord].reverse() : chord;
      notes.forEach((nm, i) => {
        const at = Math.floor((t + off + i * 0.012) * SR);
        const g = (up ? 0.55 : 0.85) * (1 - i * 0.08);
        add(out, pluck(NOTE[nm] ?? 440, 1.5, 1000 + barIdx * 13 + si * 7 + i, 0.9955), at, g);
      });
    });
    t += bar;
    barIdx++;
  }

  const shaped = biquad(biquad(out, 'hp', 190, 0.7, SR), 'lp', 5200, 0.8, SR);

  // 骤停：留 30ms 淡出避免爆音
  if (stopAt != null && stopAt < dur) {
    const s = Math.floor(stopAt * SR);
    const fade = Math.floor(0.03 * SR);
    for (let i = s; i < n; i++) {
      const k = i - s;
      shaped[i] *= k < fade ? 1 - k / fade : 0;
    }
  }
  // 开头淡入
  const fi = Math.floor(0.5 * SR);
  for (let i = 0; i < fi && i < n; i++) shaped[i] *= i / fi;

  return gain(shaped, 0.5);
}

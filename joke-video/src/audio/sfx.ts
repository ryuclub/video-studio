// ── 音效合成：全部代码生成，零版权风险 ────────────────────────────────
// 打击类（咚/木鱼）合成效果最好，可以给足音量；
// 氛围类（蝉鸣/草叶）不如实录自然，音量压到 -28dB 以下当垫底。

import { SR } from '../config.js';
import { noise, biquad, biquadSweep, decayEnv, env, mul, gain, sine, add, rngf } from './dsp.js';

export type SfxName = 'thud' | 'wood' | 'hiss' | 'grass' | 'slide' | 'cicada' | 'whoosh' | 'pop' | 'gulp';

/** 咚：定格用。低频正弦下扫 + 轻微失谐 + 短噪声打头 */
function thud(): Float32Array {
  const n = Math.floor(1.1 * SR);
  const out = new Float32Array(n);
  add(out, mul(sine(n, 72, 44, SR), decayEnv(n, 0.16, SR, 0.002)), 0, 1);
  add(out, mul(sine(n, 108, 63, SR), decayEnv(n, 0.1, SR, 0.002)), 0, 0.35);
  const click = mul(biquad(noise(Math.floor(0.03 * SR), 21), 'lp', 2200, 0.9, SR), decayEnv(Math.floor(0.03 * SR), 0.008, SR, 0.0008));
  add(out, click, 0, 0.5);
  return out;
}

/** 木鱼「叩」：疑问节拍。短脉冲 + 共振 */
function wood(): Float32Array {
  const n = Math.floor(0.26 * SR);
  const out = new Float32Array(n);
  const burst = mul(noise(n, 7), decayEnv(n, 0.012, SR, 0.0006));
  add(out, biquad(biquad(burst, 'bp', 1350, 7, SR), 'bp', 1350, 7, SR), 0, 3.2);
  add(out, mul(sine(n, 880, 800, SR), decayEnv(n, 0.035, SR, 0.001)), 0, 0.5);
  add(out, mul(sine(n, 2100, 1950, SR), decayEnv(n, 0.02, SR, 0.001)), 0, 0.25);
  return out;
}

/** 蛇「嘶」：带通噪声 + 慢起慢落 */
function hiss(): Float32Array {
  const n = Math.floor(0.62 * SR);
  const base = biquad(biquad(noise(n, 31), 'hp', 2600, 0.8, SR), 'bp', 5200, 1.1, SR);
  const e = env(n, SR, 0.09, 0.12, 0.72, 0.3);
  // 轻微的气流起伏
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wob = 1 + 0.18 * Math.sin((i / SR) * 2 * Math.PI * 5.5);
    out[i] = base[i] * e[i] * wob;
  }
  return gain(out, 1.5);
}

/** 草叶摩擦：随机小簇噪声，做开场环境 */
function grass(): Float32Array {
  const n = Math.floor(2.6 * SR);
  const out = new Float32Array(n);
  const r = rngf(97);
  for (let k = 0; k < 22; k++) {
    const at = Math.floor(Math.abs(r()) * (n - SR * 0.3));
    const len = Math.floor((0.05 + Math.abs(r()) * 0.12) * SR);
    const burst = mul(biquad(noise(len, 100 + k * 7), 'bp', 2600 + Math.abs(r()) * 2600, 1.2, SR), decayEnv(len, 0.03, SR, 0.01));
    add(out, burst, at, 0.6 + Math.abs(r()) * 0.5);
  }
  return gain(out, 1.6);
}

/** 拖长滑音：铺垫笑点前的下滑 */
function slide(): Float32Array {
  const n = Math.floor(0.8 * SR);
  const s = sine(n, 620, 165, SR);
  const e = env(n, SR, 0.02, 0.1, 0.8, 0.35);
  const out = mul(s, e);
  // 加一点二次谐波，别太纯
  const h = mul(sine(n, 1240, 330, SR), e);
  const mixOut = new Float32Array(n);
  for (let i = 0; i < n; i++) mixOut[i] = out[i] * 0.8 + h[i] * 0.16;
  return biquad(mixOut, 'lp', 4000, 0.7, SR);
}

/** 蝉鸣：AM 调制带通噪声。定格后的"死寂中的夏天" */
function cicada(dur = 4): Float32Array {
  const n = Math.floor(dur * SR);
  const base = biquad(biquad(noise(n, 55), 'bp', 4600, 2.2, SR), 'bp', 4600, 2.2, SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const am = 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 42);
    const slow = 0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 0.35);
    out[i] = base[i] * am * slow;
  }
  // 首尾淡入淡出
  const fade = Math.floor(0.4 * SR);
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[n - 1 - i] *= i / fade;
  }
  return gain(out, 2.4);
}

/** 转场 whoosh */
function whoosh(): Float32Array {
  const n = Math.floor(0.5 * SR);
  const swept = biquadSweep(noise(n, 13), 'bp', 400, 5200, 1.6, SR);
  return gain(mul(swept, env(n, SR, 0.12, 0.1, 0.7, 0.28)), 2.2);
}

/** 小 pop：字幕弹入 */
function pop(): Float32Array {
  const n = Math.floor(0.12 * SR);
  const out = mul(sine(n, 780, 420, SR), decayEnv(n, 0.028, SR, 0.001));
  return gain(out, 0.55);
}

/** 咽口水：尴尬瞬间可选 */
function gulp(): Float32Array {
  const n = Math.floor(0.3 * SR);
  const out = mul(sine(n, 190, 320, SR), env(n, SR, 0.03, 0.06, 0.5, 0.16));
  return gain(biquad(out, 'lp', 1200, 0.8, SR), 0.7);
}

const CACHE = new Map<string, Float32Array>();

export function sfx(name: SfxName, dur?: number): Float32Array {
  const key = `${name}:${dur ?? ''}`;
  if (CACHE.has(key)) return CACHE.get(key)!;
  let v: Float32Array;
  switch (name) {
    case 'thud': v = thud(); break;
    case 'wood': v = wood(); break;
    case 'hiss': v = hiss(); break;
    case 'grass': v = grass(); break;
    case 'slide': v = slide(); break;
    case 'cicada': v = cicada(dur ?? 4); break;
    case 'whoosh': v = whoosh(); break;
    case 'pop': v = pop(); break;
    case 'gulp': v = gulp(); break;
    default: v = new Float32Array(1);
  }
  CACHE.set(key, v);
  return v;
}

/** 打击类给足音量，氛围类压低 */
export const PERCUSSIVE: SfxName[] = ['thud', 'wood', 'pop'];
export const AMBIENT: SfxName[] = ['grass', 'cicada'];

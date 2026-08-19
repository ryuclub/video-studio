// ── 基础 DSP：双二阶滤波器、包络、噪声 ────────────────────────────────

export function rngf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

type Coef = { b0: number; b1: number; b2: number; a1: number; a2: number };

function coefs(type: 'lp' | 'hp' | 'bp', fc: number, q: number, sr: number): Coef {
  const w = (2 * Math.PI * fc) / sr;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const alpha = sw / (2 * q);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  if (type === 'lp') {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = (1 - cw) / 2;
  } else if (type === 'hp') {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = (1 + cw) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 静态滤波 */
export function biquad(x: Float32Array, type: 'lp' | 'hp' | 'bp', fc: number, q: number, sr: number): Float32Array {
  const c = coefs(type, Math.max(20, Math.min(sr / 2 - 100, fc)), q, sr);
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const out = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

/** 扫频滤波（whoosh 用）：fc 从 f0 扫到 f1 */
export function biquadSweep(x: Float32Array, type: 'lp' | 'bp', f0: number, f1: number, q: number, sr: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / (x.length - 1 || 1);
    const c = coefs(type, Math.max(20, Math.min(sr / 2 - 100, f0 * Math.pow(f1 / f0, t))), q, sr);
    const out = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = out;
    y[i] = out;
  }
  return y;
}

export function noise(n: number, seed: number): Float32Array {
  const r = rngf(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r();
  return out;
}

/** 指数衰减包络 */
export function decayEnv(n: number, tau: number, sr: number, attack = 0.004): Float32Array {
  const out = new Float32Array(n);
  const aN = Math.max(1, Math.floor(attack * sr));
  for (let i = 0; i < n; i++) {
    const a = i < aN ? i / aN : 1;
    out[i] = a * Math.exp(-i / (tau * sr));
  }
  return out;
}

/** ADSR-ish 简版包络 */
export function env(n: number, sr: number, a: number, d: number, s: number, r: number): Float32Array {
  const out = new Float32Array(n);
  const aN = a * sr;
  const dN = d * sr;
  const rN = r * sr;
  const sN = Math.max(0, n - aN - dN - rN);
  for (let i = 0; i < n; i++) {
    if (i < aN) out[i] = i / aN;
    else if (i < aN + dN) out[i] = 1 - (1 - s) * ((i - aN) / dN);
    else if (i < aN + dN + sN) out[i] = s;
    else out[i] = Math.max(0, s * (1 - (i - aN - dN - sN) / rN));
  }
  return out;
}

export function mul(a: Float32Array, b: Float32Array): Float32Array {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
  return out;
}

export function gain(a: Float32Array, g: number): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * g;
  return out;
}

export function add(dst: Float32Array, src: Float32Array, at: number, g = 1): void {
  for (let i = 0; i < src.length; i++) {
    const j = at + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i] * g;
  }
}

/** 正弦（可扫频） */
export function sine(n: number, f0: number, f1: number, sr: number, phase = 0): Float32Array {
  const out = new Float32Array(n);
  let ph = phase;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1 || 1);
    const f = f0 * Math.pow(f1 / f0, t);
    ph += (2 * Math.PI * f) / sr;
    out[i] = Math.sin(ph);
  }
  return out;
}

/** 峰值归一化到 dBFS */
export function normalize(x: Float32Array, peakDbfs: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak < 1e-9) return x;
  const target = Math.pow(10, peakDbfs / 20);
  return gain(x, target / peak);
}

/** 软限幅，避免叠加后削顶 */
export function softClip(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.tanh(x[i] * 1.05) * 0.96;
  return out;
}

// ── 配音对齐：去首尾静音测真实时长 + 逐帧包络（驱动口型和说话节拍）───────
//
// 配音是逐句生成的（每句一个 wav），时长是算出来的不是猜的，所以这里不需要
// 从整轨里切句——那条路要靠静音检测猜断句，段数经常对不上。

export interface Trim {
  start: number; // 样本
  end: number; // 样本
}

/** 找出语音的有效区间（去掉首尾静音） */
export function trimSilence(x: Float32Array, sr: number, thresholdDb = -42, padMs = 50): Trim {
  const win = Math.floor(0.02 * sr);
  const thr = Math.pow(10, thresholdDb / 20);
  const rmsAt = (i: number) => {
    let acc = 0;
    const n = Math.min(win, x.length - i);
    for (let k = 0; k < n; k++) acc += x[i + k] * x[i + k];
    return Math.sqrt(acc / Math.max(1, n));
  };
  let start = 0;
  for (let i = 0; i + win <= x.length; i += win) {
    if (rmsAt(i) > thr) {
      start = i;
      break;
    }
  }
  let end = x.length;
  for (let i = x.length - win; i >= 0; i -= win) {
    if (rmsAt(i) > thr) {
      end = Math.min(x.length, i + win);
      break;
    }
  }
  const pad = Math.floor((padMs / 1000) * sr);
  return { start: Math.max(0, start - pad), end: Math.min(x.length, end + pad) };
}

/**
 * 逐帧包络，归一化到 0..1。
 * 用途：口型三态（0 闭 / 1 半开 / 2 张）+ 说话节拍幅度。
 */
export function frameEnvelope(x: Float32Array, sr: number, fps: number): Float32Array {
  const per = sr / fps;
  const frames = Math.ceil(x.length / per);
  const out = new Float32Array(frames);
  let peak = 1e-9;
  for (let f = 0; f < frames; f++) {
    const i0 = Math.floor(f * per);
    const i1 = Math.min(x.length, Math.floor((f + 1) * per));
    let acc = 0;
    for (let i = i0; i < i1; i++) acc += x[i] * x[i];
    const v = Math.sqrt(acc / Math.max(1, i1 - i0));
    out[f] = v;
    peak = Math.max(peak, v);
  }
  // 归一化 + 轻微平滑，避免口型高频抖动
  for (let f = 0; f < frames; f++) out[f] = Math.min(1, out[f] / peak);
  const sm = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = out[Math.max(0, f - 1)];
    const b = out[f];
    const c = out[Math.min(frames - 1, f + 1)];
    sm[f] = (a + b * 2 + c) / 4;
  }
  return sm;
}

/** 包络 → 口型三态 */
export function mouthFrom(env: number): 0 | 1 | 2 {
  // 阈值是**相对峰值**的。0.55 太保守——一句话里只有最响的几帧够得着，
  // 实测 98 帧只有 4 帧全开，看着像没张嘴。放到 0.38 / 0.10 嘴才一直在动。
  if (env > 0.38) return 2;
  if (env > 0.1) return 1;
  return 0;
}

// ── 音色测量：把"听着不一样"变成可比的数字 ──────────────────────────
//
// 调音最费时间的不是改参数，是"改完了到底有没有变"说不清。
// 这里给三个指标，都能直接对着数字判断：
//
//   基频中位   音高。改 delivery 的 pitchHz 看这个动没动
//   低高频差   音色厚薄。两个角色差 <6dB 观众就分不清谁在说话
//   净时长     去掉首尾静音的实际语音长度。改 rate / tempo 看这个

export interface VoiceMetrics {
  /** 基频中位数 Hz。0 表示没测到有声段 */
  f0: number;
  /** 基频 10–90 分位跨度 Hz，越大语调起伏越丰富 */
  f0Range: number;
  /**
   * 基频的**半音标准差**。语调起伏的标准判据，比 f0Range 更该看这个。
   *
   * 为什么用半音不用 Hz：人耳听音程是**比值**不是差值。180→200Hz 和
   * 400→420Hz 都是 20Hz，前者听着明显在抬、后者几乎听不出来。
   * 换成半音（12·log2(f/中位)）之后，不同基频的人才能横向比。
   *
   * 治愈系助眠档的判据（见 zhiyu/治愈系旁白书目_选题稿件.md）：
   *   < 1.0    发死，会被听成非人声，警觉度反而抬升
   *   1.5–2.5  目标区间
   *   > 3.5    "有感情"了，抢注意力
   * 常规叙述在 3–4，情绪朗读 5 以上。
   */
  f0Sd: number;
  /** 低频(<600Hz) 与 高频(>2kHz) 的 RMS 差，dB。越大越"厚" */
  band: number;
  /** 去首尾静音后的净时长（秒） */
  dur: number;
}

/**
 * 归一化自相关测基频。
 *
 * **不能直接取原始自相关的最大值**——原始自相关没归一化，长句上会挑中
 * 倍频/半频的峰，量出来的方向能整个反过来（实测把 +50Hz 的"拔高"量成了 −51Hz）。
 * 两个必须做的处理：
 *   ① 除以两段的能量做归一化，消掉 lag 越大项数越少带来的偏置
 *   ② 取**第一个**够高的局部峰，不是全局最大 —— 全局最大常落在真实周期的整数倍上
 */
function f0Contour(x: Float32Array, sr: number, floorRms = 0.012): number[] {
  const out: number[] = [];
  const win = Math.floor(0.045 * sr);
  const lo = Math.floor(sr / 500); // 人声上限 500Hz（童声变声后能到 400+）
  const hi = Math.floor(sr / 70); //  人声下限 70Hz
  for (let s = 0; s + win < x.length; s += Math.floor(0.02 * sr)) {
    const seg = x.subarray(s, s + win);
    let e = 0;
    for (const v of seg) e += v * v;
    if (Math.sqrt(e / win) < floorRms) continue;

    const nsdf = new Float64Array(hi + 1);
    for (let lag = lo; lag <= hi; lag++) {
      let r = 0;
      let ea = 0;
      let eb = 0;
      const n = win - lag;
      for (let i = 0; i < n; i++) {
        r += seg[i] * seg[i + lag];
        ea += seg[i] * seg[i];
        eb += seg[i + lag] * seg[i + lag];
      }
      const d = Math.sqrt(ea * eb);
      nsdf[lag] = d > 0 ? r / d : 0;
    }

    let peak = 0;
    for (let lag = lo + 1; lag < hi; lag++) if (nsdf[lag] > peak) peak = nsdf[lag];
    if (peak < 0.35) continue; // 非周期段（辅音/噪声），跳过

    // 第一个达到 0.85×峰值的局部极大，就是基周期
    let best = 0;
    for (let lag = lo + 1; lag < hi; lag++) {
      if (nsdf[lag] >= nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] >= peak * 0.85) {
        best = lag;
        break;
      }
    }
    if (best) out.push(sr / best);
  }
  return out;
}

const pct = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;

/** 一阶 IIR 低通/高通，够用来分频段量能量 */
function filt(x: Float32Array, sr: number, fc: number, high: boolean): Float32Array {
  const dt = 1 / sr;
  const rc = 1 / (2 * Math.PI * fc);
  const out = new Float32Array(x.length);
  if (high) {
    const a = rc / (rc + dt);
    let prevIn = x[0];
    let prevOut = 0;
    for (let i = 0; i < x.length; i++) {
      prevOut = a * (prevOut + x[i] - prevIn);
      prevIn = x[i];
      out[i] = prevOut;
    }
  } else {
    const a = dt / (rc + dt);
    let prev = 0;
    for (let i = 0; i < x.length; i++) {
      prev = prev + a * (x[i] - prev);
      out[i] = prev;
    }
  }
  return out;
}

/** 只在有声段量 RMS，静音会把结果冲淡 */
function voicedRmsDb(x: Float32Array, gate: Float32Array, floorRms = 0.012, sr = 48000): number {
  const win = Math.floor(0.02 * sr);
  let acc = 0;
  let n = 0;
  for (let s = 0; s + win < x.length; s += win) {
    let ge = 0;
    for (let i = s; i < s + win; i++) ge += gate[i] * gate[i];
    if (Math.sqrt(ge / win) < floorRms) continue;
    for (let i = s; i < s + win; i++) acc += x[i] * x[i];
    n += win;
  }
  if (!n) return -Infinity;
  return 20 * Math.log10(Math.sqrt(acc / n));
}

export function measure(x: Float32Array, sr: number): VoiceMetrics {
  const raw = f0Contour(x, sr);
  const f = raw.slice().sort((a, b) => a - b);
  const lowB = voicedRmsDb(filt(x, sr, 600, false), x, 0.012, sr);
  const highB = voicedRmsDb(filt(x, sr, 2000, true), x, 0.012, sr);

  // 净时长：首尾各找第一个超过门限的 20ms 窗
  const win = Math.floor(0.02 * sr);
  const loud = (s: number) => {
    let e = 0;
    for (let i = s; i < Math.min(s + win, x.length); i++) e += x[i] * x[i];
    return Math.sqrt(e / win) > 0.012;
  };
  let a = 0;
  let b = x.length;
  for (let s = 0; s + win < x.length; s += win)
    if (loud(s)) {
      a = s;
      break;
    }
  for (let s = x.length - win; s >= 0; s -= win)
    if (loud(s)) {
      b = s + win;
      break;
    }

  // 半音标准差：先换算到以中位数为 0 的半音刻度，再求标准差。
  // 用中位数而不是均值做基准，避免个别倍频误判把整条曲线拽偏
  const med = pct(f, 0.5);
  let sd = 0;
  if (med > 0 && raw.length > 1) {
    const st = raw.filter((v) => v > 0).map((v) => 12 * Math.log2(v / med));
    const mean = st.reduce((a, b) => a + b, 0) / st.length;
    sd = Math.sqrt(st.reduce((a, b) => a + (b - mean) ** 2, 0) / st.length);
  }

  return {
    f0: Math.round(pct(f, 0.5)),
    f0Range: Math.round(pct(f, 0.9) - pct(f, 0.1)),
    f0Sd: Number(sd.toFixed(2)),
    band: Number((lowB - highB).toFixed(1)),
    dur: Number(((b - a) / sr).toFixed(2)),
  };
}

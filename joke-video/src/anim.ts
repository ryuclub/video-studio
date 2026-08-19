// ── 动效工具：缓动、关键帧采样、常驻振荡（呼吸/眨眼）──────────────────

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeInOut = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1));
  return t * t * (3 - 2 * t);
};

export type Key = [t: number, v: number];

/** 关键帧采样，段内用 easeInOut */
export function track(keys: Key[], t: number, ease = easeInOut): number {
  if (!keys.length) return 0;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i];
    const [t1, v1] = keys[i + 1];
    if (t < t1) return lerp(v0, v1, ease(clamp((t - t0) / (t1 - t0 || 1))));
  }
  return keys[keys.length - 1][1];
}

/** 常驻呼吸：body scaleY 1.0 ↔ 1.015，周期 2.4s */
export function breathe(t: number, period = 2.4, amp = 0.015) {
  return 1 + Math.sin((t / period) * Math.PI * 2) * amp;
}

/** 眨眼：每 3–5s 随机一次，闭合 120ms。返回 true 表示此刻眼睛闭着 */
export function blinking(t: number, seed = 1): boolean {
  let acc = 0;
  let i = 0;
  while (acc < t + 6) {
    const gap = 3 + ((Math.sin(seed * 9.7 + i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 2;
    if (t >= acc && t < acc + 0.12) return true;
    acc += gap;
    i++;
    if (i > 200) break;
  }
  return false;
}

/** 说话节拍：头部上下 ±amp px，跟随音频包络 env(0..1) */
export function talkBob(t: number, env: number, amp = 1.5, rate = 6.5) {
  return Math.sin(t * rate * Math.PI * 2) * amp * env;
}

/** 轻微抖动（惊讶用），dur 内衰减 */
export function shake(t: number, start: number, dur = 0.25, amp = 2.5) {
  const k = clamp((t - start) / dur);
  if (t < start || k >= 1) return { x: 0, y: 0 };
  const decay = 1 - k;
  return {
    x: Math.sin(t * 47) * amp * decay,
    y: Math.cos(t * 39) * amp * decay * 0.6,
  };
}

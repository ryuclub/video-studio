// ── 剪纸风基元 ─────────────────────────────────────────────────────────
// 规则：无渐变、无描边、投影用同色系加深（不用黑）、边缘轻微手撕不规则。
// 投影不用 SVG 滤镜，而是把同一形状偏移画一层——快 10 倍，且更像剪纸。

import { deepen } from './palette.js';

/** 可复现随机数：同一 seed 每帧结果一致，纸边不会抖动闪烁 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const n = (v: number) => Math.round(v * 100) / 100;

/** 沿一串点加 ±amt 的抖动，模拟手撕纸边 */
export function jitter(pts: [number, number][], seed: number, amt = 1.2): [number, number][] {
  const r = rng(seed);
  return pts.map(([x, y]) => [x + (r() - 0.5) * 2 * amt, y + (r() - 0.5) * 2 * amt]);
}

export function toPath(pts: [number, number][], close = true): string {
  if (!pts.length) return '';
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${n(pts[i][0])} ${n(pts[i][1])}`;
  return close ? d + ' Z' : d;
}

/** 手撕矩形（每条边细分后加抖动） */
export function tornRect(x: number, y: number, w: number, h: number, seed: number, amt = 1.4, per = 14): string {
  const pts: [number, number][] = [];
  const push = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(2, Math.round(len / per));
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
  };
  push(x, y, x + w, y);
  push(x + w, y, x + w, y + h);
  push(x + w, y + h, x, y + h);
  push(x, y + h, x, y);
  return toPath(jitter(pts, seed, amt));
}

/** 手撕圆／椭圆 */
export function tornEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, amt = 1.3, steps = 40): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return toPath(jitter(pts, seed, amt));
}

/** 圆头矩形（四肢、蛇身段用） */
export function capsule(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * (w / 2);
  const py = ux * (w / 2);
  const r = w / 2;
  return [
    `M${n(x1 + px)} ${n(y1 + py)}`,
    `L${n(x2 + px)} ${n(y2 + py)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x2 - px)} ${n(y2 - py)}`,
    `L${n(x1 - px)} ${n(y1 - py)}`,
    `A${n(r)} ${n(r)} 0 0 1 ${n(x1 + px)} ${n(y1 + py)}`,
    'Z',
  ].join(' ');
}

/**
 * 画一片"纸"：先在偏移位置画一层加深色当投影，再画本体。
 * dx/dy 默认 (3,4)，剪纸感的来源。
 */
export function piece(
  d: string,
  fill: string,
  o: { dx?: number; dy?: number; shadow?: boolean; opacity?: number; shadowAlpha?: number } = {}
): string {
  const dx = o.dx ?? 3;
  const dy = o.dy ?? 4;
  const op = o.opacity != null ? ` opacity="${o.opacity}"` : '';
  const sh =
    o.shadow === false
      ? ''
      : `<path d="${d}" fill="${deepen(fill, 0.5)}" opacity="${o.shadowAlpha ?? 0.11}" transform="translate(${n(dx)},${n(dy)})"/>`;
  return sh + `<path d="${d}" fill="${fill}"${op}/>`;
}

/**
 * 和纸纹理：输出「带 alpha 的暗斑」PNG，最后由 ffmpeg 用 overlay 叠到整片上。
 * 注意：不要用 ffmpeg 的 blend=multiply —— 实测会串色（画面整体发绿）。
 * @param strength 0.2 淡 / 0.5 默认 / 0.8 明显
 */
export function paperTextureSvg(w: number, h: number, strength = 0.45): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="7" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.10  0 0 0 0 0.09  0 0 0 0 0.07  0.34 0.34 0.34 0 -0.28"/>
    </filter>
    <filter id="fiber" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.004 0.22" numOctaves="2" seed="3" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.12  0 0 0 0 0.10  0 0 0 0 0.08  0.22 0.22 0.22 0 -0.20"/>
    </filter>
  </defs>
  <g opacity="${strength}">
    <rect width="${w}" height="${h}" fill="#888" filter="url(#grain)"/>
    <rect width="${w}" height="${h}" fill="#888" filter="url(#fiber)" opacity="0.35"/>
  </g>
</svg>`;
}

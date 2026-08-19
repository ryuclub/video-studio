// ── 长条型 rig：蛇 / 鱼 / 虫 / 蚯蚓 ────────────────────────────────────
// 身体是一条曲线，正弦摆动 + 沿法线偏移出宽度。头部抬起，五官在头部局部坐标里画。

import { piece, tornEllipse, toPath, jitter, rng, n, capsule } from '../style/papercut.js';
import { P } from '../style/palette.js';
import { smoothstep } from '../anim.js';
import type { CharState } from './state.js';

export function serpentine(s: CharState, ink: (c: string) => string, seed: number): string {
  const L = s.length ?? 420;
  const f = s.facing;
  const wMax = L * 0.115;
  const amp = L * 0.055;
  const freq = 1.55;
  const phase = s.t * 1.15;
  const N = 46;

  const body = ink(s.color);
  const bodyLight = ink(s.accent);

  // 中心线
  const pt = (u: number): [number, number] => {
    const px = -L * (1 - u);
    let py = Math.sin(u * Math.PI * 2 * freq + phase) * amp * (1 - u * 0.35);
    py -= 165 * smoothstep(0.7, 1, u); // 头部抬起
    return [px * f, py];
  };
  const width = (u: number) => wMax * (0.2 + 0.8 * Math.pow(u, 0.45)) * (1 - 0.25 * smoothstep(0.88, 1, u));

  const up: [number, number][] = [];
  const dn: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const [px, py] = pt(u);
    const [ax, ay] = pt(Math.min(1, u + 0.012));
    const [bx, by] = pt(Math.max(0, u - 0.012));
    const tx = ax - bx;
    const ty = ay - by;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const w = width(u) / 2;
    up.push([px + nx * w, py + ny * w]);
    dn.push([px - nx * w, py - ny * w]);
  }
  const bodyPath = toPath(jitter([...up, ...dn.reverse()], seed, 1.1));

  // 身上的菱形花纹（剪纸味）
  const r = rng(seed + 11);
  let marks = '';
  for (let i = 0; i < 4; i++) {
    const u = 0.22 + i * 0.14;
    const [px, py] = pt(u);
    const w = width(u) * 0.32;
    const jx = (r() - 0.5) * 3;
    marks += `<path d="${toPath([
      [px + jx, py - w],
      [px + w * 1.1 + jx, py],
      [px + jx, py + w],
      [px - w * 1.1 + jx, py],
    ])}" fill="${bodyLight}" opacity="0.5"/>`;
  }

  // 头部
  const [hx, hy] = pt(1);
  const [px0, py0] = pt(0.955);
  const angle = (Math.atan2(hy - py0, hx - px0) * 180) / Math.PI;
  const rx = wMax * 1.02;
  const ry = wMax * 0.8;

  const eyeCx = rx * 0.2;
  const eyeCy = -ry * 0.34;
  let eye = '';
  if (s.eyes === 'closed') {
    eye = `<path d="${capsule(eyeCx - 9, eyeCy, eyeCx + 9, eyeCy, 4)}" fill="${ink(P.paper)}"/>`;
  } else if (s.eyes === 'wide') {
    eye =
      `<path d="${tornEllipse(eyeCx, eyeCy, 21, 21, seed + 3, 0.7, 24)}" fill="${ink(P.paper)}"/>` +
      `<circle cx="${n(eyeCx + 3)}" cy="${n(eyeCy)}" r="7.5" fill="${ink(P.ink)}"/>`;
  } else {
    eye =
      `<path d="${tornEllipse(eyeCx, eyeCy, 9.5, 10, seed + 3, 0.6, 20)}" fill="${ink(P.paper)}"/>` +
      `<circle cx="${n(eyeCx + 1.5)}" cy="${n(eyeCy + 0.5)}" r="4.2" fill="${ink(P.ink)}"/>`;
  }
  // 眉毛：情绪 90% 靠眉毛
  const browY = eyeCy - (s.eyes === 'wide' ? 24 : 18);
  const browRot = s.brows === 'up' ? -18 : s.brows === 'down' ? 16 : -4;
  const brow = `<g transform="translate(${n(eyeCx)},${n(browY)}) rotate(${browRot})"><path d="${capsule(-11, 0, 11, 0, 5)}" fill="${ink(P.ink)}" opacity="0.75"/></g>`;

  // 嘴：三态
  const open = s.mouth === 2 ? 18 : s.mouth === 1 ? 8 : 0;
  const mx = rx * 0.52;
  const my = ry * 0.18;
  const mouth =
    open === 0
      ? `<path d="${capsule(mx - 14, my, mx + 12, my + 2, 4.5)}" fill="${ink(P.ink)}" opacity="0.6"/>`
      : `<path d="${tornEllipse(mx - 2, my + open * 0.25, 15, open * 0.62, seed + 5, 0.8, 20)}" fill="${ink('#5A2320')}"/>`;

  // 舌头：分叉，可带豁口
  let tongue = '';
  const tv = s.tongue ?? 0;
  if (tv > 0.02) {
    const base = [mx + 10, my + open * 0.3] as [number, number];
    const len = 56 * tv;
    const tipX = base[0] + len;
    const forkA = 26 * tv;
    const forkB = s.tongueNick ? 9 * tv : 26 * tv; // 豁口：一叉短一截
    const tc = ink(s.color === P.secondary ? P.accent : P.secondary);
    tongue =
      `<path d="${capsule(base[0], base[1], tipX, base[1] + 2, 11)}" fill="${tc}"/>` +
      `<path d="${capsule(tipX, base[1] + 2, tipX + forkA * 0.85, base[1] - forkA * 0.8, 8.5)}" fill="${tc}"/>` +
      `<path d="${capsule(tipX, base[1] + 2, tipX + forkB * 0.85, base[1] + forkB * 0.9, 8.5)}" fill="${tc}"/>`;
    if (s.tongueNick) {
      tongue += `<circle cx="${n(tipX + forkB * 0.8)}" cy="${n(base[1] + forkB * 0.8)}" r="7" fill="${ink(P.accent)}"/>`;
    }
  }

  const head =
    `<g transform="translate(${n(hx)},${n(hy + s.bob)}) rotate(${n(angle * f)}) scale(${f},1)">` +
    piece(tornEllipse(0, 0, rx, ry, seed + 2, 1.0, 34), body) +
    mouth +
    tongue +
    eye +
    brow +
    `</g>`;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY)}) scale(${n(s.scale)},${n(s.scale * s.breath)}) rotate(${n(-s.lean * f * 0.4)})">` +
    piece(bodyPath, body) +
    marks +
    head +
    `</g>`
  );
}

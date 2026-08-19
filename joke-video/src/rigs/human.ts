// ── 人物 rig：只有一套骨架 ────────────────────────────────────────────
// 大人/小孩/老人/男/女 的差别全是参数：头身比、肩宽、前倾角、动作速度、识别附件。
// 原点在双脚（y=0 处），向上为负 y。

import { piece, tornEllipse, tornRect, capsule, n } from '../style/papercut.js';
import { P } from '../style/palette.js';
import type { CharState } from './state.js';

interface Prop {
  headR: number;
  neckH: number;
  shoulderW: number;
  torsoH: number;
  hipW: number;
  legH: number;
  armLen: number;
  lean: number;
  /** 动作速度/幅度系数：小孩快而大，老人慢而小 */
  speed: number;
}

export const PROPORTIONS: Record<string, Prop> = {
  // 约 4 头身：头大、四肢短、动作快而弹
  child: { headR: 62, neckH: 10, shoulderW: 116, torsoH: 148, hipW: 96, legH: 132, armLen: 108, lean: -2, speed: 1.3 },
  // 约 7 头身
  adultM: { headR: 52, neckH: 22, shoulderW: 174, torsoH: 236, hipW: 122, legH: 250, armLen: 166, lean: 0, speed: 1.0 },
  adultF: { headR: 50, neckH: 22, shoulderW: 146, torsoH: 230, hipW: 116, legH: 252, armLen: 160, lean: 0, speed: 0.95 },
  // 约 6.5 头身 + 脊柱前倾：老人味来自前倾和慢，不是画皱纹
  elder: { headR: 52, neckH: 18, shoulderW: 158, torsoH: 214, hipW: 124, legH: 226, armLen: 154, lean: 10, speed: 0.7 },
};

/** 手势：相对肩点的肘/手位置（x 已按 facing 处理） */
function armPose(g: string, armLen: number, near: boolean) {
  const a = armLen;
  switch (g) {
    case 'point':
      return near
        ? { elbow: [0.34 * a, 0.3 * a], hand: [0.95 * a, 0.18 * a] }
        : { elbow: [-0.1 * a, 0.5 * a], hand: [-0.05 * a, 0.95 * a] };
    case 'shrug':
      return near
        ? { elbow: [0.42 * a, 0.32 * a], hand: [0.66 * a, -0.02 * a] }
        : { elbow: [-0.42 * a, 0.32 * a], hand: [-0.66 * a, -0.02 * a] };
    case 'facepalm':
      return near
        ? { elbow: [0.3 * a, 0.2 * a], hand: [0.1 * a, -0.55 * a] }
        : { elbow: [-0.12 * a, 0.5 * a], hand: [-0.06 * a, 0.95 * a] };
    default: // down
      return near
        ? { elbow: [0.2 * a, 0.48 * a], hand: [0.3 * a, 0.94 * a] }
        : { elbow: [-0.2 * a, 0.48 * a], hand: [-0.3 * a, 0.94 * a] };
  }
}

export function human(s: CharState, ink: (c: string) => string, seed: number): string {
  const pr = PROPORTIONS[s.proportion ?? 'adultM'] ?? PROPORTIONS.adultM;
  const f = s.facing;
  const body = ink(s.color);
  const skin = ink(P.light);
  const hairColor = s.hair === 'white' ? ink(P.paperDeep) : ink(P.ink);

  const hipY = -pr.legH;
  const shoulderY = hipY - pr.torsoH;
  const headCY = shoulderY - pr.neckH - pr.headR * 0.95;
  const lean = pr.lean + s.lean;

  // 腿
  const legW = pr.hipW * 0.36;
  const legs =
    piece(capsule(-pr.hipW * 0.24, hipY, -pr.hipW * 0.26, -6, legW), body, { dy: 3 }) +
    piece(capsule(pr.hipW * 0.24, hipY, pr.hipW * 0.28, -6, legW), body, { dy: 3 });

  // 躯干：梯形（肩宽 → 胯宽）
  const torso = piece(
    `M${n(-pr.shoulderW / 2)} ${n(shoulderY)} L${n(pr.shoulderW / 2)} ${n(shoulderY)} L${n(pr.hipW / 2)} ${n(hipY + 6)} L${n(-pr.hipW / 2)} ${n(hipY + 6)} Z`,
    body
  );

  // 脖子
  const neck = `<path d="${capsule(0, shoulderY + 6, 0, shoulderY - pr.neckH, pr.headR * 0.42)}" fill="${skin}"/>`;

  // 手臂
  const sx = pr.shoulderW * 0.44;
  const armW = pr.armLen * 0.14;
  const g = s.gesture ?? 'down';
  let armFar = '';
  let armNear = '';
  for (const near of [false, true]) {
    const pose = armPose(g, pr.armLen, near);
    const ox = (near ? sx : -sx) * f;
    const ex = ox + pose.elbow[0] * f;
    const ey = shoulderY + 8 + pose.elbow[1];
    const hx = ox + pose.hand[0] * f;
    const hy = shoulderY + 8 + pose.hand[1];
    const seg =
      `<path d="${capsule(ox, shoulderY + 8, ex, ey, armW)}" fill="${body}"/>` +
      `<path d="${capsule(ex, ey, hx, hy, armW * 0.88)}" fill="${body}"/>` +
      `<circle cx="${n(hx)}" cy="${n(hy)}" r="${n(armW * 0.62)}" fill="${skin}"/>`;
    if (near) armNear += seg;
    else armFar += `<g opacity="0.86">${seg}</g>`;
    if (near && (s.props ?? []).includes('cane')) {
      armNear += `<path d="${capsule(hx + 12, hy, hx + 24, -4, armW * 0.34)}" fill="${ink(P.neutral)}"/>`;
    }
  }

  // 头
  const R = pr.headR;
  const head = piece(tornEllipse(0, headCY, R * 0.93, R, seed + 2, 1.0, 36), skin);

  // 头发（识别年龄/性别的主要手段）
  let hair = '';
  const hs = s.hair ?? 'short';
  if (hs === 'long') {
    hair =
      piece(tornRect(-R * 0.9, headCY - R * 0.3, R * 1.8, R * 2.0, seed + 8, 1.4, 16), hairColor, { dy: 2 }) +
      piece(tornEllipse(0, headCY - R * 0.32, R * 1.0, R * 0.78, seed + 9, 1.1, 30), hairColor, { shadow: false });
  } else if (hs === 'bun') {
    hair =
      piece(tornEllipse(-R * 0.9 * f, headCY - R * 0.85, R * 0.34, R * 0.34, seed + 7, 0.9, 24), hairColor, { dy: 2 }) +
      piece(tornEllipse(0, headCY - R * 0.36, R * 0.98, R * 0.72, seed + 9, 1.1, 30), hairColor, { shadow: false });
  } else if (hs === 'bald') {
    hair = '';
  } else if (hs === 'white') {
    hair = piece(tornEllipse(0, headCY - R * 0.42, R * 0.99, R * 0.62, seed + 9, 1.2, 30), hairColor, { shadow: false });
  } else {
    hair = piece(tornEllipse(0, headCY - R * 0.38, R * 0.97, R * 0.68, seed + 9, 1.1, 30), hairColor, { shadow: false });
  }

  // 五官（在头部局部坐标，snout 朝 +x）
  const eyeDX = R * 0.3;
  const eyeY = headCY + R * 0.02;
  const eyeR = s.eyes === 'wide' ? R * 0.19 : R * 0.11;
  let eyes = '';
  if (s.eyes === 'closed') {
    eyes =
      `<path d="${capsule(-eyeDX - 10, eyeY, -eyeDX + 10, eyeY, 4.5)}" fill="${ink(P.ink)}"/>` +
      `<path d="${capsule(eyeDX - 10, eyeY, eyeDX + 10, eyeY, 4.5)}" fill="${ink(P.ink)}"/>`;
  } else if (s.eyes === 'wide') {
    eyes = [-eyeDX, eyeDX]
      .map(
        (dx) =>
          `<circle cx="${n(dx)}" cy="${n(eyeY)}" r="${n(eyeR)}" fill="${ink(P.paper)}"/>` +
          `<circle cx="${n(dx + 1.5 * f)}" cy="${n(eyeY)}" r="${n(eyeR * 0.46)}" fill="${ink(P.ink)}"/>`
      )
      .join('');
  } else {
    eyes = [-eyeDX, eyeDX].map((dx) => `<circle cx="${n(dx)}" cy="${n(eyeY)}" r="${n(eyeR)}" fill="${ink(P.ink)}"/>`).join('');
  }

  const browRot = s.brows === 'up' ? -20 : s.brows === 'down' ? 15 : -3;
  const browY = eyeY - (s.eyes === 'wide' ? R * 0.42 : R * 0.32);
  const brows = [-eyeDX, eyeDX]
    .map(
      (dx, i) =>
        `<g transform="translate(${n(dx)},${n(browY)}) rotate(${(i === 0 ? 1 : -1) * browRot})"><path d="${capsule(-R * 0.17, 0, R * 0.17, 0, 5)}" fill="${ink(P.ink)}" opacity="0.8"/></g>`
    )
    .join('');

  const open = s.mouth === 2 ? R * 0.34 : s.mouth === 1 ? R * 0.16 : 0;
  const mouthY = headCY + R * 0.45;
  const mouth =
    open === 0
      ? `<path d="${capsule(-R * 0.16, mouthY, R * 0.16, mouthY, 5)}" fill="${ink(P.ink)}" opacity="0.7"/>`
      : `<path d="${tornEllipse(0, mouthY + open * 0.3, R * 0.22, open * 0.6, seed + 5, 0.7, 20)}" fill="${ink('#5A2320')}"/>`;

  let props = '';
  if ((s.props ?? []).includes('glasses')) {
    props +=
      [-eyeDX, eyeDX]
        .map((dx) => `<circle cx="${n(dx)}" cy="${n(eyeY)}" r="${n(R * 0.26)}" fill="none" stroke="${ink(P.ink)}" stroke-width="5"/>`)
        .join('') +
      `<path d="${capsule(-eyeDX + R * 0.26, eyeY, eyeDX - R * 0.26, eyeY, 4)}" fill="${ink(P.ink)}"/>`;
  }
  if ((s.props ?? []).includes('cap')) {
    props += piece(tornEllipse(0, headCY - R * 0.6, R * 1.0, R * 0.5, seed + 12, 1.1, 26), ink(P.secondary), { dy: 2 });
    props += piece(tornRect(R * 0.2 * f, headCY - R * 0.68, R * 1.0 * f, R * 0.2, seed + 13, 1.0, 12), ink(P.secondary), { shadow: false });
  }
  if ((s.props ?? []).includes('bag')) {
    props += piece(tornRect(-R * 1.5 * f - (f > 0 ? 0 : R * 0.9), shoulderY + 30, R * 0.9, R * 1.2, seed + 14, 1.3, 14), ink(P.accent), { dy: 3 });
  }

  const headGroup = `<g transform="translate(0,${n(s.bob)})">${hair}${head}${eyes}${brows}${mouth}${props}</g>`;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY)}) scale(${n(s.scale * f)},${n(s.scale)})">` +
    `<g transform="translate(0,${n(hipY)}) rotate(${n(-lean)}) translate(0,${n(-hipY)}) scale(1,${n(s.breath)})">` +
    armFar +
    legs +
    torso +
    neck +
    headGroup +
    armNear +
    `</g></g>`
  );
}

/** 供时间轴取动作速度系数 */
export function speedOf(proportion?: string): number {
  return (PROPORTIONS[proportion ?? 'adultM'] ?? PROPORTIONS.adultM).speed;
}

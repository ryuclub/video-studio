// ── 老鼠 rig：照 assets/characters/mouse.svg 的形象做 ────────────────────
//
// **无描边扁平版**——第三种视觉语言（乌龟是线稿描边，蛇和人物是剪纸）。
// 一条片子里别混用两种风格，选一套贴到底。
//
// 形象以 svg 为准，路径数据直接抄过来，只把要动的参数化：
//   会动：眼睛（三态）、嘴（三态）、手臂/脚（走路循环）、头部 bob
//   不动：耳朵、身体、肚皮、尾巴 —— 形象本身
//
// 注意这只**朝右**（鼻子在右边），乌龟朝左。镜像逻辑因此相反。

import { n } from '../style/papercut.js';
import type { CharState } from './state.js';

const VB = 700; // viewBox 宽
const CX = 378; // 身体中心 x
const BOTTOM = 682; // 脚底 y

const C = {
  fur: '#B8B8B8',
  belly: '#E2E2E2',
  earIn: '#F9C7D8',
  tail: '#C4C4C4',
  face: '#5C3A2A',
  blush: '#F2B4B7',
};

const D = {
  tail:
    'M 268,590 C 230,600 200,620 178,618 C 150,616 138,592 148,572 C 158,554 184,552 192,568 C 199,582 186,596 172,592 C 162,589 158,578 164,570',
  earSideIn:
    'M 170,352 C 140,344 106,318 96,286 C 86,254 106,226 138,228 C 172,230 194,262 190,298 C 187,326 180,344 170,352 Z',
  earTopIn:
    'M 360,178 C 336,166 310,140 306,110 C 302,76 328,54 360,54 C 392,54 418,76 414,110 C 410,140 384,166 360,178 Z',
  body: 'M 378,440 C 452,440 492,492 492,560 C 492,624 452,656 378,656 C 304,656 264,624 264,560 C 264,492 304,440 378,440 Z',
  footL: 'M 292,614 L 292,652 C 292,672 306,682 322,682 C 338,682 352,672 352,652 L 352,614 Z',
  footR: 'M 416,614 L 416,652 C 416,672 430,682 446,682 C 462,682 476,672 476,652 L 476,614 Z',
  head:
    'M 370,158 C 470,158 540,196 572,262 C 588,294 592,318 578,340 C 560,412 480,478 372,478 C 258,478 186,410 186,322 C 186,232 262,158 370,158 Z',
  mouth: 'M 430,414 C 436,432 456,436 466,422',
};

const EYES = [
  { cx: 386, cy: 302, rx: 11, ry: 16, rot: 20 },
  { cx: 446, cy: 258, rx: 11, ry: 16, rot: 20 },
];

export function mouse(s: CharState, ink: (c: string) => string, seed: number): string {
  const scale = (s.length ?? 520) / VB;
  const fur = ink(C.fur);
  // 渐变 id 要带 seed，同一帧里两只老鼠不会互相覆盖定义
  const gid = `blush${seed}`;

  // 手臂摆动有两个来源：走路，和**说话**。
  // 小孩说话时手是会跟着比划的，光动嘴不动手很僵。
  // 说话这一路频率更高、幅度跟着音量走，所以两路分开算再叠加。
  const walk = s.walking ?? 0;
  const talk = s.speech ?? 0;
  const step = (p: number) => Math.sin(s.t * 3.4 + p) * 10 * walk;
  const sw = (p: number) => step(p) + Math.sin(s.t * 8.2 + p) * 16 * talk;

  const arm = (mirror: boolean, dy: number) =>
    `<g transform="${mirror ? 'translate(756,0) scale(-1,1) ' : ''}translate(0,${n(dy)})">` +
    `<rect x="200" y="490" width="150" height="70" rx="35" fill="${fur}" transform="rotate(-20 275 525)"/></g>`;

  // ── 眼睛三态 ──
  const eye = (e: (typeof EYES)[number]) => {
    if (s.eyes === 'closed') {
      return `<path d="M ${e.cx - 13},${e.cy} Q ${e.cx},${e.cy + 11} ${e.cx + 13},${e.cy}"
        fill="none" stroke="${ink(C.face)}" stroke-width="5" stroke-linecap="round"/>`;
    }
    const g = s.eyes === 'wide' ? 1.5 : 1;
    return (
      `<ellipse cx="${e.cx}" cy="${e.cy}" rx="${n(e.rx * g)}" ry="${n(e.ry * g)}" fill="${ink(C.face)}"
        transform="rotate(${e.rot} ${e.cx} ${e.cy})"/>` +
      `<circle cx="${n(e.cx + e.rx * 0.35)}" cy="${n(e.cy - e.ry * 0.4)}" r="${n(e.rx * 0.32 * g)}" fill="#FFFFFF"/>`
    );
  };

  // 眉毛：扁平风没有眉毛，用眼睛上方一小段线代替，只在有情绪时出现
  const brow =
    s.brows === 'normal'
      ? ''
      : EYES.map((e) => {
          const dy = s.brows === 'up' ? -30 : -20;
          const tilt = s.brows === 'up' ? -14 : 14;
          return `<g transform="rotate(${tilt} ${e.cx} ${e.cy + dy})"><path d="M ${e.cx - 14},${n(
            e.cy + dy
          )} L ${e.cx + 14},${n(e.cy + dy)}" stroke="${ink(C.face)}" stroke-width="5" stroke-linecap="round"/></g>`;
        }).join('');

  // ── 嘴三态 ──
  const open = s.mouth === 2 ? 1 : s.mouth === 1 ? 0.45 : 0;
  const mouth =
    open === 0
      ? `<path d="${D.mouth}" fill="none" stroke="${ink(C.face)}" stroke-width="5" stroke-linecap="round"/>`
      : `<ellipse cx="450" cy="${n(424 + 4 * open)}" rx="${n(15 + 6 * open)}" ry="${n(6 + 14 * open)}" fill="${ink('#7A2E33')}"/>`;

  const face =
    `<g transform="translate(0,${n(s.bob)})">` +
    `<circle cx="374" cy="386" r="52" fill="url(#${gid})"/>` +
    EYES.map(eye).join('') +
    brow +
    `<circle cx="584" cy="314" r="38" fill="${ink(C.face)}"/>` +
    mouth +
    `</g>`;

  const body =
    // 尾巴
    `<path d="${D.tail}" fill="none" stroke="${ink(C.tail)}" stroke-width="6" stroke-linecap="round"/>` +
    // 侧耳
    `<ellipse cx="138" cy="292" rx="95" ry="98" fill="${fur}" transform="rotate(-25 138 292)"/>` +
    `<path d="${D.earSideIn}" fill="${ink(C.earIn)}"/>` +
    // 头顶耳
    `<ellipse cx="362" cy="108" rx="100" ry="95" fill="${fur}" transform="rotate(6 362 108)"/>` +
    `<path d="${D.earTopIn}" fill="${ink(C.earIn)}"/>` +
    // 手臂
    arm(false, sw(0)) +
    arm(true, sw(Math.PI)) +
    // 身体 + 肚皮
    `<path d="${D.body}" fill="${fur}"/>` +
    `<ellipse cx="378" cy="556" rx="80" ry="72" fill="${ink(C.belly)}"/>` +
    // 脚
    `<g transform="translate(0,${n(step(Math.PI) * 0.4)})"><path d="${D.footL}" fill="${fur}"/></g>` +
    `<g transform="translate(0,${n(step(0) * 0.4)})"><path d="${D.footR}" fill="${fur}"/></g>` +
    // 头（画在身体之后，压住肩线）+ 五官
    `<g transform="translate(0,${n(s.bob * 0.6)})"><path d="${D.head}" fill="${fur}"/></g>` +
    face;

  // 原稿朝右。facing=-1（朝左）时才镜像 —— 跟乌龟正好相反
  const mirror = s.facing === -1 ? -1 : 1;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY)}) ` +
    `scale(${n(scale * mirror)},${n(scale * s.breath)}) rotate(${n(-s.lean * 0.4)}) ` +
    `translate(${n(-CX)},${n(-BOTTOM)})">` +
    `<defs><radialGradient id="${gid}">` +
    `<stop offset="0%" stop-color="${ink(C.blush)}" stop-opacity="0.95"/>` +
    `<stop offset="55%" stop-color="${ink(C.blush)}" stop-opacity="0.55"/>` +
    `<stop offset="100%" stop-color="${ink(C.blush)}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    body +
    `</g>`
  );
}

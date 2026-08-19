// ── 乌龟 rig：照 guilai_xiaogui.svg / guilai_mama.svg 的形象做 ──────────
//
// 这两只是线稿描边风（黑描边 + 绿色块），跟片子其余部分的剪纸风不是一套。
// **形象以 SVG 为准**，路径数据直接抄过来，只把要动的部分参数化：
//
//   会动：眼睛（三态）、嘴（三态）、四肢（走路循环）、头部 bob、整体呼吸
//   不动：龟壳、壳沿、壳斑、腹部、脖子 —— 这些是形象本身，动了就不像原稿了
//
// 颜色全部过 ink()，定格去色才生效。

import { n } from '../style/papercut.js';
import type { CharState } from './state.js';

/** 两只的配色和尺寸。数值直接来自两个 svg */
const SKIN = {
  kid: {
    vb: [620, 400] as [number, number],
    cx: 310,
    bottom: 356,
    stroke: 8,
    shell: '#93C96A',
    rim: '#74B84F',
    spot: '#57A245',
    head: '#B3DE8E',
    legFront: '#B3DE8E',
    legBack: '#A5D383',
    belly: '#E2EFB4',
    cheek: '#F9BBCE',
  },
  mom: {
    vb: [900, 560] as [number, number],
    cx: 450,
    bottom: 500,
    stroke: 9,
    shell: '#7CB755',
    rim: '#5C9E3D',
    spot: '#3F8434',
    head: '#9BCB78',
    legFront: '#9BCB78',
    legBack: '#8CBE6C',
    belly: '#D2E39F',
    cheek: '#F2AEC2',
  },
};

const KID = {
  legBack: 'M 428,272 L 428,330 Q 428,356 460,356 L 498,356 Q 530,356 530,330 L 530,272 Z',
  legFront: 'M 212,272 L 212,330 Q 212,356 244,356 L 282,356 Q 314,356 314,330 L 314,272 Z',
  tail: 'M 548,238 L 600,252 L 548,278 Z',
  belly:
    'M 212,232 L 552,232 C 574,232 582,258 574,282 C 562,310 478,326 382,326 C 288,326 228,310 210,290 C 196,274 197,248 212,232 Z',
  head:
    'M 248,292 C 218,280 196,244 192,208 C 189,182 188,164 190,142 C 194,52 118,18 60,58 C 10,92 10,180 40,224 C 68,266 140,290 202,294 C 220,296 236,295 248,292 Z',
  ahoge: 'M 116,36 C 122,12 148,6 158,16 C 148,16 138,26 134,44 Z',
  shell: 'M 212,252 C 209,150 282,96 382,96 C 482,96 554,150 551,252 C 470,274 296,274 212,252 Z',
  rim:
    'M 192,236 C 218,268 298,282 382,282 C 466,282 546,268 572,236 C 580,254 580,268 572,278 C 546,308 466,322 382,322 C 298,322 220,308 192,278 C 184,268 184,254 192,236 Z',
  spots: [
    'M 288,158 C 312,146 340,156 340,178 C 340,202 314,214 294,204 C 274,194 270,168 288,158 Z',
    'M 388,138 C 416,128 448,142 445,166 C 442,192 410,200 390,188 C 368,176 366,148 388,138 Z',
    'M 472,168 C 494,158 516,170 513,190 C 510,210 486,218 470,207 C 454,196 454,177 472,168 Z',
    'M 262,218 C 288,208 314,220 311,240 C 308,258 282,266 266,254 C 250,242 248,226 262,218 Z',
    'M 366,218 C 400,206 436,220 432,244 C 428,266 392,274 368,262 C 346,251 344,228 366,218 Z',
  ],
  eye: { cx: 76, cy: 120, rx: 27, ry: 31 },
  glint: { cx: 87, cy: 107, r: 9 },
  cheek: { cx: 152, cy: 162, rx: 28, ry: 18, rot: -8 },
  mouth: 'M 38,176 C 48,198 68,198 76,182 C 84,198 104,198 112,176',
  mouthAt: [75, 184] as [number, number],
};

const MOM = {
  legBack: 'M 640,395 L 640,468 Q 640,500 677,500 L 723,500 Q 760,500 760,468 L 760,395 Z',
  legFront: 'M 305,395 L 305,468 Q 305,500 342,500 L 388,500 Q 425,500 425,468 L 425,395 Z',
  tail: 'M 785,335 L 862,352 L 785,382 Z',
  belly:
    'M 305,330 L 780,330 C 806,330 816,362 806,395 C 792,438 690,462 545,462 C 400,462 318,442 300,410 C 285,382 288,350 305,330 Z',
  head:
    'M 350,405 C 310,392 272,345 264,300 C 258,262 256,232 258,200 C 262,90 175,42 105,88 C 42,130 42,232 78,282 C 116,335 200,382 285,398 C 308,403 332,408 350,405 Z',
  ahoge: '',
  shell: 'M 300,345 C 296,190 405,102 552,102 C 700,102 810,190 806,345 C 700,378 405,378 300,345 Z',
  rim:
    'M 272,322 C 302,364 424,384 552,384 C 682,384 802,364 832,322 C 843,348 843,364 832,377 C 794,420 674,436 552,436 C 430,436 310,420 272,377 C 261,364 261,348 272,322 Z',
  spots: [
    'M 372,175 C 396,163 424,172 424,194 C 424,218 398,230 378,222 C 358,213 352,185 372,175 Z',
    'M 462,148 C 492,138 524,150 522,174 C 520,200 490,210 468,200 C 446,190 442,158 462,148 Z',
    'M 570,150 C 600,140 632,152 630,176 C 628,200 598,210 576,200 C 554,190 550,160 570,150 Z',
    'M 672,180 C 698,168 726,180 724,202 C 722,224 696,234 676,224 C 656,214 654,190 672,180 Z',
    'M 340,262 C 366,250 394,262 392,286 C 390,310 362,320 342,308 C 322,296 322,272 340,262 Z',
    'M 448,248 C 482,236 520,250 518,278 C 516,306 480,318 452,306 C 426,294 424,260 448,248 Z',
    'M 578,252 C 610,240 646,254 643,280 C 640,306 606,316 580,304 C 556,293 554,262 578,252 Z',
    'M 700,268 C 726,258 752,270 750,292 C 748,314 722,324 702,313 C 683,302 682,278 700,268 Z',
  ],
  eye: { cx: 118, cy: 172, rx: 20, ry: 24 },
  glint: null,
  brow: 'M 92,150 C 104,132 138,132 148,152',
  wrinkles: ['M 76,158 L 58,146', 'M 72,180 L 52,177'],
  cheek: { cx: 205, cy: 205, rx: 34, ry: 21, rot: -8 },
  mouth: 'M 72,238 C 88,262 122,262 138,238',
  mouthAt: [105, 249] as [number, number],
};

const INK = '#141414';

export function turtle(s: CharState, ink: (c: string) => string, seed: number): string {
  const isMom = s.variant === 'mom';
  const D = isMom ? MOM : KID;
  const C = isMom ? SKIN.mom : SKIN.kid;
  const k = ink(INK);

  // 目标高度换算缩放：length 当"体长"用，跟 svg 的 viewBox 宽度对齐
  const scale = (s.length ?? (isMom ? 620 : 430)) / C.vb[0];

  // 走路循环：前后腿反相上下动。爬得慢，频率压得很低
  const walk = s.walking ?? 0;
  const swing = (p: number) => Math.sin(s.t * 3.1 + p) * 9 * walk;

  const path = (d: string, fill: string, sw = C.stroke) =>
    d ? `<path d="${d}" fill="${ink(fill)}" stroke="${k}" stroke-width="${sw}"/>` : '';

  // ── 眼睛三态 ──
  const E = D.eye;
  let eye: string;
  if (s.eyes === 'closed') {
    eye = `<path d="M ${E.cx - E.rx},${E.cy} Q ${E.cx},${E.cy + E.ry * 0.7} ${E.cx + E.rx},${E.cy}"
      fill="none" stroke="${k}" stroke-width="${C.stroke}"/>`;
  } else {
    const g = s.eyes === 'wide' ? 1.26 : 1;
    eye =
      `<ellipse cx="${E.cx}" cy="${E.cy}" rx="${n(E.rx * g)}" ry="${n(E.ry * g)}" fill="${k}" stroke="none"/>` +
      (D.glint
        ? `<circle cx="${D.glint.cx}" cy="${D.glint.cy}" r="${D.glint.r}" fill="#FFFFFF" stroke="none"/>`
        : `<circle cx="${n(E.cx + E.rx * 0.4)}" cy="${n(E.cy - E.ry * 0.45)}" r="${n(E.rx * 0.3)}" fill="#FFFFFF" stroke="none"/>`);
  }

  // 眉毛：情绪主要靠这个。抬眉 = 惊讶，压眉 = 不耐烦
  const browRot = s.brows === 'up' ? -12 : s.brows === 'down' ? 12 : 0;
  const brow = isMom
    ? `<g transform="rotate(${browRot} ${MOM.eye.cx} ${MOM.eye.cy})"><path d="${MOM.brow}" fill="none" stroke="${k}" stroke-width="8"/></g>`
    : s.brows !== 'normal'
    ? `<g transform="rotate(${browRot} ${KID.eye.cx} ${KID.eye.cy})"><path d="M ${KID.eye.cx - 30},${
        KID.eye.cy - E.ry - 16
      } Q ${KID.eye.cx},${KID.eye.cy - E.ry - 30} ${KID.eye.cx + 30},${KID.eye.cy - E.ry - 18}"
        fill="none" stroke="${k}" stroke-width="7"/></g>`
    : '';

  const wrinkles = isMom
    ? MOM.wrinkles.map((d) => `<path d="${d}" fill="none" stroke="${k}" stroke-width="7"/>`).join('')
    : '';

  // ── 嘴三态：闭合用原稿那条波浪线，张开换成填充椭圆 ──
  const [mx, my] = D.mouthAt;
  const open = s.mouth === 2 ? 1 : s.mouth === 1 ? 0.45 : 0;
  const mouth =
    open === 0
      ? `<path d="${D.mouth}" fill="none" stroke="${k}" stroke-width="${C.stroke - 1}"/>`
      : `<ellipse cx="${mx}" cy="${n(my + 6 * open)}" rx="${n(26 + 6 * open)}" ry="${n(
          8 + 20 * open
        )}" fill="#7A2E33" stroke="${k}" stroke-width="${C.stroke - 2}"/>`;

  const cheek = `<ellipse cx="${D.cheek.cx}" cy="${D.cheek.cy}" rx="${D.cheek.rx}" ry="${D.cheek.ry}"
    fill="${ink(C.cheek)}" stroke="none" transform="rotate(${D.cheek.rot} ${D.cheek.cx} ${D.cheek.cy})"/>`;

  const spots = D.spots.map((d) => path(d, C.spot, 7)).join('');

  // 头和脸整体跟着说话 bob 一起动。脖子不重画，小幅位移看不出接缝
  const face =
    `<g transform="translate(0,${n(s.bob)})">` + eye + brow + wrinkles + cheek + mouth + `</g>`;

  const bodyGroup =
    `<g transform="translate(0,${n(swing(0))})">${path(D.legBack, C.legBack)}</g>` +
    `<g transform="translate(0,${n(swing(Math.PI))})">${path(D.legFront, C.legFront)}</g>` +
    path(D.tail, C.legBack) +
    path(D.belly, C.belly) +
    `<g transform="translate(0,${n(s.bob * 0.55)})">` +
    path(D.head, C.head) +
    path(D.ahoge, C.head) +
    `</g>` +
    path(D.shell, C.shell) +
    path(D.rim, C.rim) +
    spots +
    face;

  // 原稿的头朝左。facing=1（朝右）时整体镜像
  const mirror = s.facing === 1 ? -1 : 1;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY)}) ` +
    `scale(${n(scale * mirror)},${n(scale * s.breath)}) rotate(${n(-s.lean * 0.4)}) ` +
    `translate(${n(-C.cx)},${n(-C.bottom)})" ` +
    `stroke-linejoin="round" stroke-linecap="round">` +
    bodyGroup +
    `</g>`
  );
}

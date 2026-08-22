/**
 * 老牛 · 侧面走路装配
 *
 *   node bull_side.mjs           静止装配版
 *   node bull_side.mjs --frames  一轮走路循环
 *
 * 把老马侧面那几轮踩出来的规矩全部先套上：
 *   面朝右 → 肘尖朝后（x 减小）、膝盖朝前（x 增大）
 *   脚跟短、脚尖长 —— 对称的脚不提供方向信息
 *   腿顶要埋进躯干够深，胯部外扩盖住它，否则圆头会戳出轮廓成一块疙瘩
 *   四肢用带圆头的加粗，末端半圆就是手，不要另贴一个球
 *   图层：远腿 → 远臂 → 近腿 → 躯干 → 近臂 → 头
 *
 * 牛角在侧面是**一前一后两根**，不是正面那种左右对张。
 * 远侧那根压暗并画在头之前，近侧那根压在最上层。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { stroke, hatch, sample, poly, jitter, ellipsePts } from "./rough.mjs";

const VB = { x: 150, y: 30, w: 560, h: 1080 };
const LINE = "#2E2622";
const BODY = "#5A4A40";
const FAR = "#453931";
const SHADE = "#3E332C";
const HORN = "#9A9166";
const HORNF = "#79714E";
const HORNS = "#786F4C";
const MUZZ = "#8B7266";
const TUFT = "#17110F";
const WHITE = "#FBF8F1";
const HOOF = "#241D1A";

export const PIVOT = {
  shoulder: [364, 556],
  hip: [346, 812],
  neck: [330, 470],
};

function capsule(pts, w0, w1 = w0, capSteps = 10) {
  const L = [], R = [], norm = [], n = pts.length - 1;
  pts.forEach((p, i) => {
    let d;
    if (i === 0) d = [pts[1][0] - p[0], pts[1][1] - p[1]];
    else if (i === n) d = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]];
    else d = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]];
    const m = Math.hypot(d[0], d[1]) || 1;
    const nx = -d[1] / m, ny = d[0] / m;
    norm.push([nx, ny, d[0] / m, d[1] / m]);
    const hw = (w0 + (w1 - w0) * (i / n)) / 2;
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    R.push([p[0] - nx * hw, p[1] - ny * hw]);
  });
  const arc = (c, hw, nx, ny, dx, dy, out) => {
    const a = [];
    for (let k = 1; k < capSteps; k++) {
      const th = (Math.PI * k) / capSteps;
      a.push([
        c[0] + (nx * Math.cos(th) + dx * Math.sin(th) * (out ? 1 : -1)) * hw,
        c[1] + (ny * Math.cos(th) + dy * Math.sin(th) * (out ? 1 : -1)) * hw,
      ]);
    }
    return a;
  };
  const [enx, eny, edx, edy] = norm[n];
  const [snx, sny, sdx, sdy] = norm[0];
  return L.concat(
    arc(pts[n], w1 / 2, enx, eny, edx, edy, true),
    R.reverse(),
    arc(pts[0], w0 / 2, -snx, -sny, sdx, sdy, false)
  );
}

const fill = (pts, c, seed, amp = 2.2) =>
  `<path d="${poly(jitter(pts, amp, seed), true)}" fill="${c}"/>`;

const piece = (pts, { c, hc = SHADE, gap = 12, ang = 62, op = 0.28, w = 3.8, seed = 1 }) =>
  fill(pts, c, seed) +
  (gap > 0 ? hatch(pts, { angle: ang, gap, color: hc, w: 1.6, op, seed: seed + 1 }) : "") +
  stroke(pts, { color: LINE, w, passes: 2, amp: 2.4, close: true, seed: seed + 2 });

/* ── 躯干：比老马宽一档，胯部外扩盖住腿顶 ── */
const torso = sample([
  [[262, 506], [234, 604], [222, 722], [232, 812]],
  [[232, 812], [242, 862], [296, 888], [360, 888]],
  [[360, 888], [424, 888], [472, 858], [478, 800]],
  [[478, 800], [496, 700], [476, 578], [446, 506]],
  [[446, 506], [404, 468], [304, 468], [262, 506]],
], 12);

/* ── 脖子：短而粗 ── */
const neck = sample([
  [[288, 392], [280, 432], [280, 474], [288, 516]],
  [[288, 516], [332, 534], [396, 532], [428, 514]],
  [[428, 514], [430, 472], [424, 428], [414, 392]],
  [[414, 392], [372, 408], [330, 408], [288, 392]],
], 10);

/* ── 四肢：膝盖朝前、肘尖朝后 ── */
const legShape = capsule(sample([
  [[348, 748], [358, 812], [360, 878], [354, 940]],
  [[354, 940], [350, 972], [346, 998], [342, 1018]],
], 10), 130, 96);

const armShape = capsule(sample([
  [[364, 566], [338, 628], [324, 700], [340, 764]],
  [[340, 764], [362, 806], [386, 834], [390, 862]],
], 10), 88, 66);

const hoof = (cx, cy) => [
  [cx - 38, cy], [cx - 44, cy + 28], [cx - 28, cy + 48],
  [cx + 84, cy + 48], [cx + 102, cy + 30], [cx + 92, cy + 2],
];

/* ── 头：方阔颅骨 + 钝口鼻 + 一前一后两根角 ── */
function bullHeadSide() {
  const skull = sample([
    [[268, 380], [244, 300], [258, 196], [326, 156]],
    [[326, 156], [396, 116], [472, 138], [500, 200]],
    [[500, 200], [520, 250], [556, 268], [598, 286]],
    [[598, 286], [634, 302], [640, 352], [612, 384]],
    [[612, 384], [568, 414], [486, 424], [420, 428]],
    [[420, 428], [342, 436], [286, 424], [268, 380]],
  ], 14);
  const muzzle = ellipsePts(566, 356, 92, 76, 44);
  const earShape = capsule(sample([[[318, 268], [284, 282], [242, 300], [206, 312]]], 8), 74, 26);
  // 近侧角：向前上方翘；远侧角：向后上方，压暗
  // 近侧角朝左后掠、长度约远侧的一半：侧面看牛，近侧那根是朝观众这边翘出来的，
// 投影到平面上被压短，而牛角本身向后弯，所以尖端落在基点的后方。
const hornNear = capsule(sample([[[400, 196], [372, 168], [340, 146], [312, 132]]], 10), 78, 22);
  const hornFar = capsule(sample([[[344, 196], [312, 158], [276, 114], [246, 74]]], 10), 66, 16);
  const tuft = sample([
    [[302, 236], [318, 178], [364, 150], [408, 158]],
    [[408, 158], [444, 166], [462, 196], [458, 232]],
    [[458, 232], [416, 214], [372, 222], [348, 244]],
    [[348, 244], [326, 254], [308, 250], [302, 236]],
  ], 12);

  let o = `<g id="head-shape">`;
  o += piece(hornFar, { c: HORNF, hc: HORNS, gap: 14, ang: 130, op: 0.36, seed: 81, w: 4 });
  o += piece(earShape, { c: BODY, gap: 9, op: 0.34, seed: 71, w: 4.2 });
  o += piece(skull, { c: BODY, gap: 12, op: 0.28, seed: 61 });
  o += piece(muzzle, { c: MUZZ, gap: 15, ang: 68, op: 0.26, seed: 65, w: 3.6 });
  o += fill(ellipsePts(616, 336, 18, 15, 28), TUFT, 66);          // 鼻孔
  o += fill(tuft, TUFT, 74, 3.4) + stroke(tuft, { color: LINE, w: 3.4, passes: 2, amp: 3, close: true, seed: 75 });
  for (let i = 0; i < 16; i++) {
    const x0 = 312 + i * 9 + ((i * 31) % 11);
    const y0 = 176 + ((i * 47) % 34);
    const L = 34 + ((i * 23) % 46), bend = -18 + ((i * 37) % 34);
    o += `<path d="${poly(jitter([[x0, y0], [x0 + bend * 0.4, y0 - L * 0.5], [x0 + bend, y0 - L]], 2.4, 300 + i))}" ` +
      `fill="none" stroke="${TUFT}" stroke-width="${(2 + ((i * 13) % 22) / 10).toFixed(1)}" stroke-linecap="round"/>`;
  }
  o += `</g>`;

  o += `<g id="face" transform="translate(0,0)">`;
  const e = ellipsePts(468, 292, 54, 58, 48);
  o += `<g id="eye-white-r">` + fill(e, WHITE, 91) +
    stroke(e, { color: LINE, w: 3.8, passes: 2, amp: 2, close: true, seed: 92 }) + `</g>`;
  o += `<g id="pupil-r" transform="translate(0,0)">` +
    fill(ellipsePts(482, 306, 17, 18, 32), "#141414", 93) + `</g>`;
  o += `<g id="mouth-closed">` +
    stroke([[528, 408], [572, 420], [614, 404]], { color: LINE, w: 3.4, passes: 2, amp: 2, seed: 95 }) + `</g>`;
  o += `</g>`;

  o += `<g id="head-front">` +
    piece(hornNear, { c: HORN, hc: HORNS, gap: 14, ang: 40, op: 0.4, seed: 84, w: 4.4 }) + `</g>`;
  return o;
}

function build({ armNear = 0, armFar = 0, legNear = 0, legFar = 0, bob = 0 } = {}) {
  const R = (a, p) => `rotate(${a.toFixed(2)} ${p[0]} ${p[1]})`;
  const hf = (cx, cy, c, seed) => {
    const h = hoof(cx, cy);
    return fill(h, c, seed, 1.8) + stroke(h, { color: LINE, w: 2.8, passes: 1, amp: 1.8, close: true, seed: seed + 1 });
  };
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${VB.w}" height="${VB.h}">`;
  o += `<g id="bull-side" transform="translate(0,${bob.toFixed(2)})">`;

  o += `<g id="leg-far" transform="${R(legFar, PIVOT.hip)} translate(-50,-6)">` +
    piece(legShape, { c: FAR, gap: 10, op: 0.3, seed: 21 }) + hf(322, 1000, HOOF, 22) + `</g>`;
  o += `<g id="arm-far" transform="${R(armFar, PIVOT.shoulder)} translate(-48,-6)">` +
    piece(armShape, { c: FAR, gap: 11, op: 0.28, seed: 31 }) + `</g>`;
  o += `<g id="leg-near" transform="${R(legNear, PIVOT.hip)}">` +
    piece(legShape, { c: BODY, gap: 10, op: 0.3, seed: 41 }) + hf(342, 1012, HOOF, 42) + `</g>`;
  o += `<g id="body">` + piece(neck, { c: BODY, gap: 11, op: 0.3, seed: 15, w: 3.8 }) +
    piece(torso, { c: BODY, gap: 12, op: 0.28, seed: 11, w: 4 }) + `</g>`;
  o += `<g id="arm-near" transform="${R(armNear, PIVOT.shoulder)} translate(36,0)">` +
    piece(armShape, { c: BODY, gap: 11, op: 0.3, seed: 51 }) + `</g>`;
  o += `<g id="head" transform="translate(0,0)">` + bullHeadSide() + `</g>`;
  o += `</g></svg>`;
  return o;
}

export function walkPose(t, { swing = 19, bob = 5 } = {}) {
  const th = 2 * Math.PI * t, s = Math.sin(th);
  return {
    legNear: swing * s, legFar: -swing * s,
    armNear: -swing * 0.8 * s, armFar: swing * 0.8 * s,
    bob: -bob * Math.abs(Math.sin(2 * th)),
  };
}

writeFileSync("bull_side.svg", build());
if (process.argv.includes("--frames")) {
  mkdirSync("bside", { recursive: true });
  for (let i = 0; i < 8; i++) writeFileSync(`bside/f${i}.svg`, build(walkPose(i / 8)));
  console.log("bull_side.svg + 8 帧");
} else console.log("bull_side.svg");

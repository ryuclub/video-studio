/**
 * 老马 · 侧面走路装配
 *
 *   node horse_side.mjs           出静止装配版
 *   node horse_side.mjs --frames  出一轮走路循环的帧
 *
 * 老马是拟人角色（有胳膊、拿杯子），所以侧面是**人形侧走**，不是四足马。
 *
 * 高度定成 1030，和 horse_only.svg 的 viewBox 高度一致 —— 
 * 这样正面版和侧面版按同一个 height 合成时，两者身高对得上，切镜不会跳。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { stroke, hatch, sample, poly, jitter, ellipsePts } from "../rough.mjs";

// 画框裁紧。高度与 horse_only.svg 的 1028 保持同一"角色占框比例"，
// 这样正面版和侧面版按同一个 height 合成时身高一致，切镜不跳。
const VB = { x: 150, y: 8, w: 560, h: 1060 };
const LINE = "#3B322B";
const FUR = "#C2793C";
const FAR = "#A2622F";      // 远侧肢体压暗，做纵深
const SHADE = "#93551F";
const MANE = "#241F1C";
const WHITE = "#FBF8F1";
const HOOF = "#241F1C";

/** 支点：走路时绕这些点旋转 */
export const PIVOT = {
  shoulder: [348, 500],
  hip: [332, 762],
  neck: [330, 430],          // 头部点头/俯仰
};

function thicken(pts, w0, w1 = w0) {
  const L = [], R = [], n = pts.length - 1;
  pts.forEach((p, i) => {
    let d;
    if (i === 0) d = [pts[1][0] - p[0], pts[1][1] - p[1]];
    else if (i === n) d = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]];
    else d = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]];
    const m = Math.hypot(d[0], d[1]) || 1;
    const nx = -d[1] / m, ny = d[0] / m;
    const hw = (w0 + (w1 - w0) * (i / n)) / 2;
    L.push([p[0] + nx * hw, p[1] + ny * hw]);
    R.push([p[0] - nx * hw, p[1] - ny * hw]);
  });
  return L.concat(R.reverse());
}

/** 带圆头的加粗：两端补半圆，末端本身就是手，不用另贴一个球 */
function capsule(pts, w0, w1 = w0, capSteps = 10) {
  const L = [], R = [], n = pts.length - 1;
  const norm = [];
  pts.forEach((p, i) => {
    let d;
    if (i === 0) d = [pts[1][0] - p[0], pts[1][1] - p[1]];
    else if (i === n) d = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]];
    else d = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1]];
    const m = Math.hypot(d[0], d[1]) || 1;
    norm.push([-d[1] / m, d[0] / m, d[0] / m, d[1] / m]);
    const hw = (w0 + (w1 - w0) * (i / n)) / 2;
    L.push([p[0] + (-d[1] / m) * hw, p[1] + (d[0] / m) * hw]);
    R.push([p[0] - (-d[1] / m) * hw, p[1] - (d[0] / m) * hw]);
  });
  const arc = (c, hw, nx, ny, dx, dy, out) => {
    const a = [];
    for (let k = 1; k < capSteps; k++) {
      const th = (Math.PI * k) / capSteps;
      const sx = nx * Math.cos(th) + dx * Math.sin(th) * (out ? 1 : -1);
      const sy = ny * Math.cos(th) + dy * Math.sin(th) * (out ? 1 : -1);
      a.push([c[0] + sx * hw, c[1] + sy * hw]);
    }
    return a;
  };
  const [enx, eny, edx, edy] = norm[n];
  const endCap = arc(pts[n], w1 / 2, enx, eny, edx, edy, true);
  const [snx, sny, sdx, sdy] = norm[0];
  const startCap = arc(pts[0], w0 / 2, -snx, -sny, sdx, sdy, false);
  return L.concat(endCap, R.reverse(), startCap);
}

const fill = (pts, c, seed, amp = 2.2) =>
  `<path d="${poly(jitter(pts, amp, seed), true)}" fill="${c}"/>`;

const piece = (pts, { c, hc = SHADE, gap = 12, ang = 62, op = 0.28, w = 3.8, seed = 1 }) =>
  fill(pts, c, seed) +
  (gap > 0 ? hatch(pts, { angle: ang, gap, color: hc, w: 1.6, op, seed: seed + 1 }) : "") +
  stroke(pts, { color: LINE, w, passes: 2, amp: 2.4, close: true, seed: seed + 2 });

/* ── 躯干：侧面是个略前倾的胶囊 ── */
const torso = sample([
  [[256, 452], [234, 546], [224, 660], [234, 748]],   // 后背：较直，胯部外扩盖住腿顶
  [[234, 748], [244, 792], [292, 814], [348, 814]],
  [[348, 814], [406, 814], [450, 788], [456, 736]],
  [[456, 736], [472, 644], [452, 528], [424, 452]],   // 前胸与肚子：明显外凸
  [[424, 452], [386, 416], [294, 416], [256, 452]],
], 12);

/* ── 腿：髋到蹄，中段略收 ── */
// 腿顶要埋得够深，否则圆头会从躯干轮廓外戳出来，读成一块单独的疙瘩。
const legShape = capsule(sample([
  [[334, 700], [342, 790], [344, 856], [338, 912]],
  [[338, 912], [334, 938], [330, 952], [328, 964]],
], 10), 118, 86);
// 侧面的脚必须指向行进方向：**脚跟短、脚尖长**。
// 对称的脚不提供方向信息，会让整个身体读作"没朝向"。
const hoof = (cx, cy) => [
  [cx - 34, cy], [cx - 40, cy + 26], [cx - 26, cy + 44],
  [cx + 78, cy + 44], [cx + 94, cy + 28], [cx + 84, cy + 2],
];

/* ── 臂：肩到手 ── */
// 面朝右 → **肘尖朝后**（x 变小），前臂再往前带到手。
// 画反了的话身体读作面朝左，配上朝右的头就成了"扭头往后看"。
const armShape = capsule(sample([
  [[348, 508], [338, 566], [332, 632], [340, 692]],
  [[340, 692], [348, 736], [356, 768], [356, 790]],
], 10), 78, 58);

/* ── 头：侧脸向右，长脸 + 尖耳 + 后颈乱鬃 ── */
function headGroup() {
  const skull = sample([
    [[248, 344], [222, 262], [232, 148], [300, 100]],
    [[300, 100], [372, 56], [452, 78], [482, 148]],
    [[482, 148], [508, 208], [548, 232], [598, 248]],
    [[598, 248], [644, 262], [656, 314], [626, 350]],
    [[626, 350], [584, 384], [500, 392], [434, 398]],
    [[434, 398], [346, 410], [268, 402], [248, 344]],
  ], 14);
  const ear = thicken([[318, 130], [300, 52], [296, 24]], 88, 18);

  let o = `<g id="head-shape">`;
  o += piece(ear, { c: FUR, gap: 9, op: 0.34, seed: 71, w: 3.4 });
  o += piece(skull, { c: FUR, gap: 12, op: 0.28, seed: 61 });
  // 鬃毛：从头顶盖到后颈
  let r = 1;
  // 先铺一块深色鬃毛团（头顶到后颈），再加乱发
  const mass = sample([
    [[236, 200], [244, 128], [300, 84], [366, 78]],
    [[366, 78], [412, 74], [448, 96], [462, 132]],
    [[462, 132], [420, 140], [372, 158], [340, 190]],
    [[340, 190], [312, 226], [292, 300], [286, 396]],
    [[286, 396], [258, 380], [238, 300], [236, 200]],
  ], 12);
  o += fill(mass, MANE, 55, 3.2);
  for (let i = 0; i < 92; i++) {
    const t = i / 91;
    const x0 = 240 + t * 218 + ((i * 37) % 19) - 9;
    const y0 = 80 + Math.pow(t, 1.6) * 60 + ((i * 53) % 26) - 12;
    const L = 76 + ((i * 29) % 104);
    const bend = -48 + ((i * 41) % 70);
    o += `<path d="${poly(jitter([[x0, y0], [x0 + bend * 0.4, y0 + L * 0.5], [x0 + bend, y0 + L]], 2.6, r++))}" ` +
      `fill="none" stroke="${MANE}" stroke-width="${(1.8 + ((i * 13) % 30) / 10).toFixed(1)}" ` +
      `stroke-linecap="round" opacity="${(0.6 + ((i * 7) % 35) / 100).toFixed(2)}"/>`;
  }
  o += `</g>`;
  o += `<g id="face" transform="translate(0,0)">`;
  const e = ellipsePts(438, 244, 56, 60, 48);
  o += `<g id="eye-white-r">` + fill(e, WHITE, 91) +
    stroke(e, { color: LINE, w: 3.6, passes: 2, amp: 2, close: true, seed: 92 }) + `</g>`;
  o += `<g id="pupil-r" transform="translate(0,0)">` +
    fill(ellipsePts(452, 258, 17, 18, 32), "#141414", 93) + `</g>`;
  o += fill(ellipsePts(606, 302, 17, 14, 28), LINE, 94);           // 鼻孔
  o += `<g id="mouth-closed">` +
    stroke([[554, 356], [596, 366], [630, 352]], { color: LINE, w: 3.2, passes: 2, amp: 2, seed: 95 }) + `</g>`;
  o += `</g>`;
  return o;
}

/* ── 组装 ── */
function build({ armNear = 0, armFar = 0, legNear = 0, legFar = 0, bob = 0 } = {}) {
  const R = (a, p) => `rotate(${a.toFixed(2)} ${p[0]} ${p[1]})`;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${VB.w}" height="${VB.h}">`;
  o += `<g id="horse-side" transform="translate(0,${bob.toFixed(2)})">`;

  // 远侧：压暗一档，先画
  o += `<g id="leg-far" transform="${R(legFar, PIVOT.hip)} translate(-46,-6)">` +
    piece(legShape, { c: FAR, gap: 10, op: 0.3, seed: 21 }) +
    (() => { const h = hoof(306, 988); return fill(h, HOOF, 22, 1.8) + stroke(h, { color: LINE, w: 2.8, passes: 1, amp: 1.8, close: true, seed: 23 }); })() +
    `</g>`;
  o += `<g id="arm-far" transform="${R(armFar, PIVOT.shoulder)} translate(-44,-6)">` +
    piece(armShape, { c: FAR, gap: 11, op: 0.28, seed: 31 }) + `</g>`;

  const neck = sample([
    [[276, 336], [268, 380], [268, 424], [276, 468]],
    [[276, 468], [318, 486], [372, 484], [404, 466]],
    [[404, 466], [406, 420], [400, 372], [390, 336]],
    [[390, 336], [352, 352], [312, 352], [276, 336]],
  ], 10);
  o += `<g id="leg-near" transform="${R(legNear, PIVOT.hip)}">` +
    piece(legShape, { c: FUR, gap: 10, op: 0.3, seed: 41 }) +
    (() => { const h = hoof(332, 996); return fill(h, HOOF, 42, 1.8) + stroke(h, { color: LINE, w: 2.8, passes: 1, amp: 1.8, close: true, seed: 43 }); })() +
    `</g>`;
  o += `<g id="body">` + piece(neck, { c: FUR, gap: 11, op: 0.3, seed: 15, w: 3.8 })
     + piece(torso, { c: FUR, gap: 12, op: 0.28, seed: 11, w: 4 }) + `</g>`;

  o += `<g id="arm-near" transform="${R(armNear, PIVOT.shoulder)} translate(34,0)">` +
    piece(armShape, { c: FUR, gap: 11, op: 0.3, seed: 51 }) + `</g>`;

  o += `<g id="head" transform="translate(0,0)">` + headGroup() + `</g>`;
  o += `</g></svg>`;
  return o;
}

/** 走路循环：手脚反相，身体两次起伏 */
export function walkPose(t, { swing = 22, bob = 5 } = {}) {
  const th = 2 * Math.PI * t, s = Math.sin(th);
  return {
    legNear: swing * s, legFar: -swing * s,
    armNear: -swing * 0.8 * s, armFar: swing * 0.8 * s,
    bob: -bob * Math.abs(Math.sin(2 * th)),
  };
}

writeFileSync("horse_side.svg", build());
if (process.argv.includes("--frames")) {
  mkdirSync("side", { recursive: true });
  for (let i = 0; i < 8; i++) writeFileSync(`side/f${i}.svg`, build(walkPose(i / 8)));
  console.log("horse_side.svg + 8 帧");
} else console.log("horse_side.svg");

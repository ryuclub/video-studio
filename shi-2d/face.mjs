/**
 * 石总 2D 口播 · 表情层（原型）
 *
 * 在 `man3_rig.svg` 的基础上加三样骨架里没有的东西：**眼珠、眉毛、表情嘴**。
 * 做法是给骨架打补丁，不改美术那边的文件 —— 定案之后应该并进 `make/build-rig.mjs`。
 *
 * ## 为什么眼珠要重画，不能直接挪原来那几条路径
 *
 * 这版眼睛的画法是：**一整块深色杏仁**（路径 113/116，#57392a）打底，
 * 左右各盖一牙白（122/128 和 120/125），中间露出来的就是虹膜，
 * 再压一个更深的瞳孔（149/151）和一个高光点（150/153）。
 *
 * 也就是说 **虹膜不是一个独立的圆，是「没被白色盖住的那块底」**。
 * 只挪瞳孔的话，虹膜留在原地，看着像瞳孔从眼球上滑下去了。
 * 所以这儿的做法是：裁到杏仁形状里，**整只眼球重画** ——
 * 白底 + 虹膜圆 + 瞳孔圆 + 高光点，三个圆一起平移。
 * 视线为 0 的时候和原画基本一致（差别只在眼角那点柔和的阴影）。
 *
 * ## 眼珠能走多远
 *
 * 虹膜直径 22、杏仁 31×22 —— **横向富余 ±4.5，纵向 0**。
 * 所以纵向靠「裁掉一截」来读：往下看就是上面露出白眼白、下面被裁。
 * 二维动画本来就这么做。超过 `GAZE` 里那个范围就会露馅。
 *
 * ## 眉毛是挪原画，不是重画
 * 眉毛（114/115）整条包进 `<g>` 里转就行 —— 眉毛下面是纯肤色，怎么挪都没接缝。
 */
import fs from 'node:fs';
import { load } from './素材.mjs';
import { RIG } from './rig.mjs';

// 序号 1 起，跟 `素材库/装配.json` 的分组同一套编号。
// **美术重导之后要跟着核** —— 序号对不上这儿会抛（找不到眉毛那条 d），不会静默画错。
// 核的办法：node shi-2d/asset-scan.mjs "…/资源 1.svg"
const shapes = load('E:/ryu/石总/SVG/正面new/SVG/资源 1.svg').shapes;
const dOf = (n1) => {
  const m = shapes[n1 - 1]?.xml.match(/ d="([^"]*)"/);
  if (!m) throw new Error(`资源 1.svg 第 ${n1} 个图元取不到 d —— 素材换了，跑 asset-scan 重核序号`);
  return m[1];
};

/** 脸上量出来的坐标。改美术文件就得重量 */
export const FACE = {
  eye: {
    l: { clip: dOf(113), cx: 195.5, cy: 124, irisR: 11, pupilR: 5.5, hi: [3, -2.5] },
    r: { clip: dOf(116), cx: 252.5, cy: 123.5, irisR: 11, pupilR: 5.5, hi: [3.5, -2.5] },
  },
  brow: {
    l: { d: dOf(114), pivot: [211, 102] },   // 支点取眉毛内端（靠鼻梁那头）
    r: { d: dOf(115), pivot: [234, 102] },
  },
  mouth: { cx: 222, cy: 172, halfW: 19 },
  color: { white: '#f2ece4', iris: '#57392a', pupil: '#2d1e16', hi: '#ede0d7', line: '#80503b' },
};

/** 眼珠的活动范围。虹膜跟杏仁一样高，纵向全靠裁，别放大 */
const GAZE = { x: 6, y: 4.5 };
const clamp = (v, m) => Math.max(-m, Math.min(m, v));

/* ---------- 补丁 ---------- */

const rigRaw = RIG;

/** 眼球：裁到杏仁里，白底 + 虹膜 + 瞳孔 + 高光。整组平移 = 转眼珠 */
function eyeball(side) {
  const e = FACE.eye[side], c = FACE.color;
  return (
    `<g clip-path="url(#ce-${side})">` +
    `<path d="${e.clip}" fill="${c.white}"/>` +
    `<g id="gaze-${side}">` +
    `<circle cx="${e.cx}" cy="${e.cy}" r="${e.irisR}" fill="${c.iris}"/>` +
    `<circle cx="${e.cx - 1.5}" cy="${e.cy + 0.5}" r="${e.pupilR}" fill="${c.pupil}"/>` +
    `<circle cx="${e.cx + e.hi[0]}" cy="${e.cy + e.hi[1]}" r="2" fill="${c.hi}"/>` +
    `</g></g>`
  );
}

/** 表情嘴：骨架里已经有一块肤色补丁盖住原嘴，这儿再盖一层画自己的线 */
const MOUTH_PATCH =
  'M198,172 Q200,163 210,161 Q222,159 234,161 Q244,163 246,172 ' +
  'Q246,182 236,188 Q222,192 208,188 Q198,182 198,172 Z';

/**
 * 给骨架打补丁。**可以直接打在 `buildFrame()` 的输出上** —— 锚点（`<defs>`、
 * 眉毛的 d、`<g id="faceOv">`）在摆完姿势之后一个没变。
 * 所以表情层和动作层互不干涉：`face(patch(buildFrame(pose)), expr)`。
 */
export function patch(svgIn) {
  let s = svgIn;
  // 1) clipPath 进 defs
  s = s.replace(
    '<defs>',
    '<defs>' +
    `<clipPath id="ce-l"><path d="${FACE.eye.l.clip}"/></clipPath>` +
    `<clipPath id="ce-r"><path d="${FACE.eye.r.clip}"/></clipPath>`,
  );
  // 2) 眉毛整条包进 <g>，转的时候连描边一起转
  for (const side of ['l', 'r']) {
    const d = FACE.brow[side].d;
    const i = s.indexOf(`d="${d}"`);
    if (i < 0) throw new Error(`骨架里找不到眉毛 ${side} —— 美术重导过素材？`);
    const start = s.lastIndexOf('<path', i);
    const end = s.indexOf('/>', i) + 2;
    s = s.slice(0, start) + `<g id="brow-${side}">` + s.slice(start, end) + '</g>' + s.slice(end);
  }
  // 3) 眼球和表情嘴垫在 faceOv 底下 —— 眼睑要能盖住眼球，口型要能盖住表情嘴
  s = s.replace(
    '<g id="faceOv">',
    eyeball('l') + eyeball('r') +
    `<g id="mouthX" opacity="0"><path d="${MOUTH_PATCH}" fill="#e8b092"/>` +
    `<path id="mxLine" d="" fill="none" stroke="${FACE.color.line}"` +
    ` stroke-width="2.6" stroke-linecap="round"/></g>` +
    '<g id="faceOv">',
  );
  return s;
}

/* ---------- 嘴形 ---------- */

/** 嘴角上扬／下撇／抿平。`k` 正=笑，负=撇；`tilt` 是左右不对称（坏笑、思考） */
function mouthLine(k, tilt = 0) {
  const { cx, cy, halfW } = FACE.mouth;
  const x0 = cx - halfW, x1 = cx + halfW;
  const y0 = cy - k * 5 + tilt;
  const y1 = cy - k * 5 - tilt;
  return `M${x0},${y0.toFixed(1)} Q${cx},${(cy + k * 9).toFixed(1)} ${x1},${y1.toFixed(1)}`;
}

/* ---------- 表情 ---------- */

/**
 * 表情表在**素材库**里，不在代码里：`shi-2d/素材库/表情.json`。
 * 加表情、调数值都改那份，这儿只负责把它套上去。
 */
export const EXPR = (() => {
  const raw = JSON.parse(fs.readFileSync(
    new URL('./素材库/表情.json', import.meta.url), 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    out[k] = { gaze: v.眼珠, brow: v.眉, lid: v.眼睑, mouth: v.嘴, 说明: v._ };
  }
  return out;
})();

/**
 * 把表情套进骨架，返回可以再交给 render3.mjs 那套姿势替换的 SVG。
 * @param {object} o
 *   gaze  [dx,dy] 眼珠位移，范围见 GAZE
 *   brow  [左,右] 眉毛抬起量（正=抬）。**左右分开给**，一高一低就是疑惑
 *   lid   0–1 上眼睑下垂量（跟眨眼共用同一组眼睑，别和 blink 同时给）
 *   mouth [k, tilt] 嘴角。k 正=笑负=撇，tilt 左右不对称。给 null 用原嘴
 */
export function face(svg, { gaze = [0, 0], brow = [0, 0], lid = 0, mouth = null } = {}) {
  let s = svg;
  const gx = clamp(gaze[0], GAZE.x), gy = clamp(gaze[1], GAZE.y);
  for (const side of ['l', 'r']) {
    s = s.replace(`<g id="gaze-${side}">`,
      `<g id="gaze-${side}" transform="translate(${gx.toFixed(2)},${gy.toFixed(2)})">`);
  }
  // 眉毛：抬起量同时给一点旋转 —— 只平移的眉毛像贴纸，转一点才有情绪
  const bs = { l: brow[0], r: brow[1] };
  for (const side of ['l', 'r']) {
    const v = bs[side];
    if (!v) continue;
    const [px, py] = FACE.brow[side].pivot;
    const rot = (side === 'l' ? -1 : 1) * v * 0.35;
    s = s.replace(`<g id="brow-${side}">`,
      `<g id="brow-${side}" transform="translate(0,${(-v).toFixed(2)}) rotate(${rot.toFixed(2)} ${px} ${py})">`);
  }
  if (lid > 0.02) {
    const k = Math.max(lid, 0.001);
    for (const id of ['lidR', 'lidL']) {
      s = s.replace(`id="${id}" transform="translate(0,114) scale(1,0.001)`,
        `id="${id}" transform="translate(0,114) scale(1,${k.toFixed(4)})`);
    }
  }
  if (mouth) {
    s = s.replace('<g id="mouthX" opacity="0"', '<g id="mouthX" opacity="1"');
    s = s.replace('<path id="mxLine" d=""', `<path id="mxLine" d="${mouthLine(mouth[0], mouth[1])}"`);
  }
  return s;
}

/** 打好补丁的空骨架。只用来单独摆表情看效果，出片走 `patch(buildFrame(pose))` */
export const RIG_SVG = patch(rigRaw);

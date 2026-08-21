/**
 * 漫符 —— 老马头边上蹦出来的那些小符号
 *
 *   import { mark, MARKS, place } from "./marks.mjs";
 *   mark("惊", { size: 150, seed: 3 })              // 一个符号，画在 0..100 的自有坐标系里
 *   place("惊", "右上", box, { size: 0.22 })        // 挂到马的头边上，box 是 compose 算出来的马框
 *
 * ── 为什么老马这条线特别需要它 ──
 *
 * 人设是「不愤怒、累到平静、全程陈述句、不表演」，脸上不能有戏 ——
 * 可 30 秒一条片子，一张不动的脸会闷死。
 *
 * **漫符是唯一的出口：情绪不放在脸上，放在头旁边。**
 * 这不是妥协，是这套人设自带的喜剧结构 —— 脸毫无反应、旁边"啪"地弹出一个
 * 巨大的感叹号，那个落差本身就是笑点。脸要是也跟着惊讶，符号就白画了。
 *
 * 所以有一条硬规矩：**出符号的那一帧，脸不许动。**
 *
 * ── 用量 ──
 *
 * 「偶尔穿插」是字面意思。跟扭头一样有上限（方案 §四「扭头一条最多两次，
 * 多了像抽搐」），符号也是：**一条 30 秒的片子最多 3 个，同一个符号不重复用**。
 * 满屏乱弹就成了表情包合集，那是另一个赛道，而且是更廉价的那个。
 *
 * ── 画法 ──
 *
 * 全部走 rough.mjs，跟马和场景同一套笔触（手绘线条、两遍描画、种子化抖动）。
 * **不要用 emoji、不要用图标字体** —— 那两样跟这套画风是两个世界，
 * 贴上去立刻变成"在剪辑软件里加了个贴纸"。
 *
 * 每个符号画在 100×100 的自有坐标系里、中心大致在 (50,50)，
 * 由 place() 统一缩放摆位。加新符号就往 MARKS 里加一条。
 */
import { stroke, shape, sample, ellipsePts, rng } from "./rough.mjs";

const INK = "#3B322B";
const ACCENT = "#C4552E";  // 朱调，给最需要跳出来的那两个符号（惊、闪）
const GRAY = "#6E6459";

/** 一条粗竖线，两端略收，画感叹号和"冷"用 */
const bar = (x, y0, y1, w, seed, color = INK) =>
  stroke([[x, y0], [x + (Math.sin(seed) * 2), (y0 + y1) / 2], [x, y1]], { color, w, passes: 2, amp: 1.6, seed });

const dot = (x, y, r, seed, color = INK) =>
  shape(ellipsePts(x, y, r, r * 1.05, 14), { fill: color, hatchGap: 0, line: color, w: 2, seed, amp: 1.2 });

/** 惊：一个粗感叹号。略右倾，倾了才有"弹出来"的劲 */
function jing(seed) {
  return `<g transform="rotate(8 50 50)">${bar(50, 14, 62, 13, seed, ACCENT)}${dot(50, 79, 8, seed + 1, ACCENT)}</g>`;
}

/** 惊二：两个感叹号，一大一小、方向相反。比单个夸张一档，给真的意外用 */
function jing2(seed) {
  return (
    `<g transform="rotate(-11 30 50) scale(0.86) translate(6,7)">${bar(30, 16, 60, 11, seed, ACCENT)}${dot(30, 75, 7, seed + 1, ACCENT)}</g>` +
    `<g transform="rotate(13 70 46)">${bar(70, 10, 60, 13, seed + 2, ACCENT)}${dot(70, 78, 8, seed + 3, ACCENT)}</g>`
  );
}

/** 问：问号。给"这是什么"、"他在说什么" */
function wen(seed) {
  const curve = sample([
    [[26, 30], [28, 8], [72, 8], [66, 33]],
    [[66, 33], [62, 46], [50, 48], [50, 64]],
  ], 16);
  return stroke(curve, { color: INK, w: 11, passes: 2, amp: 2, seed }) + dot(50, 81, 8, seed + 1);
}

/** 汗：一滴汗，尖朝上。尴尬、心虚 —— 老马最常用的一个 */
function han(seed) {
  const drop = sample([
    [[50, 12], [62, 38], [76, 52], [72, 70]],
    [[72, 70], [68, 88], [32, 88], [28, 70]],
    [[28, 70], [24, 52], [38, 38], [50, 12]],
  ], 14);
  return shape(drop, { fill: "#CFE0E4", hatchGap: 0, line: INK, w: 6, seed, amp: 1.8 });
}

/** 点：三个点。无语、沉默、不想接这个话 —— 人设最贴的一个 */
function dian(seed) {
  return dot(20, 58, 9, seed, GRAY) + dot(50, 58, 9, seed + 1, GRAY) + dot(80, 58, 9, seed + 2, GRAY);
}

/** 闪：放射线。被点名、被戳中、突然意识到 */
function shan(seed) {
  const r = rng(seed * 31 + 7);
  let o = "";
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r() * 0.2;
    const r0 = 20 + r() * 6;
    const r1 = 44 + r() * 10;
    o += stroke(
      [[50 + Math.cos(a) * r0, 50 + Math.sin(a) * r0], [50 + Math.cos(a) * r1, 50 + Math.sin(a) * r1]],
      { color: ACCENT, w: 7, passes: 2, amp: 1.5, seed: seed + i }
    );
  }
  return o;
}

/** 云：一小朵乌云加两条雨丝。丧、认了 */
function yun(seed) {
  const puff = sample([
    [[16, 58], [16, 40], [34, 34], [40, 40]],
    [[40, 40], [44, 24], [66, 24], [68, 40]],
    [[68, 40], [86, 38], [88, 58], [74, 60]],
    [[74, 60], [40, 62], [30, 62], [16, 58]],
  ], 14);
  return (
    shape(puff, { fill: "#D8D2C6", hatchGap: 26, hatchAngle: 60, hatchOp: 0.3, line: INK, w: 5, seed, amp: 2 }) +
    stroke([[34, 70], [30, 88]], { color: GRAY, w: 4, passes: 2, amp: 1.4, seed: seed + 4 }) +
    stroke([[58, 70], [54, 90]], { color: GRAY, w: 4, passes: 2, amp: 1.4, seed: seed + 5 })
  );
}

/** 灯：灯泡。想通了 —— 但老马想通的多半是件没用的事，这个符号自带反讽 */
function deng(seed) {
  const bulb = ellipsePts(50, 42, 26, 29, 20);
  return (
    shape(bulb, { fill: "#F2D98A", hatchGap: 0, line: INK, w: 6, seed, amp: 1.8 }) +
    stroke([[36, 70], [64, 70]], { color: INK, w: 6, passes: 2, amp: 1.2, seed: seed + 1 }) +
    stroke([[39, 80], [61, 80]], { color: INK, w: 5, passes: 2, amp: 1.2, seed: seed + 2 }) +
    stroke([[50, 6], [50, 14]], { color: GRAY, w: 4, passes: 1, amp: 1, seed: seed + 3 })
  );
}

/** 冷：三条竖线。僵住、发凉、后背一紧 —— 这是"害怕"那一档 */
function leng(seed) {
  return (
    bar(24, 16, 78, 8, seed, "#8FA3AD") +
    bar(50, 8, 86, 9, seed + 1, "#8FA3AD") +
    bar(76, 18, 74, 8, seed + 2, "#8FA3AD")
  );
}

/** 星：小星星。晕、被打击 */
function xing(seed) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 42 : 17;
    pts.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  return shape(pts, { fill: "#F2D98A", hatchGap: 0, line: INK, w: 5, seed, amp: 2 });
}

export const MARKS = {
  惊: { fn: jing, label: "感叹号 · 吃惊", note: "最通用的一个" },
  惊二: { fn: jing2, label: "双感叹号 · 大吃惊", note: "比惊夸张一档，一条片子最多一次" },
  问: { fn: wen, label: "问号 · 没听懂" },
  汗: { fn: han, label: "汗 · 尴尬心虚", note: "老马最常用" },
  点: { fn: dian, label: "三个点 · 无语", note: "人设最贴的一个，最不吵" },
  闪: { fn: shan, label: "放射线 · 被戳中" },
  云: { fn: yun, label: "乌云 · 丧" },
  灯: { fn: deng, label: "灯泡 · 想通了", note: "自带反讽：老马想通的多半没用" },
  冷: { fn: leng, label: "竖线 · 僵住发凉", note: "「害怕」那一档" },
  星: { fn: xing, label: "星 · 晕/被打击" },
};

export const MARK_NAMES = Object.keys(MARKS);

/**
 * 画一个符号，返回一段可以直接塞进 svg 的内容。
 *
 * @param size 画出来多大（px）。0..100 的自有坐标系按这个缩放
 * @param pop  0..1 的弹出进度。做动画用：0 是没出现，1 是完全弹出。
 *             用 easeOutBack 那种回弹曲线喂它，符号才有"啪"的一下
 */
export function mark(name, { size = 120, seed = 1, pop = 1, x = 0, y = 0, tilt = 0 } = {}) {
  const m = MARKS[name];
  if (!m) throw new Error(`没有这个符号：${name}\n可用：${MARK_NAMES.join(" / ")}`);
  const p = Math.max(0, Math.min(1, pop));
  if (p <= 0.001) return "";
  const k = (size / 100) * p;
  // 从中心缩放，且**略微上浮**：弹出时从下往上一点点，落定即停
  const rise = (1 - p) * size * 0.14;
  return (
    `<g transform="translate(${(x - (size * p) / 2).toFixed(1)},${(y - (size * p) / 2 + rise).toFixed(1)}) ` +
    `scale(${k.toFixed(4)}) rotate(${tilt} 50 50)" opacity="${p.toFixed(3)}">${m.fn(seed)}</g>`
  );
}

/**
 * 马在自身框里的墨迹范围（实测，`Resvg` 光栅化之后量的非透明像素）。
 * 头是上面这一段：水平 0.057..0.836，垂直 0..0.26。
 * **马的原稿换了就要重量一遍**，这几个数是硬编码的。
 */
export const HORSE_INK = { x0: 0.057, x1: 0.937, y0: 0.023, y1: 0.977 };
export const HORSE_HEAD = { x0: 0.057, x1: 0.836, y0: 0.023, y1: 0.26 };

/** 挂符号的两个位置。值是「马框」里的比例坐标 */
export const SPOTS = {
  左上: { x: -0.02, y: 0.05 },
  右上: { x: 0.98, y: 0.03 },
};

/**
 * 把符号挂到马的头边上。
 *
 * @param box compose() 里算出来的马框 { x, y, w, h }（画布像素）
 * @param size 符号占**马框宽度**的比例，默认 0.30
 *
 * 位置刻意在头的**外侧**：头在框里占到 x 0.057..0.836，
 * 所以左上落在 −0.02、右上落在 0.98，都在轮廓外面。
 * **压在头上就不是漫符了，是贴纸。**
 */
export function place(name, spot, box, { size = 0.3, seed = 1, pop = 1, tilt = 0 } = {}) {
  const s = SPOTS[spot];
  if (!s) throw new Error(`没有这个位置：${spot}\n可用：${Object.keys(SPOTS).join(" / ")}`);
  return mark(name, {
    size: box.w * size,
    seed,
    pop,
    tilt,
    x: box.x + box.w * s.x,
    y: box.y + box.h * s.y,
  });
}

// ── 说话放射：他一开口就在头边上跳 ────────────────────────────────────
//
// 素材是给过来的那张 svg，**路径数据一个字没改**，只改了三件事：
//
//   ① **CSS 动画换成逐帧算。** 原稿用 `@keyframes` + `animation`，
//      而这条链是 resvg 逐帧光栅化 —— **resvg 不支持 CSS 动画**，
//      直接喂进去五根刺全都定在初始状态，而且不报错。
//      所以把每根刺的周期和缩放区间抄成数，按当前时刻算出 scale。
//   ② 缩放中心。原稿是 `transform-origin: 0px 0px`（view-box 原点），
//      这里就绕 (0,0) 缩放，效果一致。
//   ③ 摆位。原稿的扇形是朝右开的，顶点在 x≈30 附近；
//      挂到马身上时按 `spot` 决定朝左还是朝右。
//
// ── 用量跟漫符不是一回事 ──
//
// 漫符是「偶尔来一个」，这个是**每句话都在**。所以它必须够小、够边上：
// 它的作用是让「他在说话」这件事在静止画面里看得见，不是抢戏。
// 五根刺各有各的周期（.37–.62 秒，互质得不整齐），所以永远不会齐步跳 ——
// 齐步跳会变成一个在闪的整体，那就吵了。

/** 五根刺：路径 ＋ 周期（秒）＋ 缩放区间。全部照抄原稿的 @keyframes */
const SPIKES = [
  { d: 'M 24.1 -56.8 L 32.4 -53.7 L 82.1 -134.2 L 55.9 -146.3 Z', period: 0.62, from: 0.72, to: 1.0 },
  { d: 'M 77.2 -54.3 L 83.0 -43.5 L 272.1 -133.2 L 245.0 -178.4 Z', period: 0.48, from: 1.0, to: 0.7 },
  { d: 'M 58.0 -6.4 L 58.3 3.5 L 162.8 5.7 L 160.8 -19.7 Z', period: 0.37, from: 0.78, to: 1.0 },
  { d: 'M 84.8 34.2 L 79.3 44.4 L 229.9 137.5 L 249.7 93.6 Z', period: 0.55, from: 0.94, to: 0.68 },
  { d: 'M 35.7 49.2 L 27.0 53.6 L 63.7 125.2 L 86.2 110.1 Z', period: 0.43, from: 0.7, to: 1.0 },
];

/** 原稿的 viewBox 宽度，用来把「占马框多少」换算成缩放系数 */
const SPIKE_W = 277.2;

const SPIKE_FILL = '#F5D400';
const SPIKE_LINE = '#4A2A17';

/** 说话放射的挂点。值是马框里的比例坐标，指的是扇形的**顶点** */
export const BURST_SPOTS = {
  左: { x: 0.1, y: 0.17, flip: true },
  右: { x: 0.9, y: 0.17, flip: false },
};

/**
 * 说话放射。**每帧都要重算**（五根刺在跳）。
 *
 * @param t    当前时刻（秒）。相位从这儿来
 * @param box  马框 { x, y, w, h }
 * @param size 扇形宽度占马框宽度的比例
 */
export function speechBurst(t, box, { spot = '右', size = 0.34, tilt = 0, seed = 1 } = {}) {
  const s = BURST_SPOTS[spot];
  if (!s) throw new Error(`没有这个挂点：${spot}\n可用：${Object.keys(BURST_SPOTS).join(' / ')}`);
  const k = (box.w * size) / SPIKE_W;
  const x = box.x + box.w * s.x;
  const y = box.y + box.h * s.y;

  const body = SPIKES.map((sp, i) => {
    // 0% / 100% 是 from，50% 是 to。余弦插值 ≈ 原稿的 ease-in-out
    const phase = (t / sp.period + seed * 0.13 * i) % 1;
    const g = sp.from + (sp.to - sp.from) * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    return (
      `<g transform="scale(${g.toFixed(4)})">` +
      `<path d="${sp.d}" fill="${SPIKE_FILL}" stroke="${SPIKE_LINE}" stroke-width="12" stroke-linejoin="round"/>` +
      `</g>`
    );
  }).join('');

  const flip = s.flip ? ' scale(-1,1)' : '';
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${tilt})${flip} scale(${k.toFixed(4)})">${body}</g>`;
}

// ── 道具库：能摆进画面的物件 ──────────────────────────────────────────
//
// 场景是背景（三层视差），角色是 rig（会动会说话），**道具是中间那一层**——
// 故事里被搬、被砸、被吃的东西。《小老鼠做蛋糕》没有蛋和蛋糕就没法讲。
//
// 道具跟角色共用 `stage` 名单：`"stage": ["鼠甲", "egg"]`。
// 这样句间空白归属、镜头切换那套规则自动继承，不用再写一遍。
//
// 画法统一：**柔和描边 + 平涂**。这是绘本最通用的语汇，跟线稿描边族（兔/松鼠）
// 和扁平族（老鼠）都不打架。

import { n } from '../style/papercut.js';

export type Prop = (ink: (c: string) => string, seed: number) => string;

const OUT = '#5B4A3F'; // 描边：暖褐，比纯黑柔和，适合儿童内容
const SW = 7;

const stroke = (d: string, fill: string, ink: (c: string) => string, sw = SW) =>
  `<path d="${d}" fill="${ink(fill)}" stroke="${ink(OUT)}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;

const ell = (cx: number, cy: number, rx: number, ry: number, fill: string, ink: (c: string) => string, sw = SW) =>
  `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${ink(fill)}" stroke="${ink(OUT)}" stroke-width="${sw}"/>`;

/** 大蛋：比小老鼠还大，这是全篇的核心道具 */
const egg: Prop = (ink) =>
  ell(0, -150, 130, 165, '#FFF6E4', ink, 8) +
  // 高光：一小片offset的浅色，蛋才有体积感
  `<ellipse cx="${n(-42)}" cy="${n(-205)}" rx="34" ry="48" fill="${ink('#FFFFFF')}" opacity="0.75" transform="rotate(-18 -42 -205)"/>`;

/** 敲开的蛋：两半蛋壳 + 中间的蛋黄 */
const eggCracked: Prop = (ink) =>
  // 左半壳
  stroke('M -160,-20 L -150,-120 L -128,-70 L -104,-130 L -80,-64 L -60,-118 L -46,-20 Z', '#FFF6E4', ink) +
  // 右半壳
  stroke('M 46,-20 L 60,-118 L 80,-64 L 104,-130 L 128,-70 L 150,-120 L 160,-20 Z', '#FFF6E4', ink) +
  // 蛋黄
  ell(0, -52, 62, 42, '#FFD75E', ink) +
  `<ellipse cx="-18" cy="-64" rx="16" ry="10" fill="${ink('#FFEBA6')}" opacity="0.8"/>`;

/** 大锅：故事里"锅太大拉不动"，所以要画得夸张地大 */
const pot: Prop = (ink) =>
  // 锅身
  stroke('M -170,-190 L -150,-40 Q -145,-6 -105,-6 L 105,-6 Q 145,-6 150,-40 L 170,-190 Z', '#8A93A6', ink, 8) +
  // 锅沿
  stroke('M -186,-206 L 186,-206 L 178,-172 L -178,-172 Z', '#A8B0C0', ink) +
  // 两只把手
  stroke('M -186,-196 Q -232,-190 -230,-152 Q -228,-126 -196,-126', 'none', ink, 12) +
  stroke('M 186,-196 Q 232,-190 230,-152 Q 228,-126 196,-126', 'none', ink, 12);

/** 面粉、牛奶、白糖、碗 —— 一堆材料摆一起 */
const ingredients: Prop = (ink) =>
  // 面粉袋
  stroke('M -150,-10 L -140,-120 Q -138,-150 -110,-150 L -70,-150 Q -42,-150 -40,-120 L -30,-10 Z', '#F0E6D2', ink, 6) +
  `<path d="M -132,-96 L -48,-96" stroke="${ink(OUT)}" stroke-width="5" opacity="0.5"/>` +
  // 牛奶瓶
  stroke('M -12,-10 L -12,-96 Q -12,-116 2,-124 L 2,-146 L 30,-146 L 30,-124 Q 44,-116 44,-96 L 44,-10 Z', '#FFFFFF', ink, 6) +
  `<path d="M -12,-64 L 44,-64" stroke="${ink(OUT)}" stroke-width="5" opacity="0.4"/>` +
  // 糖罐
  stroke('M 62,-10 L 66,-92 L 128,-92 L 132,-10 Z', '#FFE9B8', ink, 6) +
  stroke('M 58,-92 L 136,-92 L 132,-112 L 62,-112 Z', '#D8A860', ink, 6) +
  // 碗
  stroke('M 148,-10 Q 148,-70 206,-70 Q 264,-70 264,-10 Z', '#CFE3F0', ink, 6);

/** 炉子 + 柴火 + 火苗 */
const stove: Prop = (ink) =>
  // 三块垫石
  ell(-96, -18, 44, 26, '#9A948A', ink, 6) +
  ell(0, -14, 46, 27, '#8C867B', ink, 6) +
  ell(96, -18, 44, 26, '#9A948A', ink, 6) +
  // 柴
  stroke('M -110,-44 L 108,-70', '#A0703F', ink, 14) +
  stroke('M -104,-70 L 112,-44', '#8A5E33', ink, 14) +
  // 火苗：三片，中间最高
  stroke('M -46,-72 Q -30,-128 -6,-96 Q 6,-150 26,-96 Q 46,-130 56,-72 Z', '#FF9F43', ink, 6) +
  `<path d="M -18,-76 Q -6,-114 8,-84 Q 18,-112 30,-76 Z" fill="${ink('#FFD75E')}"/>`;

/** 做好的蛋糕：两层 + 樱桃，香喷喷 */
const cake: Prop = (ink) =>
  // 下层
  stroke('M -140,-12 L -132,-96 L 132,-96 L 140,-12 Z', '#F6D9A8', ink) +
  // 奶油边
  stroke('M -134,-96 Q -110,-122 -84,-96 Q -58,-122 -32,-96 Q -6,-122 20,-96 Q 46,-122 72,-96 Q 98,-122 134,-96 L 132,-72 L -132,-72 Z', '#FFFFFF', ink, 6) +
  // 上层
  stroke('M -84,-96 L -78,-166 L 78,-166 L 84,-96 Z', '#F6D9A8', ink) +
  stroke('M -80,-166 Q -56,-190 -30,-166 Q -4,-190 22,-166 Q 48,-190 80,-166 L 78,-146 L -78,-146 Z', '#FFF3E0', ink, 6) +
  // 樱桃
  ell(0, -196, 24, 24, '#E8564A', ink, 6) +
  `<path d="M 0,-216 Q 10,-238 26,-240" fill="none" stroke="${ink('#5C8A3A')}" stroke-width="7" stroke-linecap="round"/>`;

/** 蛋壳车：两节车厢 + 轮子，故事的结尾 */
const eggCar: Prop = (ink) => {
  const carriage = (dx: number) =>
    `<g transform="translate(${n(dx)},0)">` +
    // 半个蛋壳当车厢，锯齿口朝上
    stroke('M -108,-30 Q -108,-146 0,-146 Q 108,-146 108,-30 Z', '#FFF6E4', ink, 8) +
    stroke('M -108,-140 L -84,-116 L -58,-146 L -30,-118 L -2,-148 L 26,-118 L 54,-146 L 80,-118 L 108,-142', 'none', ink, 6) +
    // 轮子
    ell(-58, -14, 34, 34, '#7E6B5A', ink, 7) +
    ell(58, -14, 34, 34, '#7E6B5A', ink, 7) +
    `<circle cx="-58" cy="-14" r="10" fill="${ink('#C9B79E')}"/>` +
    `<circle cx="58" cy="-14" r="10" fill="${ink('#C9B79E')}"/>` +
    `</g>`;
  return (
    // 连杆
    `<path d="M -120,-40 L 120,-40" stroke="${ink(OUT)}" stroke-width="9" stroke-linecap="round"/>` +
    carriage(-230) +
    carriage(0) +
    // 后面拴着的大锅（原文：锅太大只好用绳子拴在车厢后面）
    `<path d="M 108,-52 L 196,-64" stroke="${ink(OUT)}" stroke-width="6" stroke-dasharray="10 8"/>` +
    `<g transform="translate(300,10) scale(0.52)">${pot(ink, 0)}</g>`
  );
};

export const PROPS: Record<string, Prop> = {
  egg,
  'egg-cracked': eggCracked,
  pot,
  ingredients,
  stove,
  cake,
  'egg-car': eggCar,
};

export const PROP_KINDS = Object.keys(PROPS);

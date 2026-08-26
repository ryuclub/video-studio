// ── 蓝衫小人：八个姿势的尺寸换算 ──────────────────────────────────────
//
// **为什么需要这个。** 八张原稿是从同一张动作设定表上裁下来的，共用一套坐标
// （每张的头半径都是 32），但各自的 viewBox 宽窄从 145 到 218 不等 ——
// 而 `still` 的 `length` 给的是**目标宽度**。同一个 `length` 传给「打电话」
// （145 宽）和「鞠躬」（218 宽），出来是**一大一小两个人**，
// 而且哪一张都不难看，得两张摆在一起才看得出来。
//
// 用法：`still(… { art: 'figure-sitting', length: figureLength('figure-sitting', 300) })`
// 300 是「按走路那张算的宽度」，八个姿势传同一个数就是同一个人。

/** 各姿势的 viewBox 宽度。改原稿要一起改这张表 —— 不一致时 `figureLength` 会抛 */
const VB_W: Record<string, number> = {
  'figure-walking': 156,
  'figure-thinking': 156,
  'figure-phone-call': 145,
  'figure-typing': 214,
  'figure-sitting': 176,
  'figure-hand-raised': 157,
  'figure-jumping': 158,
  'figure-bowing': 218,
};

/** 基准：走路那张。八个姿势按它折算 */
const BASE = VB_W['figure-walking'];

export const FIGURES = Object.keys(VB_W);

/** 想要「跟走路那张一样大」的话，这个姿势该传多少 length */
export function figureLength(art: string, base = 300): number {
  const w = VB_W[art];
  if (!w) throw new Error(`figureLength: 不认识的姿势 ${art}（只有 ${FIGURES.join(' / ')}）`);
  return Math.round((base * w) / BASE);
}

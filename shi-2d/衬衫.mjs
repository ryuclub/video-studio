/**
 * 老石的衬衫换色。
 *
 * 原画那件是粉的（`#E6ACB4`）。**一期一个颜色**，写在项目的 `动作表.json` 里：
 *
 *   { "衬衫": "天蓝", ... }        名字，见 素材库/衬衫.json 的「配色」
 *   { "衬衫": "#17B1EF", ... }     也可以直接给色值
 *
 * ## 为什么按色值换，不给素材另存十份
 *
 * 十份素材就是十份要跟着美术改的东西 —— 美术重导一次，十份全废。
 * 按色值换只有一张表要维护（`素材库/衬衫.json` 的「原色」），而且那张表是**量出来的**
 * （`shirt-scan.mjs`），不是手挑的。
 *
 * ## 换的是色相和饱和度，不是整块涂色
 *
 * 一件衬衫在原画里是五到三十个色：本色、阴影、高光、领口边、褶子的暗线。
 * 直接全刷成同一个目标色，衣服就成了一块平板。所以走 HSL：
 *
 *   色相  一律换成目标色的
 *   饱和  按「这个色比基色饱和多少」等比缩放
 *   明度  **重映射不是平移** —— 基色那一档对齐到目标色，比基色暗的往 0 拉伸、
 *         比基色亮的往 1 拉伸。平移的话，目标色一深（墨绿 `#2E5252`），
 *         所有阴影会被压成纯黑，衣服上就剩几块死黑。
 *
 * ⚠ **原色表跟素材是绑死的。** 美术重导之后色值会变（Illustrator 会重新量化），
 * 表对不上的表现是**「换了色但有几块还是粉的」，不报错** —— 所以重导要重跑 shirt-scan。
 */
import fs from 'node:fs';

const LIB = JSON.parse(fs.readFileSync(new URL('./素材库/衬衫.json', import.meta.url), 'utf8'));

/** 名字 → 色值。也认直接写的 #RRGGBB */
export function 解析色(名) {
  if (!名) return null;
  if (/^#[0-9a-fA-F]{6}$/.test(名)) return { 名: 名.toUpperCase(), 色: 名.toUpperCase() };
  const c = LIB.配色[名];
  if (!c) {
    throw new Error(`衬衫颜色「${名}」不在配色表里。有的是：${Object.keys(LIB.配色).join(' ')}` +
      '（也可以直接写 #RRGGBB）');
  }
  return { 名, 色: c.色.toUpperCase(), 说明: c._ };
}

export const 配色表 = LIB.配色;
export const 原色表 = LIB.原色;

/* ---------- 颜色换算 ---------- */

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  .toString(16).padStart(2, '0')).join('');

function rgb2hsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hsl2rgb([h, s, l]) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

/**
 * 一个原色映射到目标色。
 * @param 原   这一块的原色
 * @param 基   这张素材的基色（面积最大的那个，原色表里排第一）
 * @param 目标 要换成的颜色
 */
export function 映射(原, 基, 目标) {
  const [, s0, l0] = rgb2hsl(hex2rgb(原));
  const [, sB, lB] = rgb2hsl(hex2rgb(基));
  const [hT, sT, lT] = rgb2hsl(hex2rgb(目标));
  // 明度：基色对齐到目标色，两头各自按比例拉伸（不是平移 —— 见文件头）
  const l = l0 <= lB
    ? (lB > 1e-6 ? lT * (l0 / lB) : l0)
    : lT + (1 - lT) * ((l0 - lB) / Math.max(1e-6, 1 - lB));
  // 饱和：等比缩放，保住「阴影比本色灰一点」这个关系
  const s = sB > 1e-6 ? Math.min(1, sT * (s0 / sB)) : sT;
  return rgb2hex(hsl2rgb([hT, s, l]));
}

/**
 * 给一张素材算出「原色 → 新色」的替换表。
 * @param 文件 素材文件名（原色表的键，比如 `插兜站姿.svg`）
 */
export function 替换表(文件, 目标) {
  const 原色 = 原色表[文件];
  if (!原色) return null;                       // 这张素材上没有衬衫（腿件、头、场景）
  const 基 = 原色[0];
  const m = new Map();
  for (const c of 原色) m.set(c, 映射(c, 基, 目标));
  return m;
}

/**
 * 把一段已经拼好的 SVG 里的衬衫色换掉。
 *
 * **在最后一步做，不在 `load()` 里做** —— `face.mjs` 是在模块顶层就 `load()` 的，
 * 塞进 load 里会变成「import 顺序决定换没换色」，那种错不报错、只是颜色不对。
 *
 * @param svg   拼好的 SVG 字符串（图元都带内联 fill）
 * @param 目标  目标色 `#RRGGBB`，给 null 就原样返回
 * @param 文件  这段 SVG 来自哪张素材；不给就拿所有素材的原色表一起换
 */
export function 换衬衫(svg, 目标, 文件 = null) {
  if (!目标) return svg;
  const 表 = new Map();
  const 名单 = 文件 ? [文件] : Object.keys(原色表);
  for (const f of 名单) {
    const t = 替换表(f, 目标);
    if (t) for (const [a, b] of t) 表.set(a, b);
  }
  // ⚠ 一次遍历换完，**别一个色一个色地 replace** —— 换出来的新色可能正好是
  // 另一个原色，第二轮会把它再换一次（粉→蓝→更蓝），出来是花的
  return svg.replace(/#[0-9a-fA-F]{6}/g, (m) => 表.get(m.toLowerCase()) || m);
}

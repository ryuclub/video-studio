// ── 出口在哪：技术和结果的边界，只此一处 ──────────────────────────────
//
// **仓库分两半：代码在各条线自己的目录里，成品全部落在根级 `projects/<类型>/`。**
//
//   技术                                   结果
//   ─────────────────────────────────      ──────────────────────────
//   src/                （记者读稿的代码）   projects/记者读稿/
//   joke-video/src/     （下面三条线共用）   projects/段子与儿童故事/
//   joke-video/jokes/   （段子+一页故事稿件） projects/说书/
//   shuoshu/*.md        （聊斋稿件与手册）   projects/治愈/
//   zhiyu/*.md musics/  （治愈线文档与素材）
//
// 以前每条线的成品散在自己目录下（`joke-video/projects/`、`shuoshu/projects/`…），
// 找片子要翻四个地方，而且 `.gitignore` 得为每条线各写一套规则。
//
// ── 为什么段子和《一页故事》合在一个文件夹 ──
//
// 它们**共用同一条管线**：稿件都在 `joke-video/jokes/` 一个平目录里，
// `preview.ts` 也是把它们汇总成同一个画廊（`index.html`）。
// 按内容拆成两个文件夹的话，画廊和稿件源就对不上了。
// 要拆得先把 `jokes/` 和预览页一起拆，那是另一件事。
//
// ── 改路径只改这里 ──
//
// 这些常量是**相对 `joke-video/` 跑的脚本**给的（那几个脚本的 cwd 都是它）。
// 根级 `src/` 那条线走 `src/config.ts` 的 `projectsDir`，两边要一起改。

/** 所有成品的根。相对 joke-video/ */
export const OUT_ROOT = '../projects';

/** 段子 + 《一页故事》。两条内容线共用 joke-video 管线，所以共用一个目录 */
export const OUT_JOKE = `${OUT_ROOT}/段子与儿童故事`;
/** 说书（聊斋） */
export const OUT_SHUOSHU = `${OUT_ROOT}/说书`;
/** 治愈系旁白 */
export const OUT_ZHIYU = `${OUT_ROOT}/治愈`;

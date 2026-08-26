// ── 原稿上色：素材库预览和正片渲染共用一份规则 ────────────────────────
//
// 放在这儿是因为 `roster.ts`（素材库预览）和 `rigs/still.ts`（正片）**各写过一份**，
// 两边已经漂了：预览只换 fill、正片 fill 和 stroke 都换。同一张原稿在两处
// 长得不一样，那素材库就不再是预览了。

/** 这张原稿是不是靠 `fill="none"` 继承来画线的 */
export function isLineArt(svg: string): boolean {
  return /fill="none"/.test(svg);
}

/**
 * 把原稿里的颜色过一遍 `ink()`。
 *
 * ⚠ **「没写 fill 的 path 补深墨」这条不能无条件执行。**
 * 它是为纯黑线稿（`rabbit-line.svg`：5 个 path，一个 fill 都没有）准备的。
 * 可 `figure-*.svg` 那批是**靠外层 `<g fill="none">` 继承**来画线的 ——
 * 无条件补的话，胳膊腿会被填成一坨黑块。
 * 所以：**整张图里出现过 `fill="none"` 就不补**，那说明作者是有意让它继承。
 */
export function inkPaths(inner: string, ink: (c: string) => string): string {
  const out = inner
    .replace(/fill="(#[0-9a-fA-F]{3,8})"/g, (_m, c) => `fill="${ink(c)}"`)
    .replace(/stroke="(#[0-9a-fA-F]{3,8})"/g, (_m, c) => `stroke="${ink(c)}"`);
  return isLineArt(inner) ? out : out.replace(/<path (?![^>]*fill=)/g, `<path fill="${ink('#22283A')}" `);
}

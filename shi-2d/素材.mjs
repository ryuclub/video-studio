/**
 * 石总 2D 素材加载 —— **入库这一关**
 *
 * 美术那边用 Illustrator 导，**导出设置一变文件长相就变**，而且变了不报错，
 * 只是颜色没了、形状少了。已经踩到两种：
 *
 *   旧式  `<defs><style>.cls-1{fill:#0b142a;}</style></defs>` ＋ 只有 <path>
 *   新式  `<style type="text/css"> .st0{fill:#0B142A;} </style>` ＋ 还有 <polygon>
 *
 * `make/build-rig.mjs` 的正则写死了 `\.cls-\d+\{fill:#[0-9a-f]{6}\}` ——
 * 遇到新式全部匹配不上，**所有 fill 变成黑色**，渲出来是一片黑剪影。
 * 这份就是为了不再踩这个：类名前缀、大小写、缩写色、非 path 图元一起吃掉。
 *
 * `load()` 返回的每一项都是**自带 fill 的独立图元**，不依赖 <style>，
 * 拼进任何 SVG 都不会串色（各素材的 .cls-1 撞名是另一个静默坑）。
 */
import fs from 'node:fs';

/** #abc → #aabbcc，顺便统一成小写 */
function normHex(c) {
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((x) => x + x).join('');
  return s;
}

/**
 * 读一个 Illustrator 导出的 SVG，返回：
 *   { viewBox:[w,h], shapes:[{ xml, fill, tag }] }
 * xml 里的 class 已经换成直接的 fill。
 */
export function load(file) {
  const s = fs.readFileSync(file, 'utf8');

  const vb = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error(`${file}: 没有 viewBox="0 0 w h"，导出设置不对`);

  // 类名 → 颜色。类名前缀不限（cls- / st / 别的），色值大小写和缩写都吃。
  // `fill:none` 也收 —— 它跟「查不到颜色」是两回事：查不到是导出设置坏了（要抛错），
  // `none` 是美术明写的「这条不画」。2026-09-06 那次重导的空路径就是这种。
  const css = (s.match(/<style[^>]*>([\s\S]*?)<\/style>/) || [, ''])[1];
  const colors = new Map();
  for (const m of css.matchAll(/\.([\w-]+)\s*\{\s*fill\s*:\s*(#[0-9a-fA-F]{3,6}|none)\s*;?\s*\}/g)) {
    colors.set(m[1], m[2] === 'none' ? 'none' : normHex(m[2]));
  }

  // path 之外还见过 polygon。别的图元出现了要在这儿加，**不要静默丢掉**
  const shapes = [];
  const unknown = new Set();
  let 空 = 0;
  for (const m of s.matchAll(/<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*\/>/g)) {
    const [xml, tag] = m;
    const cls = (xml.match(/class="([\w-]+)"/) || [])[1];
    const inline = (xml.match(/fill="(#[0-9a-fA-F]{3,6})"/) || [])[1];
    const fill = inline ? normHex(inline) : colors.get(cls);
    // `fill:none` 的直接不收 —— 它渲出来什么都没有，留着只会把后面所有序号顶掉一位，
    // 而分组、换腿、切臂全是按序号来的
    if (fill === 'none') { 空++; continue; }
    if (!fill) unknown.add(cls || '(无 class)');
    shapes.push({
      tag,
      fill: fill || '#000000',
      xml: cls ? xml.replace(/class="[\w-]+"/, `fill="${fill || '#000000'}"`) : xml,
    });
  }
  if (unknown.size) {
    throw new Error(
      `${file}: 这些 class 在 <style> 里查不到颜色 —— ${[...unknown].join(', ')}。` +
      `导出设置八成变了（比如 fill 写成了内联 style 或者用了渐变）`,
    );
  }
  if (!shapes.length) throw new Error(`${file}: 一个图元都没读到`);

  // `空` 是被丢掉的 fill:none 条数。**序号是按这份 shapes 数的** ——
  // 美术要是加减了空路径，序号会跟着挪，分组和切臂的区间要回来核
  return { viewBox: [+vb[1], +vb[2]], shapes, 空 };
}

/** 把若干图元拼成一段 xml */
export const join = (shapes, from, to) =>
  shapes.slice(from - 1, to).map((x) => x.xml).join('');

/** 按序号挑（1 起） */
export const pick = (shapes, idx) => idx.map((i) => shapes[i - 1].xml).join('');

/**
 * 素材对照图 —— 挑姿势用，不是量用的（量走 `量.mjs`）
 *
 *   node gao-2d/看.mjs                 全部 11 张
 *   node gao-2d/看.mjs side-walk       只出一组
 *
 * ⚠ **必须走 `load()` 拿图元，不能把整张 svg 的内容直接拼进同一张画布。**
 * 各素材的 `.cls-1` 会撞名，后面那张的 `<style>` 覆盖前面的 ——
 * 表现是**串色**（蓝头发、脸一块深一块浅、裤子花的），而且不报错。
 * `shi-2d/素材.mjs` 顶上写着这一条，`load()` 返回的每一项都自带 fill，就是为了这个。
 * 我第一版图省事跳过了它，当场撞上。
 */
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { load } from '../shi-2d/素材.mjs';

const 册 = JSON.parse(fs.readFileSync('gao-2d/素材库/素材册.json', 'utf8'));
const 只要 = process.argv[2];

const 项 = [
  ...册.姿势.map((p) => ({ 名: p.key, file: p.file })),
  ...册.帧序列.flatMap((s) => s.frames.map((f, i) => ({ 名: `${s.key}#${i}`, file: f.file }))),
].filter((x) => !只要 || x.名.startsWith(只要));

const 列 = Math.min(6, 项.length);
const 格宽 = 300, 格高 = 620, 人高 = 560;
const g = 项
  .map((it, i) => {
    const { viewBox: [W, H], shapes } = load(`gao-2d/素材库/svg/${it.file}`);
    const k = 人高 / H;
    const x = (i % 列) * 格宽 + (格宽 - W * k) / 2;
    const y = Math.floor(i / 列) * 格高 + 30;
    return (
      `<g transform="translate(${x.toFixed(1)},${y}) scale(${k.toFixed(4)})">${shapes.map((s) => s.xml).join('')}</g>` +
      `<rect x="${(i % 列) * 格宽}" y="${Math.floor(i / 列) * 格高}" width="${格宽}" height="${格高}" fill="none" stroke="#CFC7B8" stroke-width="2"/>`
    );
  })
  .join('');

const SW = 列 * 格宽, SH = Math.ceil(项.length / 列) * 格高;
const page = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}"><rect width="100%" height="100%" fill="#FBF8F1"/>${g}</svg>`;
const 出 = `gao-2d/素材库/_对照${只要 ? '-' + 只要 : ''}.png`;
fs.writeFileSync(出, new Resvg(page, { fitTo: { mode: 'width', value: SW }, font: { loadSystemFonts: false } }).render().asPng());
console.log(`${项.length} 张 → ${出}`);
console.log('  ' + 项.map((x) => x.名).join('  '));

/**
 * 表情摆拍台 —— 把 `face.mjs` 里 `EXPR` 那张表整张渲出来，裁到脸，拼成一张对照图。
 *
 * **调表情数值就用这个**，别去出整片。改完 EXPR 跑一次，几秒钟就能看见。
 *
 *   node shi-2d/face-probe.mjs <输出目录> [表情名 ...]
 *
 * 不给表情名就渲 EXPR 里的全部。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RIG_SVG, face, EXPR } from './face.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const OUT = process.argv[2];
if (!OUT) { console.error('要给输出目录'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const names = process.argv.slice(3).filter((n) => EXPR[n]);
const list = names.length ? names : Object.keys(EXPR);

// 骨架坐标里的脸：帽檐到下巴 x290-480 / y60-210（viewBox 原点是 -150,-30）
const CROP = 'crop=190:150:290:60,scale=380:300:flags=neighbor';

const files = list.map((n) => {
  const svg = face(RIG_SVG, EXPR[n]).replace('<svg ', '<svg width="745" height="1010" ');
  const full = path.join(OUT, `_expr_${n}.png`);
  fs.writeFileSync(full,
    new Resvg(svg, { font: { loadSystemFonts: false }, background: 'rgba(255,255,255,1)' })
      .render().asPng());
  const cut = path.join(OUT, `_face_${n}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', full, '-vf', CROP, cut]);
  return cut;
});

// 一行最多五张
const cols = Math.min(5, files.length);
const rows = Math.ceil(files.length / cols);
const layout = files.map((_, i) => {
  const c = i % cols, r = Math.floor(i / cols);
  const x = c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+');
  return `${x}_${r === 0 ? '0' : Array.from({ length: r }, () => 'h0').join('+')}`;
}).join('|');

const sheet = path.join(OUT, '表情对照.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
  ...files.flatMap((f) => ['-i', f]),
  '-filter_complex',
  `${files.map((_, i) => `[${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}`,
  sheet]);
files.forEach((f) => fs.unlinkSync(f));
list.forEach((n) => fs.unlinkSync(path.join(OUT, `_expr_${n}.png`)));

console.log(`${list.length} 个表情：${list.join(' ')}`);
console.log(sheet);

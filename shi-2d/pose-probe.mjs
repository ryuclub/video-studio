/**
 * 定格姿势摆拍台 —— 把姿势库里每张图按登记的机位摆到画面上，拼成对照图。
 *
 * **调机位数值用这个**：改 `素材库/姿势.json` 的眼距／眼线，跑一次就能看见。
 * 第一张是骨架的站定姿势，用来比景别 —— 切镜头的时候头不该跳。
 *
 *   node shi-2d/pose-probe.mjs <输出目录> [姿势名 ...]
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { POSE, renderPose, CANVAS } from './pose.mjs';
import { buildFrame } from './rig.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const OUT = process.argv[2];
if (!OUT) { console.error('要给输出目录'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const names = process.argv.slice(3).filter((n) => POSE[n]);
// 没机位的是配件（坐姿下半身），不单独摆
const list = names.length ? names : Object.keys(POSE).filter((n) => POSE[n].机位);

const png = (svg, file) => fs.writeFileSync(file,
  new Resvg(svg, { font: { loadSystemFonts: false }, background: 'rgba(255,255,255,1)' })
    .render().asPng());

// 第一张放骨架，用来比景别
// ⚠ **这两个数必须跟 shoot.mjs 的 CANVAS 一样**，不然第一张比出来的景别是假的。
// 2026-09-05 字幕挪到头顶之后 shoot 改成了 1.04 / 1180，这儿漏改了一版（1.30 / 1250），
// 结果骨架那张比姿势大一圈 —— 看着像姿势图都缩水了，其实是参照物错了
const RIG_SCALE = 1.04, RIG_FEET = 1180;
const rigSvg = buildFrame({ mouth: 'E' })
  .replace(/<svg([^>]*)viewBox="[^"]*"([^>]*)>/,
    `<svg$1width="${CANVAS.w}" height="${CANVAS.h}" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}"$2>` +
    `<g transform="translate(${(540 - 222 * RIG_SCALE).toFixed(2)},` +
    `${(RIG_FEET - 922.5 * RIG_SCALE).toFixed(2)}) scale(${RIG_SCALE})">`)
  .replace(/<\/svg>\s*$/, '</g></svg>');

const files = [];
const tmp = path.join(OUT, '_pp_rig.png');
png(rigSvg, tmp); files.push(tmp);
for (const n of list) {
  const f = path.join(OUT, `_pp_${n}.png`);
  png(renderPose(n, { t: 0, breathe: false }), f);
  files.push(f);
}

const small = files.map((f, i) => {
  const o = path.join(OUT, `_ppz_${i}.png`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f,
    '-vf', 'scale=270:-1,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=2', o]);
  return o;
});

const cols = Math.min(5, small.length), rows = Math.ceil(small.length / cols);
const layout = small.map((_, i) => {
  const c = i % cols, r = Math.floor(i / cols);
  const x = c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+');
  const y = r === 0 ? '0' : Array.from({ length: r }, () => 'h0').join('+');
  return `${x}_${y}`;
}).join('|');

const sheet = path.join(OUT, '姿势对照.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
  ...small.flatMap((f) => ['-i', f]),
  // `fill=white` —— 姿势数不是整行的时候，xstack 默认拿**黑色**填最后那几格，
  // 这张图是要嵌进汇总页的，末尾挂一块黑很扎眼
  '-filter_complex', `${small.map((_, i) => `[${i}]`).join('')}xstack=inputs=${small.length}:layout=${layout}:fill=white`,
  sheet]);
[...files, ...small].forEach((f) => fs.unlinkSync(f));

console.log(`骨架(比景别) + ${list.length} 张姿势：${list.join(' ')}`);
console.log(sheet);

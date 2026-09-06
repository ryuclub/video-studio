/**
 * 素材扫描 —— **美术每次重导都得跑一次这个**
 *
 * 石总这套素材里，整片站姿那张（`资源 1.svg`）**没有任何图层名**，176 条路径平铺。
 * 能拆开只是因为**绘制顺序恰好是按部位聚类的**。所以「哪几条是头、哪几条是腿」
 * 这件事，每次美术重导都要重新量 —— 加了两条路径，后面所有序号就全错位了。
 *
 * 这份把每个图元单独渲一遍、量出包围盒，再按区域归类，报出分组序号。
 * **不是猜的，是量的。**
 *
 *   node shi-2d/asset-scan.mjs "E:/ryu/石总/SVG/正面new/SVG/资源 1.svg"
 *   node shi-2d/asset-scan.mjs <文件> --grid       只出包围盒清单，不归类
 *
 * 归类用的区域框写在 `ZONES` 里，是按整片站姿那张的坐标定的；
 * 扫别的素材（半身姿势之类）加 `--grid` 看原始包围盒就行。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { load } from './素材.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

/* ---------- 自带的 PNG 解码：只为了量包围盒 ---------- */
// resvg 不给像素，sharp/pngjs 仓库里都没有，所以这儿自己解一层。
// 只处理 8 位、非隔行的 PNG —— resvg 出的就是这种。
function decode(buf) {
  let p = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('只认 8 位 PNG');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[rp++], line = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

function bboxOf(png) {
  const { w, h, ch, data } = decode(png);
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + 3] > 40) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ---------- 区域框：按整片站姿那张的坐标 ---------- */
// 判据是「包围盒中心落在哪个框里」。跨区的大件（西装本体之类）归躯干
const ZONES = [
  { 名: '头', box: [128, 0, 322, 214] },
  { 名: '左前臂', box: [0, 340, 110, 620] },
  { 名: '右前臂', box: [340, 340, 445, 620] },
  { 名: '腿', box: [100, 540, 350, 923] },
  { 名: '躯干', box: [0, 0, 445, 923] },   // 兜底，放最后
];

const file = process.argv[2];
if (!file) { console.error('要给素材路径'); process.exit(1); }
const gridOnly = process.argv.includes('--grid');
const faceOnly = process.argv.includes('--face');

const { viewBox: [W, H], shapes } = load(file);
const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${W} ${H}">`;

console.log(`${path.basename(file)}　${W}×${H}　${shapes.length} 个图元\n`);

const rows = shapes.map((s, i) => {
  const png = new Resvg(head + s.xml + '</svg>', { font: { loadSystemFonts: false } })
    .render().asPng();
  const b = bboxOf(png);
  let zone = '空';
  if (b) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    zone = (ZONES.find((z) => cx >= z.box[0] && cx <= z.box[2] && cy >= z.box[1] && cy <= z.box[3]) || {}).名 || '躯干';
  }
  return { n: i + 1, tag: s.tag, fill: s.fill, b, zone };
});

if (gridOnly) {
  for (const r of rows) {
    console.log(`${String(r.n).padStart(3)} ${r.tag.padEnd(8)} ${r.fill}  ` +
      (r.b ? `x${r.b.x0}-${r.b.x1} y${r.b.y0}-${r.b.y1}  ${r.b.w}×${r.b.h}` : '(空)'));
  }
  process.exit(0);
}

/* ---------- --face：给一张新画的姿势图找五官 ---------- */
// 每张姿势图都是**单独画的**（头的角度、比例都不一样），要给它接口型／眼珠，
// 就得先量出这张脸上的眼和嘴在哪儿。这一段就是干这个的，**结果还要肉眼过一遍**。
if (faceOnly) {
  const lum = (h) => {
    const n = parseInt(h.slice(1), 16);
    return ((n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11);
  };
  const has = rows.filter((r) => r.b);
  // 帽子：画面上部最大的深色块。**先找它** —— 全身图里头只占很小一块，
  // 不拿帽子把范围框住的话，西装扣子、口袋暗部全会被当成瞳孔报出来
  // 判据：**顶到画面最上沿** ＋ 深色 ＋ 扁的（帽子总是宽大于高）。
  // 只写「上部的深色大块」不行 —— 全身图里西装从 y≈200 就开始了、又大又深，会被当成帽子
  const hat = has.filter((r) =>
    lum(r.fill) < 115 && r.b.y0 < Math.max(12, H * 0.06) && r.b.w > r.b.h)
    .sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h)[0];
  const hh = hat ? hat.b.h : H * 0.1;
  const band = hat
    ? { x0: hat.b.x0 - hh * 0.1, x1: hat.b.x1 + hh * 0.1, y0: hat.b.y1 - hh * 0.25, y1: hat.b.y1 + hh * 1.7 }
    : { x0: 0, x1: W, y0: 0, y1: H * 0.5 };
  // 瞳孔：小、近似圆、颜色很深，而且**落在帽檐下面那条带子里**
  const inBand = (b) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    return cx >= band.x0 && cx <= band.x1 && cy >= band.y0 && cy <= band.y1;
  };
  const pupils = has.filter((r) =>
    lum(r.fill) < 75 && r.b.w >= 5 && r.b.w <= 26 &&
    Math.abs(r.b.w - r.b.h) <= 8 && inBand(r.b));
  // 脸：最大的肤色块（肤色 = 亮、偏暖）
  const skin = has.filter((r) => {
    if (!inBand(r.b) && !(r.b.y0 < band.y1 && r.b.y1 > band.y0)) return false;
    const n = parseInt(r.fill.slice(1), 16);
    const [R, G, Bb] = [n >> 16 & 255, n >> 8 & 255, n & 255];
    return R > 190 && R - Bb > 30 && G > 130;
  }).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h)[0];

  console.log(`帽 ${hat ? `#${hat.n} x${hat.b.x0}-${hat.b.x1} y${hat.b.y0}-${hat.b.y1} ${hat.b.w}×${hat.b.h}` : '没找到'}`);
  console.log(`脸 ${skin ? `#${skin.n} ${skin.fill} x${skin.b.x0}-${skin.b.x1} y${skin.b.y0}-${skin.b.y1} ${skin.b.w}×${skin.b.h}` : '没找到'}`);
  console.log('瞳孔候选：');
  for (const p of pupils.slice(0, 8)) {
    console.log(`  #${String(p.n).padStart(3)} ${p.fill} 心(${((p.b.x0 + p.b.x1) / 2).toFixed(1)},` +
      `${((p.b.y0 + p.b.y1) / 2).toFixed(1)}) ${p.b.w}×${p.b.h}`);
  }
  if (pupils.length >= 2) {
    const two = pupils.slice(0, 2).sort((a, b) => a.b.x0 - b.b.x0);
    const c = two.map((p) => [(p.b.x0 + p.b.x1) / 2, (p.b.y0 + p.b.y1) / 2]);
    console.log(`  → 眼距 ${(c[1][0] - c[0][0]).toFixed(1)}　眼线 y≈${((c[0][1] + c[1][1]) / 2).toFixed(1)}`);
  }
  // 嘴：眼线往下 0.25~0.75 个眼距的范围里，宽度在眼距的 0.5~1.4 倍
  if (pupils.length >= 2) {
    const two = pupils.slice(0, 2).sort((a, b) => a.b.x0 - b.b.x0);
    const c = two.map((p) => [(p.b.x0 + p.b.x1) / 2, (p.b.y0 + p.b.y1) / 2]);
    const d = c[1][0] - c[0][0], eyeY = (c[0][1] + c[1][1]) / 2, midX = (c[0][0] + c[1][0]) / 2;
    const cand = has.filter((r) => {
      const cy = (r.b.y0 + r.b.y1) / 2, cx = (r.b.x0 + r.b.x1) / 2;
      return cy > eyeY + d * 0.3 && cy < eyeY + d * 1.5 &&
        Math.abs(cx - midX) < d * 0.6 && r.b.w > d * 0.35 && r.b.w < d * 1.6;
    });
    console.log('嘴／鼻候选（由上到下）：');
    for (const r of cand.sort((a, b) => a.b.y0 - b.b.y0).slice(0, 10)) {
      console.log(`  #${String(r.n).padStart(3)} ${r.fill} x${r.b.x0}-${r.b.x1} y${r.b.y0}-${r.b.y1} ${r.b.w}×${r.b.h}`);
    }
  }
  process.exit(0);
}

/* 连续段合并 —— 关心的是「第几条到第几条是一块」 */
const runs = [];
for (const r of rows) {
  const last = runs[runs.length - 1];
  if (last && last.zone === r.zone) last.to = r.n;
  else runs.push({ zone: r.zone, from: r.n, to: r.n });
}
console.log('绘制顺序上的分块（连续段）：');
for (const r of runs) console.log(`  ${String(r.from).padStart(3)}–${String(r.to).padStart(3)}  ${r.zone}`);

console.log('\n按区域汇总：');
for (const z of ZONES) {
  const ns = rows.filter((r) => r.zone === z.名).map((r) => r.n);
  if (!ns.length) continue;
  const seg = [];
  let a = ns[0], p = ns[0];
  for (let i = 1; i <= ns.length; i++) {
    if (ns[i] !== p + 1) { seg.push(a === p ? `${a}` : `${a}-${p}`); a = ns[i]; }
    p = ns[i];
  }
  console.log(`  ${z.名.padEnd(4)} (${ns.length})  ${seg.join(',')}`);
}

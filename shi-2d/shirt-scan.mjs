/**
 * 衬衫取色 —— **换衬衫颜色之前跑这个**，量出每张素材里哪几个色是衬衫。
 *
 * 换色是按**色值**换的（不是按图元序号），所以得先知道「哪几个十六进制是衬衫」。
 * 一件衬衫在原画里不是一个色：本色 ＋ 阴影 ＋ 高光 ＋ 领口边，一张图上四五个。
 *
 * 怎么挑出来的，两道判据：
 *   1. **绿色分量最低**（r>g 且 b>g）—— 粉紫一族。肤色是橙的（g>b），一刀就分开了
 *   2. **包围盒在躯干**（不在脸上）—— 嘴唇、腮红也是粉紫一族，靠位置排掉
 *
 * ⚠ 第 2 条要**逐图元渲一遍量包围盒**，慢（一张图几秒）。这不是出片链路上的一步，
 * 是美术重导素材之后跑一次的**标定**，结果写进 `素材库/衬衫.json`。
 *
 *   node shi-2d/shirt-scan.mjs                 扫全部素材，打印候选
 *   node shi-2d/shirt-scan.mjs 插兜站姿.svg     只扫一张，连图元序号一起报
 *   node shi-2d/shirt-scan.mjs --json          吐 JSON，写进素材库
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { load } from './素材.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const SRC = 'E:/ryu/石总/SVG/正面new/SVG/';
const 只扫 = process.argv.slice(2).find((a) => !a.startsWith('--'));
// --json：只吐每张图的衬衫色（面积从大到小），拿去写进 素材库/衬衫.json
const JSON输出 = process.argv.includes('--json');
const 汇总 = {};

/** 只解 8 位非隔行 PNG 的 alpha —— 跟 asset-scan.mjs 里那份同源，只为量包围盒 */
function alphaBox(png, w, h) {
  let p = 8; const idat = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = 4, stride = w * ch, out = Buffer.alloc(h * stride);
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
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      cur[x] = v & 255;
    }
  }
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (out[y * stride + x * ch + 3] > 16) {
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n ? { x0, y0, x1, y1, n } : null;
}

/**
 * 粉紫一族：**绿色分量最低**。肤色是橙的（g>b），这一刀就把脸和衣服分开了。
 * ⚠ 还要挡一道**近灰**：`#908f90` 这种三个通道差 1 的灰，绿也是最低的 ——
 * 不挡的话坐姿下半身的裤子、说话姿势2 的牙齿都会被算成衬衫，换色时一起变。
 */
const 粉紫 = (hex) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const 彩度 = Math.max(r, g, b) - Math.min(r, g, b);
  return r > g && b > g && r > 90 && 彩度 >= 12;
};

const files = 只扫 ? [只扫] : fs.readdirSync(SRC).filter((f) => f.endsWith('.svg'));

for (const f of files) {
  const { viewBox: [W, H], shapes } = load(SRC + f);
  const w = 240, h = Math.round((H / W) * 240);
  const 按色 = new Map();
  shapes.forEach((s, i) => {
    if (!粉紫(s.fill)) return;
    const png = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${W} ${H}">${s.xml}</svg>`,
      { font: { loadSystemFonts: false } }).render().asPng();
    const bb = alphaBox(png, w, h);
    if (!bb) return;
    const rec = 按色.get(s.fill) || { 序号: [], 面积: 0, y0: 1e9, y1: -1 };
    rec.序号.push(i + 1);
    rec.面积 += bb.n;
    rec.y0 = Math.min(rec.y0, bb.y0 / h);
    rec.y1 = Math.max(rec.y1, bb.y1 / h);
    按色.set(s.fill, rec);
  });
  const 排好 = [...按色].sort((a, b) => b[1].面积 - a[1].面积);
  if (JSON输出) { 汇总[f] = 排好.map(([hex]) => hex); continue; }
  if (!按色.size) { console.log(`${f}　没有粉紫色`); continue; }
  console.log(`\n=== ${f}　${shapes.length} 个图元`);
  for (const [hex, r] of 排好) {
    // 纵向位置按画布比例报：脸在上四分之一，衬衫在胸口那一带
    console.log(`  ${hex}  面积 ${String(r.面积).padStart(5)}  y ${r.y0.toFixed(2)}~${r.y1.toFixed(2)}  ` +
      `图元 ${r.序号.slice(0, 8).join(',')}${r.序号.length > 8 ? '…' : ''}`);
  }
}
// **面积最大的那个排在第一位** —— 换色时它就是基色，别的色按跟它的明暗关系跟着走
if (JSON输出) console.log(JSON.stringify(汇总, null, 2));

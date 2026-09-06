/**
 * 定格姿势标定 —— **美术每加一张姿势图就跑一次这个**
 *
 * 每张姿势图都是单独画的：头的角度、脸的大小、五官位置全不一样。
 * 要让它能眨眼、能说话、能有表情，就得先把这张脸上的东西量出来：
 *
 *   眼距／眼线／眼中   定机位用（对位不按画布，按两只瞳孔）
 *   眼眶 ＋ 肤色       眨眼用（拿肤色盖住眼眶）
 *   嘴心 ＋ 嘴框       口型用（补丁盖住原嘴，上面画 A/I/U/E/O）
 *   眉 ＋ 眉支点       表情用（把原画那两条眉毛包进 <g> 里转）
 *
 * 用法（瞳孔序号先用 `asset-scan.mjs <文件> --face` 报出来，**肉眼挑一遍**）：
 *
 *   node shi-2d/asset-scan.mjs "…/插兜站姿.svg" --face
 *   node shi-2d/pose-calib.mjs 插兜站姿 171 173
 *   node shi-2d/pose-calib.mjs 插兜站姿 171 173 --dry     只报不写
 *
 * 跑之前 `素材库/姿势.json` 里要先有这张的 `文件`／`画布`／`类型`／`机位` 四项。
 *
 * ⚠ **量完一定要用 `pose-probe.mjs` 和 `face-probe.mjs` 看一眼。**
 * 自动量出来的框会把下巴的折线、鼻孔、袖口的暗块一起圈进去 —— 数是对的，
 * 意思不一定对。嘴心的 y 就是这么发现要用比例算、不能用框心的。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { load } from './素材.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const SRC = 'E:/ryu/石总/SVG/正面new/SVG/';
const REG_PATH = new URL('./素材库/姿势.json', import.meta.url);
/** 骨架那张脸的基准：嘴在眼线下 0.835 个眼距 */
const 嘴比例 = (172 - 124) / 57.5;

/* ---------- PNG 解码，只为了量包围盒 ---------- */
function decode(buf) {
  let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, out = Buffer.alloc(h * stride); let rp = 0;
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
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * ch + 3] > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const lum = (h) => {
  const n = parseInt(h.slice(1), 16);
  return (n >> 16 & 255) * 0.3 + (n >> 8 & 255) * 0.59 + (n & 255) * 0.11;
};

/* ---------- 主流程 ---------- */
const [name, p1, p2] = process.argv.slice(2);
const dry = process.argv.includes('--dry');
if (!name || !p1 || !p2) {
  console.error('用法：node shi-2d/pose-calib.mjs <姿势名> <瞳孔序号1> <瞳孔序号2> [--dry]');
  process.exit(1);
}
const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const p = reg.姿势[name];
if (!p) { console.error(`姿势库里没有「${name}」，先在 姿势.json 里加上 文件/画布/类型/机位`); process.exit(1); }

const { viewBox: [W, H], shapes } = load(SRC + p.文件);
const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${W} ${H}">`;
const bb = shapes.map((s) =>
  bboxOf(new Resvg(head + s.xml + '</svg>', { font: { loadSystemFonts: false } }).render().asPng()));

const pupils = [+p1, +p2].map((i) => ({ n: i, b: bb[i - 1] }));
if (pupils.some((x) => !x.b)) { console.error('给的瞳孔序号是空图元'); process.exit(1); }
pupils.sort((a, b) => a.b.x0 - b.b.x0);
const ctr = pupils.map((x) => [(x.b.x0 + x.b.x1) / 2, (x.b.y0 + x.b.y1) / 2]);
const 眼距 = +(ctr[1][0] - ctr[0][0]).toFixed(1);
const 眼线 = +((ctr[0][1] + ctr[1][1]) / 2).toFixed(1);
const 眼中 = +((ctr[0][0] + ctr[1][0]) / 2).toFixed(2);

/** 眼眶：把跟瞳孔重叠的小图元并起来（眼白、虹膜、睫毛线都在里面） */
const 眼眶 = pupils.map((pu) => {
  const area = pu.b.w * pu.b.h;
  let [x0, y0, x1, y1] = [pu.b.x0, pu.b.y0, pu.b.x1, pu.b.y1];
  bb.forEach((b) => {
    if (!b || b.w * b.h > area * 14) return;
    if (b.x1 < pu.b.x0 - 1 || b.x0 > pu.b.x1 + 1 || b.y1 < pu.b.y0 - 1 || b.y0 > pu.b.y1 + 1) return;
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  });
  return [x0, y0, x1, y1];
});

/** 脸：**必须把两只眼睛都包住**的最大肤色块。只按颜色挑会挑到粉衬衫 */
const 肤色 = shapes.map((s, i) => ({ s, b: bb[i] }))
  .filter((r) => {
    if (!r.b) return false;
    const n = parseInt(r.s.fill.slice(1), 16);
    const [R, G, B] = [n >> 16 & 255, n >> 8 & 255, n & 255];
    const wrap = 眼眶.every((q) => r.b.x0 <= q[0] && r.b.x1 >= q[2] && r.b.y0 <= q[1] && r.b.y1 >= q[3]);
    return wrap && R > 190 && R - B > 25 && G > 125;
  }).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h)[0]?.s.fill;

/** 嘴框：按比例先预测嘴在哪儿，再把落在那儿的小图元并起来 */
const lo = 眼线 + 眼距 * (嘴比例 - 0.28), hi = 眼线 + 眼距 * (嘴比例 + 0.30);
let m = [1e9, 1e9, -1, -1];
bb.forEach((b) => {
  if (!b) return;
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if (cy < lo || cy > hi) return;
  if (Math.abs(cx - 眼中) > 眼距 * 0.55) return;
  if (b.w > 眼距 * 1.15 || b.h > 眼距 * 0.6) return;
  m = [Math.min(m[0], b.x0), Math.min(m[1], b.y0), Math.max(m[2], b.x1), Math.max(m[3], b.y1)];
});
const 嘴框 = m[2] < 0 ? null : m;
// **嘴心的 y 用比例算，不用框心** —— 框会把下巴的折线也圈进去，心就偏低了
const 嘴心 = 嘴框 ? [+(((嘴框[0] + 嘴框[2]) / 2)).toFixed(1), +(眼线 + 嘴比例 * 眼距).toFixed(1)] : null;

/**
 * 眉：眼眶正上方、横向压着眼睛的那条深色形状。
 * ⚠ **必须成对挑。** 一边一边地挑最宽的，很容易一边挑到眉毛、另一边挑到帽檐 ——
 * 两条眉毛应该**高度差不多、宽度差不多**，拿这个当判据比「最宽的那条」可靠。
 */
function 眉候选(e) {
  const [ex0, ey0, ex1, ey1] = e;
  const eh = ey1 - ey0, ew = ex1 - ex0;
  return shapes.map((s, i) => ({ n: i + 1, s, b: bb[i] })).filter((r) => {
    if (!r.b || lum(r.s.fill) > 140) return false;
    if (r.b.y1 > ey0 + eh * 0.3 || r.b.y1 < ey0 - eh * 1.5) return false;   // 底边贴着眼睛上沿
    const ov = Math.min(r.b.x1, ex1) - Math.max(r.b.x0, ex0);
    return ov > ew * 0.4 && r.b.w < ew * 2.4 && r.b.h < eh * 0.95 && r.b.w > r.b.h;
  });
}
const 眉 = (() => {
  const [L, R] = 眼眶.map(眉候选);
  let best = null, score = 1e9;
  for (const a of L) for (const b of R) {
    // ⚠ **同一条不能既当左眉又当右眉。** 跨过两只眼的大件（帽檐的暗边最常见）
    // 会同时进两边的候选，自己跟自己配分数是 0，必赢 —— 库里就写进一对
    // `[174,174]`，出片时两条眉毛一起按左眉那套转，看着像整个额头在动。
    if (a.n === b.n) continue;
    // 眉毛是分开的两条，中间隔着鼻梁；重叠的一律不是一对
    if (Math.min(a.b.x1, b.b.x1) - Math.max(a.b.x0, b.b.x0) > 0) continue;
    const s = Math.abs(a.b.y1 - b.b.y1) * 2 + Math.abs(a.b.w - b.b.w);
    if (s < score) { score = s; best = [a.n, b.n]; }
  }
  if (!best) {
    // 没配上对就把候选摊出来，**别静默写个 null 进库** —— 那样表情少一根杠杆，还看不出来
    console.log('  ⚠ 眉毛没配上对。候选：');
    [L, R].forEach((c, i) => console.log(`    ${i === 0 ? '画面左' : '画面右'}：` +
      (c.map((r) => `#${r.n} ${r.s.fill} x${r.b.x0}-${r.b.x1} y${r.b.y0}-${r.b.y1}`).join('  ') || '（一个都没有）')));
  }
  return best || [null, null];
})();

/**
 * ⚠ **一条眉毛不止一条路径。** 这批图的眉毛是「深色底 ＋ 浅色面」两条叠着画的
 * （`单手插兜站立`：画面左 135＋301、画面右 133＋131）。只记深色那条的话，
 * 转的时候浅色那条**留在原地** —— 出来是双层眉毛，挑眉那一句最扎眼。
 * 2026-09-06 出片的 00:01／00:06 两帧就是这么发现的。
 *
 * 所以挑完主眉再扫一遍：**包围盒落在主眉里面（放宽 2px）、而且比肤色暗**的，
 * 一律算同一条眉。浅色的（眼睑高光、脸上的过渡块）靠亮度挡掉。
 */
const 同眉 = (主) => {
  if (!主) return null;
  const b = bb[主 - 1];
  // 两个方向都要看：**浅色面被深色底包着**（面在里），也有**深色描边包着浅色面**（描边在外）。
  // 只查一个方向会漏 —— 2026-09-06 插兜侧走 的左眉描边就是这么漏掉的，出来是个空心眉框
  const 套 = (a, c) => a.x0 >= c.x0 - 2 && a.x1 <= c.x1 + 2 && a.y0 >= c.y0 - 2 && a.y1 <= c.y1 + 2;
  const 里 = (r) => r && (套(r, b) || 套(b, r));
  const out = shapes.map((s, i) => ({ n: i + 1, s, b: bb[i] }))
    .filter((r) => 里(r.b) && lum(r.s.fill) < 140)
    .map((r) => r.n);
  return out.length > 1 ? out : 主;      // 只有自己就还写一个数，别把库搞得都是数组
};
const 眉全 = 眉.map(同眉);

// 支点取眉毛内端（靠鼻梁那头）：画面左眉取右端，画面右眉取左端
const 眉支点 = 眉.map((n, i) => {
  if (!n) return null;
  const b = bb[n - 1];
  return [i === 0 ? b.x1 : b.x0, +(((b.y0 + b.y1) / 2)).toFixed(1)];
});

console.log(`${name}　画布 ${W}×${H}　${shapes.length} 个图元`);
console.log(`  眼距 ${眼距}　眼线 ${眼线}　眼中 ${眼中}　（骨架基准 57.5 / 124 / 222.75）`);
console.log(`  眼眶 ${JSON.stringify(眼眶)}`);
console.log(`  肤色 ${肤色 || '**没找到** —— 检查瞳孔序号是不是给错了'}`);
console.log(`  嘴框 ${JSON.stringify(嘴框)}　嘴心 ${JSON.stringify(嘴心)}`);
console.log(`  眉 ${JSON.stringify(眉全)}　支点 ${JSON.stringify(眉支点)}`);

if (dry) process.exit(0);
Object.assign(p, { 眼距, 眼线, 眼中, 眼眶, 肤色, 嘴框, 嘴心, 眉: 眉全, 眉支点 });
fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 2), 'utf8');
console.log('\n已写回 素材库/姿势.json —— 记得跑 pose-probe 看一眼');

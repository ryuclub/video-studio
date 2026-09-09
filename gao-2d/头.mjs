/**
 * 头部层 —— **点头／摇头**
 *
 *   node gao-2d/头.mjs        出一张演示表 _头动.png
 *   import { 渲人 } from './头.mjs'
 *
 * ── 为什么非要美术单独给一张头 ──
 *
 * 整figure 的 SVG 里，**头和身体的 path 下标不连续**（正面站立头部 62 条散在
 * 2–159 之间，中间夹着 95 条身体的），整组 `transform` 会把身体一起带走。
 * 2026-09-08 美术补了 `头部.svg`（独立一张，66 条图元），这条路才通。
 *
 * ── 怎么对位 ──
 *
 * **按两只眼的中心**：缩放 = 眼距之比，平移 = 对齐眼心。
 * 不按脸的包围盒 —— 脸是靠「上半部最大的肤色块」认出来的，边界会随头发遮挡浮动几像素，
 * 而眼心是两个几何点，稳。实测头部 vs 正面站立：眼距 57 vs 57.5，缩放 1.0026。
 *
 * ⚠ **只能用在正面姿势上。** `头部.svg` 是正面的，套到四分之三侧的
 *   `侧面站立-抬单手` 上是一张正面的脸贴在侧身上。判据是**眼心偏离脸心多少**：
 *   正面 0.7%，四分之三侧 15%，中间没有含糊地带。超了直接抛错，不是警告 ——
 *   这种错渲出来很显眼，但**批量出帧的时候没人一帧帧看**。
 */
import fs from 'node:fs';
import { load } from '../shi-2d/素材.mjs';
import { 量 } from './量.mjs';
import { 认五官 } from './五官.mjs';
import { 渲脸 } from './画.mjs';

export const 头文件 = 'gao-2d/素材库/svg/头部.svg';

/** 眼心偏离脸心超过这个比例就不是正面 —— 正面实测 0.7%，四分之三侧 15% */
const 正面阈 = 0.06;

const 眼心 = (r) => {
  if (r.眼.length !== 2) return null;
  const [a, b] = r.眼;
  return { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2, 距: Math.abs(b.cx - a.cx) };
};

/** 头部.svg → 某个姿势的对位。返回 { scale, dx, dy, 头盒, 轴 } */
export function 对位(poseFile, 头 = 头文件) {
  const p = 认五官(poseFile), h = 认五官(头);
  const P = 眼心(p), H = 眼心(h);
  if (!P) throw new Error(`${poseFile}：认不出两只眼，没法对位头部层`);
  const 偏 = Math.abs(P.x - p.脸.cx) / p.脸.w;
  if (偏 > 正面阈)
    throw new Error(
      `${poseFile}：**不是正面**（眼心偏离脸心 ${(偏 * 100).toFixed(0)}%，正面在 1% 以内）。\n` +
      `  头部.svg 是正面的，套上去会是一张正面的脸贴在侧身上。侧面的点头摇头要美术另给一张侧面头。`);

  const s = P.距 / H.距;
  const dx = P.x - H.x * s, dy = P.y - H.y * s;
  const m = 量(头);
  // 头在姿势坐标系里的墨迹范围 —— 用来把姿势自己的头抠掉
  const 头盒 = { x0: m.左 * s + dx, x1: m.右 * s + dx, y0: m.顶 * s + dy, y1: m.底 * s + dy };
  // 转轴放在**脖子根**：头部图没有脖子，所以取它墨迹底边再往下一点，横向取脸心。
  // 轴放高了（比如脸心）转起来下巴会甩出脖子，脖子那儿就裂一道缝。
  const 轴 = { x: p.脸.cx, y: 头盒.y1 + (头盒.y1 - 头盒.y0) * 0.06 };
  return { scale: s, dx, dy, 头盒, 轴 };
}

/**
 * @param poseFile  姿势 svg
 * @param opts  { 点头: -1..1, 摇头: -1..1, 表情: {...渲脸的参数} }
 *              点头 +1 = 低头，-1 = 抬头；摇头 ±1 = 左右
 */
export function 渲人(poseFile, opts = {}) {
  const { 点头 = 0, 摇头 = 0, 表情 = {} } = opts;

  // 不动头就走老路 —— 表情直接打在整figure 上，一个图元都不多不少
  if (!点头 && !摇头) return 渲脸(poseFile, 表情);

  const { scale: s, dx, dy, 头盒, 轴 } = 对位(poseFile);
  const { viewBox: [W, H], shapes } = load(poseFile);
  for (const b of 量(poseFile).boxes) shapes[b.i - 1].box = b.box;

  // 把姿势自己的头抠掉。判据是**头盒子盖住这条图元的 40% 以上**。
  //
  // ⚠ 第一版写的是「完全落在头盒子里」，**漏网三条**：一大块头发 #4 底边探出头盒 10px
  //   （盖 92%），和脖子两侧一对 #45/#46（盖 47%）。表现是头一动，
  //   脸边上飘着一条黑线、左脸多出一块黑斑 —— 头走了它们没走。
  //   实测这里有干净的空档：该抠的 47–92%，该留的（脖子 #43 盖 19%、外套 #2 盖 4%）差得很远。
  //   反过来「重叠就算」会把外套和肩膀一起抠掉。
  const 身 = shapes.filter((sh) => {
    const b = sh.box;
    if (!b) return true;
    const ox = Math.min(b.x1, 头盒.x1) - Math.max(b.x0, 头盒.x0) + 1;
    const oy = Math.min(b.y1, 头盒.y1) - Math.max(b.y0, 头盒.y0) + 1;
    if (ox <= 0 || oy <= 0) return true;
    return (ox * oy) / (b.w * b.h) < 0.4;
  });

  // 表情打在**头部图**上，不是姿势图上 —— 眼睛和嘴现在都在这一层
  const 头svg = 渲脸(头文件, 表情).svg;
  const 头内 = 头svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

  // 点头 = 绕脖子根俯仰。2D 只能转，转不出俯仰，所以**转一点＋压一点**：
  // 低头时整颗头往下挪一丁点，读起来才像点头而不是歪头。
  const 角 = (摇头 * -7 + 点头 * 4).toFixed(2);
  // ⚠ **抬头的幅度只给低头的三分之一。** 头部图自带两缕鬓角，原本掖在衣领后面；
  //   头一抬就整条露出来，末端在衣领上戛然而止（2D 分层没法把它藏回去）。
  //   低头没这个问题 —— 往下是把鬓角埋得更深。
  const 幅 = 点头 > 0 ? 0.035 : 0.012;
  const 沉 = (点头 * (头盒.y1 - 头盒.y0) * 幅).toFixed(2);

  const body =
    身.map((sh) => sh.xml).join('') +
    `<g transform="rotate(${角} ${轴.x.toFixed(1)} ${轴.y.toFixed(1)}) translate(0 ${沉}) translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${s.toFixed(4)})">${头内}</g>`;

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body}</svg>`, W, H };
}

const 自跑 = process.argv[1] && process.argv[1].split(String.fromCharCode(92)).join('/').endsWith('gao-2d/头.mjs');
if (自跑) {
  const { Resvg } = await import('@resvg/resvg-js');
  const f = process.argv[2] || 'gao-2d/素材库/svg/正面站立.svg';
  const m = 量(f);
  const vx = m.左 - 8, vy = m.顶 - 8, vw = m.右 - m.左 + 16, vh = Math.round((m.底 - m.顶) * 0.42);
  const 表 = [
    ['原件', {}],
    ['头层·不动', { 点头: 0.001 }],
    ['低头', { 点头: 1 }],
    ['抬头', { 点头: -1 }],
    ['摇左', { 摇头: -1 }],
    ['摇右', { 摇头: 1 }],
    ['低头＋闭眼', { 点头: 0.8, 表情: { 眨: 1 } }],
    ['摇头＋说话', { 摇头: 0.7, 表情: { 嘴: '大', 眼x: -0.6 } }],
  ];
  const 列 = 4;
  const g = 表.map(([名, t], i) => {
    const inner = 渲人(f, t).svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const x = (i % 列) * vw, y = Math.floor(i / 列) * vh;
    return `<svg x="${x}" y="${y}" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#FBF8F1"/>${inner}</svg>` +
      `<rect x="${x}" y="${y}" width="${vw}" height="${vh}" fill="none" stroke="#D8D0C0"/>`;
  }).join('');
  const SW = 列 * vw, SH = Math.ceil(表.length / 列) * vh;
  fs.writeFileSync('gao-2d/素材库/_头动.png', new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}"><rect width="100%" height="100%" fill="#FFF"/>${g}</svg>`,
    { fitTo: { mode: 'width', value: SW * 3 }, font: { loadSystemFonts: false } }).render().asPng());
  console.log(表.map(([n]) => n).join('  '));
  console.log('→ gao-2d/素材库/_头动.png');
}

/**
 * 高总素材入库 —— **跑一次，把源文件收进仓库并生成素材册**
 *
 *   node gao-2d/入库.mjs [源目录]
 *
 * ── 为什么要复制进仓库（跟老石那条线不一样）──
 *
 * 老石那套是**硬编码引用** `E:/ryu/石总/SVG/...`，散在 `build.mjs`、`cover.mjs`、
 * `asset-scan.mjs` 五个文件里。那个外部目录一没，整条线就跑不出来了。
 * 仓库自己的判据是「**删了还跑不跑得出来**」，所以这条线把 11 张收进
 * `gao-2d/素材库/svg/`，一共 ~650KB。
 *
 * ── 素材册记什么 ──
 *
 * `checksum` 是**这一整套的命根子**：五官分组、脚底、脸心全是按
 * **path 的下标和几何**算出来的，而美术重新导出一次下标就全变 —— **不报错**。
 * 所以源文件一变 checksum 就对不上，`gao-2d/查.mjs` 直接报错，
 * 而不是拿着过期的下标默默画歪。这跟 `svg-assets-intake` 那条经验是同一个道理。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { 量 } from './量.mjs';
import { 认五官 } from './五官.mjs';

const 源 = process.argv[2] || 'E:/ryu/高总/SVG';
const 库 = 'gao-2d/素材库';
const SVG = `${库}/svg`;

/**
 * 姿势编目。**键用拼音／英文**，因为它要进稿件 JSON 和代码，
 * 中文键在跨平台的路径和正则里踩过太多次。中文名留在 `名` 里。
 *
 * ⚠ `走路` 那两组是**帧序列**，不是单张姿势 —— 帧序按数组顺序。
 */
const 编目 = [
  { key: 'side-stand',      名: '侧面站立',        file: '侧面站立-5.svg' },
  { key: 'side-hand',       名: '侧面抬单手',      file: '侧面站立-抬单手.svg' },
  { key: 'front-stand',     名: '正面站立',        file: '正面站立.svg' },
  { key: 'front-hand',      名: '正面抬单手',      file: '正面站立-抬单手.svg' },
  { key: 'front-wave',      名: '正面单手打招呼',  file: '正面单手打招呼.svg' },
];
/**
 * 头部单图。**不是姿势**，是叠在正面姿势上做点头/摇头的一层。
 * 2026-09-08 美术补的 —— 在这之前点头摇头做不了，因为整figure 里头和身体的
 * path 下标不连续，整组 transform 会把身体一起带走。
 */
const 头部 = { key: 'head', 名: '头部单图', file: '头部.svg' };

const 帧序列 = [
  {
    key: 'side-walk', 名: '侧面走路', loop: true,
    // ⚠ 帧序按文件名里的编号：迈右 1 → 走路 2 → 迈左 3 → 收右 4
    frames: ['侧面走路-迈右-1.svg', '侧面走路-2.svg', '侧面走路-迈左-3.svg', '侧面走路-收右-4.svg'],
  },
  {
    key: 'front-walk', 名: '正面走路', loop: true,
    // ⚠ **只有两帧，循环会跳。** 美术那边要满 4 帧（侧面已经是 4 帧了）。
    frames: ['正面走路1.svg', '正面走路2.svg'],
    缺: '只有 2 帧，循环会跳 —— 要美术补到 4 帧',
  },
];

fs.mkdirSync(SVG, { recursive: true });

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);

function 收(file) {
  const src = path.join(源, file);
  if (!fs.existsSync(src)) throw new Error(`源文件不在：${src}`);
  fs.copyFileSync(src, path.join(SVG, file));
  const m = 量(src);
  const b = m.脸 && m.脸.box;
  if (!b) throw new Error(`${file} 认不出脸 —— 对位没有基准，停手`);
  // 五官只记「认出来几只眼、几条图元」。**不记下标** —— 下标一重导就作废，
  // 存下来只会有人拿去用。真要下标就现算（`认五官()`），checksum 保证算出来跟当初一样。
  const 五 = 认五官(src, m);
  return {
    file,
    checksum: sha(src),
    图元数: m.n,
    viewBox: [Math.round(m.W), Math.round(m.H)],
    墨: { 顶: m.顶, 底: m.底, 左: m.左, 右: m.右 },
    脸: { w: b.w, h: b.h, cx: Math.round((b.x0 + b.x1) / 2), cy: Math.round((b.y0 + b.y1) / 2) },
    五官: { 眼: 五.眼.length, 眼图元: 五.眼.map((e) => e.ids.length), 嘴: 五.嘴 ? 五.嘴.ids.length : 0 },
  };
}

const 姿势 = 编目.map((e) => ({ ...e, ...收(e.file) }));
const 头 = { ...头部, ...收(头部.file) };
const 序列 = 帧序列.map((e) => ({
  key: e.key, 名: e.名, loop: e.loop, 缺: e.缺,
  frames: e.frames.map((f) => 收(f)),
}));

// ── 归一化：按脸高对齐 ────────────────────────────────────────────
// 三批素材是分别导出的，各用各的缩放（侧面 : 正面 : 正面走路 ≈ 1 : 1.58 : 2.0）。
// **脸在同一个角色的不同姿势里大小不变**，所以拿它当基准；
// 不拿整体墨高，因为抬单手那几张手举过头，墨高里含着手。
const 全部 = [...姿势, 头, ...序列.flatMap((s) => s.frames)];
const 基准脸高 = 姿势.find((p) => p.key === 'front-stand').脸.h;
for (const a of 全部) a.scale = +(基准脸高 / a.脸.h).toFixed(4);

// 水平锚：**同一组帧共用一个 ax**，这样走路时头稳、四肢摆；
// 各帧按自己的墨心锚的话，人会左右平移一下（老马那边踩过，见 horse-art.ts 的 ax 那段）。
for (const s of 序列) {
  const ax = s.frames.reduce((t, f) => t + f.脸.cx * f.scale, 0) / s.frames.length;
  for (const f of s.frames) f.ax = +(ax / f.scale).toFixed(1);
}
for (const p of 姿势) p.ax = p.脸.cx;

const 册 = {
  _说明: [
    '高总（英语频道主讲员）2D 素材册 —— **由 `node gao-2d/入库.mjs` 生成，别手改**。',
    '',
    '## 对位怎么定的',
    '三批素材是分别导出的，各用各的缩放（侧面 : 正面 : 正面走路 ≈ 1 : 1.58 : 2.0）。',
    '**按脸高归一化**：脸在同一个角色的不同姿势里大小不变。',
    '⚠ **不按整体墨高** —— 抬单手那几张手举过头，墨高里含着手，按它缩放一换姿势人就矮一截。',
    '⚠ 帧序列的 `ax` 是**一组共用一个**：各帧按自己墨心锚的话，走路时人会左右平移一下。',
    '',
    '## checksum 是命根子',
    '五官分组、脚底、脸心全是按 **path 下标和几何**算出来的，',
    '而美术重新导出一次下标就全变 —— **不报错**。',
    '源文件一变 checksum 对不上，`node gao-2d/查.mjs` 报错，而不是拿过期的下标默默画歪。',
    '',
    '## 表情（眨眼／转眼珠／口型）',
    '走 `画.mjs` 的 `渲脸(file, { 眨, 眼x, 眼y, 嘴 })`。**眼睛不重画**，用美术自己的图形做',
    'clip（眨眼）和 translate（转眼珠）；只有全闭那条弧和张开的嘴是新画的。',
    '⚠ **两只眼画法不一样**：左眼 #140 是一圈杏仁外框，右眼 #149 只是上睫毛。',
    '  所以转眼珠**不 clip**，靠限制行程（挪不出眼白范围）。踩过两版，见 `画.mjs`。',
    '⚠ 表情只在 `五官.眼 === 2` 的姿势上完整可用 —— 三个正面口播姿势都是 2。',
    '  侧面只认得出 1 只眼，侧面走路有一帧一只都认不出（走路不说话，不影响出片）。',
    '',
    '## 现在能做什么、不能做什么',
    '✅ 六种姿势（正/侧 × 站/走/抬手）、眨眼、转眼珠、口型',
    '✅ 点头/摇头 —— 走 `头.mjs` 的 `渲人()`，靠 `头部.svg` 这一层。**只能用在正面姿势上**',
    '❌ 侧面的点头/摇头 —— 头部.svg 是正面的，套到四分之三侧上是正面的脸贴在侧身上',
    '⚠ 正面走路只有 2 帧，循环会跳',
  ],
  生成于: new Date().toISOString().slice(0, 10),
  源目录: 源,
  基准: { 按: '脸高', 值: 基准脸高, 取自: 'front-stand' },
  姿势,
  头部层: 头,
  帧序列: 序列,
};

fs.writeFileSync(`${库}/素材册.json`, JSON.stringify(册, null, 2) + '\n');
console.log(`收进 ${全部.length} 张 → ${SVG}/`);
console.log(`素材册 → ${库}/素材册.json`);
console.log('\n姿势：');
for (const p of 姿势) console.log(`  ${p.key.padEnd(12)} ${p.名.padEnd(8)} scale ${String(p.scale).padStart(6)}  ax ${String(p.ax).padStart(4)}  脸 ${p.脸.w}x${p.脸.h}  眼 ${p.五官.眼}${p.五官.眼 === 2 ? " ← 表情全可用" : ""}`);
console.log('帧序列：');
for (const s of 序列) console.log(`  ${s.key.padEnd(12)} ${s.名.padEnd(8)} ${s.frames.length} 帧  scale ${s.frames[0].scale}${s.缺 ? '  ⚠ ' + s.缺 : ''}`);

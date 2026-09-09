/**
 * 高总素材闸 —— **出片前跑，美术重导之后必跑**
 *
 *   node gao-2d/查.mjs
 *
 * ── 它拦的是什么 ──
 *
 * 这条线的所有对位（缩放、锚点）和将来的五官分组，全是按
 * **path 的下标和几何**算出来的。而美术在 Illustrator 里重新导出一次，
 * **下标就全变了 —— 而且不报错**：颜色还在、形状还在，只是「第 139 条是左眼」
 * 这个事实悄悄失效，渲出来是把袖口当眼睛抠掉。
 *
 * 所以这道闸只干一件事：**比对源文件的 checksum**。对不上就停，
 * 让人重跑 `入库.mjs` 重新量，而不是拿过期的下标默默画歪。
 * 判据跟 `svg-assets-intake` 那条经验一样 —— **静默失效的东西必须有闸**。
 *
 * ── 顺带查的几样 ──
 *
 * 文件在不在、图元数变没变、脸还认不认得出来（认不出就没有对位基准）、
 * 帧序列够不够帧。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { 量 } from './量.mjs';
import { 认五官 } from './五官.mjs';
import { 对位 } from './头.mjs';

const 库 = 'gao-2d/素材库';
const 册 = JSON.parse(fs.readFileSync(`${库}/素材册.json`, 'utf8'));

let 错 = 0, 警 = 0;
const err = (m) => { console.log(`  ✗ ${m}`); 错++; };
const warn = (m) => { console.log(`  ! ${m}`); 警++; };

console.log('── 高总素材闸 ──────────────────────────────────\n');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
const 全部 = [
  ...册.姿势.map((p) => ({ 名: p.key, ...p })),
  ...(册.头部层 ? [{ 名: 册.头部层.key, ...册.头部层 }] : []),
  ...册.帧序列.flatMap((s) => s.frames.map((f, i) => ({ 名: `${s.key}#${i}`, ...f }))),
];

for (const a of 全部) {
  const p = `${库}/svg/${a.file}`;
  if (!fs.existsSync(p)) { err(`${a.名}：文件不在 ${p}`); continue; }

  // ① checksum —— 这一条是核心，别的都是它的补充
  const now = sha(p);
  if (now !== a.checksum) {
    err(
      `${a.名}（${a.file}）**源文件变了** —— checksum ${a.checksum} → ${now}\n` +
      `      所有对位和分组都是按 path 下标算的，**下标已经不作数了**。\n` +
      `      重跑：node gao-2d/入库.mjs　然后肉眼过一遍 node gao-2d/看.mjs`
    );
    continue;
  }

  // ② 量一遍，跟册子里的数对
  const m = 量(p);
  if (m.n !== a.图元数) err(`${a.名}：图元数 ${a.图元数} → ${m.n}（checksum 却没变，说明册子是旧的）`);
  if (!m.脸) { err(`${a.名}：**认不出脸** —— 对位没有基准了。看一眼 node gao-2d/看.mjs ${a.名}`); continue; }
  if (Math.abs(m.脸.box.h - a.脸.h) > 2) warn(`${a.名}：脸高 ${a.脸.h} → ${m.脸.box.h}，缩放要重算`);

  // ③ 五官还认不认得出来。**表情全靠它**，而它认错了不报错 ——
  //    渲出来是把袖口当眼睛抠掉，或者眼珠转的时候眼睛碎成一片。
  const 五 = 认五官(p, m);
  const 记 = a.五官 || {};
  if (五.眼.length !== 记.眼) err(`${a.名}：认出 ${五.眼.length} 只眼，册子记的是 ${记.眼} —— **表情会画歪**`);
  const 图元 = 五.眼.map((e) => e.ids.length);
  if (记.眼图元 && String(图元) !== String(记.眼图元))
    err(`${a.名}：眼的图元数 [${记.眼图元}] → [${图元}] —— 五官分组变了，重跑 node gao-2d/画.mjs 肉眼过一遍`);
  if ((五.嘴 ? 五.嘴.ids.length : 0) !== 记.嘴) err(`${a.名}：嘴的图元数 ${记.嘴} → ${五.嘴 ? 五.嘴.ids.length : 0}`);
}

// ③ 帧序列够不够帧 —— 两帧的循环会跳
for (const s of 册.帧序列) {
  if (s.frames.length < 4)
    warn(`${s.名}（${s.key}）只有 ${s.frames.length} 帧，**循环会跳**。侧面已经是 4 帧了，要美术补齐${s.缺 ? '' : ''}`);
}

// ④ 头部层还对不对得上正面姿势。
//    **对不上不报错** —— 渲出来只是一张正面的脸贴歪在身上，批量出帧没人一帧帧看。
console.log('');
for (const p of 册.姿势) {
  if (p.五官.眼 !== 2) continue;
  try {
    const { scale } = 对位(`${库}/svg/${p.file}`);
    if (scale < 0.8 || scale > 1.25)
      warn(`${p.key}：头部层缩放 ${scale.toFixed(3)}，离 1 太远 —— 看一眼 node gao-2d/头.mjs ${库}/svg/${p.file}`);
  } catch (e) {
    // 侧面姿势对不上是**预期的**（头部.svg 是正面的），不算错
    if (/不是正面/.test(e.message)) console.log(`  · ${p.key}：四分之三侧，点头摇头用不了（头部.svg 是正面的）`);
    else err(`${p.key}：头部层对位失败 —— ${e.message}`);
  }
}

console.log('');
console.log(错 ? `✗ ${错} 条硬伤${警 ? `，另有 ${警} 条提醒` : ''}` : `✓ ${全部.length} 张全过${警 ? `（${警} 条提醒）` : ''}`);
process.exit(错 ? 1 : 0);

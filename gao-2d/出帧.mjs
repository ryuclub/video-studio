/**
 * 高总 · B 层帧序列（出片方案 §6.1、角色集成规范 §2）
 *
 *   node gao-2d/出帧.mjs             出全部五组
 *   node gao-2d/出帧.mjs ms_talk     只出一组
 *   node gao-2d/出帧.mjs --底 dark   换成黑底（默认纸底）
 *   node gao-2d/出帧.mjs --验        另出一张接缝图 projects/高总/_图/帧-接缝.png
 *
 * 产物：`projects/高总/_帧/<组>/00000.png…`，1080×1920，**不进 git**
 * （判据是「删了还跑不跑得出来」—— 这儿一条命令全回来，而三百多张
 * 1080×1920 的 PNG 进版本库是几十兆的死重量）。
 *
 * ── 为什么是纸底不是黑底 ──
 *
 * 角色集成规范 §3 说背景用「数字卡的底色（黑底 #111111 或白底 #ffffff）」。
 * 实渲之后只剩一个选择：**纸底**。高总穿的是近黑的外套，压在 #111111 上
 * 人和底融成一块、只剩一圈描边 —— 不报错，就是难看。
 * 纸底 `#f4f4f2` 顺带跟 DOC 层压过的纸底同色，两层切过去不跳。
 *
 * ── 循环必须首尾接得上 ──
 *
 * `build.mjs` 的 B 层是 `loop:true` 循环填满时长的，首尾接不上会**每隔几秒抖一下**。
 * 所以每组的第 0 帧和最后一帧都是**嘴闭、眼睁、不动头**的同一张，眨眼和口型都排在中间。
 * 这一条机器查不了，`--验` 那张接缝图是用来拿眼睛看的。
 *
 * ── 一帧只渲一次 ──
 *
 * 说话循环里真正不同的画面只有几张（四种口型 × 眨眼的几档），
 * 剩下都是重复。所以按参数做 key 去重，同一张只过一次 resvg，其余是文件拷贝：
 * 486 帧实际只渲十几张。
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { 认五官 } from './五官.mjs';
import { 渲脸 } from './画.mjs';
import { 渲人 } from './头.mjs';

const LIB = 'gao-2d/素材库/svg';
const OUT = 'projects/高总/_帧';
const W = 1080, H = 1920;
const 纸 = '#f4f4f2', 黑 = '#111111';

const argv = process.argv.slice(2);
const 底 = argv.includes('--底') && argv[argv.indexOf('--底') + 1] === 'dark' ? 黑 : 纸;
const 验 = argv.includes('--验');
const 只 = argv.find((a) => !a.startsWith('--') && a !== 'dark' && a !== 'paper');

/**
 * 景别：**按脸高算，不按整体墨高**。抬单手那几张手举过头，墨高里含着手，
 * 按它算一换姿势人就矮一截（README §三 同一条道理）。
 * 系数从 `正面站立` 实测反推：全高 891 / 脸高 69 = 12.9，头顶在脸框上方约 1.63 个脸高。
 */
export const 景系数 = { WS: 13.7, MS: 7.1, MCU: 4.8, CU: 2.85 };
const 余量 = { WS: 0.02, MS: 0.045, MCU: 0.06, CU: null };

export function 取景(file, 景) {
  const f = 认五官(file).脸;
  const 脸h = f.h, 脸顶 = f.y0, 脸cx = f.x0 + f.w / 2;
  const h = 脸h * 景系数[景];
  const w = h * 0.5625;                        // 竖屏比例。**用浮点** —— 取整会让宽高比
  const x = 脸cx - w / 2;                      // 偏一丝，resvg 按 meet 缩放就会加黑边
  const y = 余量[景] === null
    ? f.y0 + f.h / 2 - h * 0.5                 // CU 以脸心为准
    : 脸顶 - 脸h * 1.63 - h * 余量[景];         // 其余以头顶为准，上面留一点余量
  return { x, y, w, h };
}

function 渲(file, 景, 表情, 头动) {
  const { svg } = 头动 ? 渲人(file, { ...头动, 表情 }) : 渲脸(file, 表情);
  const b = 取景(file, 景);
  const n = (v) => v.toFixed(2);
  // ⚠ 裁切只能改**顶层 viewBox**：套嵌套 <svg> 时落在可视区外的 clipPath 包围盒成空，
  //   resvg 会 panic 在 geom.rs:27 的 unwrap 上（README §六）。
  const 头 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}" width="${W}" height="${H}">`
    + `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${底}"/>`;
  return new Resvg(svg.replace(/^<svg[^>]*>/, 头), { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render().asPng();
}

/* ── 动作 ─────────────────────────────────────────────────────────────── */

/** 眨眼四帧一次，约 0.13s。规范 §5 要「不规律」，所以位置由各组自己钉 */
const 眨谱 = [0.45, 1, 1, 0.5];

/** 口型：几种嘴按固定谱轮着换。**首尾一定是闭**，循环才接得上 */
function 口型(n, 偏 = 0) {
  const 谱 = [['小', 4], ['大', 5], ['扁', 4], ['大', 4], ['小', 5], ['闭', 3],
              ['大', 5], ['扁', 4], ['小', 4], ['大', 5], ['闭', 4], ['小', 4], ['大', 4]];
  const out = [];
  let i = 偏;
  while (out.length < n) { const [s, k] = 谱[i++ % 谱.length]; for (let j = 0; j < k && out.length < n; j++) out.push(s); }
  out[0] = '闭'; out[n - 1] = '闭'; out[n - 2] = '闭';
  return out;
}

/** 五组。`帧` 是 30fps 下的帧数；说话组做成短循环，待机组长一点 */
const 组表 = [
  { key: 'ms_talk', 名: '说话 · 中景', 姿势: '正面站立.svg', 景: 'MS', 帧: 96, 动: '说', 眨: [62], 用: '主力，主讲人开口的所有时刻' },
  { key: 'mcu_talk', 名: '说话 · 近景', 姿势: '正面站立.svg', 景: 'MCU', 帧: 96, 动: '说', 偏: 6, 眨: [30], 用: '转折句收紧一档' },
  { key: 'ms_idle', 名: '待机 · 中景', 姿势: '正面站立.svg', 景: 'MS', 帧: 150, 动: '待', 眨: [38, 104], 用: '结尾抛问题、听感留白' },
  { key: 'mcu_nod', 名: '点头 · 近景', 姿势: '正面站立.svg', 景: 'MCU', 帧: 48, 动: '点', 眨: [], 用: '转折句，一条最多一次' },
  { key: 'ms_gesture', 名: '手势 · 中景', 姿势: '正面站立-抬单手.svg', 景: 'MS', 帧: 96, 动: '说', 偏: 3, 眨: [70], 用: '全片最多一次。**是硬切换姿势**，不是抬手的过程 —— 2D 分层画不出抬手' },
  /* ↓ 2026-09-09 加的两组「眼神」。表情系统一直都在（嘴型、眨眼、待机眼珠微动），
       但说话组全程正视 —— 这两组把 README 表情谱里的斜看和下视用起来。 */
  { key: 'ms_doubt', 名: '斜看半睁 · 中景', 姿势: '正面站立.svg', 景: 'MS', 帧: 96, 动: '说', 偏: 9, 眨: [55],
    眼: { x: -0.8, 眨底: 0.4 }, 用: '**反面事实句**（To be fair…）—— 一本正经说反话的脸。一条最多一次' },
  { key: 'ms_read', 名: '往下看 · 中景', 姿势: '正面站立.svg', 景: 'MS', 帧: 96, 动: '说', 偏: 2, 眨: [40],
    眼: { y: 1, 眨底: 0.3 }, 用: '念档案、报数字 —— 跟 DOC 层切换时视线是连着的' },
];

/** 一组的逐帧参数。返回 [{表情, 头动}]，同一组里参数相同的帧会被去重 */
function 排(g) {
  const n = g.帧;
  const 嘴 = g.动 === '说' ? 口型(n, g.偏 ?? 0) : new Array(n).fill('闭');
  const 眨值 = new Array(n).fill(0);
  for (const 起 of g.眨) 眨谱.forEach((v, k) => { if (起 + k < n - 1) 眨值[起 + k] = v; });
  return Array.from({ length: n }, (_, i) => {
    const 表情 = {};
    if (嘴[i] !== '闭') 表情.嘴 = 嘴[i];
    if (眨值[i]) 表情.眨 = 眨值[i];

    /* 眼神：整组常驻的视线偏移 ＋ 半睁（README 表情谱）。
       说话组原来全程正视，`画.mjs` 支持的 眼x / 眼y / 半睁一个都没用起来 ——
       「斜看＋半睁」本身就是一本正经说反话的脸，这是这条线最该有的表情。
       ⚠ **首尾各 6 帧渐入渐出**：循环首尾必须回到中性，不然每转一圈眼神跳一下。
       `眨底` 跟眨眼动画取大的 —— 眨到一半时不能被半睁的底值拉回去。 */
    if (g.眼) {
      const 渐 = i < 6 ? i / 6 : i > n - 7 ? (n - 1 - i) / 6 : 1;
      if (g.眼.x) 表情.眼x = +(g.眼.x * 渐).toFixed(2);
      if (g.眼.y) 表情.眼y = +(g.眼.y * 渐).toFixed(2);
      if (g.眼.眨底) 表情.眨 = Math.max(表情.眨 ?? 0, +(g.眼.眨底 * 渐).toFixed(2));
    }
    // 待机的「微动」：眼珠慢慢飘一圈，正弦保证首尾都回到 0
    if (g.动 === '待') {
      const d = +(0.35 * Math.sin((2 * Math.PI * i) / (n - 1))).toFixed(2);
      if (d) 表情.眼x = d;
    }
    // 点头：一次下去再回来，两端都是 0
    const 头动 = g.动 === '点' ? { 点头: +Math.sin((Math.PI * i) / (n - 1)).toFixed(3) } : null;
    return { 表情, 头动: 头动 && 头动.点头 > 0.02 ? 头动 : null };
  });
}

/* ── 出 ───────────────────────────────────────────────────────────────── */

const 组 = 只 ? 组表.filter((g) => g.key === 只) : 组表;
if (!组.length) { console.error(`没有这一组：${只}（有 ${组表.map((g) => g.key).join(' / ')}）`); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
for (const g of 组) {
  const dir = path.join(OUT, g.key);
  // 先清空 —— 上一次跑得更长的话，多出来的旧帧会被 build.mjs 一起循环进去
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const 参 = 排(g);
  const 缓 = new Map();
  let 渲数 = 0;
  参.forEach((p, i) => {
    const key = JSON.stringify([p.表情, p.头动]);
    const f = path.join(dir, `${String(i).padStart(5, '0')}.png`);
    if (缓.has(key)) { fs.copyFileSync(缓.get(key), f); return; }
    fs.writeFileSync(f, 渲(path.join(LIB, g.姿势), g.景, p.表情, p.头动));
    缓.set(key, f); 渲数++;
  });
  console.log(`${g.key.padEnd(11)} ${String(g.帧).padStart(3)} 帧　实渲 ${String(渲数).padStart(2)} 张　${g.景}　${g.名}`);
}

console.log(`\n→ ${OUT}/　（1080×1920，底色 ${底}，不进 git）`);

if (验) {
  // 接缝图：每组的头三帧和尾三帧并排。首尾接不上在这张图上一眼看得见
  const 图 = 'projects/高总/_图';
  fs.mkdirSync(图, { recursive: true });
  const 缩 = 150;
  const 行 = 组.map((g) => {
    const dir = path.join(OUT, g.key);
    const fs2 = fs.readdirSync(dir).sort();
    const 取 = [0, 1, 2, fs2.length - 3, fs2.length - 2, fs2.length - 1];
    return { g, 帧: 取.map((i) => path.join(dir, fs2[i])) };
  });
  const 宽 = 缩 * 6 + 20 * 7, 高 = 行.length * (缩 * 16 / 9 + 44) + 20;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${宽}" height="${高}" viewBox="0 0 ${宽} ${高}">`
    + `<rect width="${宽}" height="${高}" fill="#e9e6e0"/>`
    + 行.map((r, ri) => {
      const y = 20 + ri * (缩 * 16 / 9 + 44);
      return `<text x="20" y="${y + 14}" font-size="15" font-family="sans-serif" fill="#333">${r.g.key}　前三帧 ｜ 后三帧</text>`
        + r.帧.map((f, ci) => `<image x="${20 + ci * (缩 + 20)}" y="${y + 24}" width="${缩}" height="${缩 * 16 / 9}" href="data:image/png;base64,${fs.readFileSync(f).toString('base64')}"/>`).join('');
    }).join('') + '</svg>';
  fs.writeFileSync(path.join(图, '帧-接缝.png'),
    new Resvg(svg, { fitTo: { mode: 'width', value: 宽 }, font: { loadSystemFonts: false } }).render().asPng());
  console.log(`接缝图 → ${图}/帧-接缝.png　（拿眼睛看首尾接不接得上）`);
}

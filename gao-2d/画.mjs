/**
 * 高总的脸 —— **眨眼／转眼珠／口型**
 *
 *   node gao-2d/画.mjs            出一张演示表 _表情.png
 *   import { 渲脸 } from './画.mjs'
 *
 * ── 眼睛不重画，用美术自己的图形 ──
 *
 * 重画一双杏仁眼一定比原画难看，所以这儿只做两件事：
 *   **眨眼** = 把整只眼 clip 掉上半截，在切口上补一条上眼睑线
 *   **转眼珠** = 只给眼珠那几条加 translate，clip 在眼白里
 * 原画的形状、颜色、高光一根没动。
 *
 * 只有两样是从头画的：**全闭时那条弧线**（闭着的眼没有原画可用），
 * 和**张开的嘴**（美术给的嘴是一条闭合的线，没有张嘴的图）。
 *
 * ── 一条护栏 ──
 *
 * `渲脸(file)` 不给参数时**原样返回**，图元一条不增不减 ——
 * 这样「这一帧没有表情」和「原件」是同一张图，不会因为过了一趟处理就悄悄变样。
 *
 * ⚠ 眼镜是独立 path，不在眼组里，所以怎么眨都在。这一条是**试出来的**，
 *   见 `五官.mjs` ③ 那段：判据松一点就会把镜框一起抠掉。
 */
import fs from 'node:fs';
import { load } from '../shi-2d/素材.mjs';
import { 认五官 } from './五官.mjs';

const rgb = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
const 暗 = (c, k) => { const p = rgb(c) || [60, 40, 30]; return '#' + p.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join(''); };

/** 把一只眼的图元分角色。判据全是「相对眼盒子的比例」，不是绝对像素 —— 三批素材缩放不同 */
function 分角色(e, shapes) {
  const r = { 框: [], 白: [], 珠: [], 其他: [] };
  for (const i of e.ids) {
    const s = shapes[i - 1], B = s.box;
    const w = B.w / e.w, h = B.h / e.h;
    const p = rgb(s.fill), 亮 = p ? Math.max(...p) : 0;
    if (w >= 0.85) r.框.push(i);                       // 杏仁外框：几乎跟眼一样宽
    else if (亮 > 215) r.白.push(i);                   // 眼白
    else if (w <= 0.6 && h >= 0.4) r.珠.push(i);       // 眼珠：圆乎乎的一坨
    else r.其他.push(i);                               // 下眼睑影、眼角 —— 不跟着眼珠走
  }
  // 高光和虹膜下缘的反光跟着眼珠走。
  // ⚠ 判据是「**盖住自己 40% 以上**」，不是「完全落在眼珠盒子里」。
  //   右眼那道反光（#159）下边缘探出眼珠 2px，按「完全包含」收不着 ——
  //   结果是转眼珠时**右眼碎成一片**：眼珠挪走了，反光留在原地。左眼看不出来，
  //   因为两只眼的画法不一样。这是肉眼在 _表情.png 上看出来的，机器不会报。
  //   下眼睑影不会被误收：它只盖 27%（实测 #152），离 40% 有距离。
  if (r.珠.length) {
    const P = r.珠.map((i) => shapes[i - 1].box);
    const bx = { x0: Math.min(...P.map((b) => b.x0)), x1: Math.max(...P.map((b) => b.x1)), y0: Math.min(...P.map((b) => b.y0)), y1: Math.max(...P.map((b) => b.y1)) };
    for (const i of [...r.其他]) {
      const B = shapes[i - 1].box;
      const ox = Math.min(B.x1, bx.x1) - Math.max(B.x0, bx.x0) + 1;
      const oy = Math.min(B.y1, bx.y1) - Math.max(B.y0, bx.y0) + 1;
      if (ox > 0 && oy > 0 && (ox * oy) / (B.w * B.h) >= 0.4) {
        r.其他.splice(r.其他.indexOf(i), 1); r.珠.push(i);
      }
    }
    r.珠.sort((a, b) => a - b);   // z 序按原下标，不然反光会盖到虹膜下面
  }
  return r;
}

/**
 * @param file  素材库里的 svg
 * @param 表情  { 眨: 0..1, 眼x: -1..1, 眼y: -1..1, 嘴: '闭'|'小'|'大'|'扁' }
 * @returns { svg, W, H }  一整张 svg 字符串
 */
let 序 = 0;   // clipPath 的 id 计数器 —— 见下面那条注释

export function 渲脸(file, 表情 = {}) {
  const { 眨 = 0, 眼x = 0, 眼y = 0, 嘴: 口 = '闭' } = 表情;
  // ⚠ **每次调用换一批 id。** 同一页拼两张脸（对照表、两个人同框）时，
  //   clipPath 的 id 会撞，resvg 不报 "duplicate id"，直接 panic 在 geom.rs 的
  //   unwrap 上（第四种 panic，前三种记在 svg-assets-intake）。
  const P = `g${序++}`;
  const { viewBox: [W, H], shapes } = load(file);
  const 素 = (i) => shapes[i - 1].xml;

  // 没表情就原样返回 —— 「没表情」和「原件」必须是同一张图
  if (!眨 && !眼x && !眼y && 口 === '闭')
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${shapes.map((s) => s.xml).join('')}</svg>`, W, H };

  const r = 认五官(file);
  // 量.mjs 量的是逐图元包围盒，这儿要按下标取，所以先补一份 box 到 shapes 上
  for (const b of (r.boxes || [])) shapes[b.i - 1].box = b.box;

  const 丢 = new Set();
  const defs = [], 补 = new Map();  // 下标 → 替换用的 xml（在原位插，保住 z 序）

  for (const [n, e] of r.眼.entries()) {
    const 角 = 分角色(e, shapes);
    const 框色 = 角.框.length ? shapes[角.框[0] - 1].fill : '#2a1a12';
    const 线宽 = Math.max(1.2, e.h * 0.13);

    if (眨 >= 0.98) {
      // 全闭：整只眼抠掉，画一条向下的弧。**外框也抠掉** ——
      // 留着外框就成了「睁着的空眼眶」，比不做还怪
      for (const i of e.ids) 丢.add(i);
      const y = e.y0 + e.h * 0.55;
      补.set(e.ids[0], `<path d="M${e.x0 + e.w * 0.08} ${y - e.h * 0.06} Q${e.cx} ${y + e.h * 0.22} ${e.x1 - e.w * 0.08} ${y - e.h * 0.06}" fill="none" stroke="${框色}" stroke-width="${线宽.toFixed(2)}" stroke-linecap="round"/>`);
      continue;
    }

    // 半睁 / 睁着：眼珠先挪，再把整只眼 clip 掉上半截
    if (眼x || 眼y) {
      const 白盒 = 角.白.map((i) => shapes[i - 1].box);
      if (白盒.length && 角.珠.length) {
        const 珠盒 = 角.珠.map((i) => shapes[i - 1].box);
        // ── 转眼珠**不 clip，靠限制行程** ──────────────────────
        //
        // clip 试过两种，两种都碎，而且是**这个角色的两只眼画法根本不一样**：
        //   · clip 到眼白 —— 右眼的「眼白」不是一整块眼球，是虹膜两侧的**两条白牙**
        //     （#151 管 129–137、#150 管 142–153，中间 5px 空着，原本被虹膜盖住）。
        //     拿它当 clip 等于从虹膜中间剜一刀。
        //   · clip 到「外框」—— 左眼 #140 确实是一圈杏仁外框，右眼 #149 **是上睫毛**，
        //     只有上面半条。拿睫毛当 clip，虹膜只剩跟睫毛重叠的碎渣。
        //     （分解图 `_右眼分解.png`：一条条单独渲出来才看清的，光看合成图只知道「碎了」。）
        //
        // 所以不 clip：**眼珠挪不出眼白的横向范围**，就不会跑出眼睛。
        // 留 15% 余量，免得贴到眼角。
        const 白宽 = Math.max(...白盒.map((b) => b.x1)) - Math.min(...白盒.map((b) => b.x0));
        const 珠宽 = Math.max(...珠盒.map((b) => b.x1)) - Math.min(...珠盒.map((b) => b.x0));
        const 余x = Math.max(0, 白宽 - 珠宽) / 2 * 0.85;
        const dx = (眼x * 余x).toFixed(2), dy = (眼y * e.h * 0.08).toFixed(2);
        for (const i of 角.珠) 丢.add(i);
        // 挪过的眼珠插回第一条眼珠的原位，z 序不变（不然会盖到睫毛上面）
        补.set(角.珠[0], `<g transform="translate(${dx},${dy})">${角.珠.map(素).join('')}</g>`);
      }
    }

    if (眨 > 0.02) {
      // 上眼睑压下来：整只眼 clip 到切口以下，切口上补一条眼睑线
      const cut = e.y0 + e.h * 0.95 * 眨;
      const cid = `${P}yan${n}`;
      defs.push(`<clipPath id="${cid}"><rect x="${e.x0 - 2}" y="${cut}" width="${e.w + 4}" height="${e.y1 - cut + 3}"/></clipPath>`);
      const 内 = e.ids.map((i) => (丢.has(i) ? (补.get(i) || '') : 素(i))).join('');
      for (const i of e.ids) { 丢.add(i); 补.delete(i); }
      补.set(e.ids[0],
        `<g clip-path="url(#${cid})">${内}</g>` +
        `<path d="M${e.x0 + e.w * 0.05} ${cut - e.h * 0.04} Q${e.cx} ${cut + e.h * 0.10} ${e.x1 - e.w * 0.05} ${cut - e.h * 0.04}" fill="none" stroke="${框色}" stroke-width="${线宽.toFixed(2)}" stroke-linecap="round"/>`);
    }
  }

  // ── 嘴 ──────────────────────────────────────────────────
  // 美术只给了一条闭着的嘴线，张嘴没有原画，只能新画。
  // 保留原来的下唇影（它在嘴线下面另成一条，读起来是下巴的阴影）。
  if (口 !== '闭' && r.嘴) {
    const M = r.嘴, 线色 = shapes[M.ids[0] - 1].fill;
    const 档 = { 小: [0.80, 0.30], 大: [0.72, 0.62], 扁: [1.06, 0.14] }[口];
    if (!档) throw new Error(`嘴型只有 闭/小/大/扁，给的是「${口}」`);
    const [kw, kh] = 档;
    const rx = (M.w * kw) / 2, ry = (M.w * kh) / 2;
    for (const i of M.ids) 丢.add(i);
    补.set(M.ids[0],
      `<ellipse cx="${M.cx}" cy="${(M.cy + ry * 0.35).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${暗(线色, 0.55)}"/>` +
      // 下唇提亮一道，不然张开的嘴是一个纯黑洞
      `<path d="M${(M.cx - rx * 0.75).toFixed(1)} ${(M.cy + ry * 1.05).toFixed(1)} Q${M.cx} ${(M.cy + ry * 1.6).toFixed(1)} ${(M.cx + rx * 0.75).toFixed(1)} ${(M.cy + ry * 1.05).toFixed(1)}" fill="none" stroke="${暗(线色, 1.5)}" stroke-width="${(ry * 0.28).toFixed(2)}" stroke-linecap="round" opacity="0.55"/>`);
  }

  const body = shapes.map((s, j) => (补.has(j + 1) ? 补.get(j + 1) : 丢.has(j + 1) ? '' : s.xml)).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs.join('')}</defs>${body}</svg>`, W, H };
}

const 自跑 = process.argv[1] && process.argv[1].split(String.fromCharCode(92)).join('/').endsWith('gao-2d/画.mjs');
if (自跑) {
  const { Resvg } = await import('@resvg/resvg-js');
  const { 认五官: 认 } = await import('./五官.mjs');
  const f = process.argv[2] || 'gao-2d/素材库/svg/正面站立.svg';
  const r = 认(f);
  const F = r.脸, pad = 10;
  const vx = F.x0 - pad, vy = F.y0 - pad - 8, vw = F.w + pad * 2, vh = F.h + pad * 2 + 10;
  const 表 = [
    ['原件', {}], ['眨 0.35', { 眨: 0.35 }], ['眨 0.7', { 眨: 0.7 }], ['全闭', { 眨: 1 }],
    ['眼珠左', { 眼x: -1 }], ['眼珠右', { 眼x: 1 }], ['往下看', { 眼y: 1, 眨: 0.3 }], ['斜看＋半睁', { 眼x: -0.8, 眨: 0.45 }],
    ['嘴 小', { 嘴: '小' }], ['嘴 大', { 嘴: '大' }], ['嘴 扁', { 嘴: '扁' }], ['说话中', { 嘴: '大', 眼x: 0.5 }],
  ];
  const 列 = 4, 行 = Math.ceil(表.length / 列);
  const g = 表.map(([名, t], i) => {
    const { svg } = 渲脸(f, t);
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const x = (i % 列) * vw, y = Math.floor(i / 列) * (vh + 16);
    return `<svg x="${x}" y="${y}" width="${vw}" height="${vh}" viewBox="${vx} ${vy} ${vw} ${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#FBF8F1"/>${inner}</svg>` +
      `<rect x="${x}" y="${y}" width="${vw}" height="${vh}" fill="none" stroke="#D8D0C0"/>` +
      `<rect x="${x}" y="${y + vh}" width="${vw}" height="16" fill="#EDE7DA"/>`;
  }).join('');
  const SW = 列 * vw, SH = 行 * (vh + 16);
  const png = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}"><rect width="100%" height="100%" fill="#FFF"/>${g}</svg>`,
    { fitTo: { mode: 'width', value: SW * 4 }, font: { loadSystemFonts: false } }).render().asPng();
  fs.writeFileSync('gao-2d/素材库/_表情.png', png);
  console.log(表.map(([n]) => n).join('  '));
  console.log('→ gao-2d/素材库/_表情.png');
}

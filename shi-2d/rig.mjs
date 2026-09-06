/**
 * 石总 2D 骨架 —— 装配 ＋ 驱动
 *
 * ## 为什么搬进仓库了
 *
 * 原来这两件事在美术那边（`make/build-rig.mjs` 装配、`make/render3.mjs` 驱动，
 * 中间产物 `make/man3_rig.svg`）。**2026-09-05 美术换了 Illustrator 的导出设置**
 * （`.cls-N` 变成 `.stN`，还多了 `<polygon>`），`build-rig.mjs` 的正则接不住 ——
 * 拿新素材重建出来是**一片黑剪影**（所有 fill 匹配不上，退成黑）。
 * 而 `man3_rig.svg` 是旧素材烘出来的，跟新素材已经对不上了。
 *
 * 所以装配挪到这儿、读文件走 `素材.mjs`（两种导出格式都吃）。
 * **驱动的公式原样照抄 `render3.mjs`** —— 那套扭头压扁、腿姿轮换、口型椭圆都是调好的，
 * 没有理由重发明。改公式记得回头看一眼那份，别让两边跑偏。
 *
 * ## 装配参数在数据里
 *
 * `素材库/装配.json`：分组序号、挂载偏移、关节支点、躯干切口。
 * **美术每次重导都要回来核一遍**，核的办法是 `node shi-2d/asset-scan.mjs <素材>`。
 *
 * ## 关节的正负号（试渲量出来的，别凭直觉猜）
 *   armL 负 = 角色左手（画面右）往外抬     armR 正 = 角色右手（画面左）往外抬
 *   elbowL 负 = 小臂往外伸                 elbowR 正 = 同上
 *   抬手超过 46 度手会顶到画布边
 */
import fs from 'node:fs';
import { load, pick } from './素材.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('./素材库/装配.json', import.meta.url), 'utf8'));
const SRC = CFG.素材目录;

export const PIVOT = CFG.支点;
export const CX = CFG.中轴;
export const VIEWBOX = CFG.viewBox;

/* ---------- 装配 ---------- */

const expand = (list) => {
  const out = new Set();
  for (const x of list) {
    if (Array.isArray(x)) for (let i = x[0]; i <= x[1]; i++) out.add(i);
    else out.add(x);
  }
  return out;
};

function assemble() {
  const base = load(SRC + CFG.整片);
  const n = base.shapes.length;
  const HEAD = expand(CFG.分组.头);
  const FEAT = expand(CFG.分组.五官);
  const LOWER = expand(CFG.分组.下半身);

  // 分组落在素材范围外 = 美术改过图元数量，装配.json 没跟上。**这儿要炸，不能悄悄少画**
  for (const [名, s] of [['头', HEAD], ['五官', FEAT], ['下半身', LOWER]]) {
    for (const i of s) if (i < 1 || i > n) {
      throw new Error(`装配.json 的「${名}」里有序号 ${i}，可素材只有 ${n} 个图元 —— ` +
        `美术重导过了，跑 \`node shi-2d/asset-scan.mjs "${SRC}${CFG.整片}"\` 重新核分组`);
    }
  }

  const idx = (f) => Array.from({ length: n }, (_, i) => i + 1).filter(f);
  const headBase = idx((i) => HEAD.has(i) && !FEAT.has(i));
  const feat = idx((i) => FEAT.has(i));
  const torso = idx((i) => !HEAD.has(i) && !LOWER.has(i));
  const lower = idx((i) => LOWER.has(i));

  const arm = (key) => {
    const m = CFG.挂载[key];
    const a = load(SRC + m.文件);
    const wrap = (list) =>
      `<g transform="translate(${m.dx},${m.dy}) scale(${m.s})">${pick(a.shapes, list)}</g>`;
    return { 上: wrap(m.上臂), 下: wrap(m.前臂) };
  };
  const leg = (key) => {
    const m = CFG.挂载[key];
    const a = load(SRC + m.文件);
    return `<g transform="translate(${m.dx},${m.dy}) scale(${m.s})">` +
      a.shapes.map((s) => s.xml).join('') + '</g>';
  };

  const aR = arm('臂右'), aL = arm('臂左');

  // 表情覆盖层：脸上肤色是纯 #e8b092，贴上去零接缝。口型和眼睑都画在这层里
  const SKIN = '#e8b092';
  const MOUTH_PATCH =
    'M198,172 Q200,163 210,161 Q222,159 234,161 Q244,163 246,172 ' +
    'Q246,182 236,188 Q222,192 208,188 Q198,182 198,172 Z';
  const lid = (id, d, lash) =>
    `<g id="${id}" transform="translate(0,114) scale(1,0.001) translate(0,-114)">` +
    `<path d="${d}" fill="${SKIN}"/>` +
    `<path d="${lash}" fill="none" stroke="#2d1e16" stroke-width="2.4" stroke-linecap="round"/></g>`;
  const FACE_OV =
    `<g id="faceOv"><g id="mouth" opacity="0">` +
    `<path d="${MOUTH_PATCH}" fill="${SKIN}"/>` +
    `<ellipse id="mHole" cx="222" cy="175" rx="16" ry="8" fill="#5a3222"/>` +
    `<path id="mTeeth" d="" fill="#f2ece4"/></g><g id="lids">` +
    lid('lidR', 'M174,114 Q192,108 212,115 L212,138 Q192,143 174,137 Z', 'M174.6,136 Q192,142 211.4,137') +
    lid('lidL', 'M232,115 Q252,108 270,114 L270,137 Q252,143 232,138 Z', 'M232.6,137 Q252,142 269.4,136') +
    `</g></g>`;

  const body =
    `<g id="turn"><g id="root">` +
    `<g id="lower">` +
    `<g id="legStand">${pick(base.shapes, lower)}</g>` +
    `<g id="legA" style="display:none">${leg('腿A')}</g>` +
    `<g id="legB" style="display:none">${leg('腿B')}</g>` +
    `</g>` +
    `<g id="d-armR"><g id="j-armR"><g id="j-elbowR">${aR.下}</g>${aR.上}</g></g>` +
    `<g id="d-armL"><g id="j-armL"><g id="j-elbowL">${aL.下}</g>${aL.上}</g></g>` +
    `<g id="torso" clip-path="url(#cTorso)">${pick(base.shapes, torso)}</g>` +
    `<g id="d-head"><g id="j-head">${pick(base.shapes, headBase)}` +
    `<g id="feat">${pick(base.shapes, feat)}${FACE_OV}</g></g></g>` +
    `</g></g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" id="man" viewBox="${VIEWBOX}">` +
    `<defs><clipPath id="cTorso"><path d="${CFG.躯干切口.d}"/></clipPath></defs>${body}</svg>`;
}

/** 装配好的骨架。**每次进程起来现装**，素材改了不用手动重建 */
export const RIG = assemble();

/* ---------- 驱动（公式抄自 make/render3.mjs） ---------- */

// 口型：[横半径, 竖半径]
const VIS = { M: [17, 2], A: [16, 11], I: [18.5, 4.5], U: [8.5, 7.5], E: [15, 7.5], O: [11.5, 10.5] };
const MX = 222, MY = 175;

/** 把一个姿势对象套进骨架，返回完整 SVG 字符串 */
export function buildFrame(p = {}) {
  const g = (k, d = 0) => (p[k] ?? d);
  let doc = RIG;
  const put = (id, tf) => { doc = doc.replace(`<g id="${id}"`, `<g id="${id}" transform="${tf}"`); };
  const rot = (a, k) => `rotate(${a.toFixed(3)},${PIVOT[k][0]},${PIVOT[k][1]})`;

  // 扭头：整体绕竖轴压扁，头再反向补一点，五官加视差 —— 二维假三维就这一套
  const u = Math.sin((g('turn') * Math.PI) / 180);
  const sx = 1 - 0.30 * Math.abs(u);
  put('turn', `translate(${CX},0) scale(${sx.toFixed(4)},1) translate(${-CX},0)`);
  put('root', `translate(${g('x').toFixed(2)},${g('y').toFixed(2)})`);
  put('d-head', `translate(${(6 * u).toFixed(2)},0) translate(${CX},0) ` +
    `scale(${((1 - 0.10 * Math.abs(u)) / sx).toFixed(4)},1) translate(${-CX},0)`);
  put('feat', `translate(${(26 * u).toFixed(2)},${g('featY').toFixed(2)})`);
  put('j-head', `translate(0,${g('nod').toFixed(2)}) ${rot(g('headRot'), 'head')}`);
  put('j-armR', rot(g('armR'), 'armR')); put('j-elbowR', rot(g('elbowR'), 'elbowR'));
  put('j-armL', rot(g('armL'), 'armL')); put('j-elbowL', rot(g('elbowL'), 'elbowL'));

  // 腿姿三选一：站立 / 走姿A / 走姿B。**是轮换不是插值**，fps 给高了反而显得跳
  const want = { stand: 'legStand', A: 'legA', B: 'legB' }[p.leg ?? 'stand'];
  for (const k of ['legStand', 'legA', 'legB']) {
    if (k === want) doc = doc.replace(`<g id="${k}" style="display:none"`, `<g id="${k}"`);
    else if (k === 'legStand') doc = doc.replace('<g id="legStand"', '<g id="legStand" style="display:none"');
  }

  const mk = p.mouth ?? 'rest';
  if (mk !== 'rest') {
    const [rx, ry] = VIS[mk];
    doc = doc.replace('<g id="mouth" opacity="0"', '<g id="mouth" opacity="1"');
    doc = doc.replace('id="mHole" cx="222" cy="175" rx="16" ry="8"',
      `id="mHole" cx="${MX}" cy="${MY}" rx="${rx}" ry="${ry}"`);
    if (ry > 6) {
      const d = `M${(MX - rx * 0.8).toFixed(1)},${(MY - ry * 0.45).toFixed(1)} ` +
        `Q${MX},${(MY - ry * 1.1).toFixed(1)} ` +
        `${(MX + rx * 0.8).toFixed(1)},${(MY - ry * 0.45).toFixed(1)} Z`;
      doc = doc.replace('<path id="mTeeth" d=""', `<path id="mTeeth" d="${d}"`);
    }
  }
  const k = Math.max(g('blink'), 0.001);
  for (const lidId of ['lidR', 'lidL']) {
    doc = doc.replace(`id="${lidId}" transform="translate(0,114) scale(1,0.001)`,
      `id="${lidId}" transform="translate(0,114) scale(1,${k.toFixed(4)})`);
  }
  return doc;
}

/** 眨眼调度：每 2.6~5.6 秒眨一次，单次 0.17 秒 */
export function makeBlinker(seed = 5) {
  let s = seed >>> 0, next = 2.0, at = -9;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return (t) => {
    if (t > next) { at = t; next = t + 2.6 + rnd() * 3.0; }
    const d = t - at;
    if (d < 0 || d > 0.17) return 0;
    return Math.min(1, Math.max(0, d < 0.07 ? d / 0.07 : 1 - (d - 0.07) / 0.10));
  };
}

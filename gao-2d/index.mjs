/**
 * 高总 2D 口播（英语频道）· 汇总页
 *
 * 产物：`projects/高总/index.html`（双击打开）＋ 一批图在 `projects/高总/_图/`。
 *
 * ⚠ **这条线现在一期成片都没有。** 所以这张页跟老石那张（`shi-2d/index.mjs`）
 * 结构不一样：那张是「一期一节」，这张是**两本账**：
 * 素材层（姿势 / 表情 / 头动 / 闸 / 欠美术的）＋ 稿件库（每条片子走到哪一步了）。
 * 等出了片，在 §成片 那一节按老石那张的样式往下加，左侧目录已经留好位置了。
 *
 * **稿件库那一节的配比和阈值全部来自 `自检.mjs`** —— 跟 `build.mjs` 那道闸同一份算法。
 * 两处各算一套，迟早会一边绿一边红。
 *
 * 版式、配色、左侧目录照 `shi-2d/index.mjs` 来 —— 那份自己写着
 * 「两条线的页看着是一家人」，这条线也一样。
 *
 * 用法：
 *   node gao-2d/index.mjs           重出页面（图有就复用）
 *   node gao-2d/index.mjs --force   连图一起重渲
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { load } from '../shi-2d/素材.mjs';
import { 量 } from './量.mjs';
import { 认五官 } from './五官.mjs';
import { 渲脸 } from './画.mjs';
import { 渲人, 对位 } from './头.mjs';
import { 自检, FPS } from './自检.mjs';

const REPO = process.cwd();
const LIB = 'gao-2d/素材库';
const OUT = path.join(REPO, 'projects/高总');
const IMG = path.join(OUT, '_图');
const FORCE = process.argv.includes('--force');
const 册 = JSON.parse(fs.readFileSync(path.join(REPO, LIB, '素材册.json'), 'utf8'));

fs.mkdirSync(IMG, { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 素材册里的说明是半个 markdown：只用到 **粗** 和反引号。⚠ 先转义再套标签 */
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');

/**
 * 渲一张图。
 * ⚠ **裁切只能改顶层 viewBox**，不能套一层嵌套 `<svg>` —— clipPath 落在可视区外时
 *   resvg 会 panic 在 `geom.rs:27` 的 unwrap 上（见 README §六）。
 */
function 出图(名, svg, 框, 宽) {
  const f = path.join(IMG, `${名}.png`);
  if (!FORCE && fs.existsSync(f)) return `_图/${名}.png`;
  const { x, y, w, h } = 框;
  const cropped = svg.replace(/^<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`);
  const png = new Resvg(cropped, { fitTo: { mode: 'width', value: Math.round(宽 * 2) }, font: { loadSystemFonts: false }, background: 'rgba(0,0,0,0)' }).render().asPng();
  fs.writeFileSync(f, png);
  return `_图/${名}.png`;
}

const 全身框 = (m, pad = 6) => ({ x: m.左 - pad, y: m.顶 - pad, w: m.右 - m.左 + pad * 2, h: m.底 - m.顶 + pad * 2 });
const 脸框 = (r, pad = 12) => ({ x: r.脸.x0 - pad, y: r.脸.y0 - pad - 10, w: r.脸.w + pad * 2, h: r.脸.h + pad * 2 + 12 });
const 半身框 = (m, pad = 6) => ({ x: m.左 - pad, y: m.顶 - pad, w: m.右 - m.左 + pad * 2, h: Math.round((m.底 - m.顶) * 0.34) });

/* ---------- 出图 ---------- */

const 姿势图 = [];
for (const p of [...册.姿势, 册.头部层]) {
  const f = `${LIB}/svg/${p.file}`;
  const m = 量(f);
  const { shapes } = load(f);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.W} ${m.H}" width="${m.W}" height="${m.H}">${shapes.map((s) => s.xml).join('')}</svg>`;
  姿势图.push({ ...p, src: 出图(`姿-${p.key}`, svg, 全身框(m), 240) });
}

const 帧图 = 册.帧序列.map((s) => ({
  ...s,
  frames: s.frames.map((fr, i) => {
    const f = `${LIB}/svg/${fr.file}`;
    const m = 量(f);
    const { shapes } = load(f);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.W} ${m.H}" width="${m.W}" height="${m.H}">${shapes.map((sh) => sh.xml).join('')}</svg>`;
    return { ...fr, i, src: 出图(`帧-${s.key}-${i}`, svg, 全身框(m), 190) };
  }),
}));

/** 表情演示都拿正面站立当样板 —— 三个正面姿势的做法完全一样 */
const 样板 = `${LIB}/svg/正面站立.svg`;
const 样板五 = 认五官(样板);
const 表情谱 = [
  ['原件', {}, '不给参数时原样返回，图元一条不增不减'],
  ['眨 0.35', { 眨: 0.35 }, '上眼睑压下来三成'],
  ['眨 0.7', { 眨: 0.7 }, '快合上了'],
  ['全闭', { 眨: 1 }, '整只眼抠掉，画一条弧 —— 闭着的眼没有原画可用'],
  ['眼珠左', { 眼x: -1 }, '只给眼珠加 translate，原画一根没动'],
  ['眼珠右', { 眼x: 1 }, ''],
  ['往下看', { 眼y: 1, 眨: 0.3 }, '眼珠下移常配半睁，不然像翻白眼'],
  ['斜看＋半睁', { 眼x: -0.8, 眨: 0.45 }, ''],
  ['嘴·小', { 嘴: '小' }, ''],
  ['嘴·大', { 嘴: '大' }, '张开的嘴是新画的 —— 美术只给了一条闭合的嘴线'],
  ['嘴·扁', { 嘴: '扁' }, ''],
  ['说话中', { 嘴: '大', 眼x: 0.5 }, '口型和眼神可以叠'],
].map(([名, t, 注], i) => ({ 名, 注, 参: JSON.stringify(t), src: 出图(`表-${i}`, 渲脸(样板, t).svg, 脸框(样板五), 200) }));

const 头动谱 = [];
for (const p of 册.姿势) {
  if (p.五官.眼 !== 2) continue;
  const f = `${LIB}/svg/${p.file}`;
  let 侧 = false;
  try { 对位(f); } catch (e) { if (/不是正面/.test(e.message)) 侧 = true; else throw e; }
  if (侧) continue;
  const m = 量(f);
  头动谱.push({
    key: p.key, 名: p.名,
    格: [['低头', { 点头: 1 }], ['抬头', { 点头: -1 }], ['摇左', { 摇头: -1 }], ['摇右', { 摇头: 1 }],
         ['低头＋闭眼', { 点头: 0.8, 表情: { 眨: 1 } }], ['摇头＋说话', { 摇头: 0.7, 表情: { 嘴: '大', 眼x: -0.6 } }]]
      .map(([名, t], i) => ({ 名, 参: JSON.stringify(t), src: 出图(`头-${p.key}-${i}`, 渲人(f, t).svg, 半身框(m), 200) })),
  });
}

/* ---------- 稿件库 ---------- */

/**
 * 从工作表里抓一节。**按标题前缀抓** —— 工作表 §0 里写着「小节标题别改」，就是为了这儿。
 * 抓不到不报错，页面上那一块空着（这是有意的：稿件早期本来就没写全）。
 */
function 抓(md, 标题) {
  const L = md.replace(/\r\n/g, '\n').split('\n');
  const i = L.findIndex((l) => l.startsWith('## ' + 标题));
  if (i < 0) return '';
  const j = L.findIndex((l, k) => k > i && (l.startsWith('## ') || l.trim() === '---'));
  return L.slice(i + 1, j < 0 ? L.length : j).join('\n').trim();
}

/**
 * 稿面 EN ＋ 中文校对版**并排**。
 *
 * 工作表 §2 按空行分段，§4 用 ｜ 分段 —— 两边本来就是一句一句对着写的，
 * 段数相同就能一一对上，并排排出来校对起来快得多。
 *
 * ⚠ **段数对不上就不并排。** 硬凑会让第 5 段的中文贴到第 6 段的英文底下 ——
 *   看着整整齐齐，全是错的，而且没人会发现。对不上就退回上下两块分开摆，
 *   并把这件事写在页面上（不是写在 console 里 —— 看页面的人未必跑过脚本）。
 */
function 对照(英, 中) {
  const 竖 = String.fromCharCode(0xFF5C);                       // ｜，写码点免得被编码吃掉

  /**
   * 只要围栏**里面**那一块。
   * §2 的围栏后面还跟着一句「约 92 词。停顿合计约 6.5s。」—— 按空行切会把它算成
   * 多出来的一段，段数就对不上了。§4 没有围栏，那就整段拿。
   */
  const 正文 = (s) => {
    const L = s.split('\n');
    const a = L.findIndex((l) => l.trim().startsWith('```'));
    if (a < 0) return s;
    const b = L.findIndex((l, k) => k > a && l.trim().startsWith('```'));
    return L.slice(a + 1, b < 0 ? L.length : b).join('\n');
  };

  const 英段 = 正文(英).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const 中段 = !中 ? [] : 正文(中).replace(/\n+/g, ' ').split(竖).map((s) => s.trim()).filter(Boolean);

  /* ‖1.2 这种停顿标记单独标出来 —— 它不进引擎，读稿的时候要能一眼跳过 */
  const 停顿符 = String.fromCharCode(0x2016);
  const 排英 = (s) => esc(s).replace(/\n/g, '<br>')
    .replace(new RegExp(停顿符 + '\\s*([0-9.]+)', 'g'), '<span class="pause">$1s</span>');

  if (!中段.length)
    return `<p class="note" style="margin:6px 0 8px">工作表还没有 §4 中文校对版</p>`
      + `<table class="tw bi"><tr><th style="width:34px">#</th><th>稿面 EN</th></tr>`
      + 英段.map((e, i) => `<tr><td class="mono">${i + 1}</td><td class="en">${排英(e)}</td></tr>`).join('')
      + `</table>`;

  if (英段.length !== 中段.length)
    return `<p class="note" style="margin:6px 0 8px"><b class="no">✗ 中英段数对不上</b>：`
      + `§2 是 ${英段.length} 段，§4 是 ${中段.length} 段 —— 不并排了，硬对会串行。`
      + `把 §4 的 ｜ 数量对齐到 §2 的空行分段就能并排。</p>`
      + `<table class="tw bi"><tr><th style="width:34px">#</th><th>稿面 EN</th></tr>`
      + 英段.map((e, i) => `<tr><td class="mono">${i + 1}</td><td class="en">${排英(e)}</td></tr>`).join('')
      + `</table>`
      + `<p class="sub" style="margin:12px 0 6px"><b>中文校对版</b></p>`
      + `<table class="tw bi"><tr><th style="width:34px">#</th><th>中文</th></tr>`
      + 中段.map((c, i) => `<tr><td class="mono">${i + 1}</td><td class="zh">${esc(c)}</td></tr>`).join('')
      + `</table>`;

  return `<table class="tw bi">`
    + `<tr><th style="width:34px">#</th><th style="width:52%">稿面 EN</th><th>中文校对</th></tr>`
    + 英段.map((e, i) => `<tr><td class="mono">${i + 1}</td>`
      + `<td class="en">${排英(e)}</td><td class="zh">${esc(中段[i])}</td></tr>`).join('')
    + `</table>`;
}

/** 够用就行的 markdown：表格 / 围栏代码 / 列表（含勾选框）/ 引用 / 段落。别拿它渲别处的 md */
function md2html(md) {
  const L = md.replace(/\r\n/g, '\n').split('\n');
  const 栏 = '```';
  const out = [];
  let i = 0;
  while (i < L.length) {
    const l = L[i];
    if (l.startsWith(栏)) {                                       // 围栏代码
      const j = L.findIndex((x, k) => k > i && x.startsWith(栏));
      out.push('<pre>' + esc(L.slice(i + 1, j < 0 ? L.length : j).join('\n')) + '</pre>');
      i = (j < 0 ? L.length : j) + 1;
    } else if (l.startsWith('|')) {                              // 表格
      const 行 = [];
      while (i < L.length && L[i].startsWith('|')) 行.push(L[i++]);
      const 格 = (x) => x.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const 头 = 格(行[0]);
      const 体 = 行.slice(2).map(格);                             // 第 2 行是分隔线
      out.push('<table class="tw"><tr>' + 头.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>'
        + 体.map((cs) => '<tr>' + cs.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>');
    } else if (/^[-*] /.test(l)) {                               // 列表（含 - [ ] 勾选框）
      const 项 = [];
      while (i < L.length && /^[-*] /.test(L[i])) 项.push(L[i++].slice(2));
      out.push('<ul class="tight">' + 项.map((t) => {
        const 勾 = /^\[x\] /i.test(t), 空 = /^\[ \] /.test(t);
        const 文 = inline(t.replace(/^\[[ xX]\] /, ''));
        return 勾 ? `<li><b class="ok">✓</b> <s>${文}</s></li>`
             : 空 ? `<li><span class="no">☐</span> ${文}</li>` : `<li>${文}</li>`;
      }).join('') + '</ul>');
    } else if (l.startsWith('> ')) {                             // 引用
      const 段 = [];
      while (i < L.length && L[i].startsWith('> ')) 段.push(L[i++].slice(2));
      out.push(`<p class="note">${inline(段.join(' '))}</p>`);
    } else if (l.trim()) {                                       // 段落
      const 段 = [];
      while (i < L.length && L[i].trim() && !/^[-*|>] /.test(L[i]) && !L[i].startsWith(栏)) 段.push(L[i++]);
      out.push(`<p class="sub" style="margin:8px 0">${inline(段.join(' '))}</p>`);
    } else i++;
  }
  return out.join('\n');
}

const 稿件根 = 'gao-2d/稿件';
const 稿件 = [];
for (const slug of (fs.existsSync(稿件根) ? fs.readdirSync(稿件根).sort() : [])) {
  const 表 = path.join(稿件根, slug, '时间表.mjs');
  if (!fs.existsSync(表)) continue;
  const cfg = (await import(pathToFileURL(path.resolve(表)).href)).default;
  const 根 = { 工作: path.join('projects/高总', slug), 帧: 'projects/高总/_帧',
                素材: 'projects/高总/_素材', 音乐: 'projects/高总/_音乐' };
  const 工 = path.join(稿件根, slug, cfg.工作表 ?? '工作表.md');
  const md = fs.existsSync(工) ? fs.readFileSync(工, 'utf8') : '';
  稿件.push({ slug, cfg, r: 自检(cfg, 根),
              来源: 抓(md, '1. 来源表'), 稿面: 抓(md, '2. 稿面 EN'),
              中文: 抓(md, '4. 中文校对版'), 待办: 抓(md, '7. 出片前待办') });
}

/* ---------- 页面 ---------- */

/** 出了几条片：稿件工作目录里有没有 <slug>.mp4。别硬编码「还没有」—— 出了片没人会回来改这行字 */
const 成片数 = 稿件.filter(({ slug }) =>
  fs.existsSync(path.join('projects/高总', slug, `${slug}.mp4`))).length;

/**
 * 左侧目录。两种条目：`[名, 备注]` 是一节，`{ 组, 项 }` 是一个可折叠的组。
 * **组只能收正文里连续的几节** —— 目录顺序必须跟正文滚动顺序一致，
 * 否则滚动高亮会在组内组外来回跳。素材层那五节正好连着，所以能收；
 * 「欠美术的」夹在闸和稿件库中间，收进来就断了，留在外面。
 */
const 池文件 = 'gao-2d/选题池_v2.md';
const 池原文 = fs.existsSync(池文件) ? fs.readFileSync(池文件, 'utf8') : '';
/* 池子里 `## ` 开头的块数 —— 侧栏角标用 */
const 池块数 = (池原文.match(/^## /gm) ?? []).length;

const 节 = [
  /* **成片和稿件库排最前**（2026-09-09）：这张页最常来看的是「片子出到哪儿了」，
     素材层是查规格时才翻的。⚠ 改目录顺序**必须同时改正文顺序** ——
     两边不一致的话滚动高亮会来回跳（见 组 那条注释）。 */
  ['成片', 成片数 ? `${成片数} 条` : '还没有'],
  ['稿件库', `${稿件.length} 条`],
  ['选题池', `${池块数} 块`],
  { 组: '素材', 项: [
    ['素材总览', '12 张，进 git'],
    ['姿势', `${册.姿势.length} 种 ＋ 头部层`],
    ['帧序列', `${册.帧序列.length} 组`],
    ['表情', '眨眼 / 转眼珠 / 口型'],
    ['头动', '点头 / 摇头'],
  ] },
  ['闸', 'node gao-2d/查.mjs'],
  ['踩过的坑', '机器一条都不报'],
  ['欠美术的', '2 样'],
];
const id = (s) => 's-' + [...s].map((c) => c.charCodeAt(0).toString(36)).join('');

const 导航项 = ([n, m]) =>
  `<a class="nav-item" href="#${id(n)}"><span class="nav-title">${esc(n)}</span><span class="nav-meta">${esc(m)}</span></a>`;
// 角标数的是节，不是条目 —— 组自己不算一节。
const 节数 = 节.reduce((n, x) => n + (x.组 ? x.项.length : 1), 0);
const 侧栏 = 节
  .map((x) =>
    x.组
      ? `<details class="nav-group" open>
      <summary><span class="nav-title">${esc(x.组)}</span><span class="nav-meta">${x.项.length} 节</span></summary>
      ${x.项.map(导航项).join('\n      ')}
    </details>`
      : 导航项(x))
  .join('\n    ');

const 姿势卡 = (p, 头 = false) => `
<figure class="pose">
  <img src="${p.src}" alt="${esc(p.名)}">
  <figcaption>
    <b>${esc(p.名)}</b><code>${esc(p.key)}</code>
    <span class="meta">缩放 ${p.scale}　锚 ${p.ax ?? '—'}　脸 ${p.脸.w}×${p.脸.h}　${p.图元数} 条图元</span>
    <span class="meta">${头 ? '叠在正面姿势上做点头摇头' : `眼 ${p.五官.眼}${p.五官.眼 === 2 ? '　<b class="ok">表情全可用</b>' : '　<span class="no">只认得出一只眼</span>'}`}</span>
  </figcaption>
</figure>`;

/**
 * 稿件库那一节：一条稿件一块。
 * **数字全部来自 `自检.mjs`** —— 跟 `build.mjs --check` 那道闸同一份算法，
 * 页面上写「DOC 26%」和闸里拦不拦，必须是同一个数算出来的。
 */
const 状态色 = { 立项: 'warn', 待审: 'warn', 待配音: 'warn', 待素材: 'warn', 待出片: 'alt', 已出片: '' };

/**
 * 成片节。**这一节原来是一段占位文字**（「配音、字幕、出片管线还没接」），
 * 出了三条片之后也没人回来改 —— 硬编码的状态没人会回头维护，
 * 所以这儿一律现算：目录里有 mp4 就列出来，一条都没有就整节不出。
 *
 * 时长和配比取自 `自检.mjs`（跟闸同一份算法），不单独 ffprobe ——
 * 这份是纯渲染脚本，不该为了一个数字去起外部进程。
 */
const 有片 = ({ slug }) => fs.existsSync(path.join('projects/高总', slug, `${slug}.mp4`));

/**
 * 发布文案的四块可复制内容，直接搬到页面上。
 *
 * **只搬那四块**（标题／简介／关键字／置顶评论）—— `发布文案.md` 里还有
 * 「这条片子是什么」和核对清单，那些是给自己看的，不是复制源
 * （仓库约定：发布文案是复制源不是分析报告）。
 * `md2html` 会把围栏代码块渲成 `<pre>`，页面上整块选中就能粘走。
 */
const 文案节 = (slug) => {
  const f = path.join('projects/高总', slug, '发布文案.md');
  if (!fs.existsSync(f)) return '<p class="note">还没有 发布文案.md</p>';
  const md = fs.readFileSync(f, 'utf8');
  return ['一 标题', '二 简介', '三 关键字', '四 置顶评论']
    .map((t) => {
      const x = 抓(md, t);
      return x ? `<p class="sub" style="margin:14px 0 4px"><b>${esc(t.slice(2))}</b></p>${md2html(x)}` : '';
    }).join('') || '<p class="note">发布文案里没抓到那四节 —— 小节标题改过？</p>';
};

const 成片节 = !成片数 ? '' : `
<section class="card" id="${id('成片')}">
  <h2>成片 <span class="pill alt">${成片数} 条</span></h2>
  <p class="sub">点开就能看。片子在 <code>projects/高总/&lt;slug&gt;/&lt;slug&gt;.mp4</code>，
    底下的发布文案是**复制源** —— 标题／简介／关键字／置顶评论，整块选中就能粘进平台。</p>
  ${稿件.filter(有片).map(({ slug, cfg, r }) => `
  <div class="film-row">
    <video src="${slug}/${slug}.mp4" controls preload="metadata" playsinline></video>
    <div class="film-info">
      <p style="margin:0 0 6px"><b style="font-size:16px">${esc(cfg.题 ?? slug)}</b>
        <code>${esc(slug)}</code>
        <span class="pill ${状态色[cfg.状态] ?? 'warn'}">${esc(cfg.状态 ?? '？')}</span>
        ${cfg.模板 ? `<span class="pill alt">模板 ${esc(cfg.模板)}</span>` : ''}</p>
      <p class="note">${r.总长}s　·　${esc(cfg.线 ?? '')}　·
        B ${r.配比.B}% ／ C ${r.配比.C}% ／ DOC ${r.配比.DOC}%
        ${cfg.music ? `　·　配乐 ${esc(cfg.music.file)} @ ${cfg.music.db}dB` : '　·　无音乐'}</p>
      ${fs.existsSync(path.join('projects/高总', slug, `${slug}_cover.png`)) ? `
      <div class="covers">
        <figure><img src="${slug}/${slug}_cover.png" alt="封面">
          <figcaption class="note">封面 1080×1920<br>上传用</figcaption></figure>
        <figure><img src="${slug}/${slug}_cover_1x1.png" alt="中心裁切">
          <figcaption class="note">中心 1080×1080<br><b>首页卡片就长这样</b></figcaption></figure>
      </div>` : '<p class="note">还没出封面 —— 跑 <code>node gao-2d/封面.mjs</code></p>'}
      <details class="pub">
        <summary>发布文案（可复制）</summary>
        ${文案节(slug)}
      </details>
    </div>
  </div>`).join('')}
</section>
`;
/**
 * 选题池。**这一节是直接渲 `gao-2d/选题池_v2.md`，不是另抄一份。**
 * 抄一份的话两边迟早不一致，而这张页是拿来审选题的 —— 审的必须是正文。
 * 那份 md 只用到六种语法（标题／表格／列表／代码块／粗体／反引号），
 * 所以这儿用一个够用的小转换，不引 markdown 库。
 */
function 渲池(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let i = 0, 段 = [];
  const 收段 = () => { if (段.length) { out.push(`<p class="note">${inline(段.join(' '))}</p>`); 段 = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { 收段(); i++; continue; }
    if (/^---+\s*$/.test(l)) { 收段(); out.push('<div class="hr"></div>'); i++; continue; }
    const m = l.match(/^(#{1,4})\s+(.*)$/);
    if (m) {
      收段();
      const lv = Math.min(m[1].length + 1, 4);   // md 的 # 对应页面的 h2
      out.push(`<h${lv} class="pool-h">${inline(m[2])}</h${lv}>`);
      i++; continue;
    }
    if (l.startsWith('```')) {
      收段(); i++;
      const buf = [];
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    if (l.trimStart().startsWith('- ')) {
      收段();
      const buf = [];
      while (i < lines.length && (lines[i].trimStart().startsWith('- ')
             || (buf.length && /^\s{2,}\S/.test(lines[i])))) {
        if (lines[i].trimStart().startsWith('- ')) buf.push(lines[i].trimStart().slice(2));
        else buf[buf.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<ul class="tight">${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (l.startsWith('|')) {
      收段();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const 格 = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const 头 = 格(rows[0]);
      const 体 = rows.slice(/^[\s|:-]+$/.test(rows[1] ?? '') ? 2 : 1);
      out.push(`<table class="tw pool-t"><tr>${头.map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`
        + 体.map((r) => `<tr>${格(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') + '</table>');
      continue;
    }
    段.push(l.trim()); i++;
  }
  收段();
  return out.join('\n  ');
}
const 选题池节 = !池原文 ? '' : `
<section class="card" id="${id('选题池')}">
  <h2>选题池 <span class="pill alt">${池块数} 块</span></h2>
  <p class="sub">正文是 <code>${esc(池文件)}</code>，这一节<strong>直接渲那份文件</strong>，不另存一份。
    改选题改 md，重跑 <code>node gao-2d/index.mjs</code>。</p>
  <p class="note"><strong>池子里只写角度和「去哪儿查」，不写具体数字。</strong>
    写进池子的数字迟早会被当成已核实的引用 —— 数字一律出稿时现查现核。</p>
  <div class="hr"></div>
  ${渲池(池原文)}
</section>
`;

const 稿件节 = !稿件.length ? '' : `
<section class="card" id="${id('稿件库')}">
  <h2>稿件库 <span class="pill alt">${稿件.length} 条</span></h2>
  <p class="sub">源在 <code>gao-2d/稿件/&lt;slug&gt;/</code>（工作表 ＋ 时间表），产物在 <code>projects/高总/&lt;slug&gt;/</code>。
    下面每条的配比、阈值、缺哪块素材，都是 <code>gao-2d/自检.mjs</code> 现算的 ——
    跟 <code>node gao-2d/build.mjs &lt;slug&gt; --check</code> 那道闸同一份算法。</p>
${稿件.map(({ slug, cfg, r, 来源, 稿面, 中文, 待办 }) => `
  <details class="draft">
    <summary>
      <b>${esc(cfg.题 ?? slug)}</b>
      <code>${esc(slug)}</code>
      <span class="pill ${状态色[cfg.状态] ?? 'warn'}">${esc(cfg.状态 ?? '？')}</span>
      ${cfg.模板 ? `<span class="pill alt">模板 ${esc(cfg.模板)}</span>` : ''}
      ${cfg.克制型 ? '<span class="pill warn">克制型</span>' : ''}
      <span class="meta">${r.总长}s　·　${r.硬伤.length ? `<span class="no">${r.硬伤.length} 处硬伤</span>` : '自检全过'}</span>
    </summary>
  <p class="note">${esc(cfg.线 ?? '')}总长 ${r.总长}s / ${Math.round(r.总长 * FPS)} 帧 @${FPS}fps　·　
    配比 A ${r.配比.A}% ／ B ${r.配比.B}% ／ C ${r.配比.C}% ／ DOC ${r.配比.DOC}%（参考 35/25/25/15）　·　
    主讲人 ${r.主讲人次数} 次（≥3）　·　字卡连排 ${r.字卡连排}（≤2）</p>

  <p class="sub" style="margin:14px 0 6px"><b>${r.硬伤.length ? `八项自检：${r.硬伤.length} 处硬伤` : '八项自检：全过'}</b></p>
  ${r.硬伤.length ? `<ul class="tight">${r.硬伤.map((m) => `<li><span class="no">✗</span> ${inline(m)}</li>`).join('')}</ul>` : ''}
  ${r.提醒.length ? `<ul class="tight">${r.提醒.map((m) => `<li class="note">· ${inline(m)}</li>`).join('')}</ul>` : ''}

  <table class="tw" style="margin:14px 0">
    <tr><th>#</th><th>层</th><th>起–止</th><th>时长</th><th>素材</th><th>来源角标</th></tr>
    ${r.行.map((l) => `<tr>
      <td>${l.id}</td><td>${l.layer}</td>
      <td class="mono">${l.start}–${l.end}</td><td class="mono">${l.时长}s</td>
      <td class="mono">${l.有 ? '' : '<span class="no">✗ </span>'}${esc(l.素材)}</td>
      <td class="note">${esc(l.credit ?? '')}${l.credit中 ? `<br><span class="zh-gloss">${esc(l.credit中)}</span>` : ''}</td></tr>`).join('')}
  </table>

  ${(() => {
    /* 上屏文字。**这一节是给中文读者看的** —— 字卡和字幕是真正印在画面上的英文，
       页面上原先只显示「字卡 statement」这种类型名，看不见卡面写了什么，没法审。
       中文来自时间表的 `card.中` / `captions[].中`，跟英文挨着写，改一处不会漏另一处。
       ⚠ 中文只上页面，**不进片子** —— 频道是英文频道，画面上不叠中文（方案 §6.6）。 */
    const 卡 = r.行.filter((l) => l.layer === 'A' && l.card);
    const 幕 = cfg.captions ?? [];
    if (!卡.length && !幕.length) return '';
    const 卡面 = (c) => [c.prefix, c.value, c.suffix, c.label, c.note,
                          c.oldLabel, c.oldValue, c.newLabel, c.newValue, c.kicker, c.lines]
      .filter((x) => x !== undefined && x !== null && String(x).trim() !== '')
      .join('　').replace(/\n/g, ' / ');
    const 缺译 = [...卡.filter((l) => !l.card.中), ...幕.filter((c) => !c.中)].length;
    return `<p class="sub" style="margin:16px 0 6px"><b>上屏文字</b>
      ${缺译 ? `<span class="pill warn">${缺译} 处没写中文</span>` : '<span class="pill alt">都有中文</span>'}
      <span class="note">　·　真正印在画面上的英文。中文来自 <code>card.中</code> / <code>captions[].中</code>，只上这张页，不进片子</span></p>
    <table class="tw bi">
      <tr><th style="width:52px">位置</th><th style="width:50%">画面上的英文</th><th>中文</th></tr>
      ${卡.map((l) => `<tr>
        <td class="mono">第 ${l.id} 块<br><span class="note">字卡</span></td>
        <td class="en">${esc(卡面(l.card))}</td>
        <td class="zh">${l.card.中 ? esc(l.card.中) : '<span class="no">没写</span>'}</td></tr>`).join('')}
      ${幕.map((c) => `<tr>
        <td class="mono">${c.t0}–${c.t1}<br><span class="note">字幕</span></td>
        <td class="en">${esc(c.text).replace(/\n/g, '<br>')}</td>
        <td class="zh">${c.中 ? esc(c.中) : '<span class="no">没写</span>'}</td></tr>`).join('')}
    </table>`;
  })()}

  ${稿面 ? `<p class="sub" style="margin:16px 0 6px"><b>稿面</b>　<span class="note">右边是 §4 中文校对版，一句一句对着排。灰底的秒数是停顿标记，不进引擎</span></p>${对照(稿面, 中文)}` : ''}
  ${来源 ? `<p class="sub" style="margin:16px 0 6px"><b>来源表</b></p>${md2html(来源)}` : ''}
  ${(() => {
    /* 素材清单整张表由 `时间表.mjs` 每块的 `素材` 字段生成 —— 不再抄工作表 §6。
       说明跟 clip 名挨着写，改了文件名而忘了改说明的那种不同步就不可能发生。 */
    const 料 = r.行.filter((l) => l.layer === 'C' || l.layer === 'DOC');
    if (!料.length) return '';
    const 缺 = 料.filter((l) => !l.有);
    return `<p class="sub" style="margin:16px 0 6px"><b>素材清单</b>
      ${缺.length ? `<span class="pill warn">还缺 ${缺.length} / ${料.length} 件</span>`
                  : `<span class="pill alt">${料.length} 件齐了</span>`}
      <span class="note">　·　由 <code>时间表.mjs</code> 每块的 <code>素材</code> 字段生成，缺件是 <code>自检.mjs</code> 现算的</span></p>
    <table class="tw">
      <tr><th>#</th><th>层</th><th>时长</th><th>文件</th><th>要准备成什么样</th></tr>
      ${料.map((l) => `<tr>
        <td>${l.id}</td>
        <td>${l.layer}${l.共用 ? '<br><span class="note">共用库</span>' : ''}</td>
        <td class="mono">${l.时长}s</td>
        <td class="mono">${l.有 ? '' : '<span class="no">✗ </span>'}${esc(l.素材)}</td>
        <td>${l.说明?.要
          ? `${l.说明.源 ? `<span class="pill alt">${esc(l.说明.源)}</span> ` : ''}${esc(l.说明.要)}`
            + (l.说明.检索 ? `<br><span class="note">检索　<code>${esc(l.说明.检索)}</code></span>` : '')
            + (l.说明.备注 ? `<br><span class="note">${esc(l.说明.备注)}</span>` : '')
          : '<span class="no">没写</span>'}</td></tr>`).join('')}
    </table>`;
  })()}
  ${待办 ? `<p class="sub" style="margin:16px 0 6px"><b>出片前待办</b></p>${md2html(待办)}` : ''}
  </details>
`).join('')}
</section>
`;

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>高总 2D 口播 · 英语频道</title>
<style>
:root {
  --bg: #f4f1ea; --card: #fffdf8; --ink: #23303d; --dim: #6b7785;
  --line: #e0dace; --accent: #1f3a5f; --hot: #c8452e; --gold: #d8a53a;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#171a1d; --card:#20252a; --ink:#e8e4da; --dim:#9aa4ae;
          --line:#2f363d; --accent:#7fa8d8; --hot:#e2694f; --gold:#e0b954; }
}
* { box-sizing: border-box; }
body { margin:0; padding:32px 20px 80px; background:var(--bg); color:var(--ink);
  font:15px/1.7 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif; }
.layout { max-width:1360px; margin:0 auto; display:grid;
  grid-template-columns:250px minmax(0,1fr); gap:34px; align-items:start; }
.wrap { min-width:0; }

.side { position:sticky; top:24px; max-height:calc(100vh - 48px);
  display:flex; flex-direction:column; background:var(--card);
  border:1px solid var(--line); border-radius:14px; padding:16px 12px 12px; }
.side-head { font-size:13px; font-weight:700; color:var(--dim); letter-spacing:1px;
  padding:0 8px 12px; border-bottom:1px solid var(--line); margin-bottom:10px;
  display:flex; align-items:center; justify-content:space-between; }
.side-count { background:var(--accent); color:#fff; font-size:11px; font-weight:600;
  min-width:20px; height:20px; padding:0 6px; border-radius:10px;
  display:inline-flex; align-items:center; justify-content:center; }
/* min-height:0 不能省：flex 子项默认不肯缩到内容高度以下，少了它 overflow-y 不生效 */
.side-list { overflow-y:auto; min-height:0; display:flex; flex-direction:column; gap:4px; }
.nav-item { display:flex; flex-direction:column; gap:1px; padding:8px 10px; border-radius:9px;
  text-decoration:none; color:inherit; border:1px solid transparent; transition:background .12s; }
.nav-item:hover { background:rgba(127,127,127,.1); }
.nav-item.active { background:rgba(31,58,95,.12); border-color:var(--accent); }
@media (prefers-color-scheme: dark) { .nav-item.active { background:rgba(127,168,216,.16); } }
.nav-title { font-size:13px; font-weight:600; }
.nav-meta { font-size:11px; color:var(--dim); }
/* 折叠组。用原生 <details>，开合不写 JS —— 只在滚动高亮命中一个收起的组时替它展开（见页底脚本）。
   list-style:none ＋ ::-webkit-details-marker 两条都要，Safari 只认后一条。 */
.nav-group > summary { display:flex; align-items:center; gap:7px; cursor:pointer;
  padding:8px 10px; border-radius:9px; list-style:none; user-select:none; }
.nav-group > summary::-webkit-details-marker { display:none; }
.nav-group > summary::before { content:'▸'; font-size:11px; color:var(--dim);
  transition:transform .15s; }
.nav-group[open] > summary::before { transform:rotate(90deg); }
.nav-group > summary:hover { background:rgba(127,127,127,.1); }
.nav-group > summary .nav-meta { margin-left:auto; }
.nav-group > .nav-item { margin:4px 0 0 11px; border-left:1px solid var(--line);
  border-radius:0 9px 9px 0; padding-left:12px; }
.nav-group > .nav-item.active { border-left-color:var(--accent); }
.side-top { margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  font-size:12px; color:var(--dim); text-decoration:none; text-align:center; }
.side-top:hover { color:var(--accent); }

.alarm { background:rgba(200,69,46,.09); border-left:3px solid var(--hot);
  padding:10px 14px; border-radius:0 8px 8px 0; margin-bottom:18px; font-size:13.5px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:18px 26px; margin-bottom:18px; }
h1 { font-size:26px; margin:0 0 6px; letter-spacing:.5px; }
h2 { font-size:19px; margin:0 0 4px; }
.sub { color:var(--dim); margin:6px 0 16px; font-size:13.5px; }
code { background:rgba(127,127,127,.16); padding:1px 6px; border-radius:4px; font-size:13px;
  font-family:ui-monospace,Menlo,Consolas,monospace; }
pre { background:rgba(127,127,127,.09); border:1px solid var(--line); border-radius:9px;
  padding:12px 16px; overflow-x:auto; font-size:13px; line-height:1.65;
  font-family:ui-monospace,Menlo,Consolas,monospace; }
.pill { background:var(--accent); color:#fff; font-size:12px; padding:2px 10px; border-radius:20px; }
.pill.alt { background:transparent; color:var(--accent); border:1px solid var(--accent); }
.pill.warn { background:transparent; color:var(--hot); border:1px dashed var(--hot); }

/* 姿势／表情格 */
.grid { display:flex; flex-wrap:wrap; gap:14px; }
figure { margin:0; background:rgba(127,127,127,.05); border:1px solid var(--line);
  border-radius:11px; padding:10px; display:flex; flex-direction:column; gap:8px; }
figure img { display:block; margin:0 auto; background:
  repeating-conic-gradient(rgba(127,127,127,.10) 0% 25%, transparent 0% 50%) 50%/14px 14px; }
figure.pose img { height:190px; width:auto; }
figure.face img { width:150px; height:auto; }
figure.半身 img { width:180px; height:auto; }
figure.帧 img { height:130px; width:auto; }
figcaption { font-size:12.5px; display:flex; flex-direction:column; gap:2px; max-width:210px; }
figcaption .meta { font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
figcaption b.ok { color:var(--accent); }
figcaption .no { color:var(--hot); }
figcaption code { font-size:11px; margin-left:6px; }
.note { font-size:11.5px; color:var(--dim); line-height:1.5; }

.tw { width:100%; border-collapse:collapse; font-size:13px; }
.tw th, .tw td { border:1px solid var(--line); padding:6px 10px; text-align:left; vertical-align:top; }
.tw th { background:rgba(127,127,127,.10); font-weight:700; white-space:nowrap; }
.tw td.mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--dim); }
/* 中英对照：英文左、中文右。行高放宽一点，两栏基线才不打架 */
.tw.bi td { line-height:1.75; }
.tw.bi td.en { font-size:13.5px; }
.tw.bi td.zh { font-size:13px; color:var(--dim); }
/* 英文底下那行中文注。这张页是给中文读者看的 —— 但中文只上页面，不进片子 */
.zh-gloss { font-size:11.5px; color:var(--dim); }
/* 成片：一条一行，竖屏在左、信息和发布文案在右 —— 文案要能整块复制，
   横排三个 240px 的格子塞不下 */
.film-row { display:flex; gap:20px; align-items:flex-start;
  border-top:1px solid var(--line); padding:16px 0 4px; margin-top:12px; }
.film-row video { width:240px; height:427px; flex:none; display:block; background:#000;
  border-radius:10px; border:1px solid var(--line); }
.film-info { flex:1; min-width:0; }
/* 封面两张并排：左边完整，右边中心裁切 —— 右边那张是拿眼睛校验用的，
   Shorts 首页卡片只露中间 1080×1080（《YouTube 封面规范》§十一） */
.covers { display:flex; gap:12px; margin:10px 0 2px; }
.covers figure { margin:0; display:flex; flex-direction:column; gap:4px; }
.covers img { height:150px; width:auto; display:block; border:1px solid var(--line);
  border-radius:6px; background:#fff; }
.covers figcaption { font-size:11px; line-height:1.4; }
.pub { margin-top:10px; }
.pub > summary { cursor:pointer; list-style:none; user-select:none; font-size:13px;
  color:var(--accent); padding:4px 0; }
.pub > summary::-webkit-details-marker { display:none; }
.pub > summary::before { content:'▸ '; font-size:11px; }
.pub[open] > summary::before { content:'▾ '; }
.pub pre { max-height:none; }
/* 选题池：直接渲 md，标题层级比正文小一档 —— 一节里塞了四级标题，
   照页面原来的 h2/h3 尺寸会跟节标题打架 */
.pool-h { margin:20px 0 6px; line-height:1.4; }
h2.pool-h { font-size:17px; }
h3.pool-h { font-size:15px; color:var(--accent); }
h4.pool-h { font-size:13.5px; }
.pool-t { margin:8px 0 14px; }
.pool-t td { line-height:1.7; font-size:13px; }
.pool-t td:first-child { white-space:nowrap; }
/* 稿件库每条折叠 —— 三条稿件全展开的话这一节能滚半天 */
.draft { border-top:1px solid var(--line); padding:12px 0 4px; margin-top:10px; }
.draft > summary { display:flex; align-items:center; gap:8px; flex-wrap:wrap; cursor:pointer;
  list-style:none; user-select:none; padding:4px 0; }
.draft > summary::-webkit-details-marker { display:none; }
.draft > summary::before { content:'▸'; font-size:11px; color:var(--dim); transition:transform .15s; }
.draft[open] > summary::before { transform:rotate(90deg); }
.draft > summary:hover { color:var(--accent); }
.draft > summary b { font-size:15px; }
.pause { display:inline-block; margin:0 2px; padding:0 5px; border-radius:3px;
  background:rgba(127,127,127,.16); color:var(--dim);
  font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; vertical-align:1px; }
ul.tight { margin:6px 0 0; padding-left:20px; }
ul.tight li { margin-bottom:5px; }
.hr { height:1px; background:var(--line); margin:20px 0; }
footer { max-width:1360px; margin:34px auto 0; color:var(--dim); font-size:12px;
  text-align:center; }
</style>

<div class="layout">
<nav class="side">
  <div class="side-head"><span>英语频道</span><span class="side-count">${节数}</span></div>
  <div class="side-list">
    ${侧栏}
  </div>
  <a class="side-top" href="#top">回到顶部</a>
</nav>

<div class="wrap" id="top">
<h1>高总 2D 口播 · 英语频道</h1>
<p class="sub">第九条线　·　素材册生成于 ${esc(册.生成于)}　·　正文在 <code>gao-2d/README.md</code></p>

<div class="alarm">
  ${成片数
    ? `<strong>已经出了 ${成片数} 条片。</strong>成片和稿件库排在最前面 —— 这张页最常来看的是「片子出到哪儿了」；
       素材层（姿势、表情、头动、闸、欠美术的）挪到了下面，查规格时再翻。`
    : '<strong>这条线还一期成片都没有。</strong>这张页现在是<strong>素材层的账本</strong>。'}
</div>

${成片节}

${稿件节}

${选题池节}

<section class="card" id="${id('素材总览')}">
  <h2>素材总览</h2>
  <p class="sub">源目录 <code>${esc(册.源目录)}</code>，12 张已收进 <code>gao-2d/素材库/svg/</code>（约 670KB，<strong>进 git</strong>）。</p>
  <p class="note">为什么复制进仓库：老石那条线是硬编码引用外部目录，散在五个文件里，目录一没整条线就跑不出来。
    仓库的判据是「<strong>删了还跑不跑得出来</strong>」。</p>
  <div class="hr"></div>
  ${册._说明.filter((l) => l && !l.startsWith('#')).map((l) => `<p class="note">${inline(l)}</p>`).join('\n  ')}
</section>

<section class="card" id="${id('姿势')}">
  <h2>姿势 <span class="pill alt">${册.姿势.length} 种 ＋ 头部层</span></h2>
  <p class="sub"><strong>对位按脸高归一化</strong>，不按整体墨高 —— 抬单手那几张手举过头，墨高里含着手，
    按它缩放一换姿势人就矮一截。三批素材是分别导出的，各用各的缩放，比例约 <b>1 : 1.58 : 2.0</b>。</p>
  <div class="grid">
    ${姿势图.slice(0, -1).map((p) => 姿势卡(p)).join('\n    ')}
    ${姿势卡(姿势图[姿势图.length - 1], true)}
  </div>
</section>

<section class="card" id="${id('帧序列')}">
  <h2>帧序列 <span class="pill alt">${册.帧序列.length} 组</span></h2>
  <p class="sub">水平锚 <code>ax</code> 是<strong>一组共用一个</strong>：各帧按自己墨心锚的话，走路时人会左右平移一下。</p>
  ${帧图.map((s) => `
  <h3 style="font-size:15px;margin:14px 0 6px">${esc(s.名)} <code>${esc(s.key)}</code>
    ${s.缺 ? `<span class="pill warn">${esc(s.缺)}</span>` : `<span class="pill alt">${s.frames.length} 帧</span>`}</h3>
  <div class="grid">
    ${s.frames.map((fr) => `<figure class="帧"><img src="${fr.src}" alt="${esc(s.名)} ${fr.i}"><figcaption><b>第 ${fr.i + 1} 帧</b><span class="meta">${esc(fr.file)}</span></figcaption></figure>`).join('\n    ')}
  </div>`).join('\n')}
</section>

<section class="card" id="${id('表情')}">
  <h2>表情 <span class="pill">眨眼 / 转眼珠 / 口型</span></h2>
  <p class="sub"><strong>眼睛不重画。</strong>重画一双杏仁眼一定比原画难看，所以只做两件事：
    眨眼＝整只眼 clip 掉上半截＋补一条上眼睑线；转眼珠＝只给眼珠那几条加 translate。
    只有<strong>全闭那条弧</strong>和<strong>张开的嘴</strong>是新画的。</p>
  <pre>import { 渲脸 } from './gao-2d/画.mjs';

渲脸(file);                          // 原件（图元一条不增不减）
渲脸(file, { 眨: 0.4 });              // 半睁
渲脸(file, { 眼x: -1, 眼y: 0.5 });    // 眼珠（-1..1）
渲脸(file, { 嘴: '小' | '大' | '扁' }); // 口型（默认 '闭'）</pre>
  <p class="note">下面拿 <code>正面站立</code> 当样板 —— 三个正面姿势的做法完全一样。</p>
  <div class="grid">
    ${表情谱.map((e) => `<figure class="face"><img src="${e.src}" alt="${esc(e.名)}"><figcaption><b>${esc(e.名)}</b><span class="meta">${esc(e.参)}</span>${e.注 ? `<span class="note">${esc(e.注)}</span>` : ''}</figcaption></figure>`).join('\n    ')}
  </div>
</section>

<section class="card" id="${id('头动')}">
  <h2>头动 <span class="pill">点头 / 摇头</span></h2>
  <p class="sub">2026-09-08 美术补了 <code>头部.svg</code> 这条路才通。在这之前做不了：整 figure 里
    <strong>头和身体的 path 下标不连续</strong>（正面站立头部 62 条散在 2–159 之间，中间夹着 95 条身体的），
    整组 transform 会把身体一起带走。</p>
  <pre>import { 渲人 } from './gao-2d/头.mjs';

渲人(pose, { 点头: 1 });                            // +1 低头，-1 抬头
渲人(pose, { 摇头: -1 });
渲人(pose, { 点头: 0.8, 表情: { 眨: 1, 嘴: '大' } });  // 头动 ＋ 表情</pre>
  <p class="note">不给 <code>点头</code>/<code>摇头</code> 时 <code>渲人</code> 直接转给 <code>渲脸</code>，不叠头部层 ——
    不动头的那些帧跟原来一个图元都不差。</p>
  <table class="tw" style="margin:14px 0">
    <tr><th>对位</th><td>按<strong>两只眼的中心</strong>：缩放＝眼距之比，平移＝对齐眼心。不按脸的包围盒 ——
      脸是靠「上半部最大的肤色块」认出来的，边界会随头发遮挡浮动几像素，眼心是两个几何点。
      实测头部 vs 正面站立眼距 57 vs 57.5，缩放 1.0026；<strong>抠掉的正好 66 条，跟 头部.svg 的图元数一模一样</strong>。</td></tr>
    <tr><th>抠头判据</th><td>「头盒子盖住这条图元的 <strong>40% 以上</strong>」，不是「完全落在头盒子里」。
      该抠的 47–92%，该留的（脖子 19%、外套 4%）差得很远。</td></tr>
    <tr><th>只能正面</th><td><code>头部.svg</code> 是正面的，套到四分之三侧上是一张正面的脸贴在侧身上。
      判据是眼心偏离脸心多少：正面 0.7%，四分之三侧 15%。超了<strong>直接抛错</strong>，不是警告。</td></tr>
    <tr><th>抬头收着点</th><td>抬头幅度只给低头的三分之一 —— 头部图自带两缕鬓角，原本掖在衣领后面，
      一抬就整条露出来、末端在衣领上戛然而止（2D 分层藏不回去）。</td></tr>
  </table>
  ${头动谱.map((h) => `
  <h3 style="font-size:15px;margin:16px 0 6px">${esc(h.名)} <code>${esc(h.key)}</code></h3>
  <div class="grid">
    ${h.格.map((g) => `<figure class="半身"><img src="${g.src}" alt="${esc(g.名)}"><figcaption><b>${esc(g.名)}</b><span class="meta">${esc(g.参)}</span></figcaption></figure>`).join('\n    ')}
  </div>`).join('\n')}
</section>

<section class="card" id="${id('闸')}">
  <h2>闸 <span class="pill alt">node gao-2d/查.mjs</span></h2>
  <p class="sub">核心是<strong>比对源文件 checksum</strong>：对位和五官分组全是按 <strong>path 下标和几何</strong>算出来的，
    而美术在 Illustrator 里重新导出一次<strong>下标就全变，并且不报错</strong> ——
    颜色还在、形状还在，只是「第 149 条是右眼睫毛」这个事实悄悄失效，渲出来是把袖口当眼睛抠掉。</p>
  <ul class="tight">
    <li>checksum 对不上 → <strong>停</strong>，重跑 <code>node gao-2d/入库.mjs</code></li>
    <li>图元数、脸认不认得出来、五官分组变没变、帧序列够不够帧</li>
    <li>头部层还对不对得上每个正面姿势</li>
  </ul>
  <p class="note" style="margin-top:10px"><strong>这道闸验过会红</strong>：改一个字节 → <code>✗ 1 条硬伤</code>、退出码 1；还原 → 转绿。
    一道从没红过的闸等于没有闸。</p>
</section>

<section class="card" id="${id('踩过的坑')}">
  <h2>踩过的坑 <span class="pill warn">机器一条都不报</span></h2>
  <ul class="tight">
    <li><strong>邻近聚类把镜框并进了眼睛</strong> —— 右眼那簇 40×30，左眼才 27×21。高总戴眼镜，
      镜框紧贴眼眶，「挨着」和「是同一个东西」分不开。改成眼白打种。</li>
    <li><strong>右眼虹膜下缘的反光留在原地</strong> —— 转眼珠时右眼碎成一片。它探出眼珠 2px，
      按「完全包含」收不着；判据放宽到「盖住自己 40%」（下眼睑影只盖 27%，不会误收）。</li>
    <li><strong>clip 用错形状</strong> —— 这个角色<strong>两只眼画法根本不一样</strong>：
      左眼 #140 是一圈杏仁外框，右眼 #149 只是上睫毛。最后不 clip，靠限制行程。</li>
    <li><strong>抠头没抠干净</strong> —— 头一动，脸边上飘着一条黑线、左脸多出一块黑斑。</li>
    <li><strong>拿「认出两只眼」当「是正面」的判据</strong> —— 四分之三侧两只眼也都露着。
      我据此说过美术文件名错了，是我错了。</li>
  </ul>
  <p class="note" style="margin-top:10px">这几条全是<strong>肉眼在对照图上看出来的</strong>。
    其中「clip 用错形状」是把右眼 9 条图元<strong>一条条单独渲</strong>才看清的 ——
    合成图只告诉你「碎了」，不告诉你为什么碎。<br>
    所以：改了五官判据<strong>必须重出 <code>node gao-2d/画.mjs</code> 的表情表用眼睛看</strong>，
    <code>查.mjs</code> 全绿不代表画得对 —— 它只查「跟上次一样」。</p>
</section>

<section class="card" id="${id('欠美术的')}">
  <h2>欠美术的 <span class="pill alt">2 样</span></h2>
  <ol class="tight">
    <li><strong><code>正面走路</code> 只有 2 帧</strong> —— 循环会跳。侧面已经是 4 帧了，要补齐。</li>
    <li><strong>侧面的头部单图</strong>（可选）—— 有了它侧面姿势也能点头摇头。现在侧面直接抛错。</li>
  </ol>
  <p class="note" style="margin-top:10px">已交付：<s>点头／摇头要「头单独一层」的导出</s> —— 2026-09-08 补了 <code>头部.svg</code>。</p>
</section>



</div>
</div>

<footer>由 <code>node gao-2d/index.mjs</code> 生成　·　${new Date().toISOString().slice(0, 10)}</footer>

<script>
// 左侧目录跟着滚动高亮。用 IntersectionObserver，不用 scroll 事件 —— 后者要自己算阈值还抖。
// rootMargin 把「命中区」压成视口中间那一条，不然一屏里两三节同时算命中，高亮会跳。
const items = [...document.querySelectorAll('.nav-item')];
const map = new Map(items.map((a) => [a.getAttribute('href').slice(1), a]));
const io = new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    for (const it of items) it.classList.remove('active');
    const a = map.get(e.target.id);
    if (!a) continue;
    a.classList.add('active');
    a.closest('details')?.setAttribute('open', '');  // 滚到收起的组里，替它展开
  }
}, { rootMargin: '-20% 0px -70% 0px' });
for (const s of document.querySelectorAll('section[id]')) io.observe(s);
</script>
</html>
`;

fs.writeFileSync(path.join(OUT, 'index.html'), html);
const 图数 = fs.readdirSync(IMG).length;
console.log(`页面 → projects/高总/index.html　（${(html.length / 1024).toFixed(0)}KB）`);
console.log(`图　 → projects/高总/_图/　（${图数} 张${FORCE ? '，全部重渲' : '，已有的复用；要重渲加 --force'}）`);

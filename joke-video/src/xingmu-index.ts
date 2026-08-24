// ── 醒木不响 · 一页看完：成片 / 类型 / 发布状态 / 发布文案 / 档期 ─────────
//
// 用法：npm run deliver          收交付包，顺带出这张页
//      npm run xingmu:index     只出页，不动交付包
//
// 产物：`projects/醒木不响/index.html`（双击打开）
//
// ── 它不是第二本账 ──
//
// 这一条是这个仓库反复写过的：**目录树本身就是账本，没有第二张表。**
// 所以这张页**一个字段都不自己存**，全部现算：
//
//   成片 / 封面 / 字幕   ← 交付包里的文件（`_待发` / `_已发` 下面）
//   发布状态             ← 它在 `_待发` 还是 `_已发`，**只看它在哪个文件夹**
//   视频类型             ← 包名第三段（`parseDir().line`）＋ 文件名后缀认版本
//   发布文案             ← 包里的 `发布文案.md`，现读现解析
//   档期                 ← `schedule.ts` 的 `upcoming()`，跟 `npm run schedule` 同一份数据
//   项目目录             ← 包里的 `来源.txt`
//
// 删掉重跑一次就回来了。**页面里出现的任何东西，别指望改它能改到源头** ——
// 要改内容改 `发布.json` 重跑 `publish`，要改排期给项目目录改前缀。
//
// ⚠ **整棵 `projects/醒木不响/` 都在 .gitignore 里**，这张页也不例外：
// 它是本地产物，跟包里那些硬链接一样，`npm run deliver` 随时重建。

import { readdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { OUT_ROOT } from './paths.js';
import { parseDir, upcoming, LINES } from './schedule.js';
import { page, navPanel } from './preview.js';
import { shelves as topicShelves } from './topic-library.js';

const ROOT = `${OUT_ROOT}/醒木不响`;
const BOX = { 待发: `${ROOT}/_待发`, 已发: `${ROOT}/_已发` } as const;
type Status = keyof typeof BOX;

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((d) => statSync(`${p}/${d}`).isDirectory()) : []);
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

/** 片长。**去量文件，不拿音频时长加片头算** —— 后者跟成品差几秒（治愈线踩过） */
function seconds(file: string): number | undefined {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  const n = Number(String(r.stdout ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 版本从**文件名后缀**认，不从别处猜。
 *
 * 三版并存、文件名各不相同（见治愈系出片方案「字幕：可以烧」）：
 * 不带后缀 = 常规版，`_文字版` = 正文逐句上浮，`_烧字幕` = 字幕烧进画面。
 * 一期不一定三版都出。
 */
function versionOf(stem: string): { name: string; note: string } {
  if (stem.endsWith('_文字版')) return { name: '文字版', note: '正文逐句上浮，静音也能看。别再开平台软字幕' };
  if (stem.endsWith('_烧字幕')) return { name: '烧字幕版', note: '字幕烧进画面。别再开平台软字幕' };
  return { name: '常规版', note: '屏上只有画面，字幕走平台软字幕（.srt 另出）' };
}

/**
 * 从 `发布文案.md` 里抠出三块代码块：标题 / 简介 / 关键字。
 *
 * **那份是复制源**（zhiyu-publish 的原话），所以这儿也照原样端出来给人整块复制，
 * 不重新排版、不摘要 —— 一摘要就成了「分析报告」，那正是那份文档明令不要的东西。
 *
 * ── 两种结构，都要认 ──
 *
 *   治愈 / 禅佛典   `## 上篇 · 三米见方` → `### 标题` / `### 简介` / `### 关键字`
 *   说书            没有分篇那一层，直接 `## 标题` / `## 简介` / `## 关键字`
 *
 * **一本多期的那种，一份文案里有好几段。** 第一版只抓第一处 `### 标题`，
 * 结果 `hojoki_下` 那个包显示的是上篇的标题 —— 不报错，就是错的，
 * 而且照着这张页去传片的人会把上篇的简介贴到下篇底下。所以要按篇挑。
 *
 * @param part 哪一篇（`全` / `上` / `下`）。说书没有这一层，传 undefined
 */
function copySource(
  md: string,
  part?: string
): { title?: string; intro?: string; tags?: string; heading?: string; topic?: string } {
  /**
   * 标题行里带某个词的那一节，取节内**最后一个**围栏块。
   *
   * 「最后一个」是为老版式准备的：说书 E01/E02 的 `## 二、内容简介` 底下有两块，
   * 「前两行」在前、「完整版」在后 —— 要的是完整版。
   * 新版式一节只有一块，取最后一个也就是取那一块。
   *
   * **按「标题行含不含这个词」找，不按精确标题找。** 仓库里已经有三种写法：
   * `### 标题`（治愈/禅佛典）、`## 标题`（说书 E03 起）、`## 一、标题`（说书 E01/E02）。
   * 写死其中一种，另外两种就会安静地显示「没有发布文案」——
   * **而那几个包里明明有**，只是这张页没认出来。
   */
  const fenced = (scope: string, ...keys: string[]): string | undefined => {
    const lines = scope.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const h = /^(#{2,6})\s+(.*)$/.exec(lines[i]);
      if (!h || !keys.some((k) => h[2].includes(k))) continue;
      // 收到下一个同级或更高级的标题为止（子标题算在这一节里）
      let j = i + 1;
      for (; j < lines.length; j++) {
        const nx = /^(#{2,6})\s+/.exec(lines[j]);
        if (nx && nx[1].length <= h[1].length) break;
      }
      const blocks = [...lines.slice(i + 1, j).join('\n').matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)];
      if (blocks.length) return blocks[blocks.length - 1][1];
    }
    return undefined;
  };

  // 一本多期的，一份文案里有好几段。带「标题」那一节的 `## …` 就是一篇；
  // `## 文件` `## 发片前核对` 不带，自动排除。
  //
  // **切的时候把 `## ` 留在每一段前面**（零宽前瞻，不是 `split('## ')`）——
  // 削掉的话，说书那种「标题就是顶级标题」的版式，段首那行就没有 `##` 了，
  // `fenced()` 认不出它是标题，整段解析不出来。治愈那种（标题在 `###` 一层）反而看不出问题。
  //
  // **判据是「这一节里标题和简介都有」，不是「有标题」。** 说书那种版式里
  // `## 标题` `## 简介` `## 关键字` 是三个平级的节，各只装一样 ——
  // 按「有标题」挑，会挑中那个只装标题的节，然后把简介和关键字锁在视野外面
  // （页面上就是「有标题、没简介」，而文件里明明有）。真正的「一篇」是自足的那一整块。
  const chunks = md
    .split(/^(?=## )/m)
    .filter((c) => /^## /.test(c) && fenced(c, '标题') !== undefined && fenced(c, '简介') !== undefined);

  let scope = md;
  if (chunks.length === 1) {
    scope = chunks[0];
  } else if (chunks.length > 1) {
    // **按篇名挑**：`## 上篇 · 春与夏` 这种。挑不中就退回第一段，但那多半是数据不对，要说出来
    const head = (c: string) => c.split('\n')[0].replace(/^##\s+/, '');
    const hit = part && chunks.find((c) => head(c).startsWith(`${part}篇`) || head(c).includes(part));
    if (hit) scope = hit;
    else {
      scope = chunks[0];
      console.warn(`! 发布文案里有 ${chunks.length} 篇，按「${part ?? '（没有篇名）'}」挑不中，退回第一篇`);
    }
  }

  const title = fenced(scope, '标题');
  return {
    title,
    intro: fenced(scope, '简介'),
    tags: fenced(scope, '关键字', '标签'),
    /** 这一篇叫什么。`## 第一期 · 痴人夜行` 那一行；说书没有分篇，就是 undefined */
    heading: chunks.length ? scope.split('\n')[0].replace(/^##\s+/, '').trim() : undefined,
    /**
     * 这一期讲的是什么 —— **优先用说破句**（`中心思想` 那一块）。
     *
     * 那一句本来就是「讲完这个故事才说得出来的一句话」，拿它当话题最准，
     * 而且它跟标题、简介是同一件事的三种说法（发片前要拿它对一遍）。
     *
     * 有几期没有这一块（说破 2026-08-21 才进治愈线，说书 E01–E03 也在那之前），
     * 退回标题里**最长的那一段**。
     *
     * ⚠ **不是第一段。** 标题是 `｜` 分的三段，钩子在哪一段两条线不一样：
     *
     *   治愈  `他半夜划船去看雪，船夫说他痴｜《陶庵梦忆》第一期·痴人夜行｜深夜助眠`  ← 第一段
     *   说书  `聊斋志异·画皮｜他明知她是鬼，还是带她回家`                        ← 第二段
     *
     * 按第一段取，说书那几期的话题就成了「聊斋志异·画皮」—— 那是书名不是话题。
     * 钩子总是写得最长的那一段（书名和「深夜助眠」这类档位标签都短），按长度挑两边都对。
     */
    topic:
      fenced(scope, '中心思想', '说破句') ??
      title
        ?.split('｜')
        .map((s) => s.trim())
        .sort((a, b) => b.length - a.length)[0],
  };
}

/** 发片前那张人工核对表，只数一下有几条 —— 内容在发布文案里，这儿不重复 */
const checkCount = (md: string) => (md.match(/^- \[ \] /gm) ?? []).length;

interface Item {
  status: Status;
  pack: string;
  line: string;
  slug: string;
  date?: string;
  time?: string;
  version: { name: string; note: string };
  film?: string;
  cover?: string;
  srt?: string;
  sec?: number;
  bytes?: number;
  copy: ReturnType<typeof copySource>;
  checks: number;
  proj?: string;
}

function collect(): Item[] {
  const out: Item[] = [];
  for (const status of Object.keys(BOX) as Status[]) {
    for (const pack of dirs(BOX[status])) {
      const dir = `${BOX[status]}/${pack}`;
      const files = readdirSync(dir);
      const film = files.find((f) => f.endsWith('.mp4'));
      const p = parseDir(pack);
      // 未排期的包名是 `未排期_<线>_<名字>`，拆不出档期，但线名还在第二段
      const loose = /^未排期_([^_]+)_(.+)$/.exec(pack);
      const stem = film ? film.replace(/\.mp4$/, '') : (p?.slug ?? pack);
      const md = existsSync(`${dir}/发布文案.md`) ? readFileSync(`${dir}/发布文案.md`, 'utf8') : '';
      const src = existsSync(`${dir}/来源.txt`) ? readFileSync(`${dir}/来源.txt`, 'utf8') : '';
      const proj = /项目目录：(.+)/.exec(src)?.[1]?.trim();
      // 哪一篇（全 / 上 / 下）。治愈线的成片名是 `<项目目录名>_<篇>[_变体]`，
      // 多出来的第一段就是篇名；说书的成片名只有身份（`婴宁-E05`），没有这一层
      const projName = proj ? proj.split(/[\\/]/).pop()! : '';
      const part =
        projName && stem.startsWith(projName)
          ? stem.slice(projName.length).split('_').filter(Boolean)[0]
          : undefined;
      out.push({
        status,
        pack,
        line: p?.line ?? loose?.[1] ?? '—',
        slug: p?.slug ?? loose?.[2] ?? pack,
        date: p?.date,
        time: p?.time.replace(/(\d\d)(\d\d)/, '$1:$2'),
        version: versionOf(stem),
        film,
        cover: files.find((f) => f === '封面-横版1280.png'),
        srt: files.find((f) => f.endsWith('.srt')),
        sec: film ? seconds(`${dir}/${film}`) : undefined,
        bytes: film ? statSync(`${dir}/${film}`).size : undefined,
        copy: copySource(md, part),
        checks: checkCount(md),
        proj,
      });
    }
  }
  // 待发在前、已发在后。
  //
  // **待发按包名排** —— `_待发` 那条规矩就是「按名字排就是上传顺序」。
  // **已发按发布日倒着排**，新的在上面。
  //
  // ⚠ 已发这一组**不能按包名倒排**：`未排期_…` 里的「未」在 `2026-…` 后面，
  // 倒过来就跑到最前面，把真正最新的那一期（`2026-08-25_…婴宁-E05`）挤到最底下 ——
  // 组标写着「新的在上面」，而它在最下面。没有日期的排在最后，那才是「不知道什么时候发的」。
  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === '待发' ? -1 : 1;
    if (a.status === '待发') return a.pack.localeCompare(b.pack);
    if (a.date !== b.date) return (b.date ?? '').localeCompare(a.date ?? '');
    return a.pack.localeCompare(b.pack);
  });
}

const CSS = `
/* ── 醒木不响这一页自己的样式。骨架在 preview.ts 的 page() ── */
.ep { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:20px 22px; margin-bottom:22px; scroll-margin-top:24px; }
.ep-head { display:flex; flex-wrap:wrap; gap:10px 14px; align-items:baseline;
  border-bottom:1px solid var(--line); padding-bottom:12px; margin-bottom:16px; }
.ep-head h2 { margin:0; font-size:19px; }
.chip { font-size:11px; font-weight:700; padding:2px 9px; border-radius:20px;
  background:var(--line); color:var(--dim); white-space:nowrap; }
.chip.line { background:var(--accent); color:#fff; }
.chip.pend { background:var(--gold); color:#3a2c07; }
.chip.done { background:transparent; color:var(--dim); border:1px solid var(--line); }
.chip.ver  { background:transparent; color:var(--accent); border:1px solid var(--accent); }
.ep-slot { margin-left:auto; color:var(--dim); font-size:13px; font-variant-numeric:tabular-nums; }
.ep-body { display:grid; grid-template-columns:minmax(0,420px) minmax(0,1fr); gap:22px; align-items:start; }
@media (max-width:860px) { .ep-body { grid-template-columns:minmax(0,1fr); } }
.ep-body video, .ep-body img.cover { width:100%; border-radius:10px; border:1px solid var(--line);
  background:#000; display:block; }
.ep-files { margin-top:8px; color:var(--dim); font-size:12px; display:flex; flex-wrap:wrap; gap:4px 12px; }
.ep-files a { color:var(--accent); }
.ep-note { color:var(--dim); font-size:12px; margin-top:6px; }
/* 发布文案：**整块可选中复制**，跟 发布文案.md 里那三个代码块一一对应 */
.pub h4 { margin:0 0 6px; font-size:12px; color:var(--dim); font-weight:700; letter-spacing:.5px; }
.pub section { margin-bottom:14px; }
.pub pre { margin:0; padding:11px 13px; background:rgba(127,127,127,.08);
  border:1px solid var(--line); border-radius:8px; font:12px/1.65 ui-monospace,Consolas,monospace;
  white-space:pre-wrap; word-break:break-word; max-height:230px; overflow:auto; }
.pub .title-line { font:700 16px/1.4 inherit; white-space:pre-wrap; }
/* ── 左边目录：条目是横版封面，跟段子画廊那个竖版缩略图不是一个比例 ── */
.nav-thumb.wide { width:58px; height:33px; }
.nav-line { font-size:11px; color:var(--accent); }
.nav-st { font-size:10px; font-weight:700; padding:0 5px; border-radius:8px;
  background:var(--line); color:var(--dim); margin-left:5px; vertical-align:1px; }
.nav-st.pend { background:var(--gold); color:#3a2c07; }
.side-sep { font-size:11px; font-weight:700; color:var(--dim); letter-spacing:1px;
  padding:10px 8px 4px; border-top:1px solid var(--line); margin-top:6px; }
/* ── 档期表 ── */
/* 折叠用原生 <details>：不写一行 JS，键盘和搜索页内文字都照常работа */
details.fold > summary { cursor:pointer; list-style:none; display:flex; flex-wrap:wrap;
  gap:10px 14px; align-items:baseline; }
details.fold > summary::-webkit-details-marker { display:none; }
details.fold > summary::before { content:'▾'; color:var(--dim); font-size:13px;
  transition:transform .15s; display:inline-block; }
details.fold:not([open]) > summary::before { transform:rotate(-90deg); }
details.fold > summary h2 { margin:0; font-size:19px; }
details.fold > summary:hover h2 { color:var(--accent); }
.fold-body { border-top:1px solid var(--line); padding-top:14px; margin-top:12px; }
table.slots { border-collapse:collapse; width:100%; font-size:13px; margin-bottom:10px; }
table.slots th, table.slots td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
table.slots th { color:var(--dim); font-size:12px; font-weight:600; }
table.slots td.d { font-variant-numeric:tabular-nums; white-space:nowrap; }
table.slots tr.free td { color:var(--dim); }
table.slots tr.cross td.who { color:var(--hot); }
table.slots tr.used td { color:var(--dim); }
table.slots tr.used b { font-weight:400; }
.stat { display:flex; flex-wrap:wrap; gap:8px 22px; margin:0 0 26px; color:var(--dim); font-size:13px; }
.stat b { color:var(--ink); font-size:15px; }
`;

function epCard(it: Item, i: number): string {
  const rel = `_${it.status}/${encodeURI(it.pack)}`;
  const media = it.film
    ? `<video controls preload="none"${it.cover ? ` poster="${rel}/${encodeURI(it.cover)}"` : ''} src="${rel}/${encodeURI(it.film)}"></video>`
    : it.cover
      ? `<img class="cover" src="${rel}/${encodeURI(it.cover)}" alt="">`
      : `<div class="ep-note">这个包里没有成片</div>`;

  const files = [
    it.film && `<a href="${rel}/${encodeURI(it.film)}">成片</a>　${it.sec ? mmss(it.sec) : '—'}　${it.bytes ? mb(it.bytes) : ''}`,
    it.srt && `<a href="${rel}/${encodeURI(it.srt)}">字幕 .srt</a>`,
    it.cover && `<a href="${rel}/${encodeURI(it.cover)}">封面</a>`,
    `<a href="${rel}/%E5%8F%91%E5%B8%83%E6%96%87%E6%A1%88.md">发布文案.md</a>`,
    it.checks ? `发片前核对 ${it.checks} 条` : '',
  ].filter(Boolean);

  const blk = (h: string, v: string | undefined, cls = '') =>
    v ? `<section><h4>${h}</h4><pre class="${cls}">${esc(v)}</pre></section>` : '';

  return `<section class="ep" id="ep${i}">
  <div class="ep-head">
    <h2>${esc(it.slug)}</h2>
    <span class="chip line">${esc(it.line)}</span>
    <span class="chip ver">${esc(it.version.name)}</span>
    <span class="chip ${it.status === '待发' ? 'pend' : 'done'}">${it.status === '待发' ? '待发' : '已发'}</span>
    <span class="ep-slot">${it.date ? `${it.date} ${it.time} JST` : '未排期'}</span>
  </div>
  <div class="ep-body">
    <div>
      ${media}
      <div class="ep-files">${files.join('　·　')}</div>
      <div class="ep-note">${esc(it.version.note)}</div>
      ${it.proj ? `<div class="ep-note">项目目录：<code>${esc(it.proj)}</code></div>` : ''}
    </div>
    <div class="pub">
      ${blk('标题', it.copy.title, 'title-line')}
      ${blk('简介', it.copy.intro)}
      ${blk('关键字', it.copy.tags)}
      ${it.copy.title ? '' : '<div class="ep-note">这个包里没有发布文案 —— 跑一次 <code>zhiyu-publish</code> 或 <code>shuoshu:ship</code></div>'}
    </div>
  </div>
</section>`;
}

/** 侧栏一条 */
function navEntry(it: Item, i: number): string {
  const rel = `_${it.status}/${encodeURI(it.pack)}`;
  const thumb = it.cover
    ? `<img class="nav-thumb wide" src="${rel}/${encodeURI(it.cover)}" alt="" loading="lazy">`
    : `<span class="nav-thumb wide ph"></span>`;
  return `<a class="nav-item" href="#ep${i}" data-target="ep${i}">
  ${thumb}
  <span class="nav-body">
    <span class="nav-title"><span class="nav-num">${i + 1}</span>${esc(it.slug)}</span>
    <span class="nav-line">${esc(it.line)} · ${esc(it.version.name)}<span class="nav-st ${it.status === '待发' ? 'pend' : ''}">${it.status}</span></span>
    <span class="nav-date">${it.date ? `${it.date} ${it.time}` : '未排期'}${it.sec ? `　${mmss(it.sec)}` : ''}</span>
  </span>
</a>`;
}

/**
 * 「话题」那一栏：**按类型分组，一期一行**。
 *
 * ⚠ **一期 ≠ 一个包。** 同一期出了常规版和文字版就是两个包（那是两次上传），
 * 但话题只有一个。所以这儿按「项目目录 + 哪一篇」去重，版本收成一排小标签 ——
 * 一期占两行的话，这张表就从「频道讲过什么」变成「传过几个文件」，那是上面那张表的活。
 */
function topicTable(items: Item[]): string {
  const eps = new Map<string, { line: string; name: string; topic?: string; date?: string; vers: string[]; anchor: number }>();
  items.forEach((it, i) => {
    const key = `${it.line}|${it.proj ?? it.pack}|${it.copy.heading ?? ''}`;
    const cur = eps.get(key);
    if (cur) {
      if (!cur.vers.includes(it.version.name)) cur.vers.push(it.version.name);
      return;
    }
    eps.set(key, {
      line: it.line,
      name: it.copy.heading ? `${it.slug.replace(/_.*$/, '')}　${it.copy.heading}` : it.slug,
      topic: it.copy.topic,
      date: it.date,
      vers: [it.version.name],
      anchor: i,
    });
  });

  const byLine = new Map<string, typeof eps extends Map<string, infer V> ? V[] : never>();
  for (const e of eps.values()) byLine.set(e.line, [...(byLine.get(e.line) ?? []), e]);

  const blocks = [...byLine]
    .map(([line, list]) => {
      const rows = list
        .map(
          (e) => `<tr>
      <td class="d">${e.date ?? '<span style="color:var(--dim)">未排期</span>'}</td>
      <td><a href="#ep${e.anchor}">${esc(e.name)}</a><br><span class="nav-line">${e.vers.map(esc).join(' · ')}</span></td>
      <td>${e.topic ? esc(e.topic) : '<span style="color:var(--dim)">这一期的发布文案里没有说破句</span>'}</td></tr>`
        )
        .join('\n');
      return `<h4 style="margin:18px 0 8px;font-size:13px;color:var(--dim)">${esc(line)}　<span style="font-weight:400">${list.length} 期</span></h4>
    <table class="slots topics"><thead><tr><th>档</th><th>哪一期</th><th>话题（说破句）</th></tr></thead><tbody>
${rows}
    </tbody></table>`;
    })
    .join('\n');

  return `<section class="ep" id="topics">
  <details class="fold" open>
    <summary><h2>话题</h2><span class="chip">${eps.size} 期</span><span class="ep-slot">按类型分，一期一行</span></summary>
    <div class="fold-body">
      <p class="ep-note"><b>话题取的是「中心思想」那一句</b> —— 说破句，讲完这个故事才说得出来的那一句。
      它跟标题、简介是同一件事的三种说法（发片前本来就要拿它对一遍，三样对不上就是标题超发）。
      老几期没有这一块的，退回标题 <code>｜</code> 前那半。</p>
${blocks}
    </div>
  </details>
</section>`;
}

/**
 * 「稿件库」那一栏：**每条线还有哪些选题没做。**
 *
 * 上面那两栏（档期、话题）回答的是「做过什么」，这一栏回答「还能做什么」——
 * 数据源也因此完全不同：那两栏读交付包，这一栏读各条线自己的选题文档
 * （见 `topic-library.ts`）。
 *
 * 「做没做过」是**猜的，不是记的**：拿选题的名字去已出片那堆里找（篇名、标题、
 * 说破句拼成的那一串）。所以标的是「已出」而不是「已完成」——
 * 没有第二本账来记这件事，也不该有。
 */
function libraryTable(hay: string): string {
  const { shelves, problems } = topicShelves();

  const blocks = shelves
    .map((sh) => {
      const rows = sh.items
        .map((t) => {
          const done = t.name.length >= 2 && hay.includes(t.name);
          return `<tr class="${done ? 'used' : ''}">
      <td class="d">${esc(t.no || t.group?.replace(/（.*/, '') || '')}</td>
      <td><b>${esc(t.name)}</b>${t.sub ? `<br><span class="nav-line">${esc(t.sub)}</span>` : ''}</td>
      <td>${esc(t.note ?? '')}</td>
      <td class="d">${esc(t.src ?? '')}</td>
      <td class="d">${done ? '<span class="chip done">已出</span>' : '<span class="chip pend">备选</span>'}</td></tr>`;
        })
        .join('\n');
      const left = sh.items.filter((t) => !(t.name.length >= 2 && hay.includes(t.name))).length;
      return `<h4 style="margin:20px 0 6px;font-size:13px;color:var(--dim)">${esc(sh.line)} · ${esc(sh.title)}　<span style="font-weight:400">${sh.items.length} 条，还剩 <b style="color:var(--ink)">${left}</b> 条没做</span></h4>
    <p class="ep-note" style="margin:0 0 8px">${sh.note ?? ''}　<code>${esc(sh.doc)}</code></p>
    <table class="slots"><thead><tr><th>期/组</th><th>选题</th><th>${esc(sh.topicName)}</th><th>出处</th><th></th></tr></thead><tbody>
${rows}
    </tbody></table>`;
    })
    .join('\n');

  const total = shelves.reduce((n, s) => n + s.items.length, 0);
  const left = shelves.reduce((n, s) => n + s.items.filter((t) => !(t.name.length >= 2 && hay.includes(t.name))).length, 0);

  return `<section class="ep" id="library">
  <details class="fold">
    <summary><h2>稿件库</h2><span class="chip">${total} 条选题</span><span class="ep-slot">还剩 ${left} 条没做</span></summary>
    <div class="fold-body">
      <p class="ep-note"><b>这一栏回答「还能做什么」</b>，上面两栏回答「做过什么」。
      数据现读各条线的选题文档，<b>这张页不存选题</b> —— 要加选题去改那份 md，重跑一次就跟上。
      「已出」是拿选题名字去已出片那堆里找出来的<b>提示，不是账</b>。</p>
      ${problems.map((p) => `<p class="ep-note" style="color:var(--hot)">! ${esc(p)}</p>`).join('\n')}
${blocks}
    </div>
  </details>
</section>`;
}

function slotTable(weeks: number): string {
  const slots = upcoming(weeks);
  // 折叠起来的时候只看得见 summary 那一行，所以那一行要自带信息：
  // 排满了几档、下一个空档是哪天。不然收起来等于把这块内容藏了
  const free = slots.filter((s) => !s.by);
  const next = free[0];
  const digest =
    `${slots.length - free.length}/${slots.length} 档排上了` +
    (next ? `　·　下一个空档 ${next.date} 周${next.wd} ${next.line}` : '　·　全排满了');

  const rows = slots
    .map((s) => {
      const cross = s.by && s.by.line !== s.line;
      const who = s.by
        ? `${esc(s.by.slug)}${cross ? `　<b>← ${esc(s.by.line)}线占了这一档</b>` : ''}`
        : '—— 空';
      return `<tr class="${s.by ? (cross ? 'cross' : '') : 'free'}">
    <td class="d">${s.date}　周${s.wd}　${s.time}</td><td>${esc(s.line)}</td><td class="who">${who}</td></tr>`;
    })
    .join('\n');
  const table = Object.entries(LINES)
    .map(([line, s]) =>
      `${esc(line)}：${s.scheduled ? s.weekdays.map((w) => `周${'日一二三四五六'[w]} ${s.times[w].replace(/(\d\d)(\d\d)/, '$1:$2')}`).join('　') : '（不单独占档）'}${s.note ? `　—— ${esc(s.note)}` : ''}`
    )
    .join('<br>');
  // `<details open>`：**默认展开**（这一块本来就是要「展示排期安排」的），
  // 但收得起来 —— 二十行表格压在最上面，往下看片子要滚很久。
  // 用原生 details 不是自己写 JS：键盘能操作，浏览器页内查找也能把收起来的内容翻出来。
  return `<section class="ep" id="slots">
  <details class="fold" open>
    <summary><h2>档期</h2><span class="chip">往后 ${weeks} 周</span><span class="ep-slot">${esc(digest)}</span></summary>
    <div class="fold-body">
      <p class="ep-note">${table}</p>
      <p class="ep-note"><b>一档只发一条，但不限定哪条线</b> —— 谁的片子都能占任意一档，占了别人档的会标出来。
      改排期改 <code>joke-video/src/schedule.ts</code> 的 <code>LINES</code>；
      给某一期排期是<b>给项目目录改前缀</b>，不是在这儿改。</p>
      <table class="slots"><thead><tr><th>档</th><th>归哪条线</th><th>谁占着</th></tr></thead><tbody>
${rows}
      </tbody></table>
    </div>
  </details>
</section>`;
}

export function writeIndex(weeks = 4): string {
  const items = collect();
  const pend = items.filter((i) => i.status === '待发');
  const done = items.filter((i) => i.status === '已发');
  // 「做没做过」拿这一串去找：篇名、标题、说破句、篇名小标都在里面
  const hay = items.map((i) => [i.slug, i.copy.title, i.copy.topic, i.copy.heading].filter(Boolean).join(" ")).join(" ");
  const byLine = new Map<string, number>();
  for (const i of items) byLine.set(i.line, (byLine.get(i.line) ?? 0) + 1);

  const stat = `<p class="stat">
  <span><b>${items.length}</b> 个包</span>
  <span>待发 <b>${pend.length}</b></span>
  <span>已发 <b>${done.length}</b></span>
  ${[...byLine].map(([l, n]) => `<span>${esc(l)} <b>${n}</b></span>`).join('\n  ')}
</p>`;

  const group = (title: string, note: string, list: Item[], offset: number) =>
    list.length
      ? `<h3 style="font-size:15px;margin:28px 0 14px">${title}<span style="color:var(--dim);font-weight:400">　${note}</span></h3>\n` +
        list.map((it, k) => epCard(it, offset + k)).join('\n')
      : '';

  const body = `<h1>醒木不响 · 成片总览</h1>
<p class="sub">交付包 / 视频类型 / 发布状态 / 发布文案 / 档期 —— <b>全部现算</b>，
数据源是目录树和 <code>发布.json</code>，这张页不自己存任何东西。<code>npm run deliver</code> 重建。</p>
${stat}
${slotTable(weeks)}
${topicTable(items)}
${libraryTable(hay)}
${group('待发', '按名字排就是上传顺序。发完把整个包挪进 <code>_已发</code>', pend, 0)}
${group('已发', '新的在上面', done, pend.length)}
${items.length ? '' : '<div class="ep"><p class="ep-note">一个交付包都没有 —— 先跑 <code>npm run deliver</code></p></div>'}`;

  // 左边目录：档期一条钉在最上面，然后待发、已发各一组。
  // 分组之间插一条小标，不然十九条片子连成一片，看不出哪儿是分界
  const nav = [
    `<a class="nav-item" href="#slots" data-target="slots">
  <span class="nav-thumb wide ph"></span>
  <span class="nav-body"><span class="nav-title">档期</span><span class="nav-date">往后 ${weeks} 周</span></span>
</a>`,
    `<a class="nav-item" href="#topics" data-target="topics">
  <span class="nav-thumb wide ph"></span>
  <span class="nav-body"><span class="nav-title">话题</span><span class="nav-date">按类型分，一期一行</span></span>
</a>`,
    `<a class="nav-item" href="#library" data-target="library">
  <span class="nav-thumb wide ph"></span>
  <span class="nav-body"><span class="nav-title">稿件库</span><span class="nav-date">还有哪些选题没做</span></span>
</a>`,
    ...(pend.length ? [`<div class="side-sep">待发 ${pend.length}</div>`] : []),
    ...pend.map((it, k) => navEntry(it, k)),
    ...(done.length ? [`<div class="side-sep">已发 ${done.length}</div>`] : []),
    ...done.map((it, k) => navEntry(it, pend.length + k)),
  ];

  const out = `${ROOT}/index.html`;
  writeFileSync(out, page('醒木不响 · 成片总览', body, navPanel(nav, '片子'), CSS));
  return out;
}

if (process.argv[1]?.includes('xingmu-index')) {
  const i = process.argv.indexOf('--weeks');
  const out = writeIndex(i >= 0 ? Number(process.argv[i + 1]) : 4);
  console.log(`→ ${out}　双击打开`);
}

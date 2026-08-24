// ── 稿件预览页：场景图 + 对话内容 + 分析，按稿件分组 ──────────────────
//
// 拿到新稿件后跑 `npm run preview -- jokes/<id>.json`，会在
// projects/段子与儿童故事/<日期>_<id>/ 下生成：
//
//   stills/            每句台词一张场景图，外加开场/定格/钩子
//   方案.md            落地方案：分镜表 / 场景角色 / 发布文案
//                      带 AUTO 标记的区块每次重写，其余部分人写的原样保留
//   index.html         把上面两样和对话内容拼成一页
//
// 跑 `npm run preview` 不带参数则汇总所有稿件到 projects/段子与儿童故事/index.html。
// 页面是纯静态的，直接双击打开，不依赖任何外部资源。

import { OUT_JOKE, OUT_LAOMA } from './paths.js';
// 栏目从场景反查（每个场景在 horse/scenes.mjs 里声明了自己属于哪个栏目）
import { SCENES as HORSE_SCENE_TABLE } from '../horse/scenes.mjs';
import { emote, SYMBOLS as EMOTE_SYMBOLS } from '../horse/emote.mjs';
import { MARKS, mark as markSvg } from '../horse/marks.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import { FPS } from './config.js';
import { buildTimeline, openSpan } from './beats/typeA.js';
import { renderFrame, type RenderCtx, type VoiceTrack } from './render.js';
import { svgToPng } from './video.js';
import { resolveLineVoice } from './tts.js';
import { isIdentity } from './audio/morph.js';
import { dayNo, lineText, subtitleText, type JokeCfg, type Segment } from './types.js';
import { ensurePlan } from './plan.js';
import { makeInk } from './style/palette.js';
import { SCENE_NAMES, getScene } from './scenes/index.js';
import { ROSTER } from './roster.js';

const BEAT_LABEL: Record<string, string> = {
  setup: '铺垫',
  ask: '提问',
  reply: '回应',
  punch: '反转 · 笑点',
};

export interface PreviewShot {
  file: string;
  at: number;
  label: string;
  /** 对应第几句台词，非台词镜头为 null */
  lineIndex: number | null;
}

/**
 * 发片信息：**标题、关键词、排期时刻**，摆在成片旁边。
 *
 * ── 为什么要摆在旁边 ──
 *
 * 预览页原来只有画面和台词，发布那头的东西全在 `发布文案.md` 里 ——
 * 而审片时真正要一起看的正是这两样：**这条片子长这样，它顶着的标题是这个**。
 * 分在两处的结果是，标题从来没在成片旁边被看过一眼。
 *
 * ⚠ **只读，不生成。** 文案的唯一出处仍是 `发布文案.md`（`yiye-publish.ts` 生成）——
 * 这儿把它抠出来显示，**不做第二份**。抠不到就不显示那一栏，不猜、不兜底。
 */
export interface PublishInfo {
  title?: string;
  sub?: string;
  tags?: string;
  /** `_待发` / `_已发` */
  bucket?: string;
  /** 目录名前缀里那个时刻，例：2026-09-06 21:00 JST */
  slot?: string;
  /** 各平台时刻，从 publish.json 来 */
  platforms?: Array<[string, string]>;
}

/** 抠出 `## 标题` 那类小节里第一个代码块的内容 */
function blockAfter(md: string, head: string): string | undefined {
  const re = new RegExp("^## " + head + "\\s*$[\\s\\S]*?" + "```" + "\\n([\\s\\S]*?)" + "```", "m");
  return md.match(re)?.[1].trim();
}

export function readPublishInfo(dir: string): PublishInfo {
  const out: PublishInfo = {};
  const md = dir + "/发布文案.md";
  if (existsSync(md)) {
    const t = readFileSync(md, "utf8");
    out.title = blockAfter(t, "标题");
    out.sub = blockAfter(t, "副标题");
    out.tags = blockAfter(t, "关键词与标签");
  }
  // 排期：目录名前缀 ＋ publish.json
  const name = basename(dir);
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})JST_/.exec(name);
  if (m) out.slot = m[1] + " " + m[2] + ":" + m[3] + " JST";
  else if (/^未排期_/.test(name)) out.slot = "未排期";
  const b = /[/\\](_待发|_已发)[/\\]/.exec(dir.replace(/\\/g, "/"));
  if (b) out.bucket = b[1];
  const pj = dir + "/publish.json";
  if (existsSync(pj)) {
    try {
      const j = JSON.parse(readFileSync(pj, "utf8")) as { platforms?: Record<string, { at?: string }> };
      const ps = Object.entries(j.platforms ?? {})
        .filter(([, v]) => v?.at)
        .map(([k, v]) => [k, String(v.at)] as [string, string]);
      if (ps.length) out.platforms = ps;
    } catch {
      /* 坏 json 就当没有 —— 预览页不该因为一个字段打不开 */
    }
  }
  return out;
}
/** 这一条是不是老马线。判据跟 `cover.ts`、`yiye-publish.ts`、`cli.ts` 的体检闸是同一条 */
export const isLaoma = (cfg: JokeCfg): boolean => !!cfg.characters?.some((c) => c.rig === 'horse');

/** 老马的排期树：`projects/老马/段子/{_待发,_已发}/` */
export const LAOMA_TREE = `${OUT_LAOMA}/段子`;
const BUCKETS = ['_待发', '_已发'] as const;

/**
 * 目录名里那一截**栏目**：工位 / 一个人住 / 众目睽睽 / 回家。
 *
 * ⚠ **从场景反查，不另开一个字段。** 栏目和场景本来就是绑死的
 * （`horse/scenes.mjs` 每个场景都声明了 `column`），再让稿件写一遍
 * 就有了第二个说法 —— 改了场景忘了改栏目，目录名会一直说着旧的那个。
 *
 * 场景不在 horse 那张表里（别的线的场景）就返回空，目录名里那一截跟着省掉。
 */
export const dirColumn = (cfg: JokeCfg): string => HORSE_SCENE_TABLE[cfg.scene]?.column ?? '';

/**
 * 目录名里那一截标题。
 *
 * ⚠ **文件名里不能出现的字要滤掉**（`\/:*?"<>|` 和空格）——
 * 标题是人手写的，迟早会写进一个问号或者冒号，那时候 `mkdir` 在 Windows 上
 * 直接失败，而失败的地方离「你写了个问号」很远。
 *
 * ⚠ **反查不认这一截**（见 `findProjectDir`）：标题是可以改的，
 * 改了标题目录名就变了，**但身份是尾巴上那个天数号**。
 */
export const dirTitle = (cfg: JokeCfg): string =>
  (cfg.cover?.title ?? cfg.id).replace(/[\\/:*?"<>|\s]/g, '').slice(0, 24) || cfg.id;

/**
 * 期次目录名的**身份那一半**：`段子_<栏目>_<稿件内容>_<天数号>`。
 *
 * 完整的目录名是 `<日期>_<时刻>JST_` ＋ 这一半，前缀归排期
 * （`horse/SCHEDULE.md` §二）。**出片的时候还没定发布日**，所以这儿出的是
 * `未排期_` ＋ 这一半。
 *
 * ⚠ **反查只认最后那个天数号**，中间三截都会变。
 */
export const laomaDirName = (cfg: JokeCfg, no: number): string =>
  ['未排期', '段子', dirColumn(cfg), dirTitle(cfg), String(no)].filter(Boolean).join('_');

/**
 * 成品目录。老马走排期树，其余线照旧 `<日期>_<id>`。
 *
 * ⚠ **新建的老马目录叫 `未排期_段子-<天数号>`。**
 * 发布日是排期那头的事，出片的时候还没定 —— **不替人挑一个日期**，
 * 那种日期日后没人记得是谁定的。定了之后 `mv` 成
 * `<日期>_<时刻>JST_段子-<天数号>` 就行（`horse/SCHEDULE.md` §二），
 * 校验会一直提醒还有几条没排期。
 */
export function projectDir(cfg: JokeCfg, date?: string): string {
  if (isLaoma(cfg)) {
    const no = dayNo(cfg);
    if (no === null)
      throw new Error(
        `${cfg.id} 读不出天数号：\`day\` 和收尾卡 \`hook\` 都没有。\n` +
          `天数号是老马这条线的身份（目录名、排期、数字账本都用它），` +
          `不出收尾卡的条目也要写 \`"day": 1848\`（CHANNEL_LAOMA §五之二）。`
      );
    return `${LAOMA_TREE}/_待发/${laomaDirName(cfg, no)}`;
  }
  const d = date ?? new Date().toISOString().slice(0, 10);
  return `${OUT_JOKE}/${d}_${cfg.id}`;
}

/** 已经建过的项目目录（同一条稿子不重复建新目录） */
export function findProjectDir(cfg: JokeCfg): string | null {
  if (isLaoma(cfg)) {
    const no = dayNo(cfg);
    if (no === null) return null;
    // ⚠ **只认尾巴上那个天数号。**
    // 目录名是 `<日期>_<时刻>JST_段子_<名称>_<天数号>` —— 前面三截都会变
    // （改期改前缀、改标题改名称），**只有天数号是身份**。
    // 拿标题去反查的话，改一次标题就找不到自己的目录了，然后建一个新的。
    for (const b of BUCKETS) {
      const dir = `${LAOMA_TREE}/${b}`;
      if (!existsSync(dir)) continue;
      const hit = readdirSync(dir).filter((f) => f.endsWith(`_${no}`)).sort();
      if (hit.length) return `${dir}/${hit[hit.length - 1]}`;
    }
    return null;
  }
  if (!existsSync(OUT_JOKE)) return null;
  const hit = readdirSync(OUT_JOKE)
    .filter((f) => f.endsWith(`_${cfg.id}`))
    .sort();
  return hit.length ? `${OUT_JOKE}/${hit[hit.length - 1]}` : null;
}

// ── 成品文件叫什么 ────────────────────────────────────────────────
//
// **老马的目录名已经带了身份**（`…_段子-1851`），文件名再重复一遍 id 是噪音；
// 而且规范 §2 点名要 `out.mp4` / `thumb.png`。别的线沿用 `<id>` 前缀不动。
//
// ⚠ **要改文件名就改这四个函数**，别在各处拼字符串 —— 上一次拼字符串的结果是
// 「封面在 cover/ 下、预览页找的是根目录」这种只有出片才发现的错。

export const filmFile = (cfg: JokeCfg): string => (isLaoma(cfg) ? 'out.mp4' : `${cfg.id}.mp4`);
export const draftFile = (cfg: JokeCfg): string => (isLaoma(cfg) ? 'draft.mp4' : `${cfg.id}-draft.mp4`);
export const audioFile = (cfg: JokeCfg): string => (isLaoma(cfg) ? 'audio.wav' : `${cfg.id}-audio.wav`);
/** 发布用的那张竖版封面。老马放在目录根上叫 `thumb.png`，别的线在 `cover/` 里 */
export const coverFile = (cfg: JokeCfg): string => (isLaoma(cfg) ? 'thumb.png' : `cover/${cfg.id}-9x16.png`);

/**
 * 出场景图：每句台词一张（取这句的中点），外加开场、定格、钩子。
 * 一句一张是关键——这样场景图和对话内容能一一对上，看页面时
 * 「这句话配的是哪个画面」一眼就知道。
 */
export function renderStills(
  cfg: JokeCfg,
  dir: string,
  voices: Map<number, VoiceTrack>,
  /**
   * 只要元数据、不重渲图。
   * 出片后同步汇总页时，别的稿件的图早就在磁盘上了，没必要为了拼一张 html
   * 把每条片子的 7 张场景图重画一遍——那是几十秒的无谓等待。
   */
  reuse = false
): PreviewShot[] {
  const tl = buildTimeline(cfg);
  const ctx: RenderCtx = { tl, voices };
  mkdirSync(`${dir}/stills`, { recursive: true });

  const shots: PreviewShot[] = [];
  const push = (at: number, name: string, label: string, lineIndex: number | null) => {
    const frame = Math.max(0, Math.min(Math.ceil(tl.duration * FPS) - 1, Math.round(at * FPS)));
    const file = `stills/${name}.png`;
    if (!(reuse && existsSync(`${dir}/${file}`))) {
      writeFileSync(`${dir}/${file}`, svgToPng(renderFrame(ctx, frame)));
    }
    shots.push({ file, at, label, lineIndex });
  };

  const lineSegs = tl.segments.filter((s: Segment) => s.kind === 'line');
  // 开场那一张：老样子取空镜，「先出声后出人」取黑底大字卡。
  //
  // ⚠ 两档取帧的时刻不一样。空镜那档取 1.0s（人差不多滑到位）；
  // 黑底卡那档取**卡的正中**（`open.end / 2`）—— 取 1.0s 也行，
  // 但卡上全程一个字不换，取中间更像「这一张就是它」。
  const open = openSpan(tl);
  push(
    open ? Math.min(open.end / 2, tl.duration - 0.1) : Math.min(1.0, tl.duration - 0.1),
    '00-开场',
    open ? (open.style === 'object-first' ? '开场物件' : '开场大字') : '开场空镜',
    null
  );
  lineSegs.forEach((s: Segment) => {
    const i = s.lineIndex!;
    const mid = (s.start + s.end) / 2;
    push(mid, `${String(i + 1).padStart(2, '0')}-台词`, `第 ${i + 1} 句`, i);
  });
  push(tl.freezeStart + 0.5, '90-定格', '定格去色', null);
  if (cfg.hook) push(Math.min(tl.duration - 0.6, tl.freezeStart + (cfg.freeze ?? 2) + 0.8), '91-钩子', '结尾钩子', null);
  return shots;
}

// ── 极简 markdown → html（不引外部库，够用就行）──
//
// 支持：标题 / 列表 / 任务勾选 / 引用 / 粗体 / 斜体 / 行内码 / **表格** / <br>。
// 表格是必须的——方案.md 的分镜表就是一张表，不支持的话整块会渲成一行行竖线。
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em class="note">$2</em>')
      // 单元格里用 <br> 换行，转义之后要放回来
      .replace(/&lt;br&gt;/g, '<br>');

  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  const lines = md.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const line = raw.trimEnd();

    // 表格：本行以 | 开头且下一行是分隔行，就一直吃到表格结束
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test((lines[n + 1] ?? '').trim())) {
      closeList();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      n += 2;
      const body: string[][] = [];
      while (n < lines.length && /^\|/.test(lines[n].trim())) body.push(cells(lines[n++]));
      n--;
      const th = head.map((c) => `<th>${inline(c)}</th>`).join('');
      const tb = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="tw"><table><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table></div>`);
      continue;
    }

    // AUTO 标记是给生成器看的，别渲出来
    if (/^<!--\s*\/?AUTO/.test(line)) continue;

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const li = line.match(/^[-*]\s+(.*)$/);
    if (h) {
      closeList();
      const lv = Math.min(6, h[1].length + 1);
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
    } else if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      const box = li[1].match(/^\[([ x])\]\s+(.*)$/);
      out.push(
        box
          ? `<li class="task"><input type="checkbox" disabled ${box[1] === 'x' ? 'checked' : ''}> ${inline(box[2])}</li>`
          : `<li>${inline(li[1])}</li>`
      );
    } else if (!line) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 一条稿件的区块：场景图 + 对话 + 分析 */
/**
 * 成片那一块：**左边成片，右边发片信息**（2026-08-23 改，原来只有成片一栏）。
 *
 * 右边那栏是审片时要跟画面一起看的几样：**排期 / 标题 / 副标题 / 关键词 / 各平台时刻**。
 * 抠不到就整栏不出 —— 不猜、不兜底、不做第二份文案。
 */
function filmBlock(prefix: string, video?: string, pub?: PublishInfo): string {
  const row = (k: string, v: string, cls = "") =>
    `<div class="pub-row"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
  const side = !pub
    ? ""
    : [
        pub.slot
          ? row(
              "排期",
              esc(pub.slot) + (pub.bucket ? "　<em>" + esc(pub.bucket.replace("_", "")) + "</em>" : ""),
              "slot" + (pub.bucket === "_已发" ? " done" : pub.slot === "未排期" ? " none" : "")
            )
          : "",
        pub.title ? row("标题", esc(pub.title), "title") : "",
        pub.sub ? row("副标题", esc(pub.sub)) : "",
        pub.tags ? row("关键词", esc(pub.tags), "tags") : "",
        pub.platforms?.length
          ? row(
              "各平台",
              pub.platforms
                .map(([k, at]) => esc(k) + " <code>" + esc(at.replace("T", " ").replace(/(\+\d\d):\d\d$/, " $1")) + "</code>")
                .join("<br>"),
              "plat"
            )
          : "",
      ]
        .filter(Boolean)
        .join("\n");
  const film = video
    ? `<video src="${prefix}${esc(video)}" controls preload="metadata" playsinline></video>` +
      `<div class="film-note">成片　<code>${esc(video)}</code></div>`
    : '<div class="film-none">还没出片　<code>npm run build</code></div>';
  return (
    '<div class="film' + (side ? " with-pub" : "") + '">' +
    '<div class="film-main">' + film + "</div>" +
    (side ? '<aside class="pub">' + side + "</aside>" : "") +
    "</div>"
  );
}
export function jokeSection(
  cfg: JokeCfg,
  shots: PreviewShot[],
  analysis: string,
  assetPrefix = '',
  video?: string,
  cover?: string,
  pub?: PublishInfo
): string {
  const tl = buildTimeline(cfg);
  const byLine = new Map<number, PreviewShot>();
  const extras: PreviewShot[] = [];
  for (const s of shots) {
    if (s.lineIndex === null) extras.push(s);
    else byLine.set(s.lineIndex, s);
  }

  const rows = cfg.lines
    .map((line, i) => {
      const ch = cfg.characters.find((c) => c.id === line.who);
      const v = resolveLineVoice(ch, line);
      const shot = byLine.get(i);
      const seg = tl.segments.find((s) => s.kind === 'line' && s.lineIndex === i);
      const morphTag = isIdentity(v.morph)
        ? '原声'
        : `pitch ${v.morph.pitch.toFixed(2)} · formant ${v.morph.formant.toFixed(2)}`;
      const text = line.highlight
        ? esc(subtitleText(line)).replace(esc(line.highlight), `<em>${esc(line.highlight)}</em>`)
        : esc(subtitleText(line));
      return `<div class="row${line.beat === 'punch' ? ' punch' : ''}">
  <div class="shot">${
    shot ? `<img src="${assetPrefix}${shot.file}" alt="第 ${i + 1} 句场景" loading="lazy">` : '<div class="noshot">无场景图</div>'
  }<span class="ts">${seg ? seg.start.toFixed(1) : '?'}s</span></div>
  <div class="talk">
    <div class="beat">${BEAT_LABEL[line.beat] ?? line.beat}</div>
    <div class="who">${esc(line.who)}</div>
    <p class="text">${text}</p>
    <div class="voice">
      <span class="pill">${esc(v.castName)}</span>
      <span class="pill alt">${esc(v.delivery)}</span>
      <span class="meta">${esc(v.base)} · ${esc(v.rate ?? '0%')} · ${morphTag}</span>
    </div>
    ${line.dur ? `<div class="meta">实测配音 ${line.dur.toFixed(2)}s</div>` : '<div class="meta warn">还没跑 align，时长是估算的</div>'}
  </div>
</div>`;
    })
    .join('\n');

  // 封面排在开场前面——它是观众实际看到的第一眼，也是视频的第一帧
  const coverFig = cover
    ? `<figure class="is-cover"><img src="${assetPrefix}${esc(cover)}" alt="封面" loading="lazy">
  <figcaption>封面　<span class="ts-inline">第一帧</span></figcaption></figure>`
    : '';
  const extraShots =
    coverFig +
    extras
      .map(
        (s) => `<figure><img src="${assetPrefix}${s.file}" alt="${esc(s.label)}" loading="lazy">
  <figcaption>${esc(s.label)}　<span class="ts-inline">${s.at.toFixed(1)}s</span></figcaption></figure>`
      )
      .join('\n');

  const dupe = (() => {
    const used = new Map<string, string[]>();
    for (const c of cfg.characters) {
      const k = c.cast ?? '青年女';
      used.set(k, [...(used.get(k) ?? []), c.id]);
    }
    const d = [...used.entries()].filter(([, ids]) => ids.length > 1);
    return d.length
      ? `<div class="alarm">音色撞车：${d.map(([k, ids]) => `${esc(ids.join(' / '))} 都用了「${esc(k)}」`).join('；')}——对话类里两个角色同音色，观众分不清谁在说话。</div>`
      : '';
  })();

  return `<section class="joke" id="${esc(cfg.id)}">
  <header>
    <h2>${esc(cfg.id)}</h2>
    <div class="facts">
      <span>${esc(cfg.type)} 类 · ${esc(cfg.scene)}</span>
      <span>片长 ${tl.duration.toFixed(1)}s</span>
      <span>笑点 ${tl.punchStart.toFixed(1)}s</span>
      <span>定格 ${tl.freezeStart.toFixed(1)}s</span>
      <span>${cfg.characters.map((c) => `${esc(c.id)}=${esc(c.cast ?? '?')}`).join('　')}</span>
    </div>
  </header>
  ${dupe}
  ${filmBlock(assetPrefix, video, pub)}
  <div class="rows">${rows}</div>
  ${extraShots ? `<h3>${cover ? '封面 / ' : ''}开场 / 定格 / 钩子</h3><div class="extras">${extraShots}</div>` : ''}
  ${cfg.hook ? `<div class="hook">结尾钩子：<strong>${esc(cfg.hook)}</strong></div>` : ''}
  <details class="analysis" open>
    <summary>落地方案 · 分镜表 · 发布文案<a class="src" href="${assetPrefix}方案.md" target="_blank">方案.md ↗</a></summary>
    ${mdToHtml(analysis)}
  </details>
</section>`;
}

/**
 * 左侧导航的一项。缩略图用开场那一张（空镜／黑底大字卡）——扫一眼就知道是哪条片子。
 */
export function navEntry(
  cfg: JokeCfg,
  shots: PreviewShot[],
  assetPrefix = '',
  index?: number,
  /** 栏目（工位 / 一个人住 / 众目睽睽 / 回家）。老马线传，别的线不传 */
  column = ''
): string {
  const tl = buildTimeline(cfg);
  const thumb = shots.find((s) => ['开场空镜', '开场大字', '开场物件'].includes(s.label)) ?? shots[0];
  const casts = cfg.characters.map((c) => c.cast ?? '?').join(' · ');
  // 标题优先用发布标题，其次片尾钩子，最后才回退到 id。
  // id 是文件名（mouse-cake），扫目录时认不出是哪条片子。
  const title = cfg.title ?? cfg.hook ?? cfg.id;
  // 日期从项目目录名取（projects/段子与儿童故事/2026-08-18_mouse-cake/），那是出片日期的唯一真相。
  const date = /^(\d{4}-\d{2}-\d{2})_/.exec(assetPrefix)?.[1] ?? '';
  return `<a class="nav-item" href="#${esc(cfg.id)}" data-target="${esc(cfg.id)}">
  ${thumb ? `<img class="nav-thumb" src="${assetPrefix}${thumb.file}" alt="" loading="lazy">` : '<span class="nav-thumb ph"></span>'}
  <span class="nav-body">
    <span class="nav-title">${index != null ? `<b class="nav-num">${index}</b>` : ''}${esc(title)}</span>
    ${date ? `<span class="nav-date">${esc(date)}</span>` : ''}
    <span class="nav-meta">${column ? `<b class="nav-col">${esc(column)}</b> · ` : ''}${esc(cfg.type)} 类 · ${tl.duration.toFixed(1)}s · ${cfg.lines.length} 句</span>
    <span class="nav-cast">${esc(casts)}</span>
  </span>
</a>`;
}

/**
 * 把若干导航项包成侧栏。
 *
 * @param title 侧栏抬头。缺省「稿件目录」（段子画廊、老马那两页）；
 *   醒木不响那页列的是片子，叫别的名字
 */
export function navPanel(items: string[], title = '稿件目录'): string {
  return `<nav class="side" id="side">
  <div class="side-head">${esc(title)}<span class="side-count">${items.length}</span></div>
  <div class="side-list">${items.join('\n')}</div>
  <a class="side-top" href="#top">回到顶部</a>
</nav>`;
}

/** 一条稿件的预览页 + 留档配置。汇总页和单条页共用这一段 */
function writeProjectPage(cfg: JokeCfg, dir: string, shots: PreviewShot[], analysis: string) {
  const film = existsSync(`${dir}/${filmFile(cfg)}`) ? filmFile(cfg) : undefined;
  const cover = existsSync(`${dir}/${coverFile(cfg)}`) ? coverFile(cfg) : undefined;
  writeFileSync(
    `${dir}/index.html`,
    page(
      `${cfg.id} 稿件预览`,
      `<h1>${cfg.id}</h1>\n<p class="sub">成片 · 场景图 · 对话内容 · 音色设置 · 分析思路</p>\n${jokeSection(
        cfg,
        shots,
        analysis,
        '',
        film,
        cover
      )}`
    )
  );
  writeFileSync(`${dir}/${cfg.id}.json`, JSON.stringify(cfg, null, 2) + '\n');
  return { film, cover };
}

/**
 * 同步 projects/ 下所有预览页 + 汇总页。
 *
 * `renderFor` 是刚出片那条稿件的 id：只有它会重渲场景图，其余的复用磁盘上已有的。
 * 不给就全部重渲。出片流程末尾会自动调这个，所以成片和预览页永远是同一版。
 */
/**
 * 公用素材区：角色形象 + 场景，渲到 projects/段子与儿童故事/_assets/ 摆在汇总页最上面。
 *
 * 写新稿件前先在这儿看一眼有什么现成的——**有就别新做**。
 * 形象原稿在 assets/characters/，那是唯一真源；这里渲的是代码参数化后的样子，
 * 两边不一致说明 rig 跟原稿脱节了。
 */
/**
 * 每个角色出一句试听。
 *
 * 素材库里角色应该是**形象 + 声音**一个完整的包——光看图选不出角色，
 * 得能当场听见它说话什么调。用同一句台词，方便横向比。
 */
export const VOICE_SAMPLE = '你好呀，今天天气真不错。';

export async function buildVoiceSamples(
  synth: (id: string, cast: string, text: string) => Promise<string | null>
): Promise<void> {
  mkdirSync(`${OUT_JOKE}/_assets`, { recursive: true });
  for (const r of ROSTER) {
    if (!r.voice) continue;
    const dst = `${OUT_JOKE}/_assets/voice-${r.key}.wav`;
    if (existsSync(dst)) continue; // 已经有了就不重跑，改音色时删掉重生成
    const src = await synth(`_sample/${r.key}`, r.voice, VOICE_SAMPLE);
    if (src && existsSync(src)) writeFileSync(dst, readFileSync(src));
  }
}

/**
 * 符号库：老马页顶上那一排。**写稿的人得先看得见有哪些符号，才谈得上点名。**
 *
 * 两类符号在同一张表上，但**分开标**：
 * `endEmote`（落点符号）和 `line.emote`（停顿符号）用的是同一批「没有情绪」的八个；
 * 那套漫符（惊/汗/星/井字纹…）是**替观众表态**的一类，配额制，不列在这儿。
 */
function emoteGallery(): string {
  const dir = `${OUT_LAOMA}/_symbols`;
  mkdirSync(dir, { recursive: true });
  const cells = Object.entries(EMOTE_SYMBOLS)
    .map(([k, note]) => {
      const f = `_symbols/${k}.png`;
      if (!existsSync(`${OUT_LAOMA}/${f}`)) {
        // 单独渲一格：符号本身画在 (0,0)，外面套一张 260×200 的纸
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="200" viewBox="0 0 260 200">` +
          `<rect width="260" height="200" fill="#FBF8F1"/>` +
          `<g transform="translate(130,104) scale(0.8)">${emote(k, { p: 1, x: 0, y: 0, W: 0, H: 0, value: '26' })}</g>` +
          `</svg>`;
        writeFileSync(`${OUT_LAOMA}/${f}`, svgToPng(svg));
      }
      const [name, ...rest] = String(note).split(/\s{2,}/);
      return `<figure class="asset">
  <img src="${f}" alt="${esc(k)}" loading="lazy">
  <figcaption><b>${esc(k)}</b><span class="voice-row"><span class="vpill">${esc(name.trim())}</span></span><span class="note">${esc(rest.join(' ').trim())}</span></figcaption>
</figure>`;
    })
    .join('\n');
  // 情绪符号（漫符）：2026-08-24 起可以用了，配额制 —— 库要摆出来，不然没人知道有哪些
  const markCells = Object.entries(MARKS)
    .map(([k, v]) => {
      const f = `_symbols/mark-${k}.png`;
      if (!existsSync(`${OUT_LAOMA}/${f}`)) {
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="200" viewBox="0 0 260 200">` +
          `<rect width="260" height="200" fill="#FBF8F1"/>` +
          markSvg(k, { size: 110, seed: 5, pop: 1, x: 130, y: 96 }) +
          `</svg>`;
        writeFileSync(`${OUT_LAOMA}/${f}`, svgToPng(svg));
      }
      const meta = v as { label?: string; note?: string };
      return `<figure class="asset">
  <img src="${f}" alt="${esc(k)}" loading="lazy">
  <figcaption><b>${esc(k)}</b><span class="voice-row"><span class="vpill">${esc(meta.label ?? '')}</span></span>${
        meta.note ? `<span class="note">${esc(meta.note)}</span>` : ''
      }</figcaption>
</figure>`;
    })
    .join('\n');

  return `<section class="card" id="_symbols">
  <h2>符号库　<span class="sub-inline">两套，各有各的规矩</span></h2>
  <p class="sub"><b>没有情绪的八个</b>　落点符号写 <code>endEmote</code>（全片 ≤1，落点定格里延后 0.3 秒起）；
  停顿符号写 <code>line.emote</code>（全片 ≤2，只挂 ≥0.8 秒的句末停顿，落点句和它前一句不许挂）。</p>
  <div class="symbols-grid">${cells}</div>
  <p class="sub"><b>情绪符号十个</b>　它们是<b>画面替观众表态</b>，所以给的是配额不是自由：<b>近 5 条最多 1 条</b>
  （收尾卡 <code>endMark</code> 和停顿 <code>line.emote</code> 共用同一份账）。用在停顿里的写法跟上面一样。</p>
  <div class="symbols-grid">${markCells}</div>
</section>`;
}

function assetGallery(): string {
  const dir = `${OUT_JOKE}/_assets`;
  mkdirSync(dir, { recursive: true });
  const ink = makeInk(0);
  const page1 = (inner: string, bg: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920"><rect width="1080" height="1920" fill="${bg}"/>${inner}</svg>`;

  const chars = ROSTER.map((r) => {
    const f = `_assets/cast-${r.key}.png`;
    if (!existsSync(`${OUT_JOKE}/${f}`)) writeFileSync(`${OUT_JOKE}/${f}`, svgToPng(page1(r.draw(ink), '#EFE9DC')));
    return `<figure class="asset${r.rigged ? '' : ' unrigged'}">
  <img src="${f}" alt="${esc(r.label)}" loading="lazy">
  <figcaption><b>${esc(r.label)}${r.rigged ? '' : ' <span class="badge">未做骨架</span>'}</b>${
      r.voice
        ? `<span class="voice-row"><span class="vpill">${esc(r.voice)}</span>${
            existsSync(`${OUT_JOKE}/_assets/voice-${r.key}.wav`)
              ? `<audio controls preload="none" src="_assets/voice-${r.key}.wav"></audio>`
              : ''
          }</span>`
        : ''
    }<code>${esc(r.usage)}</code><span>${esc(r.note)}</span>${
      r.svg ? `<span class="src">原稿 ${esc(r.svg)}</span>` : '<span class="src">纯代码画</span>'
    }</figcaption>
</figure>`;
  }).join('\n');

  const scenes = SCENE_NAMES.map((n) => {
    const f = `_assets/scene-${n}.png`;
    if (!existsSync(`${OUT_JOKE}/${f}`)) {
      const L = getScene(n)(ink, 41);
      writeFileSync(`${OUT_JOKE}/${f}`, svgToPng(page1(L.far + L.mid + L.near, '#F4EDE2')));
    }
    return `<figure class="asset">
  <img src="${f}" alt="${esc(n)}" loading="lazy">
  <figcaption><b>${esc(n)}</b><code>"scene": "${esc(n)}"</code></figcaption>
</figure>`;
  }).join('\n');

  return `<section class="joke assets" id="_assets">
  <header>
    <h2>公用素材</h2>
    <div class="facts"><span>${ROSTER.filter((r) => r.rigged).length} 个可用角色 · ${ROSTER.filter((r) => !r.rigged).length} 个只有原稿</span><span>${SCENE_NAMES.length} 个场景</span><span>每个角色配了默认音色，点开可试听</span><span>写新稿件前先看这里，有现成的别新做</span></div>
  </header>
  <h3>角色形象</h3>
  <div class="assets-grid">${chars}</div>
  <h3>场景</h3>
  <div class="assets-grid">${scenes}</div>
</section>`;
}

export function syncProjects(
  loadVoices: (cfg: JokeCfg) => Map<number, VoiceTrack>,
  opts: { renderFor?: string; quiet?: boolean } = {}
): number {
  if (!existsSync('jokes')) return 0;
  const files = readdirSync('jokes').filter((f) => f.endsWith('.json')).sort();

  // ⚠ **两张汇总页，不是一张。** 老马的成品 2026-08-23 搬进了排期树
  // （`projects/老马/段子/{_待发,_已发}/`），跟段子与儿童故事不在一个根下 ——
  // 页里的图片链接是**相对汇总页**的，混在一张里那半边全是死链。
  const sections: Record<string, string[]> = { joke: [], laoma: [] };
  const navItems: Record<string, string[]> = { joke: [], laoma: [] };
  /**
   * 老马的条目先收着，最后统一排序：**未发布在前，已发布在后**，各自按天数号从小到大。
   *
   * 文件名顺序（laoma-001…016）对不上发布顺序 —— 天数号是跳着走的，而且改期只改目录名。
   * **要看的永远是「接下来发什么」，已经发过的往后放。**
   */
  const laomaRows: Array<{ cfg: JokeCfg; shots: PreviewShot[]; prefix: string; sec: string; bucket: string; day: number }> = [];

  for (const f of files) {
    const cfg = JSON.parse(readFileSync(`jokes/${f}`, 'utf8')) as JokeCfg;
    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(dir, { recursive: true });
    const reuse = opts.renderFor !== undefined && cfg.id !== opts.renderFor;
    const shots = renderStills(cfg, dir, loadVoices(cfg), reuse);
    const analysis = ensurePlan(cfg, dir);
    const { film, cover } = writeProjectPage(cfg, dir, shots, analysis);

    const laoma = isLaoma(cfg);
    const k = laoma ? 'laoma' : 'joke';
    // 相对汇总页的路径：老马那张页在 `projects/老马/`，条目在 `段子/_待发/<名>/`
    const prefix = laoma ? `${relative(OUT_LAOMA, dir).split(sep).join('/')}/` : `${basename(dir)}/`;
    if (laoma) {
      // **先收着，排完序再出 html** —— 序号要跟最终顺序对上，所以 navEntry 不能在这儿调
      const pub = readPublishInfo(dir);
      laomaRows.push({
        cfg,
        shots,
        prefix,
        sec: jokeSection(cfg, shots, analysis, prefix, film, cover, pub),
        bucket: pub.bucket ?? '_待发',
        day: dayNo(cfg) ?? 0,
      });
    } else {
      sections[k].push(jokeSection(cfg, shots, analysis, prefix, film, cover, undefined));
      navItems[k].push(navEntry(cfg, shots, prefix, navItems[k].length + 1));
    }
    if (!opts.quiet) console.log(`  ${cfg.id}${reuse ? '（复用已有场景图）' : ` ${shots.length} 张场景图`}`);
  }

  // 老马：未发布在前、已发布在后，组内按天数号
  laomaRows.sort((a, b) => (a.bucket === b.bucket ? a.day - b.day : a.bucket === '_待发' ? -1 : 1));
  laomaRows.forEach((r, i) => {
    sections.laoma.push(r.sec);
    navItems.laoma.push(navEntry(r.cfg, r.shots, r.prefix, i + 1, dirColumn(r.cfg)));
  });

  // 段子与儿童故事：公用素材区摆在所有稿件前面（写新稿件先看这里有什么现成的）
  mkdirSync(OUT_JOKE, { recursive: true });
  const gallery = assetGallery();
  const body = `<h1>段子稿件预览</h1>
<p class="sub">共 ${sections.joke.length} 条 · 每句台词一张场景图，配对话内容与音色设置</p>
${gallery}
${sections.joke.join('\n')}`;
  const galleryNav = `<a class="nav-item" href="#_assets" data-target="_assets">
  <span class="nav-thumb ph"></span>
  <span class="nav-body"><span class="nav-title">公用素材</span><span class="nav-meta">${ROSTER.length} 角色 · ${SCENE_NAMES.length} 场景</span></span>
</a>`;
  writeFileSync(`${OUT_JOKE}/index.html`, page('段子稿件预览', body, navPanel([galleryNav, ...navItems.joke])));

  // 老马：角色和场景是外挂的 `horse/`，所以没有段子那种公用素材区；
  // 但**符号库要摆在最前面** —— 写稿的人得先看得见有哪些符号，才谈得上点名
  if (sections.laoma.length) {
    mkdirSync(OUT_LAOMA, { recursive: true });
    const lbody = `<h1>老马 · 稿件与成片</h1>
<p class="sub">共 ${sections.laoma.length} 条 · 目录名带发布日和时刻，排期见 joke-video/horse/SCHEDULE.md</p>
${emoteGallery()}
${sections.laoma.join('\n')}`;
    writeFileSync(`${OUT_LAOMA}/index.html`, page('老马 · 稿件与成片', lbody, navPanel(navItems.laoma)));
  }
  return files.length;
}

/**
 * 预览页的外壳。**仓库里几张 HTML 页共用这一份**（段子画廊、老马、醒木不响），
 * 所以配色变量和暗色适配只有这一处。
 *
 * @param extraCss 这一页自己的样式。骨架里那套是给「稿件 + 竖版成片 + 场景图」排的，
 *   别的页（比如醒木不响那张要横版成片和一张档期表）**往这儿加，不要去改骨架** ——
 *   骨架一改，三张页一起变。
 */
export function page(title: string, body: string, nav?: string, extraCss = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
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
.wrap { max-width: 1080px; margin: 0 auto; }
/* 有侧栏时改成两栏；没侧栏（单条稿件页）时 .wrap 保持原样居中 */
.layout { max-width: 1360px; margin:0 auto; display:grid;
  grid-template-columns: 250px minmax(0,1fr); gap:34px; align-items:start; }
.layout > .wrap { max-width:none; margin:0; }

/* ── 左侧稿件导航 ── */
.side { position:sticky; top:24px; max-height:calc(100vh - 48px);
  display:flex; flex-direction:column; background:var(--card);
  border:1px solid var(--line); border-radius:14px; padding:16px 12px 12px; }
.side-head { font-size:13px; font-weight:700; color:var(--dim); letter-spacing:1px;
  padding:0 8px 12px; border-bottom:1px solid var(--line); margin-bottom:10px;
  display:flex; align-items:center; justify-content:space-between; }
.side-count { background:var(--accent); color:#fff; font-size:11px; font-weight:600;
  min-width:20px; height:20px; padding:0 6px; border-radius:10px;
  display:inline-flex; align-items:center; justify-content:center; }
/* min-height:0 不能省：flex 子项默认不肯缩到内容高度以下，
   少了它 overflow-y 不生效，稿件一多侧栏就会顶穿 max-height */
.side-list { overflow-y:auto; min-height:0; display:flex; flex-direction:column; gap:4px; }
.nav-item { display:flex; gap:10px; align-items:center; padding:8px; border-radius:9px;
  text-decoration:none; color:inherit; border:1px solid transparent; transition:background .12s; }
.nav-item:hover { background:rgba(127,127,127,.1); }
/* 左侧目录里的栏目（工位/一个人住/众目睽睽/回家）—— 扫一眼就知道这条是哪个栏目的 */
.nav-col { color:var(--accent); font-weight:700; }
.nav-item.active { background:rgba(31,58,95,.12); border-color:var(--accent); }
/* 深色下那层藏青压在深底上几乎看不见，换成亮色描边填充 */
@media (prefers-color-scheme: dark) {
  .nav-item.active { background:rgba(127,168,216,.16); }
}
.nav-thumb { width:34px; height:60px; object-fit:cover; border-radius:5px;
  border:1px solid var(--line); flex:none; display:block; }
.nav-thumb.ph { background:rgba(127,127,127,.12); }
.nav-body { display:flex; flex-direction:column; min-width:0; gap:1px; }
.nav-title { font-size:13px; font-weight:700; line-height:1.35;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
/* 序号做成小方牌：目录长了之后"第几条"比标题更快定位 */
.nav-num { display:inline-block; min-width:15px; margin-right:5px; padding:0 3px;
  border-radius:3px; background:var(--accent); color:#fff;
  font-size:10px; font-weight:700; text-align:center; vertical-align:1px; }
.nav-date { font-size:11px; color:var(--dim); font-variant-numeric:tabular-nums; }
.nav-meta { font-size:11px; color:var(--dim); }
.nav-cast { font-size:11px; color:var(--accent); overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.side-top { margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  font-size:12px; color:var(--dim); text-decoration:none; text-align:center; }
.side-top:hover { color:var(--accent); }
/* 锚点跳转时标题不被贴顶 */
.joke { scroll-margin-top:24px; }
h1 { font-size:26px; margin:0 0 6px; letter-spacing:.5px; }
.sub { color:var(--dim); margin:0 0 32px; font-size:14px; }
.joke { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:24px 26px 20px; margin-bottom:34px; }
.joke > header { border-bottom:1px solid var(--line); padding-bottom:14px; margin-bottom:20px; }
h2 { font-size:20px; margin:0 0 8px; }
h3 { font-size:15px; color:var(--dim); margin:26px 0 12px; font-weight:600; }
.facts { display:flex; flex-wrap:wrap; gap:6px 18px; color:var(--dim); font-size:13px; }
.alarm { background:rgba(200,69,46,.1); border-left:3px solid var(--hot);
  padding:10px 14px; border-radius:6px; margin-bottom:18px; font-size:14px; }
/* 成片：竖版，别让它撑满一屏，跟右边的对话能同时看见 */
.film { display:flex; gap:16px; align-items:flex-end; margin-bottom:22px; }
/* 成片旁边那栏发片信息（老马线）。**成片固定 250px，剩下全给它** ——
   关键词那串很长，给固定宽度会一直换行 */
.film.with-pub { align-items:flex-start; gap:22px; }
.film.with-pub .film-main { flex:0 0 auto; }
.film.with-pub .pub { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:9px;
  border-left:2px solid var(--line); padding-left:16px; }
.pub-row { display:flex; gap:10px; align-items:baseline; font-size:13px; }
.pub-row .k { flex:0 0 46px; color:var(--dim); font-size:12px; }
.pub-row .v { flex:1 1 auto; min-width:0; word-break:break-word; }
.pub-row .v.title { font-size:16px; font-weight:700; line-height:1.35; }
.pub-row .v.tags { color:var(--dim); font-size:12px; line-height:1.5; }
.pub-row .v.plat code { font-size:11px; }
.pub-row .v.slot { font-variant-numeric:tabular-nums; }
/* 排期那一行三种态：待发（默认）／已发（灰下去）／未排期（提示要补） */
.pub-row .v.slot em { font-style:normal; font-size:11px; padding:1px 6px; border-radius:9px;
  background:var(--line); color:var(--dim); }
.pub-row .v.slot.done { color:var(--dim); }
.pub-row .v.slot.none { color:#B0563F; }
.film video { width:250px; max-height:60vh; border-radius:10px; border:1px solid var(--line);
  background:#000; display:block; }
.film-note { color:var(--dim); font-size:12px; padding-bottom:4px; }
.film-none { color:var(--dim); font-size:13px; margin-bottom:20px;
  padding:10px 14px; border:1px dashed var(--line); border-radius:8px; }
.rows { display:flex; flex-direction:column; gap:18px; }
.row { display:grid; grid-template-columns:150px 1fr; gap:20px; align-items:start;
  padding:14px; border-radius:10px; border:1px solid transparent; }
.row.punch { border-color:var(--gold); background:rgba(216,165,58,.07); }
.shot { position:relative; }
.shot img { width:100%; border-radius:8px; display:block; border:1px solid var(--line); }
.noshot { aspect-ratio:9/16; display:grid; place-items:center; color:var(--dim);
  border:1px dashed var(--line); border-radius:8px; font-size:12px; }
.ts { position:absolute; left:6px; bottom:6px; background:rgba(0,0,0,.6); color:#fff;
  font-size:11px; padding:1px 6px; border-radius:4px; }
.beat { font-size:12px; color:var(--dim); letter-spacing:1px; }
.who { font-weight:700; color:var(--accent); margin:2px 0 6px; }
.text { font-size:18px; margin:0 0 10px; line-height:1.6; }
.text em { font-style:normal; color:var(--gold); font-weight:700; }
.voice { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:4px; }
.pill { background:var(--accent); color:#fff; font-size:12px; padding:2px 10px; border-radius:20px; }
.pill.alt { background:transparent; color:var(--accent); border:1px solid var(--accent); }
.meta { color:var(--dim); font-size:12px; }
.meta.warn { color:var(--hot); }
.extras { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:16px; }
.extras figure { margin:0; }
/* 公用素材区 */
.assets-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(155px,1fr)); gap:18px; }
/* 符号库：一格一个符号，比角色/场景那种小得多 —— 一屏要看得全 */
.symbols-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:10px; }
.symbols-grid .asset img { background:#FBF8F1; }
.symbols-grid figcaption { gap:1px; margin-top:4px; font-size:10px; line-height:1.35; }
.symbols-grid figcaption b { font-size:11px; }
.symbols-grid .vpill { font-size:9px; padding:1px 5px; }
.symbols-grid .note { font-size:9px; opacity:.75; }
.asset { margin:0; }
.asset img { width:100%; border-radius:9px; border:1px solid var(--line); display:block; background:#EFE9DC; }
.asset figcaption { display:flex; flex-direction:column; gap:3px; margin-top:7px; font-size:11px; color:var(--dim); }
.asset figcaption b { font-size:13px; color:var(--ink); }
.asset figcaption code { font-size:10px; word-break:break-all; }
.asset figcaption .src { opacity:.7; font-size:10px; }
.asset.unrigged img { opacity:.72; border-style:dashed; }
.voice-row { display:flex; align-items:center; gap:6px; margin:3px 0 1px; flex-wrap:wrap; }
.vpill { background:var(--accent); color:#fff; font-size:10px; padding:1px 7px; border-radius:20px; white-space:nowrap; }
.asset audio { height:26px; max-width:100%; flex:1 1 110px; min-width:100px; }
.badge { background:var(--hot); color:#fff; font-size:9px; font-weight:600; padding:1px 5px; border-radius:3px; vertical-align:middle; margin-left:4px; }
.assets h3:first-of-type { margin-top:6px; }
.extras figure.is-cover img { border:2px solid var(--gold); }
.extras figure.is-cover figcaption { color:var(--gold); font-weight:700; }
.extras img { width:100%; border-radius:8px; border:1px solid var(--line); display:block; }
figcaption { font-size:12px; color:var(--dim); margin-top:6px; }
.ts-inline { opacity:.7; }
.hook { margin-top:20px; padding:12px 16px; background:rgba(31,58,95,.08);
  border-radius:8px; font-size:15px; }
.analysis { margin-top:24px; border-top:1px solid var(--line); padding-top:14px; }
summary { cursor:pointer; color:var(--dim); font-size:14px; font-weight:600; }
.analysis h2,.analysis h3 { font-size:15px; margin:18px 0 8px; color:var(--ink); }
.analysis p { margin:6px 0; font-size:14px; }
.analysis ul { margin:6px 0; padding-left:22px; font-size:14px; }
.analysis li.task { list-style:none; margin-left:-18px; }
.analysis blockquote { margin:8px 0; padding:6px 12px; border-left:3px solid var(--line);
  color:var(--dim); font-size:13px; }
.analysis .note { color:var(--accent); font-style:normal; font-size:13px; }
summary .src { float:right; font-weight:600; font-size:12px; color:var(--accent);
  text-decoration:none; }
/* 分镜表可能很宽，让它自己横向滚，别把整页撑出横条 */
.tw { overflow-x:auto; margin:10px 0; }
.tw table { border-collapse:collapse; font-size:13px; min-width:100%; }
.tw th,.tw td { border:1px solid var(--line); padding:6px 9px; text-align:left;
  vertical-align:top; }
.tw th { background:rgba(127,127,127,.10); font-weight:700; white-space:nowrap; }
.tw td:first-child { white-space:nowrap; font-variant-numeric:tabular-nums; color:var(--dim); }
code { background:rgba(127,127,127,.16); padding:1px 6px; border-radius:4px; font-size:13px; }
/* 窄屏：侧栏收到顶部，横向滚动 */
@media (max-width:900px){
  .layout { grid-template-columns:1fr; gap:20px; }
  .side { position:static; max-height:none; }
  .side-list { flex-direction:row; overflow-x:auto; padding-bottom:4px; }
  .nav-item { flex:none; width:190px; }
  .side-top { display:none; }
}
@media (max-width:640px){ .row{grid-template-columns:110px 1fr; gap:14px;} .text{font-size:16px;} }
${extraCss}
</style>
</head>
<body id="top">
${nav ? `<div class="layout">${nav}<div class="wrap">${body}</div></div>` : `<div class="wrap">${body}</div>`}
${
  nav
    ? `<script>
// 滚动到哪条稿件，左边就高亮哪一条
(function () {
  var items = [].slice.call(document.querySelectorAll('.nav-item'));
  var map = {};
  items.forEach(function (a) { map[a.dataset.target] = a; });
  var mark = function (id) {
    items.forEach(function (a) { a.classList.toggle('active', a.dataset.target === id); });
  };
  var seen = {};
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
    // 取当前可见比例最高的一条
    var best = null, bestV = 0;
    Object.keys(seen).forEach(function (id) { if (seen[id] > bestV) { bestV = seen[id]; best = id; } });
    if (best) mark(best);
  }, { threshold: [0, 0.15, 0.4, 0.75, 1], rootMargin: '-10% 0px -55% 0px' });
  // **盯的是目录项指到的那些块**，不是某个写死的 class。
  // 原来写的是 'section.joke'，那是段子画廊的类名 —— 醒木不响那页的块叫 .ep，
  // 目录能点、但滚动时不会跟着高亮，而且不报错（就是不动）。
  // 每一项本来就带 data-target，照它去找就跟页面长什么样无关了。
  items.forEach(function (a) {
    var el = document.getElementById(a.dataset.target);
    if (el) io.observe(el);
  });
  if (items.length) items[0].classList.add('active');
})();
</script>`
    : ''
}
</body>
</html>
`;
}

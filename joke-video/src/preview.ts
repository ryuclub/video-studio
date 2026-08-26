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
import { scheduleStatus } from './laoma-schedule.js';
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
import { bake } from './svg-smil.js';
import { Resvg } from '@resvg/resvg-js';

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
    // 长片那份 `发布文案.md` 是手写的，小节叫「关键词」「标签」两块，
    // 不是短片模板的「关键词与标签」。**认两种写法**，认不出就整栏不出。
    out.tags = blockAfter(t, "关键词与标签") ?? blockAfter(t, "关键词");
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
export const laomaDirName = (cfg: JokeCfg, key: string): string =>
  ['未排期', '段子', dirColumn(cfg), dirTitle(cfg), key].filter(Boolean).join('_');

/**
 * 目录名最后那一截 —— **这条片子的身份**，反查只认它。
 *
 * - 单点式：**天数号**（1874）。它是老马的工龄，一条一格，永不改动。
 * - 累积式：**`闲聊-<稿件号>`**（闲聊-017）。累积式不占那条时间轴，没有天数号
 *   （《累积式_出片方案》§五：什么时候发都不突兀）。
 *
 * ⚠ **方案里写的是「最后一截换成 `闲聊`」，这儿多带了稿件号，是有意的。**
 * 光一个「闲聊」不是身份 —— 同一个栏目下第二条累积式的目录名会跟第一条只差
 * 中间那截标题，而**中间几截全是会变的**（改期、改标题、换场景）。
 * 反查一旦对不上，`findProjectDir` 就会**再建一个新目录**，
 * 同一条片子从此有两个家。带上稿件号才是「改什么都还认得出自己」。
 */
export function laomaKey(cfg: JokeCfg): string {
  if (cfg.format === 'cumulative') return `闲聊-${cfg.id.match(/(\d+)\s*$/)?.[1] ?? cfg.id}`;
  const no = dayNo(cfg);
  if (no === null)
    throw new Error(
      `${cfg.id} 读不出天数号：\`day\` 和收尾卡 \`hook\` 都没有。\n` +
        `天数号是单点式的身份（目录名、排期、数字账本都用它），` +
        `不出收尾卡的条目也要写 \`"day": 1848\`（CHANNEL_LAOMA §五之二）。\n` +
        `累积式不用天数号 —— 那种稿子要写 \`"format": "cumulative"\`。`
    );
  return String(no);
}

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
  // 长片是第三条线：**横屏、五分钟、另算发布策略**，它不属于「段子」那棵排期树
  // （那棵树的规矩是天数号、跳号、一周三档，长片一条都不适用）。
  // 单独一枝 `projects/老马/长片/<id>/`，排期校验只扫 `段子/`，互不打扰。
  if (cfg.format === 'long') return `${OUT_LAOMA}/长片/${cfg.id}`;
  if (isLaoma(cfg)) return `${LAOMA_TREE}/_待发/${laomaDirName(cfg, laomaKey(cfg))}`;
  const d = date ?? new Date().toISOString().slice(0, 10);
  return `${OUT_JOKE}/${d}_${cfg.id}`;
}

/** 已经建过的项目目录（同一条稿子不重复建新目录） */
export function findProjectDir(cfg: JokeCfg): string | null {
  if (cfg.format === 'long') {
    const d = `${OUT_LAOMA}/长片/${cfg.id}`;
    return existsSync(d) ? d : null;
  }
  if (isLaoma(cfg)) {
    let no: string;
    try {
      no = laomaKey(cfg);
    } catch {
      return null; // 天数号都读不出来的稿子，也不会有目录
    }
    // ⚠ **只认尾巴上那一截身份**（天数号／闲聊-稿件号）。
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

  return `<section class="joke" id="${esc(cfg.id)}"${
    cfg.characters.some((c) => c.rig === 'horse') ? ` data-fmt="${fmtKey(cfg)}"` : ''
  }>
  <header>
    <h2>${esc(cfg.id)}</h2>
    <div class="facts">
      <span>${cfg.characters.some((c) => c.rig === 'horse') ? `${formatBadge(cfg)}式 · ` : `${esc(cfg.type)} 类 · `}${esc(cfg.scene)}</span>
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
 * 长片那一块。**跟段子不共用 `jokeSection`。**
 *
 * 那一份的骨架是「一句一张场景图」—— 段子八句、八张图，扫一眼就是分镜表。
 * 长片 82 句，分镜表上却只有 16 镜：逐句出图**既没有意义、又是 82 次渲染**，
 * 这也正是它从前干脆不进汇总页的原因。
 *
 * 所以这儿换一层粒度：**给章**。八章、每章从第几秒起、几句话、头一句是什么 ——
 * 审片的人拿着这张表能直接跳到那一秒。
 *
 * ⚠ **不在这儿列每章用哪个场景。** 那张章→场景表在 `tools/long-frames.mts` 里，
 * 抄一份到预览页就是第二个真相，而两处一旦对不上，**错的那份看起来更权威**（它带图）。
 */
function longSection(cfg: JokeCfg, dir: string, prefix: string, pub: PublishInfo): string {
  const tl = buildTimeline(cfg);
  const secs = (cfg as JokeCfg & { _sections?: Array<{ name: string; from: number; to: number }> })._sections ?? [];
  const at = (i: number) => tl.segments.find((s) => s.kind === 'line' && s.lineIndex === i);
  const rows = secs
    .map((s) => {
      const a = at(s.from);
      const b = at(s.to);
      const start = a?.start ?? 0;
      const end = b?.end ?? start;
      const first = lineText(cfg.lines[s.from]);
      return `<tr>
  <td class="ttl">${esc(s.name)}</td>
  <td class="no">${mmss(start)}</td>
  <td class="no">${(end - start).toFixed(0)}s</td>
  <td class="no">${s.to - s.from + 1} 句</td>
  <td class="tip">${esc(first.slice(0, 34))}${first.length > 34 ? '…' : ''}</td>
</tr>`;
    })
    .join('\n');

  // 三层各多少句。**这一栏是有来历的**：老牛那 14 句一度全被标成旁白
  // （解析器两个人共用「旁白」缺省），画面上看不出来，现场混响一接上就漏。
  // 摆在页面上是为了下回一眼看得见 —— 老牛一句旁白都不该有。
  const layerOf = (l: (typeof cfg.lines)[number]) => (l as { _layer?: string })._layer ?? '旁白';
  const tally = new Map<string, number>();
  for (const l of cfg.lines) tally.set(layerOf(l), (tally.get(layerOf(l)) ?? 0) + 1);
  const oxNarr = cfg.lines.filter((l) => l.who === 'niu' && layerOf(l) === '旁白').length;

  const audio = readdirSync(dir).filter((f) => /^.*试听.*\.mp3$/.test(f)).sort();
  // 字幕是 `npm run audio` 顺手出的（跟音轨同一个时间轴）。**摆出来，别只躺在目录里** ——
  // 它是要传到平台去的东西，页面上看不见就没人记得有这么一份
  const srt = readdirSync(dir).filter((f) => f.endsWith('.srt')).sort();
  const copy = existsSync(`${dir}/发布文案.md`) ? readFileSync(`${dir}/发布文案.md`, 'utf8') : '';

  return `<section class="joke long" id="${esc(cfg.id)}" data-fmt="long">
  <header>
    <h2>${esc(cfg.title ?? cfg.id)}</h2>
    <div class="facts">
      <span>${formatBadge(cfg)} · 横屏 1280×720</span>
      <span><code>${esc(cfg.id)}</code></span>
      <span>片长 ${mmss(tl.duration)}</span>
      <span>${cfg.lines.length} 句 · ${secs.length} 章</span>
      <span>${cfg.characters.map((c) => `${esc(c.id)}=${esc(c.cast ?? '?')}`).join('　')}</span>
    </div>
  </header>
  <p class="long-note">长片是第三条线：<b>横屏、五分钟、全片说破一次</b>，
  <b>不进段子那棵排期树</b>（那棵树按天数号、一周三档，长片一条都不适用），
  所以它没有日子牌、没有收尾卡，左边目录上也不带排期状态。
  规矩见 <code>joke-video/horse/长片_出片方案.md</code> ／ <code>长片_稿件规范.md</code>。</p>
  ${filmBlock(prefix, existsSync(`${dir}/out.mp4`) ? 'out.mp4' : undefined, pub.title ? pub : undefined)}
  ${coverBlock(cfg, dir, prefix)}
  ${
    audio.length
      ? `<div class="long-audio"><span class="k">试听</span>${audio
          .map((f) => `<audio src="${prefix}${encodeURI(f)}" controls preload="none"></audio><code>${esc(f)}</code>`)
          .join('')}</div>`
      : ''
  }
  ${
    srt.length
      ? `<div class="long-audio"><span class="k">字幕</span>${srt
          .map((f) => `<a href="${prefix}${encodeURI(f)}" target="_blank"><code>${esc(f)}</code></a>`)
          .join('　')}<span class="dim">跟音轨同一条时间轴，可以直接当软字幕传</span></div>`
      : ''
  }
  <div class="long-layers">三层：${[...tally.entries()]
    .map(([k, n]) => `<span class="pill">${esc(k)} <b>${n}</b></span>`)
    .join('')}${
      oxNarr
        ? `<span class="alarm-inline">老牛有 ${oxNarr} 句标成了旁白 —— 他一句旁白都不该有，见 长片_稿件规范.md §八</span>`
        : ''
    }</div>
  ${rows ? `<h3>章</h3><div class="plan-wrap"><table class="plan">
  <thead><tr><th>章</th><th>起</th><th>时长</th><th>句</th><th>头一句</th></tr></thead>
  <tbody>${rows}</tbody></table></div>` : ''}
  ${
    copy
      ? `<details class="analysis">
    <summary>发布文案<a class="src" href="${prefix}发布文案.md" target="_blank">发布文案.md ↗</a></summary>
    ${mdToHtml(copy)}
  </details>`
      : ''
  }
</section>`;
}

/**
 * 长片的封面（16:9 那一档，`laoma-long-cover.ts`）。
 *
 * ⚠ **两张一起摆，210px 那张摆在大图旁边。** 规范说「唯一的验收标准是 210px 下的
 * 可读性」，可页面上只放大图的话，没人会专门去点开那张小的 —— 摆在一起才看得见
 * 「1280 上挺好看、缩小就没了」这种事（`smile_flat` 那条平杠就是这么漏过去的）。
 *
 * 没出封面就整块不画：这条线的封面是事后单独上传的，缺一张不拦出片。
 */
function coverBlock(cfg: JokeCfg, dir: string, prefix: string): string {
  const big = `cover/${cfg.id}-16x9.png`;
  if (!existsSync(`${dir}/${big}`)) return '';
  const at = (f: string) => (existsSync(`${dir}/${f}`) ? `${prefix}${encodeURI(f)}` : '');
  const small = at(`cover/${cfg.id}-210.png`);
  const sq = at(`cover/${cfg.id}-1x1.png`);
  const sqChk = at(`cover/${cfg.id}-200.png`);
  return `<div class="long-cover">
  <img class="big" src="${prefix}${encodeURI(big)}" alt="封面 1280×720">
  ${small ? `<figure><img src="${small}" alt="封面 210px"><figcaption>210px<br><b>横版验收</b></figcaption></figure>` : ''}
  ${sq ? `<img class="sq" src="${sq}" alt="封面 1080×1080">` : ''}
  ${sqChk ? `<figure><img src="${sqChk}" alt="方版 200px"><figcaption>200px<br><b>方版验收</b></figcaption></figure>` : ''}
</div>`;
}

/**
 * 长片那一套样式。**只有老马汇总页需要**（长片没有单条页），所以走 `page()` 的 `extraCss`，
 * 不进骨架 —— 骨架是三张页共用的，往里加一段，25 张单条页每张都多背一份用不到的规则。
 *
 * ⚠ `.tag-long` 是例外，它跟另外两个体裁牌一起留在骨架里：那三个牌子是一套东西，
 * 拆到两个地方之后，改配色的人只会改到看得见的那一半。
 */
const LONG_CSS = `
/* ⚠ **长片是横屏。** 250px 宽是给 1080×1920 竖版定的（一条竖片摆成一栏，右边留给发片信息）；
   1280×720 套进去只有 140px 高，字幕一个字都看不清 —— 而它恰恰是这张页上唯一能审的东西。 */
.joke.long .film { display:block; }
.joke.long .film video { width:100%; max-width:640px; max-height:none; }
.joke.long .film.with-pub { display:flex; align-items:flex-start; }
.joke.long .film.with-pub .film-main { flex:1 1 640px; min-width:0; }
.long-note { color:var(--dim); font-size:12.5px; line-height:1.75; margin:0 0 16px;
  padding:9px 13px; border-left:3px solid var(--hot); background:rgba(200,69,46,.05); border-radius:0 8px 8px 0; }
.long-note code { font-size:11.5px; }
.long-audio { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin:14px 0 4px;
  font-size:12px; color:var(--dim); }
.long-audio .k { font-weight:700; }
.long-audio .dim { color:var(--dim); font-size:11.5px; }
.long-audio a { color:inherit; }
.long-audio audio { height:32px; }
.long-layers { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin:10px 0 4px; }
.long-layers .pill b { font-variant-numeric:tabular-nums; }
.alarm-inline { color:var(--hot); font-size:12px; font-weight:700; }
.long-cover { display:flex; align-items:flex-start; gap:14px; margin:14px 0 4px; flex-wrap:wrap; }
.long-cover .big { width:100%; max-width:420px; border-radius:6px; display:block; }
.long-cover .sq { width:270px; border-radius:6px; display:block; }
.long-cover figure { margin:0; text-align:center; font-size:11px; color:var(--dim); line-height:1.5; }
.long-cover figure img { width:200px; display:block; border-radius:4px; }
.long-cover figcaption { margin-top:5px; }
/* 目录里的长片没有场景图 —— 缩略图位摆个牌子，别留一块空白让人以为图挂了 */
.nav-thumb.ph.long { display:flex; align-items:center; justify-content:center;
  writing-mode:vertical-rl; font-size:10px; font-weight:700; letter-spacing:2px;
  color:#fff; background:var(--hot); }
`;

/** 长片在左边目录里的一项。**没有场景图**，缩略图位摆一个「长片」牌子 */
function longNavEntry(cfg: JokeCfg, prefix: string, index: number): string {
  const tl = buildTimeline(cfg);
  const title = cfg.title ?? cfg.id;
  return `<a class="nav-item" href="#${esc(cfg.id)}" data-target="${esc(cfg.id)}" data-fmt="long">
  <span class="nav-thumb ph long">长片</span>
  <span class="nav-body">
    <span class="nav-title"><b class="nav-num">${index}</b>${esc(title)}</span>
    <span class="nav-meta">${formatBadge(cfg)} · ${mmss(tl.duration)} · ${cfg.lines.length} 句</span>
    <span class="nav-cast">${esc(cfg.characters.map((c) => c.cast ?? '?').join(' · '))}</span>
  </span>
</a>`;
}

/**
 * 发布状态牌（左侧目录）。三态，**分得清「发过了」和「排好了但还没到日子」**：
 *
 * | | 目录在哪 ＋ 目录名 | 读作 |
 * |---|---|---|
 * | **已发** | `_已发/` | 发过了，成片不回改（收尾卡、日子牌都烧进去了） |
 * | **待发 2026-09-06** | `_待发/` ＋ 日期前缀 | 排好了，还没到日子 |
 * | **未排期** | `_待发/未排期_…` | 出了片，日子还没定 —— **这是个正常状态，不是错** |
 *
 * ⚠ **状态只从目录来**（`readPublishInfo`：在哪个桶里 ＋ 目录名前缀），
 * 不另记一份 —— 目录树本身就是排期账本，两头记必然对不上。
 */
function pubMark(pub?: PublishInfo): string {
  if (!pub?.bucket) return '';
  const done = pub.bucket === '_已发';
  const slot = pub.slot && pub.slot !== '未排期' ? pub.slot.replace(/ \d{2}:\d{2} JST$/, '') : '';
  const label = done ? '已发' : slot ? '待发' : '未排期';
  const cls = done ? 'st-done' : slot ? 'st-todo' : 'st-none';
  return `<span class="nav-st"><b class="${cls}">${label}</b>${slot ? `<span>${esc(slot)}</span>` : ''}</span>`;
}

/**
 * 体裁牌：**单点** / **累积**。老马线两种体裁的判据好几处是反过来的
 * （落点、字幕、片长、日子牌），扫目录的时候得一眼分得出这条是哪一种 ——
 * 不然「这条落点怎么是句感想」这种问题每次都要翻稿件才能回答。
 *
 * ⚠ 只给老马线用（判据跟别处一样：传了栏目就是老马线）。
 */
const formatBadge = (cfg: JokeCfg): string =>
  cfg.format === 'long'
    ? '<b class="tag-long">长片</b>'
    : cfg.format === 'cumulative'
      ? '<b class="tag-cum">累积</b>'
      : '<b class="tag-one">单点</b>';

/**
 * 体裁 → 筛选条上的键。**三种体裁三个键**，缺省是单点式。
 *
 * ⚠ 原来这个判断在三处各写了一遍 `format === 'cumulative' ? 'cum' : 'one'` ——
 * 加第三种体裁的时候，漏掉任何一处的表现都是**「筛选按钮点了，那一条不见了」**：
 * 它的 `data-fmt` 是 `one`，选「长片」时被当成单点式藏起来。收成一个函数。
 */
const fmtKey = (cfg: JokeCfg): 'one' | 'cum' | 'long' =>
  cfg.format === 'long' ? 'long' : cfg.format === 'cumulative' ? 'cum' : 'one';

/**
 * 秒 → `5:48`。长片按分秒读，`348.3s` 那种写法看不出长短。
 *
 * ⚠ **向下取整，不四舍五入。** 这个数会被当成章节时刻用（发布文案里那张章表就是它），
 * 而章节标记**只能早不能晚** —— 进位之后跳过去，那一章的头一个字已经过去了。
 */
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * 左侧导航的一项。缩略图用开场那一张（空镜／黑底大字卡）——扫一眼就知道是哪条片子。
 */
export function navEntry(
  cfg: JokeCfg,
  shots: PreviewShot[],
  assetPrefix = '',
  index?: number,
  /** 栏目（工位 / 一个人住 / 众目睽睽 / 回家）。老马线传，别的线不传 */
  column = '',
  /**
   * 发布状态。老马线传，别的线不传（那几条线没有排期树，也就无所谓发没发）。
   *
   * **发没发是扫目录时最先要知道的一件事** —— 「这条能不能改」「下一条发什么」
   * 全看它。原来只能靠顺序猜（未发布在前、已发布在后），
   * 而顺序在筛掉一半条目之后就不成立了。
   */
  pub?: PublishInfo
): string {
  const tl = buildTimeline(cfg);
  const thumb = shots.find((s) => ['开场空镜', '开场大字', '开场物件'].includes(s.label)) ?? shots[0];
  const casts = cfg.characters.map((c) => c.cast ?? '?').join(' · ');
  // 标题优先用发布标题，其次片尾钩子，最后才回退到 id。
  // id 是文件名（mouse-cake），扫目录时认不出是哪条片子。
  const title = cfg.title ?? cfg.hook ?? cfg.id;
  // 日期从项目目录名取（projects/段子与儿童故事/2026-08-18_mouse-cake/），那是出片日期的唯一真相。
  const date = /^(\d{4}-\d{2}-\d{2})_/.exec(assetPrefix)?.[1] ?? '';
  // 体裁标在 data 上，筛选条按它显隐。**只有老马线标**（判据跟别处一样：传了栏目）——
  // 别的线没有体裁这回事，标了就得给它们也做一条筛选。
  return `<a class="nav-item${pub?.bucket === '_已发' ? ' is-done' : ''}" href="#${esc(cfg.id)}" data-target="${esc(
    cfg.id
  )}"${column ? ` data-fmt="${fmtKey(cfg)}"` : ''}>
  ${thumb ? `<img class="nav-thumb" src="${assetPrefix}${thumb.file}" alt="" loading="lazy">` : '<span class="nav-thumb ph"></span>'}
  <span class="nav-body">
    <span class="nav-title">${index != null ? `<b class="nav-num">${index}</b>` : ''}${esc(title)}</span>
    ${date ? `<span class="nav-date">${esc(date)}</span>` : ''}
    ${pubMark(pub)}
    <span class="nav-meta">${column ? `<b class="nav-col">${esc(column)}</b> · ${formatBadge(cfg)} · ` : `${esc(cfg.type)} 类 · `}${tl.duration.toFixed(1)}s · ${cfg.lines.length} 句</span>
    <span class="nav-cast">${esc(casts)}</span>
  </span>
</a>`;
}

/**
 * 把若干导航项包成侧栏。
 *
 * @param title 侧栏抬头。缺省「稿件目录」（段子画廊、老马那两页）；
 *   醒木不响那页列的是片子，叫别的名字
 * @param extra 抬头和列表之间插一块（老马那页的体裁筛选条）。
 *   **不写就一个字节都不多** —— 别的页不受影响
 */
export function navPanel(items: string[], title = '稿件目录', extra = ''): string {
  return `<nav class="side" id="side">
  <div class="side-head">${esc(title)}<span class="side-count">${items.length}</span></div>
  ${extra}
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

  return `<details class="card fold" id="_symbols">
  <summary><h2>符号库　<span class="sub-inline">没有情绪的 ${Object.keys(EMOTE_SYMBOLS).length} 个 · 情绪符号 ${
    Object.keys(MARKS).length
  } 个</span></h2></summary>
  <p class="sub"><b>没有情绪的八个</b>　落点符号写 <code>endEmote</code>（全片 ≤1，落点定格里延后 0.3 秒起）；
  停顿符号写 <code>line.emote</code>（全片 ≤2，只挂 ≥0.8 秒的句末停顿，落点句和它前一句不许挂）。</p>
  <div class="symbols-grid">${cells}</div>
  <p class="sub"><b>情绪符号十个</b>　它们是<b>画面替观众表态</b>，所以给的是配额不是自由：<b>近 5 条最多 1 条</b>
  （收尾卡 <code>endMark</code> 和停顿 <code>line.emote</code> 共用同一份账）。用在停顿里的写法跟上面一样。</p>
  <div class="symbols-grid">${markCells}</div>
</details>`;
}

/** 累积式稿件库的一条（`horse/累积式_稿件库.json`）。全文在 `horse/累积式_出片计划.md` */
interface CumEntry {
  no: number;
  set: number;
  title: string;
  scene: string;
  weight: string;
  ox?: boolean;
  beat?: string;
  note?: string;
  clash?: string;
}

/**
 * 累积式出片计划：35 条还剩哪些没做。
 *
 * ⚠ **「做了没有」是反查出来的，不是表里手写的** —— 出了片的那条稿件写
 * `"sourceNo": N`，这儿拿 `jokes/*.json` 里所有的 `sourceNo` 去比。
 * 手写状态的表迟早会停在「待做」上，而那时候片子已经发出去两个月了
 * （跟目录树当排期账本是同一条道理：**状态要从事实推出来，别另记一份**）。
 */
function cumulativePlan(made: Map<number, JokeCfg>): string {
  const p = 'horse/累积式_稿件库.json';
  if (!existsSync(p)) return '';
  let lib: CumEntry[];
  try {
    lib = JSON.parse(readFileSync(p, 'utf8')) as CumEntry[];
  } catch {
    return '';
  }
  const done = lib.filter((e) => made.has(e.no)).length;
  const cols = new Map<string, number>();
  for (const e of lib) if (!made.has(e.no)) cols.set(colOf(e.scene), (cols.get(colOf(e.scene)) ?? 0) + 1);
  const rows = lib
    .map((e) => {
      const cfg = made.get(e.no);
      const tips = [e.beat && `留一拍：${e.beat}`, e.note, e.clash && `⚠ 撞车：${e.clash}`].filter(Boolean).join('　');
      return `<tr class="${cfg ? 'done' : ''}${e.ox ? ' ox' : ''}">
  <td class="no">${e.no}</td>
  <td class="ttl">${esc(e.title)}${e.ox ? '<span class="badge">两人镜</span>' : ''}</td>
  <td>${esc(colOf(e.scene))}</td>
  <td class="mono">${esc(e.scene)}</td>
  <td class="w-${esc(e.weight === '—' ? 'na' : e.weight)}">${esc(e.weight)}</td>
  <td>${cfg ? `<a href="#${esc(cfg.id)}">已出片 ${esc(cfg.id)}</a>` : '待做'}</td>
  <td class="tip">${esc(tips)}</td>
</tr>`;
    })
    .join('\n');
  const left = [...cols.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  // **折叠**：35 行的表摆在页顶，往下翻三屏才见得着第一条片子。
  // 摘要行里留着「多少条、做了几条、下一条该做谁」——**收起来也还看得见要紧的数**。
  // ⚠ `data-fmt-aux` 不是 `data-fmt`，两个属性**故意分开**：
  //   · `data-fmt`     = 「这是一条这个体裁的稿件」—— 抬头那个数按它算
  //   · `data-fmt-aux` = 「这不是稿件，但只跟这个体裁有关」
  // 混用的话，出片计划会被算进条数，抬头显示 20 而「全部」按钮写着 19。
  return `<details class="card fold" id="_cumplan" data-fmt-aux="cum">
  <summary><h2>累积式出片计划　<span class="sub-inline">${lib.length} 条，已出片 ${done}，待做 ${
    lib.length - done
  }</span></h2></summary>
  <p class="sub">稿源是素材包三辑（<code>E:\\ryu\\laoma\\</code>），全文抄在
  <code>joke-video/horse/累积式_出片计划.md</code> 里，<b>抄进来之后以那一份为准</b>。
  场景是建议，栏目从场景反查。<b>状态不手写</b>——稿件里写 <code>sourceNo</code>，这张表自己去比。</p>
  <p class="sub">待做的栏目分布：<b>${esc(left)}</b>　——
  单点式那 16 条把工位堆到了一半，累积式往「一个人住」倾斜，两条线合起来才回得去 40%。</p>
  <div class="plan-wrap"><table class="plan">
  <thead><tr><th>#</th><th>篇名</th><th>栏目</th><th>场景建议</th><th>重量</th><th>状态</th><th>出片提示</th></tr></thead>
  <tbody>${rows}</tbody>
  </table></div>
</details>`;
}

/** 单点式选题池的一条（`horse/单点式_选题池.json`）。出处是 `horse_standup_plan.md` §五 */
interface TopicEntry {
  no: number;
  title: string;
  column: string;
}

/**
 * 单点式选题池：16 条还剩哪些没写。
 *
 * ⚠ **跟累积式那张表是同一套办法**：状态反查，不手写 —— 出了片的稿件写
 * `"topicNo": N`，这儿拿 `jokes/*.json` 里的 `topicNo` 去比。
 *
 * ⚠ **回指字段是 `topicNo` 不是 `sourceNo`**。两个池子的编号各从 1 起，
 * 合用一个字段的话「第 1 号」会同时指累积式的《说了也白说》和单点式的《收到》。
 *
 * ⚠ **不能靠标题认选题** —— `laoma-001` 的封面标题是《练了三年》，
 * 选题却是「收到」。这九条的对应关系是逐条比对**首句**定下来的，
 * 写进了稿件的 `topicNo`；表这边只管读。
 */
function topicPool(made: Map<number, JokeCfg>): string {
  const path = 'horse/单点式_选题池.json';
  if (!existsSync(path)) return '';
  let lib: TopicEntry[];
  try {
    lib = JSON.parse(readFileSync(path, 'utf8')) as TopicEntry[];
  } catch {
    return '';
  }
  const done = lib.filter((e) => made.has(e.no)).length;
  // 每个栏目还剩几条 —— **空了的栏目要显出来**，那是「池子里挑不出东西，只能新想」
  const left = new Map<string, number>();
  for (const e of lib) if (!made.has(e.no)) left.set(e.column, (left.get(e.column) ?? 0) + 1);
  const leftLine = ['工位', '一个人住', '众目睽睽', '回家']
    .map((c) => {
      const n = left.get(c) ?? 0;
      return n ? `<b>${c} ${n}</b>` : `<b class="warn-hot">${c} 0</b>`;
    })
    .join(' · ');
  const rows = lib
    .map((e) => {
      const cfg = made.get(e.no);
      const st = cfg
        ? `<b class="st-done">已写</b> <code>${esc(cfg.id)}</code>`
        : '<b class="st-none">没写</b>';
      return `<tr${cfg ? ' class="done"' : ''}><td class="no">${e.no}</td><td class="ttl">${esc(
        e.title
      )}</td><td>${esc(e.column)}</td><td>${st}</td></tr>`;
    })
    .join('\n');
  return `<details class="card fold" id="_onepool" data-fmt-aux="one">
  <summary><h2>单点式选题池　<span class="sub-inline">${lib.length} 条，已写 ${done}，没写 ${
    lib.length - done
  }</span></h2></summary>
  <p class="sub">出处是 <code>joke-video/horse/horse_standup_plan.md</code> §五，机读的一份在
  <code>joke-video/horse/单点式_选题池.json</code>。<b>状态不手写</b>——稿件里写 <code>topicNo</code>，这张表自己去比。</p>
  <p class="sub">没写的还剩：${leftLine}　——
  ⚠ <b>010–016 那七条片子不占号</b>：它们是池外新写的选题。
  栏目占比目标见 <code>horse_standup_plan.md</code> §三（工位 40% ／ 一个人住 25% ／ 众目睽睽 20% ／ 回家 15%）。</p>
  <div class="plan-wrap"><table class="plan">
  <thead><tr><th>#</th><th>选题</th><th>栏目</th><th>状态</th></tr></thead>
  <tbody>${rows}</tbody>
  </table></div>
</details>`;
}

/**
 * 档期：还剩几期库存、哪些片子出了没排、往后哪几档空着。
 *
 * ⚠ **数都从 `laoma-schedule.ts` 来**，这儿一个都不自己算 ——
 * 排期档（周二／周四／周日）2026-08-23 改过一次，两处各算一遍的话，
 * 下次改档就会出现「页面说有空档、校验说没有」这种查半天的事。
 *
 * ⚠ **库存和「_待发 里有几个目录」是两个数**，页面要并排摆：
 * 库存只数**定了日期**的，出了片没排期的那些不算 —— 只看
 * 「库存只剩 3 期」会以为真没片子了跑去写新稿，可手上明明有现成的。
 */
function schedulePanel(): string {
  let st: ReturnType<typeof scheduleStatus>;
  try {
    st = scheduleStatus();
  } catch {
    return '';
  }
  const low = st.stock < st.min;
  const rows = st.unslotted
    .map(
      (u, i) =>
        `<tr><td class="no">${i + 1}</td><td class="ttl">${esc(u.column)}</td><td class="mono">${esc(
          u.name
        )}</td><td>${
          st.openSlots[i] ? `<b class="st-todo">建议 ${st.openSlots[i].date} 周${st.openSlots[i].wd}</b>` : '—'
        }</td></tr>`
    )
    .join('\n');
  const slots = st.openSlots.map((o) => `${o.date} 周${o.wd}`).join('　·　');
  const head = low
    ? `<b class="warn-hot">待发库存 ${st.stock} ／ ${st.min}，该补产</b>`
    : `待发库存 ${st.stock} ／ ${st.min}`;
  const body = st.unslotted.length
    ? `<p class="sub"><b>最便宜的补货是先把这 ${st.unslotted.length} 条定档</b> —— 它们已经出片了，
  只是目录名还是 <code>未排期_…</code>，所以不算进库存。定了就 <code>mv</code> 上
  <code>&lt;日期&gt;_2100JST_</code> 前缀，再把日期写进 <code>publish.json</code>。
  <b>库存立刻从 ${st.stock} 变 ${st.stock + st.unslotted.length}</b>，一个字新稿都不用写。</p>
  <div class="plan-wrap"><table class="plan">
  <thead><tr><th>#</th><th>栏目</th><th>目录</th><th>空档</th></tr></thead>
  <tbody>${rows}</tbody>
  </table></div>`
    : '<p class="sub">没有「出了片还没排期」的条目。</p>';
  return `<details class="card fold" id="_schedule" data-fmt-aux="one cum"${low ? ' open' : ''}>
  <summary><h2>档期　<span class="sub-inline">${head}${
    st.unslotted.length ? ` · 出了片没排期 ${st.unslotted.length} 条` : ''
  }</span></h2></summary>
  ${body}
  <p class="sub">往后的空档（周二／周四／周日 21:00 JST）：<b>${esc(slots)}</b></p>
  <p class="sub">${st.next ? `下一条要发的是 <code>${esc(st.next)}</code>。` : '没有排好期的待发条目。'}
  完整校验跑 <code>npm run laoma:schedule</code> —— 这张卡只挑「缺不缺片、哪天空着」两件事，
  跳号、指针、平台错开那些还在命令行那边。
  ⚠ <b>长片不进排期树</b>（见 <code>长片_出片方案.md</code> §一），所以这张卡跟长片无关。</p>
</details>`;
}

/** 场景 → 栏目。跟 `dirColumn` 同一张表，只是这儿手上只有场景名 */
const colOf = (scene: string): string => HORSE_SCENE_TABLE[scene]?.column ?? '—';

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

  const 景 = sceneryFigures();

  return `<section class="joke assets" id="_assets">
  <header>
    <h2>公用素材</h2>
    <div class="facts"><span>${ROSTER.filter((r) => r.rigged).length} 个可用角色 · ${ROSTER.filter((r) => !r.rigged).length} 个只有原稿</span><span>${SCENE_NAMES.length} 个场景</span><span>${SCENERY.length} 个景／前景层</span><span>每个角色配了默认音色，点开可试听</span><span>写新稿件前先看这里，有现成的别新做</span></div>
  </header>
  <h3>角色形象</h3>
  <div class="assets-grid">${chars}</div>
  <h3>场景</h3>
  <div class="assets-grid">${scenes}</div>${
    景 ? `\n  <h3>景／前景层（会动的）</h3>\n  <div class="assets-grid">${景}</div>` : ''
  }
</section>`;
}

/** `assets/scenery/` 里有什么。空目录也不报错 */
const SCENERY = existsSync('assets/scenery')
  ? readdirSync('assets/scenery').filter((f) => f.endsWith('.svg')).sort()
  : [];

/**
 * 景／前景层的预览。
 *
 * **这一块跟角色、场景不是一回事：它们会动。** 而一张静帧看不出会动 ——
 * 所以每张出**三个相位并排**，一眼看得见它在摆。真要量幅度和周期跑
 * `npm run scenery:check`。
 *
 * ⚠ 素材里的 SMIL 动画 **resvg 一个都不认**（实测：删光动画标签再渲，
 * PNG 字节数一模一样）。这里的图是 `svg-smil.ts` 烘出来的 ——
 * 直接扔原稿进去只会得到三张一模一样的静帧。
 */
function sceneryFigures(): string {
  if (!SCENERY.length) return '';
  return SCENERY.map((f) => {
    const 名 = f.replace(/\.svg$/, '');
    const out = `_assets/scenery-${名}.png`;
    if (!existsSync(`${OUT_JOKE}/${out}`)) {
      const raw = readFileSync(`assets/scenery/${f}`, 'utf8');
      const vb = /viewBox="([\d.\s-]+)"/.exec(raw);
      const [vx0, vy0, vw0, vh0] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1024, 1024];
      // **裁到真正有内容的那块。** 柳条那张画布 743×1483，底下 28% 是空的 ——
      // 不裁的话三个相位并排会被压得很小，而**小了就看不出它在摆**，
      // 那这一块预览就白做了。`getBBox()` 给的是 user unit，还得跟 viewBox 求交
      // （内容会超出画布，超出的那部分本来就被裁掉了）。
      const bb = new Resvg(raw, { fitTo: { mode: 'original' } }).getBBox();
      const vx = bb ? Math.max(vx0, bb.x) : vx0;
      const vy = bb ? Math.max(vy0, bb.y) : vy0;
      const vw = bb ? Math.min(vx0 + vw0, bb.x + bb.width) - vx : vw0;
      const vh = bb ? Math.min(vy0 + vh0, bb.y + bb.height) - vy : vh0;
      const 相位 = [0, 1.8, 3.6];
      const 格宽 = 520;
      const s = 格宽 / vw;
      // 裁到 bbox 会让最长那条柳条正好压在底边上，看着像被切了。留 5%
      const 高 = Math.round(vh * s * 1.05);
      const 格 = 相位
        .map((t, i) => {
          const inner = bake(raw, t)
            .replace(/^[\s\S]*?<svg[^>]*>/, '')
            .replace(/<\/svg>[\s\S]*$/, '')
            // id 冲突：三份同一张图并排，gradient / clip 会互相覆盖
            .replace(/id="([^"]+)"/g, (_m, id) => `id="${id}_${i}"`)
            .replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${id}_${i})`);
          // **每格必须自己裁。** 原稿的内容超出画布（`getBBox` 给的 x 是 −61…796，
          // 画布只有 0…743），在原文件里是被 viewBox 裁掉的；并排摆的时候没有
          // 这层裁剪，第一格的叶子会跑到第二格上去。
          return (
            `<g clip-path="url(#cell${i})" transform="translate(${i * 格宽},0)">` +
            `<g transform="scale(${s}) translate(${-vx},${-vy})">${inner}</g></g>`
          );
        })
        .join('');
      const w = 格宽 * 相位.length;
      const clips = 相位
        .map((_, i) => `<clipPath id="cell${i}"><rect width="${格宽}" height="${高}"/></clipPath>`)
        .join('');
      writeFileSync(
        `${OUT_JOKE}/${out}`,
        svgToPng(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${高}" viewBox="0 0 ${w} ${高}">` +
            `<defs>${clips}</defs><rect width="100%" height="100%" fill="#F4EDE2"/>${格}</svg>`
        )
      );
    }
    const 动 = (readFileSync(`assets/scenery/${f}`, 'utf8').match(/<animate/g) ?? []).length;
    return `<figure class="asset">
  <img src="${out}" alt="${esc(名)}" loading="lazy">
  <figcaption><b>${esc(名)}</b><code>svg-smil.ts 的 bake(svg, t)</code><span>${
      动
        ? `${动} 条 SMIL 动画。上面是 t=0 / 1.8 / 3.6 秒三个相位并排 —— <b>resvg 不认 SMIL，得先烘</b>。量幅度和周期跑 <code>npm run scenery:check</code>`
        : '静态图层'
    }</span><span class="src">原稿 assets/scenery/${esc(f)}</span></figcaption>
</figure>`;
  }).join('\n');
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
  const laomaRows: Array<{ cfg: JokeCfg; shots: PreviewShot[]; prefix: string; sec: string; bucket: string; day: number; pub: PublishInfo }> = [];
  /** 长片：**摆在所有段子后面**（它不占天数号，也不进排期树，排在中间会打断「下一条发什么」那条线） */
  const longRows: Array<{ cfg: JokeCfg; sec: string; prefix: string }> = [];

  for (const f of files) {
    const cfg = JSON.parse(readFileSync(`jokes/${f}`, 'utf8')) as JokeCfg;
    // ⚠ **长片进汇总页，但不出场景图。**
    //
    // 从前它整条跳过，理由是这张页的骨架是「一句一张场景图」—— 82 句、82 次渲染，
    // 而分镜表上只有 16 镜。理由没变，**变的是结论**：跳过的代价是片子出了却在页面上
    // 一个字都看不到，只能去翻目录。现在换一层粒度进来（`longSection`：成片 ＋ 章表 ＋
    // 发布文案），**一张图都不渲**。
    if (cfg.format === 'long') {
      const d = findProjectDir(cfg) ?? projectDir(cfg);
      mkdirSync(d, { recursive: true });
      const p = `${relative(OUT_LAOMA, d).split(sep).join('/')}/`;
      longRows.push({ cfg, prefix: p, sec: longSection(cfg, d, p, readPublishInfo(d)) });
      if (!opts.quiet) console.log(`  ${cfg.id}（长片 · 不出场景图）`);
      continue;
    }
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
        pub,
        bucket: pub.bucket ?? '_待发',
        day: dayNo(cfg) ?? 0,
      });
    } else {
      sections[k].push(jokeSection(cfg, shots, analysis, prefix, film, cover, undefined));
      navItems[k].push(navEntry(cfg, shots, prefix, navItems[k].length + 1));
    }
    if (!opts.quiet) console.log(`  ${cfg.id}${reuse ? '（复用已有场景图）' : ` ${shots.length} 张场景图`}`);
  }

  // 老马：未发布在前、已发布在后；**组内先单点式后累积式**，单点式按天数号。
  //
  // ⚠ **累积式不能跟单点式混着按天数号排** —— 它没有天数号（`dayNo` 是 null，
  // 这儿退成 0），混排的话它永远排在所有待发条目最前面，
  // 而那个位置的含义是「下一条发这个」，它并不是。
  const fmtRank = (c: JokeCfg) => (c.format === 'cumulative' ? 1 : 0);
  laomaRows.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === '_待发' ? -1 : 1;
    const f = fmtRank(a.cfg) - fmtRank(b.cfg);
    return f !== 0 ? f : a.day - b.day || a.cfg.id.localeCompare(b.cfg.id);
  });
  laomaRows.forEach((r, i) => {
    sections.laoma.push(r.sec);
    navItems.laoma.push(navEntry(r.cfg, r.shots, r.prefix, i + 1, dirColumn(r.cfg), r.pub));
  });
  // 长片接在段子后面，序号连着排
  longRows.forEach((r, i) => {
    sections.laoma.push(r.sec);
    navItems.laoma.push(longNavEntry(r.cfg, r.prefix, laomaRows.length + i + 1));
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
    const cum = laomaRows.filter((r) => r.cfg.format === 'cumulative');
    const made = new Map<number, JokeCfg>();
    // ⚠ **两张表各认各的字段，而且要按体裁过滤。** `sourceNo` 是累积式池子的号，
    // `topicNo` 是单点式池子的号，两边都从 1 起 —— 不过滤的话，一条单点式
    // 会被累积式那张表认成「第 N 条已出片」，而且**页面照样出、数字照样有**。
    for (const r of laomaRows)
      if (r.cfg.format === 'cumulative' && typeof r.cfg.sourceNo === 'number') made.set(r.cfg.sourceNo, r.cfg);
    const madeTopic = new Map<number, JokeCfg>();
    for (const r of laomaRows)
      if (r.cfg.format !== 'cumulative' && r.cfg.format !== 'long' && typeof r.cfg.topicNo === 'number')
        madeTopic.set(r.cfg.topicNo, r.cfg);
    // ⚠ 这三项都是 `data-fmt-aux`，**不是 `data-fmt`** —— 它们不是稿件，
    // 抬头那个数不该把它们算进去（算了就会比「全部」按钮上的数多）。
    const schedNav = `<a class="nav-item" href="#_schedule" data-target="_schedule" data-fmt-aux="one cum">
  <span class="nav-thumb ph"></span>
  <span class="nav-body"><span class="nav-title">档期</span><span class="nav-meta">库存与空档</span></span>
</a>`;
    const poolNav = `<a class="nav-item" href="#_onepool" data-target="_onepool" data-fmt-aux="one">
  <span class="nav-thumb ph"></span>
  <span class="nav-body"><span class="nav-title">单点式选题池</span><span class="nav-meta">16 条 · 已写 ${madeTopic.size}</span></span>
</a>`;
    const planNav = `<a class="nav-item" href="#_cumplan" data-target="_cumplan" data-fmt-aux="cum">
  <span class="nav-thumb ph"></span>
  <span class="nav-body"><span class="nav-title">累积式出片计划</span><span class="nav-meta">35 条 · 已出片 ${made.size}</span></span>
</a>`;
    // ⚠ **三个数各算各的，别拿总数减。** 原来单点式那个数是 `总数 − 累积式`，
    // 长片一进来它就多了一条 —— 而且是**默默多的**，页面照样出、数字照样有。
    const one = laomaRows.length - cum.length;
    const lbody = `<h1>老马 · 稿件与成片</h1>
<p class="sub">共 ${sections.laoma.length} 条 —— <b class="tag-one">单点</b>式 ${one} 条（带日子牌，占天数号）·
<b class="tag-cum">累积</b>式 ${cum.length} 条（排比自嘲，不占时间轴）·
<b class="tag-long">长片</b> ${longRows.length} 条（横屏五分钟，说破一次，<b>不进排期树</b>）。
三种体裁的判据好几处是<b>反过来</b>的，见 joke-video/horse/ 下的
单点式_出片方案.md ／ 累积式_出片方案.md ／ 长片_出片方案.md。
目录名带发布日和时刻，排期见 horse/SCHEDULE.md</p>
${schedulePanel()}
${topicPool(madeTopic)}
${cumulativePlan(made)}
${emoteGallery()}
${sections.laoma.join('\n')}`;
    /**
     * 体裁筛选条。**两种体裁的判据好几处是反过来的**，看的时候常常只想看一种：
     * 「累积式到今天为止长什么样」「单点式那 16 条的收尾卡是怎么处理的」。
     *
     * 纯前端显隐，不另出一张页 —— 一份内容两张页，改了一处忘了另一处是迟早的事。
     */
    const filter = `<div class="fmt-filter" role="group" aria-label="体裁筛选">
  <button type="button" data-fmt="all" class="on">全部 <b>${sections.laoma.length}</b></button>
  <button type="button" data-fmt="one">单点 <b>${one}</b></button>
  <button type="button" data-fmt="cum">累积 <b>${cum.length}</b></button>
  <button type="button" data-fmt="long">长片 <b>${longRows.length}</b></button>
</div>`;
    writeFileSync(
      `${OUT_LAOMA}/index.html`,
      page('老马 · 稿件与成片', lbody, navPanel([schedNav, poolNav, planNav, ...navItems.laoma], '稿件目录', filter), longRows.length ? LONG_CSS : '')
    );
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
/* 体裁牌：三种体裁的判据好几处是反过来的，得一眼分得出 */
.tag-one, .tag-cum, .tag-long { display:inline-block; padding:0 5px; border-radius:3px;
  font-size:10px; font-weight:700; vertical-align:1px; color:#fff; }
.tag-one { background:var(--accent); }
.tag-cum { background:var(--gold); color:#3a2c07; }
.tag-long { background:var(--hot); }
/* 页顶那两个块。⚠ **.card 原来是个没有任何规则的类名**（符号库一直是裸着排在页面上的）——
   折叠之后它得看着像个可点的条，所以补上跟稿件块同一套框 */
.card { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:18px 26px; margin-bottom:18px; }
details.card[open] { padding-bottom:22px; }
/* 可折叠的大块（出片计划、符号库）。摘要行本身就是标题，收起来也看得见那几个数 */
details.fold > summary { cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px; }
details.fold > summary::-webkit-details-marker { display:none; }
details.fold > summary::before { content:'▸'; color:var(--dim); font-size:13px; flex:none;
  transition:transform .15s; }
details.fold[open] > summary::before { transform:rotate(90deg); }
details.fold > summary h2 { margin:0; }
details.fold > summary:hover h2 { color:var(--accent); }
/* 体裁筛选条：两种体裁的判据好几处是反过来的，常常只想看一种 */
.fmt-filter { display:flex; gap:4px; margin:8px 0 2px; }
.fmt-filter button { flex:1; padding:5px 2px; border-radius:7px; cursor:pointer;
  border:1px solid var(--line); background:transparent; color:var(--dim);
  font-size:11px; font-family:inherit; }
.fmt-filter button b { font-variant-numeric:tabular-nums; }
.fmt-filter button:hover { border-color:var(--accent); color:var(--ink); }
.fmt-filter button.on { background:var(--accent); border-color:var(--accent); color:#fff; }
.is-off { display:none !important; }
/* 累积式出片计划那张表 */
.plan-wrap { overflow-x:auto; }
table.plan { border-collapse:collapse; width:100%; font-size:12.5px; }
table.plan th, table.plan td { border-bottom:1px solid var(--line); padding:5px 8px;
  text-align:left; vertical-align:top; }
table.plan th { font-size:11px; color:var(--dim); font-weight:700; white-space:nowrap; }
table.plan td.no { font-variant-numeric:tabular-nums; color:var(--dim); width:1%; }
table.plan td.ttl { font-weight:700; white-space:nowrap; }
table.plan td.mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--dim); }
table.plan td.tip { color:var(--dim); font-size:11.5px; line-height:1.5; }
table.plan tr.done { background:rgba(127,127,127,.07); }
table.plan tr.done td.ttl { color:var(--dim); }
table.plan tr.ox td.ttl .badge { margin-left:6px; }
/* 重量档：重的那几条要一眼看得见，因为「重的别连着放」 */
td.w-重 { color:var(--hot); font-weight:700; }
td.w-中 { color:var(--ink); }
td.w-轻, td.w-na { color:var(--dim); }
td.w-老牛 { color:var(--gold); font-weight:700; }
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
/* 发布状态：已发 / 待发+日期 / 未排期。**扫目录时最先要知道的一件事** */
.nav-st { display:flex; align-items:center; gap:5px; font-size:10.5px;
  color:var(--dim); font-variant-numeric:tabular-nums; }
.nav-st b { padding:0 5px; border-radius:3px; font-weight:700; }
/* 缺片、栏目空了 —— 摘要行里要一眼看得见，收起来也算数 */
.warn-hot { color:var(--hot); }
.st-done { background:rgba(127,127,127,.22); color:var(--dim); }
.st-todo { background:rgba(31,58,95,.14); color:var(--accent); }
.st-none { background:transparent; color:var(--hot); border:1px solid currentColor; padding:0 4px !important; }
@media (prefers-color-scheme: dark) { .st-todo { background:rgba(127,168,216,.2); color:#bcd4f0; } }
/* 发过的整条压暗一档：那些是不回改的，视线该落在还没发的那些上 */
.nav-item.is-done .nav-title, .nav-item.is-done .nav-thumb { opacity:.62; }
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
/* 长片那一套样式**不在这儿** —— 它只有老马汇总页用得上，走 page() 的 extraCss（LONG_CSS）。
   骨架一改，25 张单条页跟着一起变，每张都多背一段自己永远用不到的规则。
   （这段注释在模板字符串里，**别写反引号** —— 反引号会当场把字符串截断。） */
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
// 点目录里的折叠块（出片计划／符号库）要自己展开 ——
// 浏览器跳到一个收起来的 <details> 上是**什么都不显示**的，用户只会觉得链接坏了
(function () {
  var open = function () {
    // ⚠ try/catch 不是摆设：querySelector 碰上不合法的 hash 会抛，
    // 而这几段脚本在同一个 <script> 里 —— 抛出去的话**底下的筛选条一起不工作**，
    // 表现是「按钮点了没反应」，跟 hash 一点关系都看不出来。
    try {
      var el = location.hash.length > 1 && document.querySelector(location.hash);
      if (el && el.tagName === 'DETAILS') el.open = true;
    } catch (err) {}
  };
  addEventListener('hashchange', open);
  open();
})();
// 体裁筛选（老马那页）：纯显隐，不出第二张页
(function () {
  var bar = document.querySelector('.fmt-filter');
  if (!bar) return;
  var btns = [].slice.call(bar.querySelectorAll('button'));
  // 两类东西一起筛，判据是同一个：
  //   · [data-fmt]     稿件本身（左边目录项 + 右边那一节）
  //   · [data-fmt-aux] 不是稿件、但只属于某个体裁的块 —— 现在只有累积式出片计划
  // **符号库没有体裁**（三种体裁都要查符号），两个属性都不带，任何时候都留着。
  var targets = [].slice.call(document.querySelectorAll('[data-fmt], [data-fmt-aux]')).filter(
    function (el) { return el.tagName !== 'BUTTON'; }
  );
  var apply = function (want) {
    targets.forEach(function (el) {
      // aux 允许写多个体裁（档期卡是 "one cum"：长片不进排期树，所以选长片时该藏）
      var f = (el.dataset.fmt || el.dataset.fmtAux || '').split(' ');
      el.classList.toggle('is-off', want !== 'all' && f.indexOf(want) < 0);
    });
    // 抬头那个数跟着变 —— 筛到只剩 2 条、抬头还写着 19，看着就像坏了。
    // ⚠ 数的是 [data-fmt]，**出片计划不算一条稿件** —— 算进去的话
    // 抬头会比「全部」按钮上的数多 1，两个数摆在一起对不上就像坏了。
    var count = document.querySelector('.side-count');
    if (count) count.textContent = String(document.querySelectorAll('.nav-item[data-fmt]:not(.is-off)').length);
  };
  // 进页面先跑一次：抬头那个数是 navPanel 按目录项个数印的（含出片计划＝20），
  // 跟「全部 19」对不上。**不点按钮就不会被纠正**，所以在这儿对齐一次。
  apply('all');
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    btns.forEach(function (x) { x.classList.toggle('on', x === b); });
    apply(b.dataset.fmt);
  });
})();
</script>`
    : ''
}
</body>
</html>
`;
}

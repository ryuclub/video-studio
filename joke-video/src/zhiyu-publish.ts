// ── 发布文案：生成「直接复制」的那份 ────────────────────────────────
//
// 用法：npx tsx src/zhiyu-publish.ts [--cover-sec 2]
//
// ── 这份文档的定位 ──
//
// **它是复制源，不是分析报告。** 打开就该能整块选中、粘到平台的输入框里，
// 中间不夹「为什么这么写」「备选是什么」——那些属于方案文档
// （`zhiyu/治愈系出片方案.md`），在这儿只会让人一边滚一边挑，
// 而挑的时候就容易连着说明文字一起复制进去。
//
// 所以这里只出四样：标题、简介、关键字、文件路径。外加一份发片前的核对清单
// （那是待办不是分析，留着）。
//
// ── 章节时间戳是算出来的 ──
//
// `发布.json` 的 chapters 里写的是**那一段的开头几个字**，不是时间。
// 生成时去 `manifest.json` 里找那一段，取它的 start，再加上片头封面的秒数。
//
// 这样改稿之后重跑一次，时间戳自动跟着走。手写时间戳的那一版里，
// 「章节要加 2 秒片头」是核对清单上的一条人工项 —— 人工项迟早会漏。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveEp, DEF } from './zhiyu-ep.js';
import { mmss } from './zhiyu-audio.js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));

interface Chapter { at: string; text: string }
interface Part {
  /** 片内和封面那一行小字。不写就是 `${part}篇`。连载书（《陶庵梦忆》）写「第一期」 */
  partName?: string;
  part: string; epTitle: string; hook: string; acts: string[];
  title: string; lead: string; body: string; next: string;
  tags: string[]; chapters: Chapter[];
}
interface PubDoc {
  book: string; author: string; shot: string;
  channel: { name: string; about: string; source: string };
  tags: { core: string[]; long: string[] };
  /** 顶层备份的一份标题，封面脚本读它。和 parts[].title 必须有一期对得上 */
  videoTitle?: string;
  cover: { hook: string; label: string };
  /** 这一本专属的核对项。通用那几条写在代码里 —— **别把书名写进代码** */
  checks?: string[];
  parts: Part[];
}
interface Manifest { duration: number; cues: { no: number; text: string; start: number }[] }

// ── 两条线的封面产物名字不一样 ────────────────────────────────────
//
// 治愈：wechat-1080x1080 / check-210，而且有「整本」那一套（一本多期）。
// 心理：§七 的预设是 square-1400x1400 / check-320，单期没有「整本」。
// **写死一套的话另一条线的发布文案会指向不存在的文件**，而人是照着它去传的。
// 发布文案里「写法与备选」那一句指向的手册。**三条线共用同一份** ——
// 标题怎么写、关键字怎么取舍这些跟线路无关，写在治愈那份里（那是这条管线的主手册）。
// 各线自己的规范在 `DEF.doc`，那是写稿看的，不是发片看的。
const PLAN = 'zhiyu/治愈系出片方案.md';

// 两条线的封面产物名字不一样（治愈是微信方版 + 「整本」那一套，心理是 1400 方图、单期）。
// **写死一套的话另一条线的发布文案会指向不存在的文件**，而人是照着它去传的。
const SKIN = DEF.publish;

const tag = (xs: string[]) => xs.map((t) => `#${t}`).join(' ');

/**
 * 这一期的中心思想。**从稿子的稿头里取，不在 `发布.json` 里再写一遍。**
 *
 * 两条线各叫各的名字，说的是同一件事：
 *
 *   心理线    「中心思想：…」（硬规则 6，写不出这一句就不许开写）
 *   禅佛典线  「说破句：…」（硬规则 11，同上）
 *
 * 治愈线没有这一行，也不该有 —— 那条线的收束是消解不是点破
 * （见 `说破层规范.md` §六 E）。取不到就整节不出。
 *
 * **抄进 `发布.json` 是最容易分叉的做法**：改了稿子而忘了改 json，
 * 发布文案上挂的就是上一版的落点 —— 而这种错没有人会发现，
 * 因为两份看上去都对。所以只认稿头那一行。
 */
function centralIdea(acts: string[]): string | null {
  for (const a of acts) {
    const f = `${PROJ}/${a}.md`;
    if (!existsSync(f)) continue;
    // 第一个 --- 之前是稿头元信息，不进音频
    const meta = readFileSync(f, 'utf8').split(/^---$/m)[0];
    const m = meta.match(/^\s*>?\s*(?:中心思想句?|说破句)[：:]\s*(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * 片长**去量成片，不要拿音频时长加片头算**。
 * concat 会把末张图补齐到整格、编码又按 25fps 量化，算出来的跟文件差几秒 ——
 * 而这个数是要写进发布页给观众看的。
 */
function videoLen(file: string): number | null {
  if (!existsSync(file)) return null;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number((r.stdout ?? '').trim());
  return Number.isFinite(d) ? d : null;
}

/** 关键字按 46 字折行。折了照样能整块复制，但读得清哪些是一组 */
function wrapTags(xs: string[], width = 46): string {
  const out: string[] = [];
  let line = '';
  for (const t of xs.map((x) => `#${x}`)) {
    if (line && [...(line + ' ' + t)].length > width) { out.push(line); line = ''; }
    line = line ? `${line} ${t}` : t;
  }
  if (line) out.push(line);
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--cover-sec');
  const coverHold = Number(i >= 0 ? argv[i + 1] : 2);
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;

  const blocks: string[] = [];
  const files: string[] = [];

  for (const p of doc.parts) {
    const dir = `${PROJ}/成片/${p.part}`;
    const mPath = `${dir}/manifest.json`;
    if (!existsSync(mPath))
      throw new Error(`没有 ${mPath}\n先跑：npx tsx src/zhiyu-episode.ts --part ${p.part}`);
    const m = JSON.parse(readFileSync(mPath, 'utf8')) as Manifest;

    // 章节：按开头几个字去 manifest 里找那一段。找不到就炸 ——
    // 静默跳过一条章节，人是不会发现的
    const chapters = p.chapters.map((c) => {
      const cue = m.cues.find((x) => x.text.startsWith(c.at));
      if (!cue)
        throw new Error(
          `${p.part}篇的章节「${c.text}」定位不到：稿子里没有以「${c.at}」开头的段落。\n` +
            `改稿之后这一条要跟着改，或者删掉。`
        );
      return { t: cue.start + coverHold, text: c.text };
    });
    for (let k = 1; k < chapters.length; k++)
      if (chapters[k].t <= chapters[k - 1].t)
        throw new Error(`${p.part}篇的章节顺序乱了：「${chapters[k].text}」排在了前一条之前`);
    // 平台要求第一条必须是 0:00
    chapters[0].t = 0;

    const intro =
      `${p.lead}\n\n${p.body}\n\n—— 章节 ——\n` +
      chapters.map((c) => `${mmss(c.t)}　${c.text}`).join('\n') +
      `\n\n—— 关于本频道 ——\n${doc.channel.about}\n${p.next}\n\n${doc.channel.source}`;

    // 中心思想那一节。取不到就整节不出（治愈线本来就没有这一行）
    const idea = centralIdea(p.acts);
    const ideaBlock = idea
      ? `
### 中心思想

> 这一句是从稿子的稿头取的，**改稿重跑就跟着变**。
> 发片前拿它对一遍标题和简介：三样说的要是同一件事，标题才不算超发。

\`\`\`
${idea}
\`\`\`
`
      : '';

    blocks.push(
      `## ${p.partName ?? `${p.part}篇`} · ${p.epTitle}

### 标题

\`\`\`
${p.title}
\`\`\`
${ideaBlock}
### 简介

\`\`\`
${intro}
\`\`\`

### 关键字

\`\`\`
${wrapTags([...new Set([...doc.tags.core, ...p.tags, ...doc.tags.long])])}
\`\`\`
`
    );

    // 文字版是另一档产品（正文逐句上浮，给静音看的人），出了才列。
    // **不列的话等于没出** —— 文件躺在目录里，照着这份传片的人不会知道它在。
    const textVer = `${dir}/${EP}_${p.part}_文字版.mp4`;
    const textRow = existsSync(textVer)
      ? `| | 文字版 | \`成片/${p.part}/${EP}_${p.part}_文字版.mp4\`　` +
        `${mmss(videoLen(textVer) ?? m.duration + coverHold)}　**别开平台软字幕**，屏上已经有同一句了 |\n`
      : '';

    files.push(
      `| **${p.partName ?? `${p.part}篇`}** | 成片 | \`成片/${p.part}/${EP}_${p.part}.mp4\`　` +
        `${mmss(videoLen(`${dir}/${EP}_${p.part}.mp4`) ?? m.duration + coverHold)} |\n` +
        textRow +
        `| | 字幕 | \`成片/${p.part}/${p.part}篇.srt\`（软字幕，没烧进画面） |\n` +
        `| | 封面 | \`cover/${p.part}/upload-1280x720.png\` |\n` +
        `| | ${SKIN.squareName} | \`cover/${p.part}/${SKIN.square}\` |`
    );
  }

  // 「整本」那一套只有治愈线有（一本多期）。心理线是单期，没有播放列表封面。
  if (SKIN.wholeBook)
    files.push(
      `| **整本** | 播放列表封面 | \`cover/总/upload-1280x720.png\` |\n| | ${SKIN.squareName} | \`cover/总/${SKIN.square}\` |`
    );

  const md = `# 《${doc.book}》· 发布文案

> **这份是复制源。** 每个代码块整块选中、直接粘到平台的输入框里，中间不用挑。
> 写法上的理由、备选标题、关键字的取舍 —— 都在
> [${PLAN}](../../../${PLAN})，不放这儿。
>
> 这份是 \`npx tsx src/zhiyu-publish.ts\` 生成的，**别手改** ——
> 改 [发布.json](发布.json) 再重跑。章节时间戳按 manifest 实测算，
> 已含片头封面 ${coverHold} 秒。

${blocks.join('\n')}
## 文件

路径都相对本目录。

| | 用途 | 文件 |
|---|---|---|
${files.join('\n')}

上传前**必看**这两张缩略图自检：\`cover/*/${SKIN.check}\`（横版）、
\`cover/*/check-square-200.png\`（${SKIN.squareShort}）。在 1280 上好看不算数。

## 发片前核对（机器查不了的）

${(doc.checks ?? []).map((c) => `- [ ] ${c}`).join('\n')}
- [ ] **每期整听一遍。** 调子飘没飘，机器查不了
- [ ] **成片头两秒**封面在不在（concat 碰上尺寸不一样的图会静默丢掉）
- [ ] **底部进度线**走到片尾是不是满的
- [ ] **右边那一栏章节名**：抽两条跟上面的章节列表对一下（同一份数据，屏上只有 ｜ 前那半），长的那几条有没有顶到窗底
- [ ] 每套封面的两张自检图都看过（\`${SKIN.check}\` / \`check-square-200.png\`）
- [ ] 简介前两行在列表页折行之后是否完整
`;

  // 标题在两个地方各存了一份：顶层 videoTitle（封面脚本读）和 parts[].title（这儿读）。
  // 改了一处不改另一处，发布文案会印出上一版的标题，而且看不出来 —— 它本身是句通顺的话。
  // 《已读不回》二版就这么印出来一次。多期的书每期标题不同，所以只要有一期对得上就算数。
  if (doc.videoTitle && !doc.parts.some((p) => p.title === doc.videoTitle))
    throw new Error(
      [
        '发布.json 里 videoTitle 和 parts[].title 对不上，改标题漏了一处：',
        `  videoTitle　　　 ${doc.videoTitle}`,
        ...doc.parts.map((p) => `  parts[${p.part}].title ${p.title}`),
      ].join('\n')
    );

  writeFileSync(`${PROJ}/发布文案.md`, md);
  console.log(`《${doc.book}》${doc.parts.length} 期 → ${PROJ}/发布文案.md`);
  for (const p of doc.parts) console.log(`  ${p.part}篇　${p.chapters.length} 个章节　标题 ${[...p.title].length} 字`);
  console.log(`  章节时间戳已含片头 ${coverHold}s`);
}

main();

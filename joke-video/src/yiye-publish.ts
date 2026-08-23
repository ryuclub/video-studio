// ── 一页故事 / 段子线的发布文案 ────────────────────────────────────────
//
// 用法：npx tsx src/yiye-publish.ts jokes/page-02-cat.json
//
// ── 为什么不是又一处新约定 ──
//
// 这条线本来就有发布文案，在各期 `方案.md` 第四节，而且**写稿阶段就要填**
// （没填 `build` 会拦，见出片方案 §四 第 6 条）。那一节是**决策**：
// 三个标题候选各自的理由、关键词怎么取舍。
//
// 这份脚本不动那一节，只把它**抽成复制源**：主选标题、简介、标签、文件路径、
// 核对清单，打开就能整块选中粘到平台输入框。分工跟别的线一样：
//
//   方案.md §四     决策与备选、写法上的理由        ← 人写
//   发布文案.md     复制源，只出要粘出去的那四样    ← 生成
//
// 见 projects/README.md「发布文案的约定」。**别手改 发布文案.md** ——
// 改 方案.md §四 再重跑。
//
// ── 主选标题怎么认 ──
//
// 候选列表里带 `←主选` 的那一条。**没有标就炸** —— 三个候选里默认取第一个
// 是个很容易出错的猜测，而错了的表现是「发布文案给了个没人选过的标题」，
// 人照着它发出去才发现。

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OUT_JOKE } from './paths.js';
import { projectDir, findProjectDir, filmFile, coverFile } from './preview.js';
import type { JokeCfg } from './types.js';
import { buildTimeline } from './beats/typeA.js';

const arg = process.argv[2];
if (!arg) {
  console.error('用法：npx tsx src/yiye-publish.ts jokes/<稿件>.json');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(arg, 'utf8')) as JokeCfg;
const id = cfg.id;

/**
 * 成品目录是 `<日期>_<id>`，按 id 反查。
 *
 * **还没出片时目录也可能不存在** —— 那就用 `projectDir()` 算出今天的那个名字。
 * 这份脚本要能在写稿阶段跑（见 videoLen 顶上那段），不能拿「目录还没建」把人挡在外面。
 * 目录不存在时 `方案.md` 也不存在，下面解析 §四 会给出该跑哪一步的提示。
 */
function projDir(): string {
  // ⚠ **别再在这儿自己 readdir。** 老马那条线的成品目录 2026-08-23 搬进了
  // `projects/老马/段子/{_待发,_已发}/`，目录名也换了（`…_段子-1851`）——
  // 反查规则只有 `findProjectDir` 一份，这儿抄一份出来就是第二套说法。
  return findProjectDir(cfg) ?? projectDir(cfg);
}

const DIR = projDir();

const mmss = (d: number) => `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}`;

/**
 * 片长。有成片就**去量文件**，没有就按时间轴估。
 *
 * ── 为什么允许没有成片 ──
 *
 * `plan.ts` 里写着「**发布文案要在写稿阶段填，不是成片后补**」：
 * 标题、封面大字、收尾金句是同一个钩子的三种长度，分开想必然对不齐。
 *
 * 但这份脚本原来**硬要成片**（为了量片长），于是那条主张实际上做不到 ——
 * 想在写稿阶段看一眼中心思想，得先渲一遍片子。顺序是反的。
 *
 * 现在：没有 mp4 就用时间轴估，并在文档里标明是估的。
 * **出片后再跑一次**，片长自动换成实测 —— 编码按帧量化，估算跟文件能差一两秒。
 */
function videoLen(): { text: string; measured: boolean } {
  const f = `${DIR}/${filmFile(cfg)}`;
  if (existsSync(f)) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    });
    const d = Number((r.stdout ?? '').trim());
    if (!Number.isFinite(d)) throw new Error(`量不出片长：${f}`);
    return { text: mmss(d), measured: true };
  }
  return { text: `约 ${mmss(buildTimeline(cfg).duration)}`, measured: false };
}

// ── 解析 方案.md 第四节 ────────────────────────────────────────────────

const planPath = `${DIR}/方案.md`;
if (!existsSync(planPath))
  throw new Error(
    `没有 ${planPath}
` +
      `**发布文案是从方案 §四 抽出来的**，得先有方案骨架。跑：npm run plan -- ${arg}`
  );
const plan = readFileSync(planPath, 'utf8');

const sec = plan.split(/^## 四、发布文案\s*$/m)[1]?.split(/^## /m)[0];
if (!sec) throw new Error(`${planPath} 里找不到「## 四、发布文案」那一节`);

/**
 * 取 `- **名字**　值` 这种单行字段。
 *
 * `optional` 只给**后加的**字段用（副标题）。**已有字段一律必填** ——
 * 缺了就炸，而不是出一份少一块的复制源：少一块的文案人是照着发出去才发现的。
 */
function field(name: string, optional = false): string {
  const m = sec!.match(new RegExp(`^- \\*\\*${name}\\*\\*[　\\s]+(.+)$`, 'm'));
  if (!m) {
    if (optional) return '';
    throw new Error(`方案.md §四 里没填「${name}」`);
  }
  return m[1].trim().replace(/`/g, '');
}

/** 主选标题：候选里带 ←主选 的那条 */
function leadTitle(): string {
  const line = sec!.split('\n').find((l) => l.includes('←主选'));
  if (!line)
    throw new Error(
      `方案.md §四 的标题候选里没有一条标了「←主选」。\n` +
        `**不默认取第一个** —— 猜错的表现是发布文案给了个没人选过的标题，` +
        `而人是照着它发出去才发现的。`
    );
  const m = line.match(/`([^`]+)`/);
  if (!m) throw new Error(`主选那一行里没有用反引号括起来的标题：${line.trim()}`);
  return m[1];
}

/** 简介：`>` 引用块，空的 `>` 是段落分隔 */
function lead(): string {
  const i = sec!.split('\n').findIndex((l) => /^- \*\*简介\*\*/.test(l));
  if (i < 0) throw new Error('方案.md §四 里没填「简介」');
  const out: string[] = [];
  for (const l of sec!.split('\n').slice(i + 1)) {
    const t = l.trim();
    if (t.startsWith('- **')) break;
    if (!t.startsWith('>')) continue;
    out.push(t.replace(/^>\s?/, ''));
  }
  if (!out.length) throw new Error('「简介」下面没有 > 引用块');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const title = leadTitle();
const intro = lead();
/**
 * 关键词统一成 `#词 #词` 的形式。
 *
 * 方案.md 里三个字段各写各的分隔符（`/`、`、`、空格），那是给人读的；
 * **粘到平台输入框里要的是带 # 的**，人工再去逐个加井号既慢又会漏。
 * 这里统一转一次，顺带去重 —— 内容词和热度词常有重叠（猫那期的「动物寓言」两边都有）。
 */
const hashify = (raw: string): string[] =>
  raw
    .split(/[\/、，,;；\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);

/** 按 46 字折行。折了照样能整块复制，但读得清哪些是一组 */
function wrapTags(xs: string[], width = 46): string {
  const out: string[] = [];
  let line = '';
  for (const t of xs.map((x) => `#${x}`)) {
    if (line && [...(line + ' ' + t)].length > width) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${t}` : t;
  }
  if (line) out.push(line);
  return out.join('\n');
}

const tagList = hashify(field('话题标签'));
const ownList = hashify(field('内容关键词'));
const hotList = hashify(field('热度关键词'));
/** 话题标签在前（那是要发的），内容词次之，热度词最后。去重按先到先得 */
const allTags = [...new Set([...tagList, ...ownList, ...hotList])];
const coverTitle = cfg.cover?.title ?? '（未设）';
const dur = videoLen();
/** 成片那一格。还没出片时不给文件名 —— 给了人会去找一个不存在的文件 */
const fileCell = dur.measured ? '`' + filmFile(cfg) + '`' : '（还没出片）';

// ── 说破段：这条线每一篇都必须有（出片方案 §四 第 7 条）──
//
// 发布文案里单列一段，理由有两个：
//   ① 简介里放中心思想，家长扫一眼就知道这一集讲什么 —— 点开的是家长不是孩子
//   ② 出片前要核「尾字幕跟语音是不是同一句」，把两边并排列出来才核得动
const lineText2 = (l: (typeof cfg.lines)[number]) => l.text ?? (l.say ?? []).map((x) => x.text).join('');

/**
 * 老马那条独白线**没有说破段**，它是单包袱结构 —— 中心思想就是落点那一句。
 *
 * 这两条线共用这份脚本（都跑 joke-video 的链路、成品都在
 * `projects/段子与儿童故事/`），但「中心思想从哪儿来」是两套：
 *
 *   《一页故事》  说破段（`shuopo: true`），寓言必须把道理说出来
 *   老马          落点句（`beat: "punch"`），**说完就停，不许升华**
 *
 * 按 rig 分流而不是按 id 猜 —— rig 是配置里写死的事实。
 */
const isLaoma = cfg.characters.some((c) => c.rig === 'horse');

// ── 老马的频道介绍：唯一出处是 horse/CHANNEL_LAOMA.md ──────────────────
//
// 每条片子的简介末尾要挂一段「关于老马」，频道简介栏要贴长版／短版／一句版。
// **这些字一个都不抄进代码** —— 抄一份就有两个出处，改人设的时候人只会改文档那一份，
// 而发布文案照样输出旧的，**且看不出来**（它本身是通顺的一段话）。
//
// 缺文件、缺那一节、缺中版，全部直接炸。少一段频道介绍的发布文案看起来一切正常，
// 人是照着它发出去、发完才发现频道简介没跟上的。
const LAOMA_DOC = fileURLToPath(new URL('../horse/CHANNEL_LAOMA.md', import.meta.url));

interface LaomaChannel {
  /** 四档简介：长版 / 中版 / 短版 / 一句版。name 是档位，where 是贴哪儿 */
  intros: { name: string; where: string; text: string }[];
  /** 固定标签，前三个必带（§五） */
  fixed: string[];
}

function laomaChannel(): LaomaChannel {
  if (!existsSync(LAOMA_DOC))
    throw new Error(
      `没有 ${LAOMA_DOC}\n老马的形象说明是发布文案的一部分，不是可选装饰。`
    );
  const raw = readFileSync(LAOMA_DOC, 'utf8');
  const part = (head: string) => raw.split(/^## /m).find((x) => x.startsWith(head));

  const sec2 = part('二、简介文案');
  if (!sec2) throw new Error(`${LAOMA_DOC} 里找不到「## 二、简介文案」那一节`);
  // `$` 在 m 模式下是**每行**的行尾，懒惰量词碰上它只会吃到第一行 ——
  // 中版三行会静默变成一行。这儿的串尾要写成 `$(?![\s\S])`。
  const intros = [...sec2.matchAll(/^### (.+?)（(.+?)）\s*\n([\s\S]*?)(?=\n### |\n---|$(?![\s\S]))/gm)].map((m) => ({
    name: m[1].trim(),
    where: m[2].trim(),
    text: m[3]
      .split('\n')
      .filter((l) => l.trim().startsWith('>'))
      .map((l) => l.trim().replace(/^>\s?/, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }));
  if (!intros.length) throw new Error(`${LAOMA_DOC} §二 里一档简介都没解析出来（要 ### 档位（贴哪儿） ＋ > 引用块）`);

  const sec5 = part('五、固定标签');
  const fixed = (sec5?.match(/```\n([\s\S]*?)```/)?.[1] ?? '')
    .split(/\s+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter(Boolean);
  if (!fixed.length) throw new Error(`${LAOMA_DOC} 里找不到「## 五、固定标签」那一节的代码块`);

  return { intros, fixed };
}

const ch = isLaoma ? laomaChannel() : null;

/** 取某一档简介。少了就炸 —— 缺一档的复制源是发出去才发现的 */
function chIntro(name: string): string {
  const hit = ch?.intros.find((i) => i.name === name);
  if (!hit)
    throw new Error(
      `${LAOMA_DOC} §二 里没有「${name}」这一档。有的是：${(ch?.intros ?? []).map((i) => i.name).join(' / ')}`
    );
  return hit.text;
}

/**
 * 实际要发的标签。**老马线把 §五 那三个固定标签顶到最前面** ——
 * 「前三个必带」是频道一致性的一条，写在文档里靠人记就会漏
 * （laoma-001 那份就漏了 #碎嘴老马）。去重按先到先得。
 */
const publishTags = ch ? [...new Set([...ch.fixed, ...allTags])] : allTags;

const shuopoLines = isLaoma
  ? cfg.lines.filter((l) => l.beat === 'punch').map(lineText2)
  : cfg.lines.filter((l) => l.shuopo).map(lineText2);

if (!shuopoLines.length)
  throw new Error(
    isLaoma
      ? `${arg} 里没有 beat: "punch" 的行 —— 老马线是单包袱结构，落点是全片唯一的锚。`
      : `${arg} 里没有标 shuopo 的行。\n` +
        `**每一篇寓言必须有说破段**（出片方案 §四 第 7 条），` +
        `给那几行加 "shuopo": true。`
  );
/**
 * 收尾那一行（老马线是收尾卡，《一页故事》是钩子）。
 *
 * **可以没有。** 老马线的收尾卡是一张日子牌（`老马的第 1847 天`，见 horse/CHANNEL_LAOMA.md §五之二）——
 * 往一条不是段子的片子后面一贴，就成了「刚才那是个段子」。
 * 所以有的稿子不写 `hook`，收尾走黑场（`fadeOut`）。
 * 早先这儿无脑取 `cfg.hook`，没写的时候末行打出「说破段落点「」」，
 * 像是漏填了 —— 而它是**有意不填的**。
 */
const tail = cfg.hook ?? '';

/** 副标题：老马这条线有（人设的一句话），《一页故事》没有 */
const subtitle = field('副标题', true);

/**
 * 逐句稿。**给二次剪辑和平台的字幕框用**，不是给人读的分析。
 *
 * 时间戳按时间轴算（含片头封面那一帧），跟成片对得上 ——
 * 平台要传字幕、或者要截一段做预告时，照着这个切就行。
 */
const script = (() => {
  const tl = buildTimeline(cfg);
  const rows: string[] = [];
  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    const t = s.start;
    rows.push(`${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}　${lineText2(s.line)}`);
  }
  if (cfg.hook) rows.push(`${'　'.repeat(0)}（收尾卡）${cfg.hook}`);
  return rows.join('\n');
})();

// 文档标题用主选标题，**不引 cfg.title** —— 那是第二个出处，
// 两处一旦不一致，人会照着错的那个发出去
const md = `# 《${title}》 · 发布文案

> **这份是复制源。** 每个代码块整块选中、直接粘到平台的输入框里，中间不用挑。
> 标题候选、关键词取舍、写法上的理由 —— 都在 [方案.md](方案.md) 第四节，不放这儿。
>
> 这份是 \`npx tsx src/yiye-publish.ts ${arg}\` 生成的，**别手改** ——
> 改 方案.md §四 再重跑。${dur.measured ? '片长是去量成片文件的。' : '**片长是按时间轴估的 —— 还没出片。出片后再跑一次换成实测。**'}

## 标题

\`\`\`
${title}
\`\`\`
${subtitle ? `\n## 副标题\n\n发在标题下面那一行，或者当第二条评论置顶。\n\n\`\`\`\n${subtitle}\n\`\`\`\n` : ''}
## 简介

\`\`\`
${intro}${ch ? `\n\n—— 关于老马 ——\n${chIntro('中版')}` : ''}
\`\`\`

## 中心思想（${isLaoma ? '落点' : '说破段'}）

${
  isLaoma
    ? '这一条到底在说什么，就是落点那一句。**不要写进简介** —— 老马这条线的规矩是「说完就停，\n不解释、不补刀、不升华」（SCRIPT_GUIDE §一之八），把落点提前放进简介等于自己先剧透。\n这一栏是给写稿的人回头核的：**这句话值不值得转发**。'
    : '片子结尾念出来的那几句。**接在简介末尾一起发**，家长扫一眼就知道这一集讲什么。'
}

\`\`\`
${shuopoLines.join('\n')}
\`\`\`

${
  tail
    ? `尾字幕：\\\`${tail}\\\``
    : '**没有尾字幕。** 这一条走黑场收尾 —— 固定收尾卡是段子的 CTA，往一条不是段子的片子后面一贴，就成了「刚才那是个段子」。'
}

## 内容（逐句稿）

时间戳含片头封面那一帧，跟成片对得上。**平台要传字幕、或者要截一段做预告，照着这个切。**

\`\`\`
${script}
\`\`\`

## 关键词与标签

话题标签、内容词、热度词已合成一串去过重，整块复制。${
    ch
      ? `
**前 ${ch.fixed.length} 个是固定标签**（\`horse/CHANNEL_LAOMA.md\` §五），每条必带，已经顶到最前面。
那份文档还写着**不要堆二十个**：三到五个、跟内容真实相关的，多了几个平台都会降权。`
      : ''
  }

\`\`\`
${wrapTags(publishTags)}
\`\`\`

${
    ch
      ? `## 频道介绍

**这一节贴在频道简介栏，不是每条片子都发**（每条片子的那一段已经挂在上面「简介」里了）。
四档按平台挑一档，整块复制。出处是 \`horse/CHANNEL_LAOMA.md\` §二，**改人设改那儿再重跑**。

${ch.intros.map((i) => `### ${i.name}　${i.where}\n\n\`\`\`\n${i.text}\n\`\`\`\n`).join('\n')}
> 第一行那句「每天嘀咕一句，说完就走」是 slogan，**四档里都不要改** ——
> 「碎嘴」这个名字预期的是话痨，靠它把读法拧成「频率高、密度低」，
> 名字才立得住（§一）。

`
      : ''
  }## 文件

路径都相对本目录。

| 用途 | 文件 |
|---|---|
| 成片 | ${fileCell}　${dur.text} |
| 竖版封面 | \`${coverFile(cfg)}\` |
| 预览页 | \`index.html\` |

封面大字：\`${coverTitle}\`

## 发片前核对（机器查不了的）

${
  isLaoma
    ? [
        '- [ ] **落点句的最后一个词，是不是笑点本身**（§一之一）',
        '- [ ] **一条里只有一个笑点吗**（§一之五）—— 第二个会稀释第一个，不是叠加',
        '- [ ] **回头看，转折的线索在前面出现过吗**（§一之三）—— 靠隐瞒信息制造的反转只会让人生气',
        '- [ ] **落点之后还有话吗**（§一之八）—— 有就删掉，不解释、不补刀、不升华',
        `- [ ] **这句话，老马会用感叹号说吗**（§二）—— 会的话就重写。这一期的落点：\`${shuopoLines.join(' / ')}\``,
        // ── §一之十二到十四，2026-08-22 加的三条「像不像真事」 ──
        // 前两条体检查得了一半（prop 有没有 declare、落点有没有反应词），
        // 判断那一半和第三条整条都只有人能做，所以三条都留在这张表上。
        cfg.object
          ? `- [ ] **删掉物件「${cfg.object}」，真的有句子说不通吗**（§一之十二）—— 说得通就是装饰，另找一个。体检只数得出它出现在几句里`
          : '- [ ] **有没有一个承担叙事功能的物件**（§一之十二）—— 写进稿件的 `object` 字段，判据是「删掉它至少有一句话说不通」',
        `- [ ] **落点说的是「发生了什么」还是「我怎么了」？里面有具体名词或数字吗**（§一之十三）`,
        '- [ ] **回收句里有钩子句的原词吗**（§一之十四）—— 换了同义词不算，观众没法回看',
        '- [ ] **通篇有没有一句在解释**（§二「通篇四不」）',
        '- [ ] 简介第一句能不能单独立住（列表页只显示第一行）',
        '- [ ] **标签是不是控制在三到五个**（§五）—— 固定那三个之外，只留跟这一条真实相关的',
        '- [ ] 封面大字在手机缩略图尺寸下读得出',
        '',
        `> 形式项（落点字数、铺垫个数、热词、模糊量词…）已经由 \`npx tsx src/laoma-check.ts ${arg}\` 查过。`,
        '> **体检全绿不等于好笑**，上面这几条才是决定好不好笑、像不像真事的，只有人能判。',
      ].join('\n')
    : [
        '- [ ] **说破段念出来了吗**（不是只有尾字幕）—— 出片方案 §四 第 1 条',
        `- [ ] **尾字幕跟语音是同一句吗** —— 第 2 条。这一期的落点：\`${tail}\``,
        '- [ ] **把说破段单独念给一个没听过这个故事的孩子，他能复述出来吗** —— 复述不出来就是没说破',
        '- [ ] 说破段在 BGM 淡出**之前**，没压在淡出上',
        '- [ ] 简介第一句能不能单独立住（列表页只显示第一行）',
        '- [ ] 封面大字在手机缩略图尺寸下读得出',
      ].join('\n')
}
`;

writeFileSync(`${DIR}/发布文案.md`, md);
console.log(`${cfg.title ?? id} → ${DIR}/发布文案.md`);
console.log(
  `  标题 ${[...title].length} 字　片长 ${dur.text}　` +
    (tail ? `${isLaoma ? '收尾卡' : '说破段落点'}「${tail}」` : `收尾${cfg.fadeOut ? '黑场' : '无卡'}，不出收尾卡`)
);

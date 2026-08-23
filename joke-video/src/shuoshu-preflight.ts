// ── 说书出片前体检：把「能跑但结果不对」拦在最前面 ──────────────────────
//
// 用法：npx tsx src/shuoshu-preflight.ts --ep E02
//
// 段子线有 `preflight.ts`，说书线一直没有——这条线的静默失败模式跟那边不一样，
// 所以单开一份，两边不共用。
//
// ── 这条线真正会翻车的地方 ──
//
// 报错的都不可怕，跑一半崩了重跑就是（TTS 有缓存）。可怕的是**跑完了、
// 文件都在、但东西是错的**，而这些只有出片之后用眼睛/耳朵才发现：
//
//   ① **节拍全是「常规」** —— 稿子解析完不标注也能出片，出来是全程一个调。
//      E01 就是这么翻的一次，全片重来。这是本条线第一号静默失败
//   ② **说话人还挂着 needsReview** —— 那些段会按说书人念，
//      对白变成旁白，听感是"这人怎么自己跟自己说话"
//   ③ **场景图密度塌了** —— 某张图挂了三分钟。不报错，但观众看到的是一张静止图
//   ④ **场景段号超出稿件** —— 图排在音频结束之后，等于没有
//   ⑤ **封面数据缺一项** —— shuoshu-cover.ts 会炸，但要等到第五步才炸
//
// 所以体检**不看代码能不能跑，只看结果对不对**。ship 起手先跑这个。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { COMPOSITION_NAMES } from './shuoshu-scene.js';
import { YT_MOTIFS, PALETTES as YT_PALETTES } from './yt-cover.js';
import { BEAT_NAMES } from './shuoshu-beat.js';
import { CAST_NAMES } from './cast.js';
import { resolveEp } from './shuoshu-ep.js';

/**
 * 片长目标。**2026-08-20 从 15–17 分钟调到 20 分钟上下** ——
 * 反馈是「太短了确实没营养」。
 *
 * `CPM` 是实测：E01 228 / E02 237 / E03 230 汉字每分钟（含停顿）。
 * 按 228 折算，20 分钟约 4560 汉字。
 */
const CPM = 228;
/** 新标准的下限。低于这个是**错**，出片会被拦住 */
const TARGET_MIN = 18;
/**
 * 老标准（15–17 分钟）的下限。**在这之间只警告不拦。**
 *
 * E01（16.8 分）和 E02（15.9 分）是按老标准做的，不该被新标准倒查成错 ——
 * 已经出过的片子不回改，这是这个仓库的一贯做法。
 * 但也不能一声不吭：哪天要重出，得知道它们按今天的标准是偏短的。
 */
const LEGACY_MIN = 15;
const TARGET_MAX = 24;

/**
 * 分幕汉字下限。卡片里每一幕后面括号那个数就是这个，**是下限不是配额**。
 * 这里给的是通用兜底值，各篇卡片上的数更准 —— 但卡片在文档里，机器读不到，
 * 所以先用一套保守的通用值拦住「明显塌了」的那种。
 */
const ACT_FLOOR: Record<string, number> = {
  冷开场: 150,
  引入: 300,
  '幕X · ': 400,
  收束: 300,
};

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

/** 一张场景图最多挂多久。超过这个数观众就开始盯着一张静止画面发呆 */
const MAX_SCENE_SEC = 75;
/** 节拍标注的下限。E01 v2 是 74%，E02 是 70%，低于这个数基本等于没标 */
const MIN_ANNOTATED = 0.35;

export function preflightShuoshu(dir: string): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  // ── 稿件 ──
  const scriptPath = `${dir}/script.json`;
  if (!existsSync(scriptPath)) {
    err(`没有 script.json。先跑：npx tsx src/shuoshu-parse.ts <稿件.md>`);
    return out;
  }
  const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as {
    lines: { no: number; act: string; who?: string; beat?: string; needsReview?: boolean; text: string }[];
  };
  const lines = script.lines ?? [];
  if (!lines.length) return [{ level: 'error', msg: 'script.json 里一段都没有' }];

  const review = lines.filter((l) => l.needsReview);
  if (review.length) err(`${review.length} 段说话人还没确认（第 ${review.slice(0, 6).map((l) => l.no).join(' / ')}${review.length > 6 ? ' …' : ''} 段）`);

  // ── ⑥ 稿子太短 ──────────────────────────────────────────────────────
  //
  // **这一条是 E03 补上的，它之前不存在。**
  //
  // E03 第一版 1969 汉字、成片 8:38，每一幕都低于卡片写的分幕下限，
  // 而体检**一路绿灯放它出片了** —— 因为体检查选角、查节拍、查段号，
  // 唯独不查字数。规范写在文档里但没进机器，等于只防君子。
  //
  // 卡片里的分幕字数是**下限不是配额**（`liaozhai-17-cards.md` 第一原则：
  // 「宁长勿断，为了凑时长把过程砍掉是错的」）。可下限只在文档里，
  // 写稿的人（包括模型）很容易把它读成「差不多就行」。所以搬进来。
  const han = (t: string) => (t.match(/[一-龥]/g) ?? []).length;
  const total = lines.reduce((a, l) => a + han(l.text), 0);
  const mins = total / CPM;
  if (mins < LEGACY_MIN)
    err(
      `稿件只有 ${total} 汉字，按 ${CPM} 字/分约 ${mins.toFixed(1)} 分钟，` +
        `短于 ${TARGET_MIN} 分钟。\n` +
        `    **这不是让你去注水** —— 卡片第一原则写着「为了凑时长把过程砍掉是错的」，` +
        `反过来为了凑时长灌水一样错。\n` +
        `    短了先回去看哪一幕的过程戏被压掉了：砍柴、追捕、交涉这类有过程的段落，` +
        `原文很省，要铺开不是再省一道。`
    );
  else if (mins < TARGET_MIN)
    warn(
      `稿件 ${total} 汉字约 ${mins.toFixed(1)} 分钟，短于现行的 ${TARGET_MIN} 分钟。
` +
        `    老标准是 15–17 分钟，E01/E02 就在这一档 —— **已出片的不回改**。
` +
        `    但新片要按 20 分钟上下做，反馈是「太短了确实没营养」。`
    );
  else if (mins > TARGET_MAX)
    warn(`稿件 ${total} 汉字约 ${mins.toFixed(1)} 分钟，超过 ${TARGET_MAX} 分钟。长不是错，但确认一下没有车轱辘话`);

  // 分幕下限也查一遍：总数够了也可能是某一幕撑着、另一幕塌了
  const byAct = new Map<string, number>();
  for (const l of lines) byAct.set(l.act, (byAct.get(l.act) ?? 0) + han(l.text));
  const floorOf = (act: string) => (/^幕/.test(act) ? ACT_FLOOR['幕X · '] : ACT_FLOOR[act]) ?? 0;
  const thin = [...byAct].filter(([a, c]) => c < floorOf(a));
  for (const [a, c] of thin)
    warn(`「${a}」只有 ${c} 汉字，比同类段落的下限低。过程戏是说书的本体，先看是不是被压掉了`);

  const badBeat = lines.filter((l) => l.beat && !BEAT_NAMES.includes(l.beat));
  for (const l of badBeat) err(`第 ${l.no} 段的节拍「${l.beat}」不在节拍表里`);

  const badCast = lines.filter((l) => l.who && !CAST_NAMES.includes(l.who));
  for (const l of badCast) err(`第 ${l.no} 段的音色「${l.who}」不在选角表里`);

  // ① 头号静默失败：没标注也能出片，出来全程一个调
  const annotated = lines.filter((l) => l.beat && l.beat !== '常规').length / lines.length;
  if (annotated < MIN_ANNOTATED)
    err(
      `节拍基本没标：只有 ${(annotated * 100).toFixed(0)}% 的段落不是「常规」（下限 ${MIN_ANNOTATED * 100}%）。\n` +
        `      现在出片会是全程一个调子——E01 就是这么翻过一次，全片重来。`
    );

  // ── 场景 ──
  const scenesPath = `${dir}/scenes.json`;
  if (!existsSync(scenesPath)) {
    err(`没有 scenes.json`);
    return out;
  }
  const doc = JSON.parse(readFileSync(scenesPath, 'utf8')) as {
    /** 旧版式留档，ship 已经不读了 */
    cover?: Record<string, string>;
    yt?: { kicker?: string; big?: string; hook?: string[]; motif?: string; palette?: string };
    scenes?: { no: number; comp: string; title: string }[];
  };
  const scenes = doc.scenes ?? [];
  if (!scenes.length) err('scenes.json 里一张图都没有');

  const maxNo = Math.max(...lines.map((l) => l.no));
  for (const s of scenes) {
    if (!COMPOSITION_NAMES.includes(s.comp)) err(`场景「${s.comp}」不存在。可用：${COMPOSITION_NAMES.join(' / ')}`);
    if (s.no > maxNo) err(`场景「${s.title}」挂在第 ${s.no} 段，但稿件只有 ${maxNo} 段——这张图排在音频结束之后`);
    if (!s.title?.trim()) err(`第 ${s.no} 段那张图没有题字`);
    if (s.title && s.title.length > 14) warn(`题字「${s.title}」${s.title.length} 字，超过 14 字会挤到画面外`);
  }
  const nos = scenes.map((s) => s.no);
  for (let i = 1; i < nos.length; i++)
    if (nos[i] <= nos[i - 1]) err(`场景段号不是递增的：第 ${nos[i - 1]} 段之后又出现第 ${nos[i]} 段`);

  // ── 封面 ────────────────────────────────────────────────────────────
  //
  // **2026-08-23 起只有一种版式。** 成片第一帧、上传横版、微信 1:1
  // 全部由 `yt-cover.ts` 出，数据是 scenes.json 的 `yt` 块。
  // 旧版式（`shuoshu-cover.ts` + `cover` 块）ship 已经不调了，这里也就不再查它 ——
  // E01–E04 那几期的 `cover` 块留着不碍事，是留档。
  //
  // 这一段**必须拦在 TTS 之前**：yt 块写错的话，音频白跑十几分钟才炸在封面那一步。
  const yt = doc.yt;
  if (!yt)
    err(
      'scenes.json 里没有 yt 那一块 —— 封面出不来，而封面就是成片第一帧。\n' +
        '    照这个写（跟 scenes 并排）：\n' +
        '    "yt": { "kicker": "聊斋 · 婴宁", "big": "不笑",\n' +
        '            "hook": ["压垮她的不是{官司}", "是婆婆那句{好话}"],\n' +
        '            "motif": "smile_flat", "palette": "ink" }'
    );
  else {
    for (const k of ['kicker', 'big', 'motif', 'palette'] as const) if (!yt[k]) err(`封面缺 yt.${k}`);
    if (yt.motif && !YT_MOTIFS[yt.motif])
      err(`封面图形「${yt.motif}」不存在。可用：${Object.keys(YT_MOTIFS).join(' / ')}`);
    if (yt.palette && !YT_PALETTES[yt.palette])
      err(`配色档「${yt.palette}」不存在。可用：${Object.keys(YT_PALETTES).join(' / ')}`);
    // 主字：两个字。三字要降到 190px，高度会跌破画面的三分之一（规范 §五）
    const bigLen = [...(yt.big ?? '')].length;
    if (bigLen > 3) err(`主字「${yt.big}」${bigLen} 字。规范 §五：两个字，三字只在图形让位时才允许`);
    else if (bigLen === 3) warn(`主字「${yt.big}」3 字，字号要降到 190px，高度会跌到画面的 26%`);
    // **主字不能照抄篇名。** 规范 §五 点名说这是说书线最容易搞错的一处：
    // 篇名是书名（畫皮 / 促織），主字要的是钩子或诊断词
    if (yt.big && doc.cover?.title && [...doc.cover.title].some((c) => yt.big!.includes(c)))
      warn(`主字「${yt.big}」跟篇名「${doc.cover.title}」有重字 —— 主字是钩子不是书名（§五）`);
    if (!Array.isArray(yt.hook) || yt.hook.length !== 2) err('yt.hook 要两行，不多不少（规范 §五：绝不三行）');
    else {
      let hot = 0;
      for (const [i, line] of yt.hook.entries()) {
        const len = [...line.replace(/[{}]/g, '')].length;
        if (len > 10) warn(`副标第 ${i + 1} 行「${line.replace(/[{}]/g, '')}」${len} 字，超过 10 字（§五）`);
        hot += (line.match(/\{[^}]*\}/g) ?? []).length;
      }
      if (hot > 2) warn(`副标圈了 ${hot} 处重点词，两行合计最多两处 —— 多了就没有落点了（§五末）`);
    }
  }

  // ── 有音频之后才能查的：画面密度 ──
  const manifestPath = `${dir}/audio/全片.manifest.json`;
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { duration: number; cues: { no: number; start: number }[] };
    const startOf = (no: number) => m.cues.find((c) => c.no >= no)?.start ?? m.duration;
    for (let i = 0; i < scenes.length; i++) {
      const a = startOf(scenes[i].no);
      const b = i + 1 < scenes.length ? startOf(scenes[i + 1].no) : m.duration;
      if (b - a > MAX_SCENE_SEC)
        warn(`「${scenes[i].title}」要挂 ${(b - a).toFixed(0)} 秒（上限 ${MAX_SCENE_SEC}）——这一段观众盯着一张静止图`);
    }
    // 场景图数量对不上稿件长度也提一句
    const per = m.duration / scenes.length;
    if (per > 45) warn(`平均每张图 ${per.toFixed(0)} 秒，${scenes.length} 张撑 ${(m.duration / 60).toFixed(1)} 分钟偏少`);
  }

  return out;
}

function main() {
  const { id, dir } = resolveEp(process.argv.slice(2));
  const issues = preflightShuoshu(dir);
  const errors = issues.filter((i) => i.level === 'error');
  console.log(`《${id}》体检`);
  if (!issues.length) {
    console.log('  ✓ 没发现问题');
    return;
  }
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  console.log(`\n${errors.length} 个错 / ${issues.length - errors.length} 个提醒`);
  if (errors.length) process.exit(1);
}

if (process.argv[1]?.includes('shuoshu-preflight')) main();

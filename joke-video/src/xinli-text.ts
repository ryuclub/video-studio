// ── 文字版：把正文写到画面上（整句上浮）────────────────────────────────
//
// 用法：npx tsx src/xinli-text.ts --line 心理 --ep e02
//       npx tsx src/xinli-text.ts --line 禅佛典 --ep 第七个饼
//       npx tsx src/xinli-text.ts --line 心理 --ep e02 --cover-sec 2
//
// **心理线和禅佛典线共用这一份**（跟封面 `xinli-cover.ts` 一样）。
// 墨色纸色跟着线路的 palette 走，不写死。
//
// 出的是 `成片/<part>/文字.ass`，一层字幕轨。**画面一张都不用重渲** ——
// 背景还是 `zhiyu-scene.ts` 出的那批 PNG，出片时 ffmpeg 在上面烧一层：
//
//   npx tsx src/zhiyu-video.ts --line 心理 --ep e02 --text-layer
//
// ── 为什么是 ASS 而不是多渲一批 PNG ──
//
// 逐句上浮要做成 PNG 的话，一句一个入场动画 = 12 帧，E02 有 135 句，
// 连进度线那几张一共约 1500 张。**实测**（这台机器，resvg）：
// 带文字的帧 0.39–0.80 秒一张，8 路 worker 并行摊到 106ms —— 出图 2.7 分钟、
// 磁盘 120M，而且**改一个字要把 1500 张全部重渲**。
//
// ASS 这条路：0 张图、0 秒渲染、几十 KB 的文本，改字重跑一次 ffmpeg 就行。
// 这套手艺仓库里早就有（`src/lib/slides.ts` 的 PPT 风整条就是 ASS 事件），
// 动效的参数照搬 `video-pipeline` 那套 fx-kit 移植（上浮位移 24、入场 450ms）。
//
// ── 这一版是另一档产品，不是给常规版加特效 ──
//
// 常规版继承的是治愈线的助眠档护栏：画面几乎不动，字幕默认不烧（**2026-08-21 起「不烧」是缺省不是禁令**），
// 「片内所有参数都在往无聊上调，就是为了不给人一个睁眼的理由」。
// **全篇文字上屏是反着来的** —— 它服务的是静音看的人。所以两版并存、
// 各出各的文件，`zhiyu-video.ts` 不带 `--text-layer` 时一个像素都不变。
//
// ── 屏上的字 = 字幕的字 ──
//
// 断句直接用 `packLines()`（字幕那套，一条最多 20 字，切在标点上），
// 句内时间按字数比例分 —— 跟 `zhiyu-video.ts` 里的 `subtitles()` 同一套算法。
// 这不是省事：**两处各算一套的话，屏上的字和 .srt 会慢慢对不上**，
// 而那种错要等到有人开着软字幕看才会发现。
//
// 段级时间是准的（manifest 给的），句级是内插出来的，误差累到段末约半秒。
// 整句上浮对这个不敏感（提前 `LEAD` 秒浮出来就行）；**逐字打字机对它很敏感**，
// 一个字错拍就看得出来 —— 要做逐字得先上波形吸附（`snapToDip`，说书线在用）。
//
// ── 题句卡那几段跳过 ──
//
// 引句和命名卡已经由 `zhiyu-scene.ts` 画进背景图里了（竖排、盖一层宣纸）。
// 文字层再横排写一遍就是两层字打架，所以**凡是落在题句卡时间窗里的段落，
// 这一层不写**。竖排＝古文与机制名、横排＝正文，这个分工是有意的。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolveEp, LINE } from './zhiyu-ep.js';
import { packLines, tidyCaption } from './shuoshu-srt.js';
import { SW, SH, planQuotes, C, type QuotePlan } from './zhiyu-scene.js';
import { mmss } from './zhiyu-audio.js';

const { id: EP, dir: PROJ } = resolveEp(process.argv.slice(2));

// ── 版式 ──────────────────────────────────────────────────────────────
//
// 窗子是 zhiyu-scene 的 L.win（430,132,1190,742）。字直接落在景上，**不垫底板**。
//
// ── 为什么没有底板 ──
//
// 第一版在字底下铺了一张纸色的半透明纸条（题句卡那个做法）。它确实挡住了
// 木格窗的格条，但**一段字对应一个矩形，看着就是一个贴上去的色块** ——
// 而且纸条是固定宽度的，短句一来右边空掉一大半，那块空白比格条更显眼。
//
// 题句卡能用纸条是因为它**只占几秒、一期两三张**，那几秒本来就是要「停一下」。
// 正文这一层是全程在的，全程挂一个方块就是给画面加了一件常驻家具。
//
// 现在改成**给字本身描一圈纸色的柔光**（见 HALO）：挡格条是它原本的活，
// 一个字管一个字那么大的范围，没有边界、没有形状，也就没有「块」。

const WIN = { x: 430, y: 132, w: 1190, h: 742 };
/** 文字区相对窗子往里收多少 */
const INSET = 34;
/**
 * 正文字号。**44 → 88（2026-08-24 用户定，翻倍）。**
 *
 * 翻倍不是只把这个数改掉就完了 —— 一行装得下几个字跟着砍一半，见 `MAX_LINE`。
 * 原来这儿写着「一条最多 20 字（packLines 的 MAX_CHARS），20×44 = 880 < 文字区宽」，
 * 那句话在 88 下是错的：20×88 = 1760，比整扇窗还宽。
 */
const SIZE = 88;
/** 行距 = 字号 × 这个系数 */
const LH_K = 1.78;
/** 正文左边距（相对文字区左边） */
const TEXT_PAD = 46;
/** 一行真正能用的宽度 */
const TEXT_W = WIN.w - INSET * 2 - TEXT_PAD;
/**
 * 一行几个字。**从字号反推，不写死。**
 *
 * `packLines` 的缺省 20 是给 `.srt` 定的（13px 那一档字幕），
 * 这一层的字是它的六七倍大，照抄那个数会横着冲出窗子 ——
 * 而 **libass 不会因为画到窗外报错**，只会把字压在木格窗框上，图照出。
 */
const MAX_LINE = Math.floor(TEXT_W / SIZE);

// ── 动效 ──────────────────────────────────────────────────────────────
//
// 数照搬 fx-kit 移植那一套（`video-pipeline/src/layers/scenes.ts`）：
// 位移 24（全仓都在 16–28 这个带里，改它等于改整套视觉语言的手感）、
// 入场 450ms、缓动 easeOutCubic。
//
// **缓动在 ASS 里是 `\move` 的直线插值，做不出 cubic。**
// 450ms 的位移只有 24px，直线和 cubic 的差别肉眼分不出来；
// 真要缓动得把一句拆成若干个 `\t` 段，为这点差别不值得。

/** 上浮位移（px，按 1920×1080） */
const RISE = 24;
/** 入场时长（ms） */
const ENTER_MS = 450;
/** 淡入 / 淡出（ms）。淡出是整段一起走 */
const FADE_IN_MS = 300;
const FADE_OUT_MS = 380;
/**
 * 每句比声音提前多少秒浮出来。
 *
 * **不提前就像字幕**：字和声音同时到，观感是「这句话被念出来了」；
 * 提前一点才是「这句话被写下来了，然后有人念它」。
 */
const LEAD = 0.28;
/** 段末整块多留多久再淡出。段与段之间是 1.25 秒（zhiyu-beat 常规），留 0.6 还剩得下 */
const TAIL = 0.6;

/** 颜色：ASS 是 &HBBGGRR，不是 RGB。写反了不报错，只是颜色不对 */
const bgr = (rgb: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(rgb);
  if (!m) throw new Error(`颜色写法不认识：${rgb}`);
  return `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase();
};

/**
 * 片内墨色 / 纸色，**跟着线路走**（`zhiyu-scene.ts` 的 `C`，它已经把
 * `zhiyu-lines.ts` 的 palette 合进 BASE 了）。
 *
 * 原来这儿抄的是心理线那两个字面值，注释写着「改那边这儿要跟着改」。
 * 加禅佛典线的时候就兑现了：那条线的景是赭石暖色，抄来的冷灰字浮在上面
 * 像贴上去的。**这种错不会报，只会看着不对。**
 */
const INK = bgr(C.ink);
const PAPER = bgr(C.paper);
/**
 * 柔光：字周围一圈纸色的描边，糊开。**这是底板的替代品。**
 *
 * 干的是同一件活 —— 让横穿整扇窗的一行字不被木格条和车厢扶手咬 ——
 * 但作用范围只有一个字那么大，没有边界也就没有「块」。
 *
 * 两个数一起调：
 *   OUTLINE  描边宽度。小于 2 挡不住格条，大于 4 笔画之间的白开始糊成一片
 *   BLUR     糊多少。0 是硬描边（看着像给字加了白边的字幕），糊开才像纸在字后面透出来
 *
 * 颜色用 `PAPER`，跟和纸底同色 —— 用纯白会在这张低对比的图上跳出来。
 */
const OUTLINE = 3;
const BLUR = 2.4;

/**
 * 字体名**必须写全带 weight 的那个**。
 *
 * OTF 的 family 名是「Noto Serif CJK SC Medium」，不是「Noto Serif CJK SC」。
 * 写短了 libass 匹配不上，**静默 fallback 到系统黑体** —— 画面上有字，
 * 但不是这个频道的字，而且不报任何错。实测过一版才发现。
 */
const FONT = 'Noto Serif CJK SC Medium';

/** 只数字，标点不占时间。跟 shuoshu-srt / zhiyu-video 的 weigh 是同一个定义 */
const weigh = (s: string) => (s.match(/[一-龥a-zA-Z0-9]/g) ?? []).length;


const esc = (s: string) => s.replace(/[{}\\]/g, '').replace(/\n/g, ' ');

/** 秒 → ASS 的 h:mm:ss.cc */
function at(t: number): string {
  const v = Math.max(0, t);
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

interface Cue { no: number; act: string; text: string; start: number; end: number }
interface Manifest { part: string; epTitle: string; duration: number; cues: Cue[] }
interface PubDoc {
  book: string;
  shot: string;
  parts: {
    part: string;
    epTitle?: string;
    免命名卡?: string;
    scenes?: { at: string; shot: string }[];
    quotes?: Parameters<typeof planQuotes>[1];
  }[];
}

interface Line { text: string; start: number }

/**
 * 断行。**还是 `packLines`，只是把上限换成这一层自己的 `MAX_LINE`。**
 *
 * 算法跟 `.srt` 共用这一件事没有变（两处各写一套迟早对不上，
 * 而那种错要等到有人开着软字幕看才发现）—— 变的只有「一行几个字」，
 * 因为这一层的字号是字幕的六七倍，**同一个数在两边不可能同时对**。
 *
 * 后面那道再切：`packLines` **只在小句超过 `max × 1.4` 时才硬切**，
 * 所以它吐出来的行最长可以到 1.4 倍。字幕那一档多出 40% 只是挤一点，
 * 88px 这一档多出 40% 就是冲出窗外。**这里按显示字数（标点也占宽）再切一刀。**
 *
 * 切法是**均分，不是切满即溢出**：14 个字切成 7+7，不是 12+2。
 * 后者会在整块字底下吊一个两字的尾巴，一段话里最显眼的就成了那行空白。
 * （`chapterCols` 那儿是同一条理由、同一个写法。）
 */
function fitLines(text: string): string[] {
  const out: string[] = [];
  for (const l of packLines(text, MAX_LINE)) {
    const cs = [...l];
    if (cs.length <= MAX_LINE) {
      out.push(l);
      continue;
    }
    const per = Math.ceil(cs.length / Math.ceil(cs.length / MAX_LINE));
    for (let i = 0; i < cs.length; i += per) out.push(cs.slice(i, i + per).join(''));
  }
  return out;
}

/** 一段话 → 若干小句 ＋ 每句的起点。分时跟字幕同一套（按字数比例内插） */
function linesOf(c: Cue): Line[] {
  const parts = fitLines(c.text);
  const total = parts.reduce((s, l) => s + weigh(l), 0) || 1;
  const out: Line[] = [];
  let t = c.start;
  for (const l of parts) {
    out.push({ text: l, start: t });
    t += ((c.end - c.start) * weigh(l)) / total;
  }
  return out;
}

/** 这一段是不是被题句卡盖住了。盖住就不写这一层，免得两层字打架 */
const coveredByCard = (c: Cue, qs: QuotePlan[]) => qs.some((q) => c.start < q.t1 && c.end > q.t0);

function build(p: PubDoc['parts'][number], doc: PubDoc, coverSec: number): string {
  const dir = `${PROJ}/成片/${p.part}`;
  const mPath = `${dir}/manifest.json`;
  if (!existsSync(mPath))
    throw new Error(`没有 ${mPath}\n先跑：npx tsx src/zhiyu-episode.ts --line ${LINE} --ep ${EP} --part ${p.part}`);
  const m = JSON.parse(readFileSync(mPath, 'utf8')) as Manifest;
  const quotes = planQuotes(m, p.quotes ?? []);

  const lh = Math.round(SIZE * LH_K);
  const textX = WIN.x + INSET + TEXT_PAD;

  const events: string[] = [];
  let shown = 0;
  let skipped = 0;
  let maxLines = 0;
  /**
   * 太长的段落。**只报不拦** —— 装得下不等于好看：
   * 一段铺满整扇窗就是一堵字墙，而这一档的卖点恰恰是「一次只来一句」。
   * 报出来让写稿的人决定要不要在那儿断一段，不替他改。
   *
   * **6 这个数是 44px 那一档的**（窗里排得下 9 行，6 行就算墙了）。
   * 字号翻倍之后窗里一共才 4 行，写死 6 等于这条提醒永远不响 ——
   * 所以按「装得下的行数减一」算：**顶到上限那一段，先报出来。**
   */
  const WALL = Math.max(3, Math.floor(WIN.h / lh) - 1);
  const walls: string[] = [];

  for (const c of m.cues) {
    if (coveredByCard(c, quotes)) {
      skipped++;
      continue;
    }
    const lines = linesOf(c);
    maxLines = Math.max(maxLines, lines.length);
    if (lines.length > WALL) walls.push(`${mmss(c.start)}　${lines.length} 行　${c.text.slice(0, 22)}…`);

    // 整段的位置**一次算定**：先按行数把整块在窗内居中，各行的 y 从头到尾不动。
    // 一句一句往下长、每来一句就重新居中的话，已经在屏上的字会跟着挪 ——
    // 那是这一档最刺眼的动作（画面上唯一在动的东西，还是一整块字）。
    const blockH = lines.length * lh;
    const top = WIN.y + WIN.h / 2 - blockH / 2;

    // 整段一起收：每一行的事件都拖到 t1，段末一块淡出
    const t1 = c.end + TAIL;

    lines.forEach((l, i) => {
      const y = Math.round(top + i * lh);
      const text = tidyCaption(l.text);
      if (!text) return;
      events.push(
        ev(1, l.start - LEAD + coverSec, t1 + coverSec,
          // 描边宽度在 Style 里；blur 没有 Style 字段，只能逐条给
          `{\\move(${textX},${y + RISE},${textX},${y},0,${ENTER_MS})` +
            `\\blur${BLUR}\\fad(${FADE_IN_MS},${FADE_OUT_MS})}${esc(text)}`)
      );
      shown++;
    });
  }

  const head = `[Script Info]
; 文字版的正文层。由 src/xinli-text.ts 生成，不要手改 —— 改稿之后重跑。
; cover-sec: ${coverSec}
; **时间已经加过片头封面的 ${coverSec} 秒。** zhiyu-video.ts --text-layer 会核这一行，
; 对不上直接报错：错了的话画面和声音会整条偏 ${coverSec} 秒，而且看着一切正常。
ScriptType: v4.00+
PlayResX: ${SW}
PlayResY: ${SH}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: 正文,${FONT},${SIZE},${INK},${INK},${PAPER},&H00000000,0,0,0,0,100,100,0,0,1,${OUTLINE},0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  console.log(`${p.part}篇《${p.epTitle ?? ''}》　${shown} 句上屏　${events.length} 条事件`);
  console.log(`  跳过 ${skipped} 段（落在题句卡时间窗里，那几段已经竖排画进背景图了）`);
  console.log(`  最长一段 ${maxLines} 行，占 ${maxLines * lh} px（窗高 ${WIN.h}，上限 ${Math.floor(WIN.h / lh)} 行）`);
  if (maxLines * lh > WIN.h)
    throw new Error(`最长的那一段 ${maxLines} 行装不进窗子。要么把 SIZE 调小，要么 packLines 的每条字数调小`);

  // ⚠ **落盘放在这一句之后。** 原来是先写文件再抛：抛出来的那一次留下的是一份
  // 语法完全合法、只是装不进窗子的 `文字.ass`，而 `zhiyu-video.ts --text-layer`
  // 只认头上那行 `; cover-sec:` —— 下一次 build 会一声不响地把这份被否掉的层烧进片子。
  // 「报成功的失败」那两个坑就是这么来的：**失败就不要留半成品。**
  const out = `${dir}/文字.ass`;
  writeFileSync(out, head + events.join('\n') + '\n', 'utf8');
  console.log(`  → ${out}`);
  if (walls.length) {
    console.log(`  ! ${walls.length} 段超过 ${WALL} 行，屏上是一堵字墙（装得下，但一次来这么多没人读）：`);
    for (const w of walls) console.log(`      ${w}`);
    console.log(`      要改就在稿子里断一段，别在这儿调字号 —— 字号是给全篇定的`);
  }
  for (const q of quotes) console.log(`  ${mmss(q.t0).padStart(6)}　题句卡（背景层）　「${q.text.slice(0, 16)}」`);
  return out;
}

/** 拼一条 Dialogue */
function ev(layer: number, start: number, end: number, text: string): string {
  return `Dialogue: ${layer},${at(start)},${at(end)},正文,,0,0,0,,${text}`;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (k: string) => {
    const i = argv.indexOf(`--${k}`);
    return i < 0 ? undefined : argv[i + 1];
  };
  const only = flag('part') ?? null;
  // 缺省 2 秒，跟 zhiyu-video.ts 的 --cover-sec 缺省值一致。两边必须是同一个数
  const coverSec = Number(flag('cover-sec') ?? 2);
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;

  const made: string[] = [];
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    made.push(build(p, doc, coverSec));
  }
  console.log('');
  console.log('出片：npx tsx src/zhiyu-video.ts --line ' + LINE + ' --ep ' + EP + ' --text-layer');
  console.log('**常规版不受影响** —— 不带 --text-layer 出的还是原来那份，文件名也不一样');
}

if (process.argv[1]?.includes('xinli-text')) main();

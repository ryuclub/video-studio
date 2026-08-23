// ── A 类结构：对话反转 ────────────────────────────────────────────────
// 铺垫 → 提问 → 回应 → 反转 → 定格留白。
// 这一层是整套方案里最值钱的部分：换段子、换动物、换人都不改这里。

import { lineText, type JokeCfg, type Timeline, type Segment, type SfxCue } from '../types.js';
import { clauseGap, type Pace } from '../pace.js';


/** 没有配音时的时长估算：中文约每字 0.22s */
export function estimateDur(text: string): number {
  return Math.max(1.1, [...text].length * 0.22 + 0.5);
}

import { buildTimelineB } from './typeB.js';

/** 按 type 分发。A 对话反转 / B 旁白叙述 */
export function buildTimeline(cfg: JokeCfg): Timeline {
  if (cfg.type === 'B') return buildTimelineB(cfg);
  return buildTimelineA(cfg);
}

function buildTimelineA(cfg: JokeCfg): Timeline {
  /**
   * 「先出声，后出人」这一档**没有开场空镜**：`intro = 0`，
   * 第 1 句的 `padBefore` 也压成 0 —— 音轨从 0.0 起，
   * 黑底大字和第一个字必须同时到，差半帧就露馅（见 `types.ts` 的 `opening`）。
   *
   * ⚠ 写了 `cfg.intro` 也不生效，**这是有意的**：这一档里「空镜多久」
   * 不再是一个可调的数，它恒等于零。留着那个旋钮只会让人以为还能调。
   */
  const voiceFirst = isVoiceFirst(cfg);
  const intro = introOf(cfg);
  const freezeDur = cfg.freeze ?? 2.0;
  const holdDur = cfg.hold ?? 4.0;

  const segments: Segment[] = [{ kind: 'intro', start: 0, end: intro }];
  const sfx: SfxCue[] = [];

  let t = intro;
  let punchStart = intro;
  let punchEnd = intro;

  cfg.lines.forEach((line, i) => {
    const padBefore = voiceFirst && i === 0 ? 0 : line.padBefore ?? (line.beat === 'punch' ? 0.4 : 0.15);
    const dur = line.dur ?? estimateDur(lineText(line));
    const padAfter = line.padAfter ?? (line.beat === 'punch' ? 0.35 : 0.2);
    const start = t + padBefore;
    const end = start + dur;
    segments.push({ kind: 'line', start, end: end + padAfter, line, lineIndex: i });

    // 字幕弹入的小 pop。默认关掉：它是 780→420Hz 的正弦扫频，听感是个音高明确的
    // "do"，每句话前面来一下，三句就腻了，而且盖住台词起头的字。
    // 想要就在 json 里写 "cues": { "subtitlePop": true }。
    if (cfg.cues?.subtitlePop) sfx.push({ name: 'pop', at: start - 0.04, gain: 0.5 });
    // 回应句用木鱼点一下（这个有节拍作用，默认留着）
    if (line.beat === 'reply' && (cfg.cues?.replyWood ?? true)) sfx.push({ name: 'wood', at: start - 0.06 });
    // 反转句尾拖一个下滑音
    if (line.beat === 'punch') {
      punchStart = start;
      punchEnd = end;
      if (cfg.cues?.punchSlide ?? true) sfx.push({ name: 'slide', at: Math.max(start, end - 0.55) });
    }
    t = end + padAfter;
  });

  const freezeStart = t;
  segments.push({ kind: 'freeze', start: freezeStart, end: freezeStart + freezeDur });
  segments.push({ kind: 'hold', start: freezeStart + freezeDur, end: freezeStart + freezeDur + holdDur });
  const duration = freezeStart + freezeDur + holdDur;

  // 定格那一下：BGM 骤停 + 咚。
  // **独白 deadpan 档要关掉**（cues.freezeThud: false）—— 那一声等于自己先敲了锣，
  // 而落点最需要的是「什么都不发生」的半拍。
  if (cfg.cues?.freezeThud ?? true) sfx.push({ name: 'thud', at: freezeStart });
  // 定格之后的蝉鸣（死寂里的夏天）
  if ((cfg.ambience ?? 'grass') !== 'none') {
    sfx.push({ name: 'grass', at: 0, until: intro + 0.6 });
    sfx.push({ name: 'cicada', at: freezeStart + 0.25, until: duration });
  }
  // 开场的一声"嘶"（蛇专属，换成人物记得关掉）
  // ⚠ intro 为 0 时不出：那一声本来是垫在空镜上的，没有空镜就直接压在第一个字上了
  if ((cfg.cues?.introHiss ?? true) && intro > 0) sfx.push({ name: 'hiss', at: intro * 0.55 });

  return { cfg, segments, duration, punchStart, punchEnd, freezeStart, sfx };
}

/**
 * **有效 intro**（开场空镜多长）。
 *
 * ⚠ **别再直接读 `cfg.intro`。** 「先出声，后出人」那一档里空镜恒等于零，
 * 而 `cfg.intro` 里那个 1.2 还留着（稿子是从老样子改过来的，没人会记得去删）。
 * 直接读它的地方会拿到一个跟时间轴对不上的数 —— 眨眼和眼动的排程按 1.2 起算、
 * 实际画面 0.0 就在说话，整条错位 1.2 秒，**而且不报错**。
 */
export function introOf(cfg: JokeCfg): number {
  return isVoiceFirst(cfg) ? 0 : cfg.intro ?? 2.0;
}

/**
 * 「先出声」那两档（② 场景 / ③ 物件）。**它们的时间轴一模一样** ——
 * 音轨 0.0 起、没有空镜、第 1 句说完人才滑进来；差别只在第 1 句期间画面上是什么。
 *
 * ⚠ **凡是判「是不是先出声」的地方都走这个函数，别写 `=== 'voice-first'`。**
 * 加档 ③ 的时候就漏了两处（`introOf` 和第 1 句 padBefore 归零），
 * 后果是 007 的音轨还是从 1.35 秒起 —— **而画面照常从 0.0 出首帧**，
 * 字和声音差了一秒半。这种错不报错，只能靠眼睛和 ffmpeg 量出来。
 */
export function isVoiceFirst(cfg: JokeCfg): boolean {
  const s = openingStyleOf(cfg);
  return s === 'voice-first' || s === 'object-first';
}

/**
 * **有效出场档。** 写了就按写的；没写的，看它是不是老马线。
 *
 * ── 为什么缺省是 ③ 而不是 ① ──
 *
 * 2026-08-22 翻的默认。档 ① 那 1.3 秒无声入场动画是**已知在掉数据**的东西
 * （首帧规范 v1 开篇：2 秒跳出 50–80%），把它留在缺省位上，等于
 * 「不特别注明就用那个已知有问题的开场」。**缺省该是当下最好的做法。**
 *
 * ⚠ **只对老马线翻。** 判据是 `rig === 'horse'`，跟 `cover.ts`、`yiye-publish.ts`
 * 分流用的是同一条。段子和《一页故事》没有出场档这回事，缺省永远是 ①ted——
 * 不加这个判断的话，那两条线会跟着变成「音轨从 0.0 起、没有空镜」，一条都跑不通。
 *
 * ⚠ **翻默认的同时，001–006 和 009 全部补了显式的 `figure-first`。**
 * 那七条是靠「不写 = ①」跑的，默认一变它们就跟着变档，而且每一条都缺
 * `frameSubject`/`frameText` —— 一次静默地把七条已出片判成不合格的改动。
 * **改缺省值这件事，配套动作永远是「先把靠旧缺省活着的都钉死」。**
 */
export function openingStyleOf(cfg: JokeCfg): 'figure-first' | 'voice-first' | 'object-first' {
  if (cfg.opening?.style) return cfg.opening.style;
  return cfg.characters?.some((c) => c.rig === 'horse') ? 'object-first' : 'figure-first';
}

/**
 * 「先出声，后出人」那张黑底大字卡：它盖到什么时候、上面写什么、人滑多久。
 *
 * **不是这一档就返回 null**，调用方按 null 走老路径 —— 老样子那条线
 * （001–009 全部）一个分支都不进。
 *
 * ⚠ **下沿取第 1 句配音停的那一刻，不含 padAfter。**
 *
 * 先按 segment 的 end 做过（含 0.35 秒 padAfter），理由是「让那句话沉下去」。
 * **看下来那 0.35 秒是多的**：字已经读完了，人还没进来，画面停在那儿等 ——
 * 这条线的停顿是留给画面的（SCRIPT_GUIDE §五），而这一档在那半秒里画面上
 * 什么都不发生。改成句尾即切之后，**他是在这半秒的静音里滑进来的**，
 * 那半拍反而有了内容。
 */
export function openSpan(
  tl: Timeline
): { end: number; text: string; slide: number; style: 'voice-first' | 'object-first'; subject?: string } | null {
  const style = openingStyleOf(tl.cfg);
  if (style === 'figure-first') return null;
  const op: NonNullable<JokeCfg['opening']> = tl.cfg.opening ?? { style };
  const first = tl.segments.find((s) => s.kind === 'line' && s.lineIndex === 0);
  if (!first?.line) return null;
  const speechEnd = first.start + (first.line.dur ?? estimateDur(lineText(first.line)));
  // ⚠ 档 ③ 的首帧字走 `frameText`（首帧规范 §一 那三条硬约束都核它），
  // 档 ② 走 `card`。两个字段不合并 —— 它们的约束不一样：
  // `frameText` 必须 ≤8 字、必须是第 1 句的连续子串；`card` 只是「挑一小句」。
  const text = style === 'object-first' ? op.frameText ?? autoCard(tl.cfg) : op.card ?? autoCard(tl.cfg);
  return { end: speechEnd, text, slide: op.slide ?? 0.9, style, subject: op.frameSubject };
}

/**
 * 卡上写什么：**第 1 句里带数字的那一小句**。
 *
 * 数字是这一档的全部理由 —— 首帧要的就是一个具体的数摆在黑底上
 * （008 挑出来是「前面还有二十三位」）。一句都不带数字就退到最后一小句，
 * 那通常是第 1 句的落脚处。
 *
 * ⚠ 只挑一句、全程不换字。第 1 句常有三小句，逐屏换的话那个数就跑到后面去了，
 * 首帧上就没有它 —— 这一档也就白做了。
 */
function autoCard(cfg: JokeCfg): string {
  const first = cfg.lines[0];
  const parts = (first.say?.map((s) => s.text) ?? [lineText(first)])
    .map((t) => t.replace(/[，。、！？：；]+$/g, '').trim())
    .filter(Boolean);
  const withNum = parts.find((t) => /[\d零一二两三四五六七八九十百千万]/.test(t));
  return withNum ?? parts[parts.length - 1] ?? lineText(first);
}

export function segAt(tl: Timeline, t: number): Segment {
  for (const s of tl.segments) if (t >= s.start && t < s.end) return s;
  return tl.segments[tl.segments.length - 1];
}

/** 当前正在说话的行（不含 pad） */
export function speakingAt(tl: Timeline, t: number): { line: import('../types.js').LineCfg; index: number; local: number } | null {
  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    const dur = s.line.dur ?? estimateDur(lineText(s.line));
    if (t >= s.start && t < s.start + dur) return { line: s.line, index: s.lineIndex!, local: t - s.start };
  }
  return null;
}

/** 当前应该显示的字幕（说话中 + 说完后的 pad 期间继续显示） */
export function subtitleAt(tl: Timeline, t: number): { line: import('../types.js').LineCfg; index: number; prog: number } | null {
  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    if (t >= s.start - 0.12 && t < s.end) {
      return { line: s.line, index: s.lineIndex!, prog: Math.min(1, (t - (s.start - 0.12)) / 0.22) };
    }
  }
  return null;
}

/**
 * 一句话里每个 `say` 小句各占哪一段时间。
 *
 * ── 为什么需要它 ──
 *
 * 字幕原来是**整句一次性铺出来**的。铺垫句无所谓，落点句和转折句致命：
 * 观众三秒读完，后面几秒在听复述 —— **笑点在被听到之前就消费掉了**。
 * 要做到「跟着配音逐屏出」，就得知道每个小句从第几秒开始。
 *
 * ── 怎么算 ──
 *
 * 一句话是一个 wav（TTS 把小句合成完再按 gap 拼起来），所以只有整句的
 * 实测 `dur`。先按字数把「说话时间」摊到各小句上（gap 是已知的静音，先扣掉），
 * 再拿配音包络去**吸附**到真正的静音处 —— 拼接时插的那段 gap 是**真零**，
 * 在包络上是一段谷，找得到。找不到就用估算值，不会崩。
 *
 * 传了 env 才吸附。排眨眼那种地方用估算值就够，字幕才需要准。
 */
export interface PartSpan {
  a: number;
  b: number;
  text: string;
  /** 这一小句自己点的表情。undefined = 沿用 line.look，'' = 归中正视 */
  look?: string;
}

export function partSpans(
  line: import('../types.js').LineCfg,
  start: number,
  dur: number,
  opts: { env?: Float32Array; fps?: number; pace?: Pace } = {}
): PartSpan[] {
  const say = line.say;
  if (!say?.length || say.length === 1)
    return [{ a: start, b: start + dur, text: lineText(line), look: say?.[0]?.look }];

  // gap 没写就跟 tts.ts 用同一套缺省，不然算出来的边界会系统性偏移
  const gaps = say.map((c, i) =>
    i === say.length - 1 ? 0 : c.gap ?? (opts.pace ? clauseGap(c.text, opts.pace) : 0.24)
  );
  const totalGap = gaps.reduce((s, g) => s + g, 0);
  const speech = Math.max(0.2, dur - totalGap);
  const chars = say.map((c) => Math.max(1, c.text.replace(/[\s\p{P}]/gu, '').length));
  const totalCh = chars.reduce((s, c) => s + c, 0);

  const spans: PartSpan[] = [];
  let cur = start;
  for (let i = 0; i < say.length; i++) {
    const d = (speech * chars[i]) / totalCh;
    spans.push({ a: cur, b: cur + d, text: say[i].text, look: say[i].look });
    cur += d + gaps[i];
  }

  const env = opts.env;
  const fps = opts.fps ?? 30;
  if (!env) return spans;

  // 吸附：在估算边界前后 0.5 秒里找**最安静的一帧**，把交界挪过去。
  // 只挪交界，不改总长 —— 最后一小句的 b 永远是 start + dur。
  for (let i = 1; i < spans.length; i++) {
    const guess = spans[i].a;
    const lo = Math.max(0, Math.round((guess - start - 0.5) * fps));
    const hi = Math.min(env.length - 1, Math.round((guess - start + 0.5) * fps));
    let best = -1;
    let bestV = Infinity;
    for (let f = lo; f <= hi; f++) {
      if (env[f] < bestV) {
        bestV = env[f];
        best = f;
      }
    }
    if (best < 0 || bestV > 0.06) continue; // 没找到真谷就信估算值
    // 谷底往后走到重新有声音的那一帧 —— 字幕要在**他开口的那一刻**换
    let f = best;
    while (f < env.length - 1 && env[f] < 0.08) f++;
    const at = start + f / fps;
    if (at > spans[i - 1].a + 0.15 && at < spans[i].b - 0.15) {
      spans[i - 1].b = at;
      spans[i].a = at;
    }
  }
  return spans;
}

/** 这一刻正在被念的是哪个小句。传 env 才准，见 partSpans */
export function partAt(
  line: import('../types.js').LineCfg,
  start: number,
  dur: number,
  t: number,
  opts: { env?: Float32Array; fps?: number; pace?: Pace } = {}
): PartSpan {
  const spans = partSpans(line, start, dur, opts);
  for (const s of spans) if (t < s.b) return s;
  return spans[spans.length - 1];
}

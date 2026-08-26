// ── 老马 · 用语规范的机器部分（三条线共用）──────────────────────────
//
// 规范正文：`horse/用语规范.md`。**这儿只实现它 §十一 那张表**，
// 且按 §12.2 改了四处 —— 照抄那张表会误伤，四处都是拿 18 条已出稿量出来的。
//
// ⚠ **一份实现，两个入口共用** —— `laoma-check`（单点式／累积式）和
// `laoma-long-check`（长片）各自 import 这一支。**没有第三个脚本。**
//
// ⚠ 跟 `zhiyu-diction.ts` 是**两份，不合并**。规范正文自己就写着
// 「与说书、治愈两份规范并行，互不参照 —— 老马是口语角色，
// 有几条规则跟那两边正好相反」：治愈禁语气词，老马靠语气词活着；
// 治愈要一段一句，老马一条 line 里可以有两三拍。合成一份就得到处写 if(线)。
//
// ⚠ 这条线**没有 `用语豁免` 开关**（治愈线有）。因为 18 条已出稿按小句量
// 硬伤 0 处 —— 不需要后门。别看见治愈那边有就顺手加过来：
// **没人用的开关迟早会被用来关掉真问题。**

/** §五 那张表 */
export const LEN = {
  /** 单句上限 —— 三条线里最严。**按小句量，不按整行**（§12.2） */
  clause: 16,
  /** 排比句上限 */
  parallel: 12,
  /** 硬伤线。过了这个是 error */
  hard: 24,
};

/** §2.1 高危多音字表。**整条汇总一行，不逐行报**（§12.2）*/
export const 多音字 = [...'都得了着干会差还好少长重分中转空数应便落'];

/**
 * §2.2 点名的三个是「都 得 了」，但**闸门只报「得」**。
 *
 * ⚠ 拿 18 条已出稿量过：报三个字的话 **18/18 全中**，长片也中 ——
 * 100% 命中的闸门等于没有闸门，只会把同一块里真正该看的几条淹掉。
 * 拆开看：「了」18/18（几乎全是 le，没有歧义）、「都」9/18（几乎全是 dōu）、
 * **「得」6/18** —— 它是唯一真有三读（de／dé／děi）、且规范自己举的例子
 *（「说了就得解释」）就出在它身上的。
 *
 * 「了」「都」不是不用听，是**退回 §十 那张出稿检查表** ——
 * 每期都要做的固定动作属于检查表，不属于闸门。
 */
const 必听 = [...'得'];

/** §3.1 口语字。**这些是老马的命，不能删** —— 只查密度和连排 */
export const 口语字 = [...'啥咋嘛呗吧哈呢哟嘞'];

/**
 * §3.2 一条段子里方言字不超过三处。
 *
 * ⚠ **这条只对段子线成立** —— 规范原文写的是「一条段子里」，量的是
 * 25–45 秒里的密度。长片 001 有 82 句、4 处方言字，套这个绝对值就是误报。
 * 所以由调用方给：段子线传 3，长片传 `null` 关掉。
 */
const 方言上限默认 = 3;

/** §7.2 书面概念词黑名单。**老马嘴里一个都不许有** */
export const 书面概念词 = [
  '看破', '执念', '意义', '本质', '状态', '机制', '认知',
  '内耗', '能量', '磁场', '底层逻辑', '情绪价值',
];

/**
 * §7.3 判断句式。**老马不给自己下定义**
 *
 * ⚠ 第一个式子写成 `/我是不[^，。！？]/` 会**误伤真疑问句** ——
 * 「我是不是该早点说」被当成下定义。18 条已出稿里一处没中，
 * 但式子本身不稳，所以排掉「我是不是」。
 */
const 定义句式 = [/我是不(?!是)[^，。！？]/, /我就是个/, /我这种人/, /我这个人就是/, /我是那种/];

/** §12.4 落点前那一拍：绝对够，或明显长于句间 —— 满足其一 */
export const BEAT = { abs: 0.8, rel: 1.3 };

/** §12.3 line 内句号 ≥3 才报 —— 两拍是对的，三拍才该拆 */
const 句号上限 = 2;

const cn = (s: string) => [...s.replace(/[^一-龥A-Za-z0-9]/g, '')].length;

/** 小句 = 逗号／句号／顿号切开的那一段（§12.2） */
const 切小句 = (t: string) =>
  t.split(/[，。！？；、]/).map((s) => s.trim()).filter(Boolean);

export interface DictionIssue {
  level: 'error' | 'warn';
  msg: string;
}

export interface DictionInput {
  /** 这一条 line 的全文（`say[]` 拼好之后的） */
  text: string;
  /** 显示用的位置，比如 `第3` 或 `第二段` */
  at: string;
  /**
   * 是不是落点句。
   *
   * ⚠ **落点句长度不在这儿查** —— `laoma-check.ts` 已经有一套更细的
   * （累积式 >20 不计标点 error、单点式 >30 error、>15 warn），
   * 这边再查一遍就是同一件事两个出处，013 会被报两次、字数还对不上。
   * 留这个字段是给将来别的落点专属规则用的。
   */
  punch?: boolean;
  /** 是不是旁白（长片有，段子线没有）*/
  narr?: boolean;
}

export interface DictionOpts {
  /**
   * 体裁。
   *
   * ⚠ 目前这儿的判据**三条线是一样的** —— §九 说的「累积式一句都不能文」
   * 是选词层面的事，机器判不了。留这个口子是因为 §五 那张表迟早会分叉。
   */
  format?: string;
  /**
   * 落点前那一拍。两个数都要给，判据是「或」（§12.4）。
   * 长片没有 `beat: punch` 这套，不传就不查。
   */
  beat?: { gap: number; median: number };
  /** §3.2 方言字上限。不传按 3；长片传 `null` 关掉（见常量处的说明）*/
  方言上限?: number | null;
}

/**
 * 规范 §十一那张表的机器部分。
 * **分级见 §12.5** —— 硬伤 error，其余 warn。
 */
export function checkDiction(lines: DictionInput[], opts: DictionOpts = {}): DictionIssue[] {
  const out: DictionIssue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  let 方言计 = 0;
  const 多音计 = new Map<string, number>();

  for (const l of lines) {
    const t = l.text;
    if (!t) continue;

    // ── §五 句长。**按小句量** ──────────────────────────────
    for (const c of 切小句(t)) {
      const n = cn(c);
      if (n > LEN.hard) err(`${l.at} 小句 ${n} 字，过了硬伤线 ${LEN.hard}：「${c}」`);
      else if (n > LEN.clause) warn(`${l.at} 小句 ${n} 字，超 §五 的 ${LEN.clause}：「${c}」`);
    }

    // ── §1.1 漏停 ────────────────────────────────────────
    if (cn(t) > 10 && !/[，。]/.test(t))
      warn(`${l.at} ${cn(t)} 字一口气没停。§1.1：这句说出来中间有换气的地方吗？有就加逗号 —— 「${t}」`);

    // ── §12.3 line 内句号 ≥3 ──────────────────────────────
    const 句号 = (t.match(/。/g) ?? []).length;
    if (句号 > 句号上限)
      warn(`${l.at} 一条 line 里 ${句号} 个句号，塞了三拍以上，考虑拆屏：「${t}」`);

    // ── §3.2 / §3.3 口语字 ────────────────────────────────
    方言计 += [...t].filter((c) => 口语字.includes(c)).length;
    const 连 = t.match(new RegExp(`[${口语字.join('')}]{2,}`));
    if (连) warn(`${l.at} 口语字连排「${连[0]}」。§3.3：挨着堆，TTS 会读成一串怪音 —— 「${t}」`);

    // ── §2 多音字：**攒着，最后汇总一行**（§12.2）───────────
    for (const c of [...t]) if (多音字.includes(c)) 多音计.set(c, (多音计.get(c) ?? 0) + 1);

    // ── §7.2 书面概念词 ──────────────────────────────────
    for (const w of 书面概念词)
      if (t.includes(w)) err(`${l.at} 书面概念词「${w}」。§7.2 一个都不许有 —— 工位上的人不这么说话`);

    // ── §7.3 判断句式 ────────────────────────────────────
    for (const re of 定义句式)
      if (re.test(t)) warn(`${l.at} 判断句式「${t.match(re)![0]}」。§7.3：老马不给自己下定义，改成认输句（我是不敢 → 我就是没敢试）`);

  }

  // ── §3.2 方言密度：整条一次 ────────────────────────────
  const 方上限 = opts.方言上限 === undefined ? 方言上限默认 : opts.方言上限;
  if (方上限 !== null && 方言计 > 方上限)
    warn(`方言字 ${方言计} 处，超 §3.2 的 ${方上限}。太密违和感会累积，三处以内反而像口音`);

  // ── §4.2 排比字数差 ───────────────────────────────────
  out.push(...查排比(lines));

  // ── §6.2 落点前那一拍（§12.4 的「或」判据）──────────────
  if (opts.beat) {
    const { gap, median } = opts.beat;
    if (gap < BEAT.abs && gap < median * BEAT.rel)
      warn(
        `落点前只停了 ${gap.toFixed(2)}s（全片句间中位 ${median.toFixed(2)}s，${(gap / median).toFixed(2)}×）。` +
          `§6.2：这一拍是笑点和苦味的容器，没有它落点只是最后一句话。` +
          `判据是绝对 ≥${BEAT.abs}s 或 相对 ≥${BEAT.rel}×，两个都没够`,
      );
  }

  // ── §2 多音字汇总 ─────────────────────────────────────
  const 要听 = 必听.filter((c) => 多音计.has(c));
  if (要听.length) {
    const s = 要听.map((c) => `${c}×${多音计.get(c)}`).join(' ');
    out.push({
      level: 'warn',
      msg:
        `多音字抽听：${s}。§2.2 不用逐个改，但生成后要听这几处 —— ` +
        `「得」表"必须"读 děi，「觉得／显得」读 de，TTS 分不清`,
    });
  }

  return out;
}

/**
 * §4.2 排比段：连续三句字数差 ≤4。
 *
 * ⚠ **「连续三句」指的是三条 line，不是一行里的三个句子。**
 * 规范给的例子本身就是三条：
 *
 *     小心翼翼上了很多当
 *     扣扣嗖嗖花了很多钱
 *     认认真真犯了很多错
 *
 * 第一版按「一行里三个句号」判，在长片 001 上 **4 处全是误报** ——
 * 那些只是连着三句的叙述，不是排比。这仓库的规矩是
 * **天天报错的闸门只会教人加 `--anyway`**，所以判据收紧成两条都要满足：
 *
 *   ① 三条连续的 line；
 *   ② 三条在**同一个字位**上有 ≥2 字的公共片段（上面那例是第 4–6 位的「了很多」）。
 *
 * 光靠字数接近判不出排比 —— 叙述句的字数本来就常常接近。
 */
function 查排比(lines: DictionInput[]): DictionIssue[] {
  const out: DictionIssue[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const t = [lines[i].text, lines[i + 1].text, lines[i + 2].text];
    if (t.some((x) => !x || /[，。！？；]/.test(x.slice(0, -1)))) continue; // 排比句是单句，中间不带标点
    if (!同位公共片段(t)) continue;
    const ns = t.map(cn);
    const d = Math.max(...ns) - Math.min(...ns);
    if (d > 4)
      out.push({
        level: 'warn',
        msg:
          `${lines[i].at}–${lines[i + 2].at} 是排比，三句字数 ${ns.join('/')}，差 ${d} > 4。` +
          `§4.2：位置一致，节奏才起得来`,
      });
  }
  return out;
}

/** 三句在同一个字位上是否有 ≥2 字的公共片段 */
function 同位公共片段(t: string[]): boolean {
  const n = Math.min(...t.map((x) => x.length));
  let run = 0;
  for (let k = 0; k < n; k++) {
    if (t[0][k] === t[1][k] && t[1][k] === t[2][k]) {
      if (++run >= 2) return true;
    } else run = 0;
  }
  return false;
}

/**
 * 落点前那一拍的实测值。**给 `laoma-check` 用** ——
 * 长片没有 `beat: punch` 这套结构，不走这儿。
 *
 * 实际停顿 = 前一句 `padAfter` + 落点句 `padBefore` + 前一句的 `beatPause`。
 * ⚠ 只看 `padAfter` 会算少 —— 那是 §12.4 那张表最早量错的地方。
 */
export function 量落点前(
  lines: { padAfter?: number; padBefore?: number; beatPause?: boolean }[],
  punchIdx: number,
): { gap: number; median: number } | undefined {
  if (punchIdx <= 0 || punchIdx >= lines.length) return undefined;
  const gap = (i: number) =>
    (lines[i].padAfter ?? 0) + (lines[i + 1]?.padBefore ?? 0) + (lines[i].beatPause ? 0.8 : 0);
  const 常 = lines
    .map((_, i) => i)
    .filter((i) => i < lines.length - 1 && i !== punchIdx - 1)
    .map(gap)
    .sort((a, b) => a - b);
  if (!常.length) return undefined;
  return { gap: gap(punchIdx - 1), median: 常[Math.floor(常.length / 2)] };
}

/** 打印，跟两个入口各自的 `Issue` 格式对齐 */
export function printDiction(issues: DictionIssue[]): { err: number; warn: number } {
  let err = 0;
  let warn = 0;
  for (const i of issues) {
    if (i.level === 'error') err++;
    else warn++;
    console.log(`  ${i.level === 'error' ? '✗' : '·'} ${i.msg}`);
  }
  return { err, warn };
}

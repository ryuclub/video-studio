// ── 老马线稿件体检 ────────────────────────────────────────────────────
//
// 用法：
//   npm run laoma:check -- jokes/laoma-001.json            体检
//   npm run laoma:check -- jokes/laoma-001.json --commit   过了之后把数字入账
//   npm run laoma:check -- --ledger                        看数字账本
//
// ⚠ **它不只是个命令，`voice` 和 `build` 之前会自动跑一遍**（cli.ts），
// 有硬伤直接停。要强行过加 `--anyway`，跟「方案.md 没填完」那道闸同一个开关。
//
// ⚠ **2026-08-23 起按写稿规范 v3 查「一句配额」**（原来的四禁令拆成
// 两条硬禁令 ＋ 一句配额）。配额句在哪一句由稿件的 `emotionLine` 点名 ——
// **机器不判断一句话有没有情绪，只判断你点的那句合不合规矩**。
//
// ── 为什么要有这个东西 ──
//
// `horse/SCRIPT_GUIDE.md` §六 有一张十一条的发布前自检表，写着「逐条过，
// 有一条不过就不发」。**但它是一张复选框，没有代码在守。**
// 第一条稿子（laoma-001）就是照着结构填出来的 —— 形式全对、流程全通、
// 出片链一路绿灯，可片子出来「总觉得没亮点」。回头拿那张表逐条对，
// 十一条里当场挂掉四条。
//
// 心理线的 `xinli-check.ts` 顶上写过同一句话，说书线也写过：
// **文档拦不住人，体检才拦得住。** 这份就是把那张表里机器能查的部分变成代码。
//
// ── 只查得了一半，而且是不重要的那一半 ──
//
// 「一条只有一个笑点吗」「误导公不公平」「转折的线索前面出现过吗」——
// 这三条决定这条片子好不好笑，**一条都查不了**。机器能查的是字数、个数、
// 词表这些形式项。所以：**体检全绿不等于好笑，只等于没有明显的形式硬伤。**
//
// 但形式硬伤值得拦 —— 因为它们不是品味问题，是规范里写死的数，
// 而人照着结构填稿的时候，最容易漏掉的正是这些数。

import { FONT_FILES } from './config.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { SYMBOLS as EMOTE_SYMBOLS } from '../horse/emote.mjs';
import { MARKS } from '../horse/marks.mjs';
import { lineText, dayNo, type JokeCfg, type LineCfg } from './types.js';
// ⚠ **有效 intro，不是 `cfg.intro`。** 「先出声后出人」那一档空镜恒等于零，
// 而稿子里那个 `intro: 1.2` 通常还留着 —— 直接读它，体检报的片长会比成片多出 1.2 秒。
import { introOf, openingStyleOf, partSpans, estimateDur, BEAT_PAUSE } from './beats/typeA.js';
import { getPace } from './pace.js';
// 出场档 ③ 的首帧要画物件。**库里有没有那个画法，体检就该知道** ——
// 不然人要等到渲染起来才被 `drawObject()` 抛一次。
import { OBJECTS, hasObject } from '../horse/objects.mjs';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

/** §一之九：落点最好不超过十五字。长句铺垫、短句落点，节奏落差本身就是笑点 */
const PUNCH_MAX = 15;

/**
 * 累积式的落点上限（不计标点）。《累积式_出片方案》§六。
 *
 * ⚠ **别把这个数搬回单点式。** 两条线的落点是两种东西：
 * 那边是事实句（说「发生了什么」），这边是感想句（「不过这样也挺好，……」）。
 */
const CUM_PUNCH_MAX = 20;

/** 累积式一屏的最短驻留（秒）。低于这个数读不完，就是闪一下 */
const CUM_SCREEN_MIN = 0.6;

/**
 * 累积式的**签名句**。全部条目逐字相同，字幕上反复出现同一行字会长成频道的记忆点。
 *
 * ⚠ **它的价值全在「逐字」两个字上。** 改一个字、少一个「也」，
 * 它就从签名退回成一句普通的收尾 —— 那就不如没有。
 */
const SIGNATURE = '不过这样也挺好';

/** §一之二：用三个例子，不是两个也不是四个 */
const SETUP_WANT = 3;

/**
 * §一之七 点名的那批词。**形容词是在替观众下判断**，
 * 「离谱」「荒唐」「绝了」一旦出现，笑点当场死亡。
 */
const JUDGE_WORDS = ['离谱', '荒唐', '绝了', '无语', '崩溃', '窒息', '救命', '太难了', '真的会谢', '服了'];

/**
 * §二：当季网络热词。半年后这条片子就不能重发，而且老马不说那种话。
 * **这张表要定期更新** —— 热词的定义就是会过期。
 */
const HOT_WORDS = ['栓Q', '绝绝子', 'yyds', 'emo', '摆烂', '躺平', 'city', '尊嘟假嘟', '显眼包', '哈基米'];

/** §二：「你是不是也」这类拉近距离的话，一说就变说教 */
const PREACH = ['你是不是也', '有没有人和我一样', '有没有人跟我一样', '是不是只有我'];

/**
 * §一之十三：**落点说「发生了什么」，不说「我怎么了」。**
 *
 * 这张表是 2026-08-22 从 008 的初版落点上抄下来的 —— 那一句是
 * 「它少一位的时候，**我差点鼓掌**」，形式项全绿、体检全过，
 * 可它把这件事替观众归好了档（「这是个可笑的反应」），观众只剩点头的份。
 * 改成「一个半小时，我看着它掉了一位」之后什么都没归档，
 * 荒唐感是观众自己从两个数之间量出来的。
 *
 * ⚠ **拦的是动词不是人称。** 第一人称照旧要贯穿（§一之十一），
 * 「我看着」「我坐了」「我数了」都是事实；这几个是心里活动。
 */
const REACTION = /差点|几乎|居然|竟然|忍不住|莫名|才发现|原来|不由|有点想|想起|我觉得|我以为|说不上来/;

/**
 * §二「通篇四不」之一：**不解释。** 说破＝不信任观众，荒诞由事实自己完成。
 *
 * ⚠ 跟 `REACTION` 是两张表：那张只管落点句，这张**管全篇**。
 */
const EXPLAIN = /其实|说明|意味着|大概是因为|可见|也就是说|这就是|所谓/;

/**
 * **v3 §1 硬禁令一「不解释」的词表。**
 *
 * 跟 `EXPLAIN` 是两批：那批拦的是「其实／也就是说」这类**逻辑连接**，
 * 这批拦的是**替观众下结论的成品句**——「太真实了」「打工人都懂」
 * 「这就是职场」「多少人中招」。
 *
 * ⚠ 这一条是 v2 四禁令里**唯一没被改成配额的两条之一**（另一条是不堆形容词）：
 * 它买到的是「挡住自杀式收尾」，代价几乎为零，所以永不放开。
 */
const V3_EXPLAIN = /真实|都懂|就是这样|扎心|中招|大概就是|多少人/;

/**
 * **配额句里不许出现的人称**（v3 §2 约束②）。
 *
 * **配额句必须是老马自己的处境，不能是对观众说话。**
 *
 *   ✓ 十五年了，有些词他一直是猜的。      ← 他的处境
 *   ✗ 谁没遇到过这种事呢。                ← 对观众说话
 *
 * > **这条是防止老马变成第一千零一个账号的唯一闸门。**
 *
 * ⚠ **只查配额句那一句。** 别的句子里「我们公司」是正常说法
 * （v3 §9 的示例第 1 句就是「我们公司有个词」），全篇拦会把它一起拦掉。
 */
const V3_SECOND_PERSON = /你们|你|谁|大家|我们/;

/** v3 §8：一个名词带 ≥2 个修饰。判据是连着两个「…的」，其中至少一个是形容词 */
const ADJ_CHAIN = /([一-龥]{1,3}的){2,}/;
const ADJ_WORDS = /^(大|小|新|旧|老|长|短|高|低|多|少|好|坏|快|慢|难|累|轻|重|厚|薄|干净|漂亮|奇怪|安静|吵|空|满|粉|红|橙|黄|绿|青|蓝|紫|灰|白|黑|银|金)/;

/**
 * §一之十二：**纯外观描述不能单独充当物件。**
 *
 * 「粉色挂号单综合症」—— 这两条正则是照着 007 的「发票是绿的」和
 * 008 的「挂号单是粉色的」写的，那是上一版规范（要「闲置物件」）
 * 直接催生出来的两句装饰。颜色、材质、新旧、大小都不承担叙事功能。
 */
// ⚠ **前导那个词不能是可选的，也别拿 `色$` 兜底。**
// 写成 `(…)?色?的?$` 时每一组都可选，正则连空串都收；而 `色$` 是另一头的错 ——
// 「角色」「景色」「音色」这些正经物件名全被判成纯外观描述，硬伤退回。
// 真正要拦的只有「光是一个外观词」当物件名：绿的、粉色的、新的。
// 「粉色挂号单」这种拦不到也不该拦 —— 它是不是装饰，交给下面「≥2 句里出现」那条判。
const APPEARANCE = /^(粉|红|橙|黄|绿|青|蓝|紫|灰|白|黑|银|金|新|旧|大|小)色?的?$/;
const COLOR_WORD = /(粉|红|橙|黄|绿|青|蓝|紫|灰|白|黑|银|金)色?的/;

/**
 * §一之十四 判回收时忽略的高频字。
 *
 * **「小门」和「小时」共用一个「小」不是呼应。** 没有这张表，
 * 任意两句中文都能凑出重叠字，这条检查就恒过。
 */
const STOP = new Set([
  ...'的了在是我他她它你们这那个一有和就都还也不没很上下来去时候人么什，。、？！ 要会能着过又再才只把被让给对从跟和与大小多少好新老半里中前后件样种',
]);

/** §一之十五：单句上限。眼睛能扫回去，耳朵不能 */
const MAX_CHARS_PER_LINE = 24;
/** §一之十六：近 N 条内不得复用同一个显著数字 */
const NUMBER_WINDOW = 10;
/** 小于这个值的数字不进账本（「一个」「两次」满天飞，记了也没用） */
const SIGNIFICANT_NUMBER = 10;

const cn = (s: string) => [...s.replace(/\s/g, '')].length;
/** 只留实词：滤掉停用字和标点 */
const keep = (t: string) => [...t].filter((c) => !STOP.has(c) && !/[，。、！？：；]/.test(c));
/** 二字组。全由停用字组成的（「一个」「这个」）不算 */
const bigrams = (t: string): Set<string> => {
  const s = t.replace(/[，。、！？：；\s]/g, '');
  return new Set(
    [...s].slice(0, -1).map((_, i) => s.slice(i, i + 2)).filter((g) => [...g].some((c) => !STOP.has(c)))
  );
};

const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cn2num(s: string): number {
  let total = 0,
    section = 0,
    num = 0,
    seen = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch];
      seen = true;
    } else if (ch === '十') {
      section += (seen ? num : 1) * 10;
      num = 0;
      seen = false;
    } else if (ch === '百') {
      section += (seen ? num : 1) * 100;
      num = 0;
      seen = false;
    } else if (ch === '千') {
      section += (seen ? num : 1) * 1000;
      num = 0;
      seen = false;
    } else if (ch === '万') {
      total += (section + num) * 10000;
      section = 0;
      num = 0;
      seen = false;
    } else return NaN;
  }
  return total + section + num;
}

/** 把一段话里的数字都抠出来，阿拉伯数字和中文数字都认 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /\d+(?:\.\d+)?|[零一二两三四五六七八九十百千万]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const v = /^\d/.test(raw) ? parseFloat(raw) : cn2num(raw);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

// ── 数字账本 ────────────────────────────────────────────────────────
//
// §一之十六：不得复用近 10 条用过的数字。**重复的数字是最明显的模板痕迹** ——
// 观众记不住哪条用过「三十七」，但连着看到第三次就会觉得「这号是套模板的」。
//
// 账本是**一稿一行**，key 是日子牌上那个天数（`hook` 里的数）而不是文件号：
// 天数一稿一天往下加，本来就是这条线的时间轴（CHANNEL_LAOMA §五之二）。
//
// ⚠ **只在 `--commit` 时写。** 体检本身是只读的 —— 一条稿子在定稿前会跑很多遍，
// 每跑一遍就入账的话，它自己第二次跑就会撞自己。

const LEDGER = 'horse/used-numbers.json';

interface LedgerEntry {
  /** 收尾卡上那个天数（1847…） */
  day: number;
  nums: number[];
  /** 这一条挂没挂尾卡事实句。用来守「每五条最多一条」那条使用率 */
  tail?: boolean;
  /** 这一条用没用情绪符号（漫符）。同样是「近 5 条最多 1 条」 */
  mark?: boolean;
  /** 入账日期。只是给人看的，校验不用它排序 —— 排序永远按天数 */
  at?: string;
}

function loadLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER, 'utf8')) as LedgerEntry[];
  } catch {
    return [];
  }
}

/** `--commit`：把这一条的显著数字写进账本 */
export function commitNumbers(cfg: JokeCfg): void {
  const day = dayNo(cfg);
  if (day === null) {
    console.log('  读不出天数号（`day` 和收尾卡都没有），不入账');
    return;
  }
  const nums = [...new Set(extractNumbers(cfg.lines.map(lineText).join('')).filter((v) => v >= SIGNIFICANT_NUMBER))];
  const ledger = loadLedger().filter((e) => e.day !== day);
  ledger.push({ day, nums, tail: !!cfg.tailCard, mark: !!cfg.endMark || cfg.lines.some((l) => l.emote && MARKS[l.emote.kind]), at: new Date().toISOString().slice(0, 10) });
  ledger.sort((a, b) => a.day - b.day);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log(`  第 ${day} 天入账：${nums.length ? nums.join('、') : '（无显著数字）'} → ${LEDGER}`);
}

/** 这一句是哪个节拍。beat 字段是排时间轴用的，这儿按稿件的四段来分 */
function role(lines: LineCfg[], i: number): 'hook' | 'setup' | 'turn' | 'punch' {
  const l = lines[i];
  if (l.beat === 'punch') return 'punch';
  if (l.beat === 'reply' || l.beat === 'ask') return 'turn';
  return i === 0 ? 'hook' : 'setup';
}

export function checkLaoma(cfg: JokeCfg): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  /**
   * **体裁分流。** `format: "cumulative"` 才走累积式那一套判据，
   * **不写就是单点式，已出片的 16 条一条都没动。**
   *
   * 分流的地方每一处都写了「单点式怎么样／累积式怎么样」——
   * 因为它们不是「松一点严一点」，是**正面冲突**：单点式的落点必须是事实句，
   * 累积式的落点就是那句感想；单点式的字幕在防剧透，累积式的字幕在造节拍。
   */
  const cum = cfg.format === 'cumulative';

  /**
   * 一句前后的停顿。**跟 `beats/typeA.ts` 走同一套缺省，也走同一个 `BEAT_PAUSE`** ——
   * 缺省值在两处各写一遍的话，体检报的片长跟成片对不上，
   * 而**那个数是人拿去判断稿子长短的**（估错了就照着错的数改稿）。
   */
  const pace = getPace(cfg.pace, 'banter');
  const padBeforeOf = (l: LineCfg) => l.padBefore ?? (l.beat === 'punch' ? 0.4 : pace.padBefore);
  const padAfterOf = (l: LineCfg) =>
    (l.padAfter ?? (l.beat === 'punch' ? 0.35 : pace.padAfter)) + (l.beatPause ? BEAT_PAUSE : 0);

  const roles = cfg.lines.map((_, i) => role(cfg.lines, i));
  const punchIdx = roles.lastIndexOf('punch');
  /** 配额句的下标（0 起算）。稿件里的 `emotionLine` 是 1 起算的，这儿换算过 */
  const quotaIdx = typeof cfg.emotionLine === 'number' ? cfg.emotionLine - 1 : -1;
  const punch = punchIdx >= 0 ? cfg.lines[punchIdx] : null;
  // ── 尾卡事实句（2026-08-24 立的规范）──────────────────────────
  //
  // **它必须是事实，不能是感想。** 老马的第一条硬禁令是不解释，
  // 而金句是解释里最响的一种 —— 它把观众刚刚自己想到的东西又替他们说了一遍。
  // 观众完成的那个「哦」，必须留给观众自己完成。
  const tail = cfg.tailCard?.trim();
  // 累积式**不出尾卡、也不出收尾卡**（《累积式_出片方案》§五，沿用 002 的黑场）：
  // 那五条检查（人称／解释词／超长／allowBoth／使用率）整组停用 ——
  // **写成关闭，不是漏填**。挂了就在这儿拦下来，别让它悄悄走单点式那条路。
  if (cum && tail)
    err(
      `累积式挂了尾卡「${tail}」。**累积式不出尾卡、不出收尾卡，落点说完直接黑场** ——` +
        `它的余味在「不过这样也挺好」那一句里，再补一行字是替观众把话说完`
    );
  if (tail && !cum) {
    const tLen = [...tail.replace(/[，。！？、,.!?：:；;「」“”‘’]/g, '')].length;
    if (tLen > 16) err(`尾卡「${tail}」${tLen} 字，上限 16 —— 一行，不折行`);

    // 人称：出现任何一个即为对观众说话，跟配额句是同一条闸门
    const pron = ['你们', '你', '我们', '大家', '谁'].find((w) => tail.includes(w));
    if (pron) err(`尾卡出现人称「${pron}」。**尾卡是说给画面的，不是说给观众的** —— 跟配额句同一条闸门`);

    // 解释词：出现就说明它在解释，而不是在陈述后来发生的事
    const TAIL_BAN = ['真实', '都懂', '就是这样', '扎心', '其实', '终究', '原来', '有些人', '成年人'];
    const bad = TAIL_BAN.find((w) => tail.includes(w));
    if (bad) err(`尾卡命中解释词「${bad}」。尾卡不解释刚才发生了什么，**只告诉你后来怎么样了**`);

    // 跟配额句二选一：同一条里两个都上，等于连着捅两下，第二下必然弱
    //
    // ⚠ **2026-08-25 从硬伤降成提醒。** 尾卡那天变成了单点式的必备项
    //（跟日子牌一样），而配额句是 v3 给的「一集一句」—— 两条都是规范，
    // 硬拦的话等于「用了配额句就出不了片」，那不是二选一，是把 v3 那条废掉。
    // **这一处的取舍留给人**：真觉得连着捅两下，就把尾卡写得更淡，或者放弃配额。
    if (quotaIdx >= 0 && !cfg.allowBoth)
      warn(
        `尾卡和配额句（第 ${quotaIdx + 1} 句）同时用了 —— **连着捅两下，第二下必然弱**。` +
          `想清楚哪一下才是这条片子的收尾；确认要都留，写 "allowBoth": true 把这条提醒关掉`
      );

    // 不许重复落点里的物件动作：落点写了「一口没喝」，尾卡就不能再写喝不喝
    // ⚠ **要滤停用字。** 不滤的话「也 / 了 / 天」这种高频字随便就凑够四个，
    // 这条检查会对任意两句中文都报警 —— 跟 §一之十四 判钩子回收是同一个道理。
    const pw = new Set(keep(punch ? lineText(punch) : ''));
    const dup = keep(tail).filter((c) => pw.has(c));
    if (dup.length >= 4)
      warn(
        `尾卡跟落点有 ${dup.length} 个字重合（${dup.slice(0, 6).join('')}…）。` +
          `§3④：不许重复落点里的物件动作，**要往后推到另一天、另一个人**`
      );

    // ⚠ **「每五条最多一条」那条使用率 2026-08-25 作废了。**
    //
    // 原来的理由是「稀缺才有力量：每条都挂，两个月后它就成了片尾模板」。
    // 用户当天定的是另一条：**单点式片子要有收尾卡和尾卡事实句这两样，不能变** ——
    // 尾卡从「配额」变成了「格式的一部分」，跟日子牌一个地位。
    //
    // 两条规矩不能同时留着：留着使用率，每条稿子都会挨一次警告，
    // 而**天天报的警告等于没有警告**（这条线为这件事栽过一次：
    // 「四行永远消不掉的提醒 = 这条检查以后会被当背景噪音」）。
  }

  // ── 落点符号：老马只用「没有情绪」的那一类 ────────────────────
  //
  // 汗滴是慌张、感叹号是兴奋、星星是可爱、井字纹是生气 —— 全都是画面替观众表态，
  // 跟「只陈述不评论」的人设正相反。
  /**
   * 情绪符号（那套漫符：惊 / 汗 / 星 / 井字纹…）。
   *
   * **2026-08-24 从「一律禁用」改成「配额」**（用户定：偶尔用是可以的）。
   * 理由照旧成立 —— 它们是**画面替观众表态**，跟「只陈述不评论」正相反；
   * 但「偶尔」这个词本身就是配额，**写成数字机器才拦得住**：
   * 写成提醒的话，提醒久了就麻木，迟早每条都有。
   *
   * 口径跟尾卡那条一样：**近 5 条最多 1 条**，共用同一个账本。
   */
  // 情绪符号用在哪儿都算进同一份配额：收尾卡那个（endMark）和停顿里那些（line.emote）
  const moodPauses = cfg.lines.filter((l) => l.emote && MARKS[l.emote.kind]);
  if (cfg.endMark || moodPauses.length) {
    const where = [
      ...(cfg.endMark ? [`收尾卡「${cfg.endMark.name}」`] : []),
      ...moodPauses.map((l, i) => `第 ${cfg.lines.indexOf(l) + 1} 句「${l.emote!.kind}」`),
    ].join('、');
    const recentMark = loadLedger()
      .filter((e) => e.day !== cfg.day)
      .sort((a, b) => b.day - a.day)
      .slice(0, 4)
      .filter((e) => e.mark).length;
    if (recentMark >= 1)
      err(
        `用了情绪符号（${where}），而近 4 条里已经有 ${recentMark} 条用过 —— **近 5 条最多 1 条**。` +
          `这类符号是画面替观众表态，所以给的是配额不是自由`
      );
    else warn(`用了情绪符号（${where}），在配额内。**近 5 条最多 1 条**，下一条就别再用了`);
  }
  // ── 停顿符号（`line.emote`）────────────────────────────────────
  //
  // 三十秒一张不动的脸，中途全靠眼动撑着 —— 太冷场。这一层给中途的停顿一点东西看。
  // 但它离「画面替观众表态」只有一步，所以位置、长度、个数三样都卡死。
  //
  // ⚠ **累积式两个数都得放宽**（《累积式_出片方案》§六）：句间压到 0.35–0.45 之后
  // **全片一个 0.8 秒的窗口都没有**，照单点式的阈值判，累积式一个符号都挂不上 ——
  // 于是 1863 那条「太冷场」的毛病会原样复发，而 40 秒的片子比 25 秒更扛不住。
  const PAUSE_MIN = cum ? 0.5 : 0.8;
  const PAUSE_MAX = cum ? 3 : 2;
  const pauses = cfg.lines.filter((l) => l.emote);
  if (pauses.length > PAUSE_MAX)
    err(`挂了 ${pauses.length} 个停顿符号，**全片最多 ${PAUSE_MAX} 个**（加上落点符号再多一个）—— 满屏乱弹就成了表情包合集`);
  cfg.lines.forEach((l, i) => {
    if (!l.emote) return;
    if (!EMOTE_SYMBOLS[l.emote.kind] && !MARKS[l.emote.kind])
      err(
        `第 ${i + 1} 句的停顿符号「${l.emote.kind}」两套库里都没有。
` +
          `  没有情绪的：${Object.keys(EMOTE_SYMBOLS).join(' / ')}
` +
          `  情绪符号　：${Object.keys(MARKS).join(' / ')}`
      );
    const pad = padAfterOf(l);
    if (pad < PAUSE_MIN)
      err(
        `第 ${i + 1} 句的停顿只有 ${pad.toFixed(2)}s，挂不了符号 —— **浮现就要半秒多**，` +
          `0.3 秒的停顿里塞进去只会闪一下。要么把停顿放到 ${PAUSE_MIN} 秒以上` +
          (cum ? '（累积式给这一句写 `beatPause`，正好 +0.8）' : '') +
          `，要么这句别挂`
      );
    // ⚠ **2026-08-25 拆成两档：落点句仍旧硬拦，落点前一句降成提醒。**
    //
    // 原来两句一起拦，理由是「那是『这里好笑』的提示」。但**判据其实是符号在说什么**，
    // 不是它排在第几句：016 的落点前一句是「一桌子人都在夹菜，没人接话」，
    // 那一停要的就是尴尬本身 —— 符号在这儿是**内容**，不是笑点提示。
    // 用户当天的口径：冲突时按要求改。所以这一档留给人判断，机器只提醒。
    if (i === punchIdx)
      err(`落点句挂了停顿符号。**落点那一下要什么都不发生** —— 符号是自己给包袱加注解`);
    else if (i === punchIdx - 1)
      warn(
        `第 ${i + 1} 句（落点前一句）挂了停顿符号「${l.emote.kind}」。` +
          `**看一眼它在说什么**：说的是这一句的情绪（冷场、无语）就留着；` +
          `要是读起来像「下一句好笑了」的提示，挪走`
      );
    // ⚠ **不再拦「这个停顿里已经有闭目」**（2026-08-24 用户定）。
    // 原来的理由是「一个停顿里两件事等于抢戏」，但**闭目和眨眼本来就是日常动作**，
    // 不是一件跟符号抢戏的事 —— 人停下来的时候本来就会闭一下眼。
  });
  const kinds = pauses.map((l) => l.emote!.kind);
  if (new Set(kinds).size !== kinds.length) warn('两个停顿符号用了同一个，换一个 —— 重复的符号是最明显的模板痕迹');

  if (cfg.endEmote && !EMOTE_SYMBOLS[cfg.endEmote.kind ?? 'dots'])
    err(`没有这个落点符号：${cfg.endEmote.kind}
可用：${Object.keys(EMOTE_SYMBOLS).join(' / ')}`);

  // ── §二：落点之后还有话 → 废稿重写，不要抢救 ──
  if (punchIdx >= 0 && punchIdx !== cfg.lines.length - 1)
    err(
      `落点后面还有 ${cfg.lines.length - 1 - punchIdx} 句。§一之八「说完就停」——` +
        `不解释、不补刀、不升华，最常见的毁稿方式就是落点之后又加了一句`
    );

  if (!punch) {
    err('没有落点句（beat: punch）。这条线是单包袱结构，落点是全片唯一的锚');
    return out;
  }

  // ── §一之九：落点句字数 ──
  //
  // 这一条最容易破：照结构填稿的时候，落点句往往被写成「把前面的规律总结一遍」，
  // 一总结就长。而长落点等于把包袱摊开讲，节奏落差没了。
  const pt = lineText(punch);
  const pn = cn(pt);
  // ── 累积式的落点是**感想句**，字数另有一档 ────────────────────────
  //
  // 单点式的落点是事实句、≤15 字，长了就是把包袱摊开讲。
  // 累积式的落点是「不过这样也挺好，……」—— 它要接住前面整段累积，
  // 15 字接不住，所以放宽到 20（不计标点），**代价是前面必须有 ≥3 句事实型累积兜底**：
  // 没有那三句，这一句感想就成了无源之水，那才是真的抒情。
  if (cum) {
    const bare = cn(pt.replace(/[，。、！？：；]/g, ''));
    if (bare > CUM_PUNCH_MAX) err(`落点句 ${bare} 字（不计标点），累积式上限 ${CUM_PUNCH_MAX}。沉底句要短，长了就成了总结陈词`);
    const middle = cfg.lines.length - 2; // 立、沉底之外的那些
    if (middle < 3)
      err(
        `立人设和沉底之间只有 ${middle} 句。累积式靠**一件比一件离谱**攒出笑点，` +
          `少于三句攒不起来 —— 那是单点式的结构，写 \`"format": "single"\` 走那一套`
      );
    else if (middle > 6)
      err(`立人设和沉底之间有 ${middle} 句。**错位层最多五句（加上「自己拆掉」那句是六句），超了就腻**`);
  } else if (pn > PUNCH_MAX * 2)
    err(`落点句 ${pn} 字，上限 ${PUNCH_MAX}（超了 ${(pn / PUNCH_MAX).toFixed(1)} 倍）。§一之九：长句铺垫、短句落点，节奏落差本身就是笑点`);
  else if (pn > PUNCH_MAX) warn(`落点句 ${pn} 字，超过 ${PUNCH_MAX}。能砍就砍`);

  // ── §一之一：笑点落在最后一个词 ──
  // 机器只能提醒，判断不了哪个词是笑点
  warn(`落点句的最后一句是「${pt.split(/[，。！？]/).filter(Boolean).pop() ?? ''}」—— 最后一个词是不是笑点本身？（§一之一）`);

  // ── §一之二：铺垫三个例子 ──
  //
  // ⚠ **这一条从硬伤降成了提醒，因为它已经数不准了。**
  //
  // 原来按 `say` 的小句数来数例子 ——「你回晚了…你回早了…」是一句里的两个，
  // 当时 `say` 只用来写并列例子，数得准。后来 `say` 兼了**字幕分屏**的活
  // （转折句和落点句必须逐屏出，一屏 ≤12 字），于是「为了好读拆一屏」
  // 和「多举一个例子」在数据上长得一模一样。
  //
  // 机器分不出来的东西就不该拦。现在两个数都报出来，判断交给人。
  const setups = roles.filter((r) => r === 'setup').length;
  const setupClauses = cfg.lines
    .filter((_, i) => roles[i] === 'setup')
    .reduce((n, l) => n + (l.say?.length ?? 1), 0);
  // 累积式不数「铺垫几句」—— 它没有铺垫段，它整条都在累积，
  // 层数由上面那条「立与沉底之间 3–6 句」管。两套结构互相数对方的东西只会互相判废。
  if (cum) {
    // 什么都不报：这一条在累积式里没有意义
  } else if (setups < 2 || setups > 4)
    err(
      `铺垫 ${setups} 句。§一之二：两个不足以让人认出规律，四个开始不耐烦 —— ` +
        `**观众要先认出规律，转折才有东西可打破**`
    );
  else
    warn(
      `铺垫 ${setups} 句、${setupClauses} 屏。规范要**三个例子** —— ` +
        `但拆屏和举例在数据上一样，机器数不出哪个是例子，自己数一遍`
    );

  // ── §一之十：不用问句结尾 ──
  if (/[？?]\s*$/.test(pt)) err('落点句是问句。§一之十：问句把判断权交回给观众，泄气');

  // ── §二：落点句里有感叹号 → 废稿 ──
  if (/[！!]/.test(pt)) err('落点句里有感叹号。§二 反面清单，直接废稿 —— 老马不用感叹号说话');

  // ── §一之七：形容词/副词下判断 ──
  for (const w of JUDGE_WORDS) if (pt.includes(w)) err(`落点句出现「${w}」。§一之七：形容词是在替观众下判断，笑点当场死亡`);

  // ── 首帧规范 v1 §一：出场档 ③「先出声 · 物件」的三条硬约束 ──
  //
  // ⚠ **只在这一档生效。** 用户给的 `check.mjs` 是无条件核 frame 字段的，
  // 这儿收成「档 ③ 才核」—— 那一版规范是**追加**一个新出场档，
  // 不是把 001–009 已有的两档全判废。想改成全局，把下面这个 if 去掉就行。
  {
    // ⚠ **走有效出场档，不是 `cfg.opening?.style`。** 2026-08-22 起老马线
    // **不写 opening 就是档 ③** —— 只看写没写的话，新稿子一个字段都不填反而全过，
    // 而这三条硬约束正是给新稿子准备的。
    const style = openingStyleOf(cfg);
    const op: NonNullable<JokeCfg['opening']> = cfg.opening ?? { style };
    if (style === 'object-first') {
      const plain = (x: string) => x.replace(/[，。、！？：；\s]/g, '');
      const first = lineText(cfg.lines[0]);
      if (!op.frameSubject)
        err(
          '缺 `opening.frameSubject`（首帧特写画哪样东西）。首帧规范 §一 —— ' +
            (cfg.opening?.style
              ? '写一个 `horse/objects.mjs` 里有画法的物件名，而且必须等于 `object`'
              : '**老马线不写 `opening` 就是档 ③**（先出声 · 物件）。要么补上 `frameSubject`/`frameText`，' +
                '要么写 `"opening": { "style": "figure-first" }` 退回老样子（开场空镜、先出人）')
        );
      else if (!cfg.object) err('档 ③ 要先有 `object`，`frameSubject` 得跟它对上');
      else if (!op.frameSubject.includes(cfg.object) && !cfg.object.includes(op.frameSubject))
        err(
          `\`frameSubject\` 是「${op.frameSubject}」，\`object\` 是「${cfg.object}」，两个对不上。` +
            `首帧规范 §一：**首帧要拍物件本身** —— 不另想画面，物件已经定过了，跟着它走，系列视觉一致性是白捡的`
        );

      // ⚠ **物件库里有没有这个画法，在这儿拦，不要等到渲染。**
      //
      // `horse/objects.mjs` 的 `drawObject()` 名字不在库里就抛、不回退 —— 那是对的，
      // 但它抛在渲染第 0 帧，而那时候 TTS 已经跑完、渲染线程池已经起来了。
      // 一条稿子写完先跑体检，缺画法这件事该在那时候就说。
      if (op.frameSubject && !hasObject(op.frameSubject))
        err(
          `物件库里没有「${op.frameSubject}」的特写画法（现有：${Object.keys(OBJECTS).join(' / ')}）。` +
            `去 horse/objects.mjs 加一个，或者把这一条改走 \`figure-first\`／\`voice-first\`。` +
            `**加完必过 120px 缩略图测试**：\`npm run frame -- <稿件> --thumb\``
        );

      if (!op.frameText)
        err(
          '缺 `opening.frameText`（首帧上那行字）。首帧规范 §一：≤8 字、第 1 句的连续子串、含一个数 —— ' +
            '把第 1 句里「我在哪／我们公司」这类定位语切掉，剩下的头 8 个字就是它'
        );
      else {
        const n = cn(plain(op.frameText));
        if (n > 8)
          err(`\`frameText\` ${n} 字，超过 8。首帧规范 §一：取第 1 句里最短的那截，不要整句 —— 一行不折行，折了就是超了`);
        if (!plain(first).includes(plain(op.frameText)))
          err(
            `\`frameText\`「${op.frameText}」不是第 1 句的连续子串。` +
              `首帧规范 §一：**它是正在说的那句话的一截，不是另写的标题** —— 另写就成了片头卡`
          );
        if (extractNumbers(op.frameText).length === 0)
          warn(
            `\`frameText\` 里没有数字。首帧规范 §四 的缩略图测试要「那个数字还看得见吗」，` +
              `没有数就没得看；而且**数字标红是这个系列的签名**`
          );
      }
    }
  }

  // ── §一之十三：落点是事实句，**或者那一句配额** ──
  //
  // ⚠ **v3 把这一条松了半格。** v2 是「落点必须是事实句」，v3 改成
  // 「落点是事实句，或那一句配额」——因为配额句最好的位置就是落点
  // （规范 §9 的示例：「十五年了，有些词他一直是猜的。」）。
  //
  // 松的只有这半格：**没点名成配额句的落点，照旧不许是反应句。**
  // 反应句把这件事替观众归好了档（「这是个可笑的反应」），他只剩点头的份。
  // ⚠ **累积式显式停用这一条**（《累积式_出片方案》§六）：
  // 它的落点**就是**感想句 —— 「不过这样也挺好，至少死的是绿萝，不是我」。
  // 单点式那条「落点必须是事实句」照搬过来，等于把每一条累积式都判废。
  {
    const m = cum ? null : pt.match(REACTION);
    if (m && quotaIdx !== punchIdx)
      err(
        `落点是反应句：命中「${m[0]}」。§一之十三：落点说「发生了什么」，不说「我怎么了」——` +
          `写出反应等于替观众把这件事归了档，他只剩点头的份。**反应挪到定格那一下的脸上去**（瞪眼/张嘴/一滴汗）；` +
          `真要留着这句情绪，就把它点成配额句（\`emotionLine\`）`
      );
  }

  // §一之十三：落点里必须有一个具体名词或一个数字。名词查不了，数字查得了
  // ⚠ 累积式不报这条：感想句里本来就不该有数字，数字都在前面的累积层。
  if (!cum && extractNumbers(pt).length === 0)
    warn(
      `落点里没有数字。§一之十三 要「一个具体名词或一个数字」，纯抽象的收尾一律作废 ——` +
        `没数字的话，确认末尾那个词是个**看得见的东西**（小门、第一条、椅子），不是一个概念`
    );

  // ── §二「通篇四不」之一：不解释 ──
  cfg.lines.forEach((l, i) => {
    const m = lineText(l).match(EXPLAIN);
    if (m) err(`第 ${i + 1} 句在解释：命中「${m[0]}」。§二：说破＝不信任观众，荒诞由事实自己完成`);
  });

  // ── §一之十五：单句上限 ──
  //
  // 眼睛能扫回去，耳朵不能。24 字念出来将近 6 秒，中间还拐两个弯，
  // 听的人到句尾已经丢了句首。
  cfg.lines.forEach((l, i) => {
    const t = lineText(l);
    const n = cn(t.replace(/[，。、！？：；]/g, ''));
    if (n > MAX_CHARS_PER_LINE)
      err(`第 ${i + 1} 句 ${n} 字，超过 ${MAX_CHARS_PER_LINE}。§一之十五：三个分句以上的长句纯音频会糊，拆成两句`);
    const clauses = t.split(/[，、]/).filter(Boolean).length;
    // ⚠ **累积式的排比句天生就是三个分句**，而且它们**已经一句一屏**分开了 ——
    // 照单点式报「信息拥堵」的话，每一条累积式都会挨这一条，
    // **而提醒挨久了就成了背景噪音**。只在分句没拆屏的时候才报。
    const crowded = !(cum && (l.say?.length ?? 1) >= clauses);
    if (clauses >= 3 && n >= 20 && crowded) warn(`第 ${i + 1} 句 ${clauses} 个分句 ${n} 字，信息拥堵，纯音频会糊`);
  });

  // ── §一之十四：钩子埋了必须回收，而且要字面复现 ──
  //
  // ⚠ **这一条 2026-08-22 从「查不了」升级成了硬伤。**
  //
  // 原来的做法是把钩子末句和落点并排打给人看，理由是「回收有两种，
  // 量度回收（007 的『优化了一个流程』→『第十一天』）两句可以一个字都不重叠」。
  // 那个让步是错的：**这是听觉媒介，观众没法回看。** 换了同义词或者只靠
  // 语义呼应，观众得先认出「哦这说的是刚才那个」，那一下的迟疑正好盖住笑点。
  //
  // 现在按 `hookLine` / `payoffLine` 点名的两句做字面重叠比对，
  // 滤掉 STOP 里的高频字 —— 「小门」和「小时」共用一个「小」不算呼应。
  //
  // ⚠ **累积式换成「首尾扣合，宽松比对」**（《累积式_出片方案》§〇 那张对照表）。
  // 单点式的钩子是**一个包袱的引信**，不回收就是哑弹，所以要求字面复现、缺了判硬伤。
  // 累积式没有单一包袱 —— 它的首尾扣合是「开头立的那个人设，结尾自己认了」，
  // 点名了就比，没点名也不拦。
  if (cfg.hookLine === undefined || cfg.payoffLine === undefined) {
    if (!cum)
      err(
        '没写 `hookLine` / `payoffLine`（1 起算）。§一之十四：钩子埋在第几句、第几句回收，要点名 ——' +
          '不点名这条就查不了，而「埋了不收」是观众读作「东一句西一句」的头号原因'
      );
  } else {
    const hi = cfg.hookLine - 1;
    const pi = cfg.payoffLine - 1;
    if (!cfg.lines[hi] || !cfg.lines[pi]) err(`hookLine ${cfg.hookLine} / payoffLine ${cfg.payoffLine} 越界（共 ${cfg.lines.length} 句）`);
    else if (hi >= pi) err(`hookLine(${cfg.hookLine}) 必须早于 payoffLine(${cfg.payoffLine})`);
    else {
      const ht = lineText(cfg.lines[hi]);
      const ptt = lineText(cfg.lines[pi]);
      const hooked = new Set(keep(ht));
      const hb = bigrams(ht);
      const hit = keep(ptt)
        .filter((c) => hooked.has(c))
        .concat([...bigrams(ptt)].filter((g) => hb.has(g)));
      if (hit.length === 0)
        (cum ? warn : err)(
          `钩子未回收：第 ${cfg.hookLine} 句「${ht}」埋的东西，第 ${cfg.payoffLine} 句「${ptt}」没接住。` +
            `**要么字面复现那个词，要么删掉钩子句** —— 听觉媒介，同义词不算回收` +
            (cum ? '（累积式这条是提醒：它的首尾扣合可以只是「立的人设自己认了」，不一定复现某个词）' : '')
        );
      else warn(`§一之十四 回收命中「${[...new Set(hit)].join('')}」（第 ${cfg.hookLine} 句 → 第 ${cfg.payoffLine} 句）`);
    }
  }

  // ── §一之十二：承担叙事功能的物件 ──
  //
  // ⚠ **口径 2026-08-22 翻过一次。** 初版要的是「闲置的、删掉毫发无伤的」物件，
  // 照那条写出来的是 007 的「发票是绿的」和 008 的「挂号单是粉色的」——
  // 两句都是贴上去的装饰，只出现一次，删掉整条稿子毫发无伤。
  // **「未解释」和「闲置」是两回事**：物件要有用，不给的是解释。
  //
  // 机器查得了两件事：不是纯外观描述、出现在 ≥2 句里。
  // 查不了「删掉它有没有句子说不通」—— 那一条只能人看。
  //
  // ⚠ **累积式里 `object` 是可选的**（《累积式_出片方案》§〇）：单点式的落点要落在
  // 一件看得见的东西上，所以物件是硬要求；累积式的落点是一句感想，
  // 撑住它的是**累积本身**，不是某一件东西。写了就照样查（外观词、≥2 句），不写不拦。
  if (!cfg.object) {
    if (!cum)
      err(
        '没有 `object`（承担叙事功能的物件）。§一之十二：**判据是「删掉它，至少有一句话说不通」**，' +
          '而且必须出现在 ≥2 个不同的句子里。原样抄台词里的字'
      );
  } else if (APPEARANCE.test(cfg.object)) {
    err(`物件「${cfg.object}」是纯外观描述，不能当物件。颜色/材质/新旧/大小都不承担叙事功能 —— 见「粉色挂号单综合症」`);
  } else {
    const inLines = cfg.lines.map((l, i) => (lineText(l).includes(cfg.object!) ? i + 1 : 0)).filter(Boolean);
    if (inLines.length < 2)
      err(
        `物件「${cfg.object}」只在第 ${inLines[0] ?? '?'} 句出现，共 ${inLines.length} 次。` +
          `**只出现一次的东西是装饰，不是物件**（§一之十二）`
      );
    else warn(`§一之十二 物件「${cfg.object}」出现在第 ${inLines.join('、')} 句 —— **删掉它，真的有句子说不通吗？** 这一条机器判不了`);
  }

  // ── §二：热词与说教 ──
  const all = cfg.lines.map(lineText).join('');
  for (const w of HOT_WORDS) if (all.includes(w)) err(`出现热词「${w}」。§二：半年后这条片子就不能重发，而且老马不说那种话`);
  for (const w of PREACH) if (all.includes(w)) err(`出现「${w}」。§二：观众自己会想到，你一说就变说教`);

  // ── §一之十一：第一人称贯穿 ──
  if (!all.includes('我')) err('通篇没有「我」。§一之十一：写他们就是在嘲笑别人，写我才是自嘲');

  // ── §一之四：具体压倒抽象，数字要奇数、非整数 ──
  //
  // 只报不拦 —— 机器分不清「三点十二分」（好）和「十几个人」（废话）的区别，
  // 但能把所有数量词捞出来让人自己看。
  const vague = ['很久', '好久', '半天', '一堆', '好几', '十几', '好多', '无数', '一大堆'];
  const hits = vague.filter((v) => all.includes(v));
  if (hits.length)
    warn(
      `出现模糊量词：${hits.join('、')}。§一之四：「等了很久」是废话，「看了三次楼层数字」才是段子 —— ` +
        `数字用**奇数、非整数**，整数听起来像在举例`
    );

  // ── §一之十六：数字 ──
  const nums = extractNumbers(all);
  if (!nums.some((v) => v >= 10 && v % 10 !== 0))
    warn('全片没有一个「不圆」的数（二十三／三十七／十一那种）。§一之十六：整十整百听起来像编的');

  // 近 10 条内不得复用同一个显著数字。**重复的数字是最明显的模板痕迹**
  //
  // ⚠ **必须是 `< day` 不是 `!== day`。** 账本按天升序存，写成 `!==` 再 slice(-10)
  // 取到的是**全账本最新的十条**，跟正在体检的是哪一条无关 —— 回头重跑一条老稿子，
  // 它会拿七天后写的稿子来判它撞车（实测：001 第 1847 天报「17 在第 1854 天用过」）。
  // 这条是硬伤级别的报警，假报警会让人开始无视它。
  const day = dayNo(cfg);
  const sig = [...new Set(nums.filter((v) => v >= SIGNIFICANT_NUMBER))];
  if (day !== null) {
    const recent = loadLedger()
      .filter((e) => e.day < day)
      .slice(-NUMBER_WINDOW);
    for (const v of sig) {
      const dup = recent.find((e) => e.nums.includes(v));
      if (dup)
        err(
          `数字 ${v} 在第 ${dup.day} 天用过（近 ${NUMBER_WINDOW} 条内）。§一之十六：换一个 —— ` +
            `**重复的数字是最明显的模板痕迹**。账本 horse/used-numbers.json，出片后跑 laoma:check --commit 入账`
        );
    }
  }

  // 一句话里两个同类量互相抢（「十七分钟」＋「一个半小时」）
  cfg.lines.forEach((l, i) => {
    const n = extractNumbers(lineText(l)).filter((v) => v >= SIGNIFICANT_NUMBER);
    if (n.length >= 2) warn(`第 ${i + 1} 句里有 ${n.length} 个量（${n.join('、')}）。§一之十六：一句话两个同类量会互相抢，观众不知道该记哪个`);
  });

  // ── 首尾扣合：不是硬性，但是好稿的共性 ──
  {
    // 累积式的「开场」是**立人设 ＋ 自己拆掉**那两三句，不是单独第 1 句 ——
    // 沉底句认的是那个被拆掉的人设，扣的不一定是开口第一句里的字。
    const headLines = cum ? cfg.lines.slice(0, Math.min(3, cfg.lines.length - 1)) : [cfg.lines[0]];
    const head = new Set(headLines.flatMap((l) => keep(lineText(l))));
    if (!keep(pt).some((c) => head.has(c)))
      warn(`落点和${cum ? '立人设那几句' : '开场'}没有任何字面呼应，首尾没扣上`);
  }

  // ── 颜色词提醒：粉色挂号单综合症 ──
  {
    const color = all.match(COLOR_WORD);
    if (color)
      warn(
        `出现颜色描述「${color[0]}」—— 确认它推动了叙事，否则删掉。` +
          `（**粉色挂号单综合症**：上一版规范要「闲置物件」，直接催生了 007 的「发票是绿的」和 008 的「挂号单是粉色的」两句装饰）`
      );
  }

  // ── §四：全片时长 ──
  const spoken = cfg.lines.reduce((s, l) => s + (l.dur ?? 0), 0);
  if (spoken > 0) {
    // ⚠ 缺省不是 0 —— `beats/typeA.ts` 给的是 padBefore 0.15 / padAfter 0.2，
    // **落点句前后是 0.4 / 0.35**。按 0 算的话，一条不写停顿的稿子每句少算最多 0.35 秒，
    // 六句就是两秒 —— 真有 38 秒的片子能从这道 35 秒的硬闸底下溜过去。
    // ⚠ 走 `padBeforeOf`/`padAfterOf`：节奏预设的缺省 ＋ 累积式的「留一拍」都算进来。
    const pad = cfg.lines.reduce((s, l) => s + padBeforeOf(l) + padAfterOf(l), 0);
    /**
     * 片尾 2026-08-24 改成**落点之后一共 2 秒**（`endHold`），
     * 老马线上 `freeze` / `hold` 已经不生效了 —— 这儿也得跟着算，
     * 不然体检报的片长比成片长三四秒，而**报出来的数是人拿去判断稿子长短的**。
     */
    const total = introOf(cfg) + spoken + pad + (cfg.endHold ?? 2);
    // ⚠ **区间 2026-08-23 从 25–32 放宽到 18–32，而且措辞改了。**
    //
    // v3 那批稿子每条五句、写得更精炼，实测 19–24 秒。旧的下限 25 会对每一条报一次，
    // 而人消掉这个提醒的办法只有一个：**把定格和收尾卡撑长**。
    // 010 就是这么被撑到 25.2 的（freeze 1.6 / hold 3.0），看着不自然。
    //
    // ⚠ **2026-08-24 片尾砍到 2 秒之后，实测又短了两三秒**（1863 是 16.4）。
    // 下限那条提醒会更常响 —— **它要的仍旧是回去看稿子，不是回去加停顿**。
    // 用户原话：别硬撑时间，有本事就完善稿子内容，让稿子把时间撑起来。
    //
    // **片子首先要自然流畅，不是凑够一个数。** 所以下限只留一个「是不是漏了一拍」的
    // 提醒，**永远不提「加长停顿」** —— 那是这条提醒唯一会被误用的方向。
    // 累积式是 35–45 秒（排比要攒够层数），单点式 18–35。
    // ⚠ **两头都只按体裁挪，判据一个字没改**：超了砍字不加速，短了回去看稿子不加停顿。
    const capMax = cum ? 45 : 35;
    const capMin = cum ? 30 : 18;
    if (total > capMax)
      err(`全片 ${total.toFixed(1)}s，超过 ${capMax}。§四：超了砍字，**不要加速** —— 加速会毁掉所有停顿设计`);
    else if (total < capMin)
      warn(
        `全片 ${total.toFixed(1)}s，短于 ${capMin} —— **回头看是不是漏了一拍**` +
          (cum ? '（累积层少了一句，或者沉底前没留一拍）' : '（少了一句铺垫、或者落点前没留白）') +
          `。**别靠拉长定格和收尾卡凑**：硬停出来的长度看着就是硬停的`
      );
    else warn(`全片 ${total.toFixed(1)}s`);
  }

  // ── 画面：抵消单调的工具用了几件 ──
  //
  // 这一条**改过口径**。原来是「一个场景 + 零漫符 = 太单调」，
  // 但表情规范定下来之后，正片里零漫符是**规定动作**不是缺陷
  // （§八：情绪符号全片最多一个，那一个留给收尾卡）。
  // 抵消单调的活现在归眼动、逐屏字幕和扭头 —— 漫符不背这个锅了。
  //
  // 剩下真正值得报的只有镜别：§五 写着「一条片子镜别切换不超过 3 次」，
  // **上限是 3，不是 0**。一镜到底 30 秒，全靠表演撑。
  const shots = new Set(cfg.lines.map((l) => l.scene ?? cfg.scene));
  const moves = cfg.lines.filter((l) => l.turn).length;
  if (shots.size === 1 && cfg.camera === 'static' && moves === 0)
    warn(
      `一个场景、镜头不动、一次扭头都没有 —— §五 的镜别表上限是 3 次，不是 0 次。` +
        `这条片子抵消单调只剩眼动一件工具了`
    );


  // ── 表情规范（老马出片方案 §五）────────────────────────────────────
  //
  // 这一段查的是**表演**，不是文字。首片形式项全绿、结构全对，
  // 挂掉的正好都在这儿：24 秒一次没眨眼、落点句眯着眼、说话标记挂满 29 秒、
  // 转折句的字幕整段预铺。**这些一条都不是品味问题，都是规范里写死的数。**

  // 眨眼：只放在停顿和换气处，所以能不能排得下取决于停顿够不够
  const durOf = (l: LineCfg) => l.dur ?? Math.max(1.1, [...lineText(l)].length * 0.22 + 0.5);
  {
    let cur = introOf(cfg);
    let last = cur;
    let worst = 0;
    cfg.lines.forEach((l, i) => {
      const a = cur + padBeforeOf(l);
      const b = a + durOf(l);
      // 停顿够长（≥0.35）能塞眨眼；say 的换气也算
      if (a - last > 0) {
        if (a - last >= 0.35) last = a;
        else worst = Math.max(worst, a - last);
      }
      if ((l.say?.length ?? 0) > 1) last = a + durOf(l) * 0.5;
      const gap = padAfterOf(l) + (cfg.lines[i + 1] ? padBeforeOf(cfg.lines[i + 1]) : 0);
      if (gap >= 0.35) last = b;
      else worst = Math.max(worst, b - last);
      cur = b + padAfterOf(l);
    });
    if (worst > 6)
      warn(`有一段 ${worst.toFixed(1)} 秒排不进眨眼（上限 6 秒）—— 停顿太密或太短，观众会读出「静图配音」`);
  }

  // 闭目：全片最多一次，不能在落点句
  const closes = cfg.lines.filter((l) => l.closeEyes);
  if (closes.length > 1) err(`闭目用了 ${closes.length} 次。**全片最多一次** —— 它读作「忍耐/认命」，是很重的情绪，用两次就廉价了`);
  for (const l of closes) {
    if (l.beat === 'punch') err('落点句闭目。落点要的是正视镜头，闭上就把全片最重的那一眼丢了');
    const d = l.closeEyes!;
    if (d < 0.8 || d > 1.5) warn(`闭目 ${d}s，建议 0.8–1.5。短于 0.5 秒读作眨眼，长过 1.5 秒观众开始等他睁眼`);
    // 停顿 = 这一句的 padAfter ＋ **下一句的** padBefore。
    // ⚠ 下一句的 padBefore 缺省不是 0.1 —— `beats/typeA.ts` 给的是 0.15，
    // **落点句前面是 0.4**。早先这儿写死 0.1，于是「padAfter 0.6 ＋ 闭目 0.8 ＋ 下一句是落点」
    // 这种本来有 1.0s 余量的稿子会被算成 0.7s，**报成硬伤直接拦下**。
    // 张嘴无声那一段（见下）一直是按下一句真实的 padBefore 算的，这儿是漏了。
    const next = cfg.lines[cfg.lines.indexOf(l) + 1];
    const room = padAfterOf(l) + (next ? padBeforeOf(next) : 0);
    if (room < d + 0.15)
      err(`闭目 ${d}s，但这一句说完只有 ${room.toFixed(2)}s 的停顿 —— 会咬进下一句的开头。加 padAfter`);
  }

  // ── 无声字幕（`line.silent`）：第五件抵消单调的工具 ────────────────
  //
  // 念出来是一句陈述，不念就是一张插入字卡 —— 观众自己读，冷一档。
  // 但它把片子从「老马在跟你讲」切换成「画面在给你看字」，
  // **一条里出现两次就成了花招**，所以跟闭目、张嘴无声同一个待遇：全片最多一次。
  {
    const silents = cfg.lines.map((l, i) => ({ l, i })).filter((x) => x.l.silent);
    if (silents.length > 1)
      err(
        `无声字幕用了 ${silents.length} 次（第 ${silents.map((x) => x.i + 1).join('、')} 句）。**全片最多一次** —— ` +
          `它是一记冷刀，出现两次就成了花招`
      );
    for (const { l, i } of silents) {
      const d = l.silent!;
      if (d < 1.0 || d > 2.5)
        err(`第 ${i + 1} 句的无声字幕挂 ${d}s，超出 1.0–2.5 —— **短了读不完，长了就是卡住**`);
      if (l.beat === 'punch')
        err('落点句是无声字幕。落点要的是他自己说出来那一下 —— 字卡把最重的一句变成了旁白');
      // ⚠ **不许拿它绕过「不解释」。** 字面是事实才成立（「杯子是空的」是他动作的结果）；
      // 一旦写成「其实他心里……」，静音字卡就成了说破的后门 —— 而且比说出来更像画外音。
      const t = lineText(l);
      const m = t.match(EXPLAIN) ?? t.match(V3_EXPLAIN) ?? t.match(REACTION);
      if (m)
        err(
          `第 ${i + 1} 句是无声字幕，却命中「${m[0]}」。**字卡只能放事实** —— ` +
            `它没有人称、没有语气，写成心理活动就是画外音替观众下判断，比说出来更重`
        );
    }
  }

  // 张嘴无声：跟闭目一样，停顿撑不住就会咬进下一句
  cfg.lines.forEach((l, i) => {
    if (!l.openMouth) return;
    if (l.beat === 'punch') err('落点句后面张嘴无声。落点说完就该完 —— 再补一个动作等于自己给包袱加注解');
    const room = padAfterOf(l) + (cfg.lines[i + 1] ? padBeforeOf(cfg.lines[i + 1]) : 0);
    if (room < l.openMouth + 0.15)
      err(`张嘴无声 ${l.openMouth}s，但这一句说完只有 ${room.toFixed(2)}s 的停顿 —— 会咬进下一句。加 padAfter`);
    if (l.openMouth < 1)
      warn(`张嘴无声 ${l.openMouth}s，偏短。这一下要的是「他说不出话」，不到一秒读成口型没对上`);
  });

  // 落点句：正视镜头，不给表情
  const pl = cfg.lines.find((l) => l.beat === 'punch');
  if (pl?.look || pl?.say?.some((s) => s.look))
    err(`落点句点了表情「${pl.look ?? pl.say?.find((s) => s.look)?.look}」。**落点不给表情** —— 脸在替台词做解释，笑点就成了图解`);

  // 说话标记：不能全程常亮
  if (cfg.speechBurst) {
    const by = cfg.speechBurst.byBeat;
    if (!by) warn('说话标记没分 beat，等于全程常亮 —— 挂满一整条它就退化成装饰贴纸，落点也没有额外的强调余地了');
    else if (!Object.values(by).some((v) => v === 0))
      warn('说话标记每个 beat 都在出。**留白是为了让落点有东西可以亮**，铺垫段建议给 0');
  }

  // 情绪符号：全片最多一个
  const symbols = cfg.lines.reduce((n, l) => n + (l.marks?.length ?? 0), 0) + (cfg.endMark ? 1 : 0);
  if (symbols > 1)
    err(`情绪符号 ${symbols} 个。**全片最多一个** —— 汗滴、问号、井字纹这类符号是画面在替观众下判断，跟「不慌不忙、只陈述不评论」的人设直接冲突`);

  // 字幕逐屏：转折句和落点句不许整段铺
  const screens = (l: LineCfg) =>
    l.say?.length ? l.say.map((s) => [...s.text.replace(/[\s\p{P}]/gu, '')].length) : [[...lineText(l).replace(/[\s\p{P}]/gu, '')].length];
  cfg.lines.forEach((l, i) => {
    const r = roles[i];
    if (r !== 'punch' && r !== 'turn') return;
    // ⚠ **累积式显式停用「转折句一屏 ≤12 字」和「落点整句一次性打出」这两条**
    //（《累积式_字幕.md》）：那两条是防剧透的，而累积式的字幕在造节拍 ——
    // 一屏装的是一个**语义单元**（状语＋结果），按字数硬拆正好把笑点切成两半。
    // 换上的是下面那一组（驻留、排比不合屏、状语结果不分家、签名屏）。
    if (cum) return;
    for (const n of screens(l))
      if (n > 12)
        err(
          `${r === 'punch' ? '落点' : '转折'}句有一屏 ${n} 字（上限 12）—— ` +
            `观众读完还得等他念完，**笑点在被听到之前就消费掉了**。拆 say`
        );
  });

  // ── 累积式的字幕：造节拍，不是防剧透（《累积式_字幕.md》）──────────
  //
  // **单点式怕的是观众读完落点才听到落点**，所以拆屏、少给、晚给。
  // **累积式怕的是排比塌成一段话**，所以切齐、对齐、看得见重复。
  // 两套规则在好几处正面冲突，所以这一组只在 `format: "cumulative"` 下跑。
  if (cum) {
    /** 序数标记。同一屏里出现两个，就是把排比合并成了一段话 */
    const ORDINAL = /第[一二三四五六七八九十]|[一二两三四五六七八九十](?:趟|次|回|遍)/g;

    cfg.lines.forEach((l, i) => {
      const dur = l.dur ?? estimateDur(lineText(l));
      const spans = partSpans(l, 0, dur, { pace });
      const padAfter = padAfterOf(l);

      spans.forEach((s, j) => {
        const bare = s.text.replace(/[\s\p{P}]/gu, '');
        // ① 一屏驻留 <0.6 秒 —— 句间压到 0.35–0.45 之后，短屏会变成一闪而过。
        //   **最后一屏算上这一句的停顿**：字幕盖到 padAfter 结束才换，那段也是驻留。
        const dwell = s.b - s.a + (j === spans.length - 1 ? padAfter : 0);
        if (dwell < CUM_SCREEN_MIN)
          err(
            `第 ${i + 1} 句第 ${j + 1} 屏「${s.text}」只驻留 ${dwell.toFixed(2)}s，` +
              `低于 ${CUM_SCREEN_MIN}s —— **读不完，只是闪了一下**。` +
              `并进相邻那一屏（同一个语义单元），或者把这一句写长一点` +
              (l.dur ? '' : '（现在是按字数估的，`align` 之后再看一遍）')
          );

        // ② 排比合并成屏：同一屏里两个序数标记 —— 重复要看得见，才有累积感
        const ord = bare.match(ORDINAL) ?? [];
        if (ord.length >= 2)
          err(
            `第 ${i + 1} 句第 ${j + 1} 屏「${s.text}」里有 ${ord.length} 个序数（${ord.join('、')}）—— ` +
              `**排比句一句一屏，绝不合并**。合并之后排比就成了一段话，累积感全丢`
          );

        // ③ 状语与结果被拆开：一屏以「地」「得」收尾，说明修饰和结果分了家。
        //   那个错位就是笑点，拆开等于切成两半，前半屏还剧透了后半屏。
        if (/[地得]$/.test(bare) && j < spans.length - 1)
          warn(
            `第 ${i + 1} 句第 ${j + 1} 屏「${s.text}」以「${bare.slice(-1)}」收尾 —— ` +
              `**状语和结果必须同屏**。一屏放不下就改写句子，不靠拆屏解决`
          );
      });
    });

    // ── 签名屏 ──────────────────────────────────────────────────
    //
    // 「不过这样也挺好」在全部条目里逐字相同，反复出现会长成频道的记忆点。
    // **成立的前提是完全一致**：位置、字号、入场方式、驻留四项锁死，飘一条就只显得偷懒。
    // 前三项由渲染层保证（侧栏定位、按屏文字自适应字号、无位移入场），
    // 第四项这儿量出来给人看 —— **量得出来才叫锁死，"建议 0.9 秒"锁不住任何东西**。
    const psay = punch.say ?? [];
    if (psay.length < 2)
      err(
        '累积式的落点必须拆两屏：「不过这样也挺好」停一拍，再出后半句。' +
          '**拆的目的是给那一拍腾出位置**，不是怕提前读到 —— 写进 `say`'
      );
    else {
      const sig = psay[0].text.replace(/[\s\p{P}]/gu, '');
      const spans = partSpans(punch, 0, punch.dur ?? estimateDur(lineText(punch)), { pace });
      const d = (spans[0].b - spans[0].a).toFixed(2);
      if (sig !== SIGNATURE)
        warn(
          `落点第 1 屏是「${sig}」，不是签名句「${SIGNATURE}」。` +
            `签名屏靠**逐字相同**长成记忆点 —— 这一条要么用那句原话，要么就当它没有签名屏`
        );
      else warn(`签名屏「${SIGNATURE}」驻留 ${d}s（四项锁死的第四项，${punch.dur ? '实测' : '估算'}）`);
    }
  }

  const turns = cfg.lines.filter((l) => roles[cfg.lines.indexOf(l)] === 'turn').length;
  if (turns === 0)
    warn('没有转折句（beat: reply/ask）。§四 的四段结构里，转折是落点的助跑');

  // ── 收尾卡：日子牌的字样 ──
  //
  // **只校验字样，不校验数字对不对** —— 数字要读分配表
  // （horse/CHANNEL_LAOMA.md §五之二），而且家庭类的条目占号但不出卡。
  //
  // 校验字样是因为它错得看不出来：「老马第1847天」「老马的第 1847 天。」
  // 单独看一条都通顺，四条片子排在一起才露馅，而那时候片子已经发出去了。
  // ── 写稿规范 v3：两条硬禁令 ＋ 一句配额 ────────────────────────────
  //
  // v2 的四禁令（不解释／不堆形容词／不评论／不抒情）是四条价值完全不同的规则
  // 被捆在了一起。前两条代价几乎为零，**保留为硬禁令**；后两条买到的是
  // 「老马不油腻」，代价是**他不能有立场、不能有感情** —— 一个不想要任何东西、
  // 不怕任何事、什么都不争取的角色，观众没法站在他那边，
  // **也没有任何一句值得截图转发**。
  //
  // 但全放开就是那一千个「说出了我的心声」账号里的第一千零一个。
  // 所以改成配额：**稀缺才有力量，一集一句。**
  //
  // ⚠ **机器不判断一句话有没有情绪** —— 那是 v3 §2 那条「删掉它信息量有没有变少」
  // 的人工判定。机器只查：你点的那句在不在该在的位置、有没有对观众说话、
  // 有没有第二句偷偷带情绪。**让脚本卡死，别靠自律**（配额制最容易滑坡成
  // 「反正能抒情」，一集两句三句，两个月后就变回那一千个账号）。
  {
    const last = cfg.lines.length; // 1 起算：落点
    if (cfg.emotionLine === undefined) {
      warn(
        '没写 `emotionLine`。v3 §2：**每集有且只有一句可以带情绪或立场** —— ' +
          '用了就写下标（1 起算），**不用就写 `null`**。' +
          '写出来的意思是「这一条动没动用那一句」是想过的，不是漏了'
      );
    } else if (cfg.emotionLine !== null) {
      if (!Number.isInteger(cfg.emotionLine) || cfg.emotionLine < 1 || cfg.emotionLine > last)
        err(`\`emotionLine\` 是 ${cfg.emotionLine}，越界（共 ${last} 句，1 起算）`);
      else if (cfg.emotionLine === 1)
        err(
          '配额句是开场句。v3 §2 约束①：**开场句永远是设定/钩子，不许带情绪** —— ' +
            '观众还没进来，煽不动'
        );
      else if (cfg.emotionLine !== last && cfg.emotionLine !== last - 1)
        err(
          `配额句在第 ${cfg.emotionLine} 句。v3 §2 约束①：**只能放在落点（第 ${last} 句）` +
            `或落点前一句（第 ${last - 1} 句）** —— 放在中间，它既不承担落点，也不给落点助跑`
        );

      // 约束②：不能对观众说话
      const qt = quotaIdx >= 0 && cfg.lines[quotaIdx] ? lineText(cfg.lines[quotaIdx]) : '';
      const p = qt.match(V3_SECOND_PERSON);
      if (p)
        err(
          `配额句里有「${p[0]}」：「${qt}」。v3 §2 约束②：配额句必须是**老马自己的处境**，` +
            `不能是对观众说话 —— 「你/谁/大家」一出现，他就从「在过自己的日子」变成了「在跟你搭话」。` +
            `**这是防止老马变成第一千零一个账号的唯一闸门**`
        );
    }

    // 约束③：数量 ≤1。
    //
    // ⚠ **机器判不了「哪句带情绪」，但判得了「哪句是心里活动」** ——
    // `REACTION` 那张表（差点/居然/忍不住/我觉得…）拦的正是这个。
    // 点名的那一句放行，**别的句子命中就是第二句配额**。
    cfg.lines.forEach((l, i) => {
      if (i === quotaIdx) return;
      // ⚠ **落点跳过：§一之十三 那条已经报过它了。**
      // 不跳的话同一句会报两遍（一遍「落点是反应句」、一遍「第二句配额」），
      // 而 `gate()` 打出来的硬伤条数是人判严重程度的依据 —— 翻倍就不准了。
      if (i === punchIdx) return;
      const m = lineText(l).match(REACTION);
      if (m)
        err(
          `第 ${i + 1} 句是情绪句：命中「${m[0]}」。v3 §2 约束③：**一集只有一句配额**` +
            (quotaIdx >= 0 ? `，而配额已经给了第 ${quotaIdx + 1} 句` : `，而这一条一句都没点名（\`emotionLine\`）`) +
            `。要么改成事实句，要么把配额挪过来`
        );
    });

    // 硬禁令一：不解释（v3 的成品结论词表，全篇）
    cfg.lines.forEach((l, i) => {
      const m = lineText(l).match(V3_EXPLAIN);
      if (m)
        err(
          `第 ${i + 1} 句在替观众下结论：命中「${m[0]}」。v3 §1 硬禁令「不解释」——` +
            `不写「太真实了」「打工人都懂」「这就是职场」，不给结论贴标签`
        );
    });

    // 硬禁令二：不堆形容词。一个名词最多带一个修饰
    cfg.lines.forEach((l, i) => {
      const t = lineText(l);
      const m = t.match(ADJ_CHAIN);
      if (m && ADJ_WORDS.test(m[0]))
        warn(
          `第 ${i + 1} 句「${m[0]}」像是一个名词带了两个修饰。v3 §1 硬禁令「不堆形容词」：` +
            `**删掉后句子还成立的形容词，删掉**`
        );
    });

    // v3 §5：身体锚点
    if (!cfg.bodyAnchor)
      warn(
        '没写 `bodyAnchor`。v3 §5：**这件事有没有一个身体动作或具体物件，' +
          '是几乎所有人都做过的？** —— 已发四条的播放量排下来，越具体越身体的越好' +
          '（电梯里看哪儿 1385 / 外卖备注 448 / 天气预报 384 / 对齐了三次 50）。' +
          '**写不出来就换选题**'
      );
  }

  // ⚠ **累积式不带日子牌**（《累积式_出片方案》§五）：单点式是老马的日记，有连续性；
  // 累积式是他随口说的，**不占时间轴** —— 什么时候发都不突兀。
  // 挂了日子牌，它就要在那条日记的时间轴上占一格，而它并不该占。
  if (cum && cfg.hook !== undefined)
    err(
      `累积式挂了日子牌「${cfg.hook}」。**累积式不带日子牌、不出收尾卡** ——` +
        `它不占老马那条时间轴，所以发片节奏可以自由掌控。删掉 \`hook\``
    );
  // ── 单点式：收尾卡和尾卡事实句**两样都是必备的**（2026-08-25 用户定）──
  //
  // 「单点式片子要有这两样，不能变。」原话。
  //
  // ⚠ **这一条推翻了两处旧规矩**，别再照旧的写：
  // ① CHANNEL_LAOMA §五之二 的「家庭类不出收尾卡」（laoma-002 那条）——**作废**，
  //    家庭类照出。日子照样占一格那半句仍然成立。
  // ② 尾卡「每五条最多一条」的使用率 —— **作废**（见上面那段）。
  //
  // ⚠ **拦在这儿而不是写进文档**：这两样都只在最后两秒露出来，
  // 逐镜看静帧看不见 —— 漏了得等成片渲完、或者根本等到发出去才发现。
  if (!cum && cfg.legacy) {
    warn(
      '这条标了 `legacy`：**收尾卡／尾卡那一组必备项不查它** —— 成片出在规范之前，不回改。' +
        '新稿子不许写这个字段'
    );
  } else if (!cum) {
    if (cfg.hook === undefined)
      err(
        '单点式没有收尾卡（`hook`）。**这一档是格式的一部分，不是可选项** —— ' +
          '写成 `"hook": "老马的第 1874 天"`（数字照 CHANNEL_LAOMA §五之二 的分配表）'
      );
    if (!tail)
      err(
        '单点式没有尾卡事实句（`tailCard`）。**跟收尾卡是一组**：一个报「第几天」，' +
          '一个报「后来怎么样了」，两条都是事实，观众一眼读完两行'
      );
  }
  if (!cum && cfg.hook !== undefined && !/^老马的第 \d+ 天$/.test(cfg.hook))
    err(
      `收尾卡「${cfg.hook}」不是日子牌的字样。写成 \`老马的第 1847 天\`：` +
        `数字前后各一个空格、结尾不加标点。数字照 horse/CHANNEL_LAOMA.md §五之二 的分配表`
    );

  // ── 字体在不在 ──────────────────────────────────────────────────
  //
  // ⚠ **字体缺了不报错，只是悄悄回退。** `FONT_FILES` 是 `.filter(existsSync)`，
  // 文件不在就少喂一个，resvg 跟着用系统字体 —— 字幕规范 §二 的原话是
  // 「你只会觉得『字怎么没变』」。实测不喂文件时渲出来跟雅黑**字节数完全一样**。
  //
  // 所以在这儿拦一道：**没有字体就不该出片**，而不是出一条字体不对的片子。
  if (!FONT_FILES.some((p) => p.includes('SmileySans')))
    err(
      '找不到得意黑字体文件（`fonts/smiley-sans-v2.0.1/SmileySans-Oblique.otf`）。' +
        '**缺了不会报错，只会静默回退到系统黑体** —— 字幕就不是这条线的样子了。见 `fonts/README.md`'
    );

  return out;
}

export function gate(cfg: JokeCfg): boolean {
  const issues = checkLaoma(cfg);
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  if (errors.length) {
    console.error(`\n${errors.length} 条硬伤。**体检全绿不等于好笑，但有硬伤一定不好笑。**`);
    console.error('查不了的那三条（一条一个笑点 / 误导公不公平 / 线索前面出现过吗）只有人能判，见 SCRIPT_GUIDE §六。');
    return false;
  }
  console.log(`  ✓ 形式项全过${issues.length ? `，${issues.length} 个提醒` : ''}`);
  return true;
}

if (process.argv[1]?.endsWith('laoma-check.ts')) {
  const argv = process.argv.slice(2);
  if (argv.includes('--ledger')) {
    const l = loadLedger();
    console.log(l.length ? l.map((e) => `第 ${e.day} 天  ${e.nums.join('、') || '—'}`).join('\n') : '（账本为空）');
    process.exit(0);
  }
  const p = argv.find((a) => !a.startsWith('--'));
  if (!p || !existsSync(p)) {
    console.log('用法：npx tsx src/laoma-check.ts jokes/laoma-001.json [--commit]');
    console.log('      npx tsx src/laoma-check.ts --ledger      看数字账本');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as JokeCfg;
  console.log(`《${cfg.cover?.title ?? cfg.id}》稿件体检\n`);
  const ok = gate(cfg);
  // ⚠ **只有过了才入账。** 挂着硬伤的稿子还会改，改完数字可能就换了 ——
  // 提前入账等于给自己埋一个「跟自己撞车」的假报警。
  if (ok && argv.includes('--commit')) commitNumbers(cfg);
  process.exit(ok ? 0 : 1);
}

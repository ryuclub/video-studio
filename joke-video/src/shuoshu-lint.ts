// ── 稿件闸：在解析之前，直接读 markdown ────────────────────────────────
//
// 用法：npm run shuoshu:lint -- ../shuoshu/liaozhai-E06-lupan.md
//
// ── 为什么要有这一道 ──
//
// 出片手册的七步里，闸只有一道（体检），装在第 ③ 步（标注）之后。
// 可它查的东西横跨两类：
//
//   · **稿件级**（总时长 / 分幕下限）—— 这是第 ① 步的产物，markdown 上就能算
//   · **工程级**（needsReview / 节拍占比 / 场景段号 / 封面字段）—— 这才真的要等 ②③
//
// 两类塞进同一道闸的后果是：稿件级的问题必然等到标注做完才暴露，
// **而补稿恰好会打乱标注和场景表**。E06 就在这个环里走了一圈 ——
// 写完 5126 字，体检才说分幕下限没过；补到 5785 又超了 24 分钟；
// 后来又发现「人味儿」四条判据缺一条，补了三段，193 之后的段号全移位，
// 节拍要重贴、scenes.json 要手工后移再逐条核。
//
// 一句话原则：**每个判据的闸，要装在能改它的最便宜的那个表示上。**
// 字数是 markdown 的属性就在 markdown 上查，别等到 script.json。
//
// ── 这一道查得了什么，查不了什么 ──
//
// 查得了的都在下面。**查不了的比查得了的重要**，所以最后会把那张必答清单印出来：
// 人味儿四条、平读测试、说破层五条。机器判不了「意思还在不在」，
// 但可以让这些问题**在正确的时刻出现在眼前** —— 而不是在标注做完之后。
//
// 这一道**不建目录、不写任何文件**。它只读一个 .md，说一句行或不行。

import { readFileSync } from 'node:fs';
import { parse, parseCastMap } from './shuoshu-parse.js';
import { CPM, TARGET_MIN, LEGACY_MIN, TARGET_MAX, ACT_TAIL_MAX, han, actFloor } from './shuoshu-limits.js';
import { BEAT_ACTIVE, BEAT_RETIRED, BEAT_REVEAL_MAX, BEAT_RUN_MAX } from './shuoshu-beat.js';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

export function lintScript(md: string): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  // parse() 自己会炸的两样先让它炸：缺「- 选角：」那一行、音色名不存在。
  // 那两样是硬错，没有「警告一下继续」的余地。
  const { lines } = parse(md);
  const header = md.slice(0, md.indexOf('\n---\n'));
  const cast = parseCastMap(header);

  if (!lines.length) return [{ level: 'error', msg: '正文一段都没有（--- 之后是空的）' }];

  // ── 说破层：三行要在动笔之前就定下来 ────────────────────────────────
  //
  // 手册 §二：「先扩写、收束再想道理，想出来的一定是能印在日历上的通用话。」
  // 所以这三行**在稿件头部**，不是写完补的。缺了只警告 —— 有的期确实是
  // 边写边定的，拦住反而挡路；但要说出来。
  for (const [k, why] of [
    ['说破', '一句。三个模子挑一个（错位型 / 归因型 / 反转型），一期只用一个'],
    ['诊断词', '一个古语的单字双字，**紧跟一句重定义「X 不是 A，是 B」**'],
    ['现代对照', '从行为链推出来的同构场景，一期只用一个题材域'],
  ] as const) {
    if (!new RegExp(`^[-*]\\s*${k}`, 'm').test(header)) warn(`稿件头部没有「- ${k}：」那一行 —— ${why}`);
  }

  // ── 字数 ────────────────────────────────────────────────────────────
  const total = lines.reduce((a, l) => a + han(l.text), 0);
  const mins = total / CPM;
  if (mins < LEGACY_MIN)
    err(
      `只有 ${total} 汉字，按 ${CPM} 字/分约 ${mins.toFixed(1)} 分钟，短于 ${TARGET_MIN} 分钟。\n` +
        `      **这不是让你去注水** —— 卡片第一原则写着「为了凑时长把过程砍掉是错的」，反过来灌水一样错。\n` +
        `      短了先回去看哪一幕的过程戏被压掉了。`
    );
  else if (mins < TARGET_MIN) warn(`${total} 汉字约 ${mins.toFixed(1)} 分钟，短于现行的 ${TARGET_MIN} 分钟（老标准 15–17，已出片的不回改）`);
  else if (mins > TARGET_MAX)
    warn(
      `${total} 汉字按 ${CPM} 字/分约 ${mins.toFixed(1)} 分钟，超过 ${TARGET_MAX}。\n` +
        `      ⚠ ${CPM} 是六期里最慢的一档。**旁白占比高的一期实测 235–239**（E05 239 / E06 235），\n` +
        `      按 238 折算是 ${(total / 238).toFixed(1)} 分钟 —— 先看这个数，再决定要不要删。`
    );

  // 分幕下限：总数够了也可能是某一幕撑着、另一幕塌了。
  // **两套地板都要过** —— E03 就是把全篇下限当成了目标，分幕四个数一个没看。
  const byAct = new Map<string, number>();
  for (const l of lines) byAct.set(l.act, (byAct.get(l.act) ?? 0) + han(l.text));
  for (const [a, c] of byAct) {
    const floor = actFloor(a);
    if (c < floor) warn(`「${a}」只有 ${c} 汉字，低于同类段落的下限 ${floor}。过程戏是说书的本体，先看是不是被压掉了`);
  }

  // ── 三条写作规范（手册 §二，直接决定标注那一步要不要人判断）──────────

  // ① 解析器认不出说话人的，一段都不该有。E01 有 18 段，E02 守了规范之后是 0
  const review = lines.filter((l) => l.needsReview);
  for (const l of review) err(`第 ${l.no} 段 ${l.reviewNote}：「${l.text.slice(0, 24)}…」`);

  // ② **冒号，不要逗号。** 这一条单列出来，因为它是三条里唯一**不报错**的那个：
  //    「她说，我原是…」正则匹配不上，整段当旁白念过去，而且没有任何标记。
  //    比 needsReview 危险得多 —— 那个至少还举了手。
  const names = Object.keys(cast).sort((a, b) => b.length - a.length);
  if (names.length) {
    const commaSaid = new RegExp(`^(?:.{0,8}?[。，])?(${names.join('|')})[说问道][，,]`);
    for (const l of lines) {
      const m = commaSaid.exec(l.text);
      if (m)
        err(
          `第 ${l.no} 段「${m[1]}说，」用的是逗号，要冒号：「${l.text.slice(0, 24)}…」\n` +
            `      ⚠ 这一条**不会报错也不会标 needsReview** —— 整段会当旁白念过去。三条规范里最危险的一条。`
        );
    }
  }

  // ③ 每幕结尾一个短句独立成段：给 TTS 自然停顿点 + 画面切点
  for (let i = 0; i < lines.length; i++) {
    const last = i === lines.length - 1 || lines[i + 1].act !== lines[i].act;
    if (!last) continue;
    const n = han(lines[i].text);
    if (n > ACT_TAIL_MAX)
      warn(`「${lines[i].act}」的末段 ${n} 汉字，规范要一个短句独立成段（≤${ACT_TAIL_MAX}）：「${lines[i].text.slice(0, 22)}…」`);
  }

  // ── 说破层的一条硬规矩：不说「你」，说「他 / 我们」──────────────────
  //
  // 转述里的引语（「爹，你什么时候不来了」）是合法的，所以只能警告、不能拦。
  const you = lines.filter((l) => l.who === '说书人' && l.text.includes('你'));
  for (const l of you)
    warn(`第 ${l.no} 段旁白里有「你」：「${l.text.slice(0, 24)}…」\n      确认它是转述的引语，不是在对听众说话（说破层规范：不说「你」，说「他 / 我们」）`);

  // ══ 频道稿件规范 §九「可以脚本化的检查」 ══════════════════════════
  //
  // 规范全文在 shuoshu/说书稿件规范.md。下面这些**不用人看**；
  // 人只需要看剩下的四样：钩子够不够反常 / 长短句有没有节奏 /
  // 歧义是不是有意的 / 收束有没有回到开头。

  // ── §二.1 一条 line = 一个字幕屏 = 一次停顿 ────────────────────────
  //
  // 24 不是拍的：本线字幕实测 FontSize=30 → 字宽 79px，1920÷79 = 24 字。
  // 第 25 个字 libass 会折成两行，字块往上长到 200px 高。
  // **line 上限和字幕行宽是同一个数**，两边对齐是有意的。
  const w = (t: string) => [...t].length;
  for (const l of lines) {
    const n = w(l.text);
    if (n > LINE_HARD) err(`第 ${l.no} 段 ${n} 字，超过硬伤线 ${LINE_HARD}：「${l.text.slice(0, 26)}…」`);
    else if (n > LINE_MAX) warn(`第 ${l.no} 段 ${n} 字，超过 ${LINE_MAX}（一个字幕屏的宽度）：「${l.text.slice(0, 26)}…」`);
  }

  // line 内部的句号 / 分号 / 破折号 = 这一条其实是两条。**末尾那个句号不算**
  for (const l of lines) {
    const inner = l.text.replace(/[。！？」』）]+$/u, '');
    if (/[。；]|——/.test(inner))
      err(`第 ${l.no} 段内部有句号或破折号，该拆成两条：「${l.text.slice(0, 26)}…」`);
  }

  // ── §二.3 句首 ────────────────────────────────────────────────────
  for (let i = 1; i < lines.length; i++)
    if (lines[i].text.slice(0, 2) === lines[i - 1].text.slice(0, 2))
      warn(`第 ${i} / ${i + 1} 段同开头「${lines[i].text.slice(0, 2)}」：相邻两句不许同开头`);

  const heads = new Map<string, number>();
  for (const l of lines) heads.set(l.text.slice(0, 2), (heads.get(l.text.slice(0, 2)) ?? 0) + 1);
  for (const [h, n] of [...heads].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const pct = (n / lines.length) * 100;
    if (pct > HEAD_MAX_PCT)
      err(
        `「${h}」开头的句子占 ${pct.toFixed(1)}%（上限 ${HEAD_MAX_PCT}%，${n} 条）。\n` +
          `      主角名最容易超。换成：他 / 这人 / 那书生，或者用动作起头`
      );
  }

  // ── §三 同音歧义 ──────────────────────────────────────────────────
  //
  // 机器只能**指出来让人看**，判不了「这个歧义是不是有意的」。
  // 所以一律是提醒，而且按字聚合 —— 二十个高危字逐条报会淹掉别的问题。
  const risky = new Map<string, { no: number; text: string }[]>();
  for (const l of lines)
    for (const c of RISKY_CHARS)
      if (l.text.includes(c)) {
        if (!risky.has(c)) risky.set(c, []);
        risky.get(c)!.push({ no: l.no, text: l.text });
      }
  if (risky.size) {
    const brief = [...risky].map(([c, hits]) => `${c}×${hits.length}`).join(' ');
    warn(`高危字（§三.1）：${brief}\n      逐个判：这个字离开它所在的词，会不会读成另一个音、变成另一件事？\n      有意保留的歧义写进稿件头部，免得后期当错误改掉`);
  }

  // §三.4 一集内同字异读。
  //
  // ⚠ **虚词要排除，否则它们把真问题淹了。** 「了 着 得 还」在中文里每句都有，
  // E06 实测「了」有 145 种词形、「着」43 种 —— 全报出来，剩下那几个真的
  // （活 / 干 / 数 / 中 / 长 / 为）就看不见了。
  // 它们仍留在 §三.1 的高危字清单里让人扫一眼，只是不进这一条。
  //
  // 代价记在这儿：**这样会漏掉「我了了」那种**（liǎo le vs le）。
  // E06 就有一处，是靠没排除虚词的那一版抓出来的，改成了「办完了」。
  // 漏掉的这一类只能靠 §三.1 那张清单人工扫 —— 机器分不出「了」念哪个音。
  for (const [c, hits] of risky) {
    if (PARTICLES.includes(c)) continue;
    const forms = new Set(hits.map((h) => {
      const i = h.text.indexOf(c);
      return h.text.slice(Math.max(0, i - 1), i + 2);
    }));
    if (forms.size >= 4)
      warn(`「${c}」在全集有 ${forms.size} 种词形（${[...forms].slice(0, 5).join(' / ')}…）——§三.4：同字异读会让听众觉得读错了一个`);
  }

  // ── §四.2 提示语雷同：**窗口，不是相邻** ──────────────────────────
  //
  // ⚠ 原来写的是「连续三句」，而一条 line ≤24 字之后，三个提示语中间隔着
  // 各自的续句 —— **「连续」这个判据被切碎了**，E06 那三句「那人说」
  // （415 / 417 / 419 段，中间各隔一条）就是这么漏过去的。
  // 这个 bug 是「切碎句子」这次改版自己引入的：判据依赖的那个结构没了。
  //
  // 提示语的定义放宽到「1–4 个字 + 说/问/道 + 逗号或冒号」——
  // 「他说，」「那人说，」「朱尔旦说：」一视同仁（§四.2）。
  const tagOf = (t: string) => /^(.{1,4}?)(说|问|道)[，,：:]/.exec(t)?.[0] ?? null;
  const reported = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const tag = tagOf(lines[i].text);
    if (!tag || reported.has(lines[i].no)) continue;
    const win = lines.slice(i, i + TAG_WINDOW).filter((l) => tagOf(l.text) === tag);
    if (win.length < 3) continue;
    win.forEach((l) => reported.add(l.no));
    warn(
      `第 ${win.map((l) => l.no).join(' / ')} 段：${TAG_WINDOW} 句之内出现三次「${tag}」（§四.2）。
` +
        `      四条改法：去掉提示语靠停顿分 ／ 换成动作 ／ 一半改转述 ／
` +
        `      **让第三个反过来加重落点**（前两个去掉，第三个换成「最后那句，吴老爷记了一辈子。」）`
    );
  }

  // ── §三之二.2 单音节裸奔 ──────────────────────────────────────────
  //
  // 双音节是中文听觉的最小单位。同一个字，有词撑着和裸着是两回事 ——
  // 「行当」听得清，「行」听不清。
  //
  // 只查两个**窄**的形状，宽了会把「中了」「好了」这类全报出来变成噪声：
  //   裸尾　　 [了的个一没不] + 高危字 + [，。！？]      「转了**行**。」
  //   虚词夹　 [先也就还再又都] + 高危字 + 了            「我先**干**了。」
  //
  // ⚠ **用的不是 §三.1 那张表。** 两张表目的不同：
  //   §三.1 查「这个字会不会读错音」　这里查「这个字裸着站不站得住」
  // 最典型的「转了**行**」里的「行」**不在 §三.1 表里**（它不是常见的读错字），
  // 可它是裸奔的头号案例。所以另立一张 BARE_CHARS。
  //
  // 三处校准（跟别的阈值一样，是量出来调的，不是推的）：
  //   · **虚词 了/着/得/还 不算** —— 「动不了」「放不了」全是语法，不是裸奔
  //   · **左边是「不/没」的不算** —— 「不好」「没空」本身就是双音节单位
  //   · **「为了 / 除了 / 极了 / 罢了」是固定词**，白名单放过
  const HZ = BARE_CHARS.join('');
  const BARE_TAIL = new RegExp(`[了的个一]([${HZ}])[，。！？]`);
  const BARE_MID = new RegExp(`[先也就还再又都]([${HZ}])了`);
  const BARE_OK = /(为|除|极|罢|忘|坏|好)了|回了家/;
  for (const l of lines) {
    // 白名单要挂在**两个形状上**，只挂一个的话「背回了家」照样被报（漏过一次）
    const m = BARE_OK.test(l.text) ? null : (BARE_TAIL.exec(l.text) ?? BARE_MID.exec(l.text));
    if (m)
      warn(`第 ${l.no} 段「${m[1]}」是裸着的单音节（§三之二.2）：「${l.text}」
      前后没有字托住它，声音上抓不住。能不能换成双音节？`);
  }

  // ── §三之二.1 踩过的词边界坑 ──────────────────────────────────────
  //
  // **这张表不求全，是踩一个记一个。** 词边界歧义没有穷举的办法 ——
  // 能做的是让同一个坑不踩第二次。真正兜住这一类的是审稿那一层（规范 §十一）。
  for (const { re, why } of SPLIT_TRAPS)
    for (const l of lines)
      if (re.test(l.text)) warn(`第 ${l.no} 段撞上词边界坑（§三之二.1）：「${l.text}」
      ${why}`);

  // ── §四.3 出声角色 ≤3（不含说书人）──────────────────────────────
  const voiced = [...new Set(lines.map((l) => l.who))].filter((x) => x !== '说书人');
  if (voiced.length > VOICE_MAX)
    err(
      `出声角色 ${voiced.length} 个（${voiced.join(' / ')}），上限 ${VOICE_MAX}（不含说书人）。\n` +
        `      出场两三次的小角色并入转述 —— 音色多了听众记不住谁是谁`
    );

  // ── §一.2 幕的占比和极差 ──────────────────────────────────────────
  const actList = [...byAct];
  for (const [a, c] of actList) {
    const pct = (c / total) * 100;
    const band = /^幕/.test(a) ? ACT_PCT['幕X · '] : ACT_PCT[a];
    if (band && (pct < band[0] || pct > band[1]))
      warn(`「${a}」占全篇 ${pct.toFixed(1)}%，规范是 ${band[0]}–${band[1]}%`);
  }
  const muCounts = actList.filter(([a]) => /^幕/.test(a)).map(([, c]) => c);
  if (muCounts.length > 1) {
    const ratio = Math.max(...muCounts) / Math.min(...muCounts);
    if (ratio > ACT_SPREAD)
      warn(`幕间字数极差比 ${ratio.toFixed(2)}（上限 ${ACT_SPREAD}）——差得多说明某一幕塞了两件事，或者某一幕没写够`);
  }

  // ── §五 beat ──────────────────────────────────────────────────────
  //
  // ⚠ 稿件闸看到的 beat 是**解析器刚打上的**（幕末的收 / 「」的引文），
  // 人还没标。所以这里只查解析器自己会打出退役标签的那两种，
  // 占比和连续那两条要等标注完 —— 在体检里查（见 shuoshu-preflight.ts）。
  const retired = lines.filter((l) => l.beat && BEAT_RETIRED[l.beat]);
  if (retired.length) {
    const kinds = [...new Set(retired.map((l) => l.beat))];
    warn(
      `解析器打了 ${retired.length} 段退役节拍（${kinds.map((k) => `${k}→${BEAT_RETIRED[k]}`).join(' / ')}）。
` +
        `      §五 只用六种：${BEAT_ACTIVE.join(' / ')}。标注那一步改掉`
    );
  }

  // ── §一.4 冷开场不许交代出处，「今天讲」放末尾 ────────────────────
  const cold = lines.filter((l) => l.act === '冷开场');
  if (cold.length) {
    const at = cold.findIndex((l) => /今天讲|这一期讲|要讲的是《/.test(l.text));
    if (at >= 0 && at < cold.length - 3)
      err(`冷开场第 ${at + 1}/${cold.length} 段就交代了出处（「${cold[at].text.slice(0, 14)}」）。§一.4：出处放**末尾**，第一句必须是钩子`);
    if (/^[一-龥]{0,4}（?《/.test(cold[0].text) || /今天讲/.test(cold[0].text))
      err(`冷开场第一句就报了篇名。第一句必须是钩子：一个反常的事实、一个说不通的处境、一个具体的动作`);
  }

  return out;
}

/** §二.1 一条 line = 一个字幕屏。24 = 1920÷79（实测字宽） */
const LINE_MAX = 24;
const LINE_HARD = 30;
/** §二.3 同一个词开头的句子占比上限 */
const HEAD_MAX_PCT = 8;
/** §四.3 出声角色上限，不含说书人 */
const VOICE_MAX = 3;
/** §一.2 各幕占全篇的比例 */
const ACT_PCT: Record<string, [number, number]> = {
  冷开场: [4, 6],
  引入: [6, 8],
  '幕X · ': [12, 16],
  收束: [10, 12],
};
/** §一.2 幕间字数极差比上限 */
const ACT_SPREAD = 1.25;
/** §三.1 高危字表 */
const RISKY_CHARS = [...'活干数缝空血还得着了重长朝为相好发分中转'];
/** 虚词：留在 §三.1 的清单里，但不进 §三.4 的词形统计（见那一段的注释） */
const PARTICLES = [...'了着得还'];
/**
 * §三之二.2 **裸着站不住的单音节**。跟 §三.1 是两张表，目的不同：
 * §三.1 查「会不会读错音」，这张查「裸着抓不抓得住」。
 * 「行」不在 §三.1 里，却是裸奔的头号案例（háng/xíng，而且单音节没有重量）。
 */
const BARE_CHARS = [...'行家角色都只种少教差当处应尽活干数缝空血重长朝为相发分中转'];
/** §四.2 提示语雷同的窗口大小 */
const TAG_WINDOW = 6;
/**
 * §三之二.1 **踩过的词边界坑。踩一个记一个，不求全。**
 *
 * 判据是「把字重新分组，有没有第二种分法也说得通」——
 * 这件事没法穷举，机器只能记住踩过的。
 */
const SPLIT_TRAPS: { re: RegExp; why: string }[] = [
  { re: /千万[一二三四五六七八九十百千万零]*[颗个只条]/, why: '「千万」先被听成副词（千万别），要等到量词才翻案。换「几千几万」' },
  { re: /[颗个只条粒]心里/, why: '「心里头 / 心里」是高频固定词，「N 颗心 | 里头」会被切成「N 颗 | 心里头」' },
  { re: /[一二三四五六七八九十]行[，。]/, why: '「行」单着 háng/xíng 分不出。换成「行当」或用代词回指' },
  { re: /[的了]大方/, why: '「大方」dà fang（不小气）↔ dà fāng（大的方）。前面接的/了 的时候确认是哪个' },
  { re: /[了的]东西[，。]/, why: '「东西」dōng xi（物件）↔ dōng xī（方位）。确认上文足够定住它' },
];

/** 机器判不了的那几条。**印出来不是走过场** —— 它们比上面查得了的重要 */
const 必答清单 = `
──────────────────────────────────────────────────────────
机器查不了的（逐条问自己，答不上来就是没写好）
──────────────────────────────────────────────────────────

人味儿四条　zhiyu/治愈系稿件规范.md 第十一节
  1. 有没有一个**具体到不能替换**的人和事？越具体越普遍
  2. 听众**带走什么**？一句话说清，得是动作或新看法，不是名词
     （检验：念落点给没听过的人，他说「那我下次可以试试」才算过）
  3. 有没有**一处你自己也没想通**、并且说出来了？
  4. 有没有**一句只可能出自这个人**？

平读测试　出片手册 §二　**逐句过，这条没有兜底**
  把句子用完全平直、无重音的语调念一遍。意思还在 → 过；散了 → 改。
  · 对比不许靠重音，要写进结构（用「不是…是…」、用重复词、用独立成句）
  · 一句只放一个重点，两个重点拆成两句
  · 要强调的词放句尾
  ⚠ Edge TTS 拒绝一切 SSML 标签，**写坏了没有后期能救，只能回来改字**

说破层五条　说破层规范.md
  · 说破句只有讲完这个故事才说得出来（印在日历上也成立的，删）
  · 是预言／观察，不是建议（讲「会怎样」，不讲「该怎样」）
  · 诊断词后面跟着「不是 A，是 B」的重定义
  · 现代对照从行为链推出来，且能回指故事里一个具体动作
  · 冷开场是说破句的伪装版，首尾扣得上

收束不许超发
  收束每一句话，都要能在前面指出具体是哪一幕演过。正文没演的，收束不许提。
`;

function main() {
  const src = process.argv[2];
  if (!src || src.startsWith('-')) {
    console.log('用法：npm run shuoshu:lint -- <稿件.md>');
    console.log('这一道在**解析之前**跑，不建目录、不写文件。');
    process.exit(1);
  }
  const md = readFileSync(src, 'utf8');
  const title = /^#\s+(.*)$/m.exec(md)?.[1] ?? src;

  let issues: Issue[];
  try {
    issues = lintScript(md);
  } catch (e) {
    // parse() 抛的（缺选角行 / 音色名不存在 / 没有 --- ）——这些是硬错
    console.log(`《${title}》稿件闸\n`);
    console.error(`  ✗ ${(e as Error).message}`);
    process.exit(1);
  }

  const errors = issues.filter((i) => i.level === 'error');
  console.log(`《${title}》稿件闸\n`);
  if (!issues.length) console.log('  ✓ 机器能查的都过了');
  else for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);

  console.log(必答清单);

  if (errors.length) {
    console.error(`✗ ${errors.length} 个错。**先改稿，别往下跑解析** ——\n` + '  解析和标注之后再补稿，段号会全移位，标注和 scenes.json 都要重来一遍。');
    process.exit(1);
  }
  console.log(`✓ ${issues.length} 个提醒，没有硬错。下一步：npm run shuoshu:parse -- ${src}`);
}

if (process.argv[1]?.includes('shuoshu-lint')) main();

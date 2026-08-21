// ── 老马线稿件体检 ────────────────────────────────────────────────────
//
// 用法：npx tsx src/laoma-check.ts jokes/laoma-001.json
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

import { readFileSync, existsSync } from 'node:fs';
import { lineText, type JokeCfg, type LineCfg } from './types.js';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

/** §一之九：落点最好不超过十五字。长句铺垫、短句落点，节奏落差本身就是笑点 */
const PUNCH_MAX = 15;

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

const cn = (s: string) => [...s.replace(/\s/g, '')].length;

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

  const roles = cfg.lines.map((_, i) => role(cfg.lines, i));
  const punchIdx = roles.lastIndexOf('punch');
  const punch = punchIdx >= 0 ? cfg.lines[punchIdx] : null;

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
  if (pn > PUNCH_MAX * 2)
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
  if (setups < 2 || setups > 4)
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

  // ── §四：全片时长 ──
  const spoken = cfg.lines.reduce((s, l) => s + (l.dur ?? 0), 0);
  if (spoken > 0) {
    // ⚠ 缺省不是 0 —— `beats/typeA.ts` 给的是 padBefore 0.15 / padAfter 0.2，
    // **落点句前后是 0.4 / 0.35**。按 0 算的话，一条不写停顿的稿子每句少算最多 0.35 秒，
    // 六句就是两秒 —— 真有 38 秒的片子能从这道 35 秒的硬闸底下溜过去。
    const pad = cfg.lines.reduce(
      (s, l) =>
        s +
        (l.padBefore ?? (l.beat === 'punch' ? 0.4 : 0.15)) +
        (l.padAfter ?? (l.beat === 'punch' ? 0.35 : 0.2)),
      0
    );
    const total = (cfg.intro ?? 2) + spoken + pad + (cfg.freeze ?? 2) + (cfg.hold ?? 4);
    if (total > 35) err(`全片 ${total.toFixed(1)}s，超过 35。§四：超了砍字，**不要加速** —— 加速会毁掉所有停顿设计`);
    else warn(`全片 ${total.toFixed(1)}s（区间 25–32）`);
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
    let cur = cfg.intro ?? 2;
    let last = cur;
    let worst = 0;
    cfg.lines.forEach((l, i) => {
      const a = cur + (l.padBefore ?? 0.1);
      const b = a + durOf(l);
      // 停顿够长（≥0.35）能塞眨眼；say 的换气也算
      if (a - last > 0) {
        if (a - last >= 0.35) last = a;
        else worst = Math.max(worst, a - last);
      }
      if ((l.say?.length ?? 0) > 1) last = a + durOf(l) * 0.5;
      const gap = (l.padAfter ?? 0.2) + (cfg.lines[i + 1]?.padBefore ?? 0.1);
      if (gap >= 0.35) last = b;
      else worst = Math.max(worst, b - last);
      cur = b + (l.padAfter ?? 0.2);
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
    const room = (l.padAfter ?? 0.2) + (next?.padBefore ?? (next?.beat === 'punch' ? 0.4 : 0.15));
    if (room < d + 0.15)
      err(`闭目 ${d}s，但这一句说完只有 ${room.toFixed(2)}s 的停顿 —— 会咬进下一句的开头。加 padAfter`);
  }

  // 张嘴无声：跟闭目一样，停顿撑不住就会咬进下一句
  cfg.lines.forEach((l, i) => {
    if (!l.openMouth) return;
    if (l.beat === 'punch') err('落点句后面张嘴无声。落点说完就该完 —— 再补一个动作等于自己给包袱加注解');
    const room = (l.padAfter ?? 0.2) + (cfg.lines[i + 1]?.padBefore ?? 0.1);
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
    for (const n of screens(l))
      if (n > 12)
        err(
          `${r === 'punch' ? '落点' : '转折'}句有一屏 ${n} 字（上限 12）—— ` +
            `观众读完还得等他念完，**笑点在被听到之前就消费掉了**。拆 say`
        );
  });

  const turns = cfg.lines.filter((l) => roles[cfg.lines.indexOf(l)] === 'turn').length;
  if (turns === 0) warn('没有转折句（beat: reply/ask）。§四 的四段结构里，转折是落点的助跑');

  // ── 收尾卡：日子牌的字样 ──
  //
  // **只校验字样，不校验数字对不对** —— 数字要读分配表
  // （horse/CHANNEL_LAOMA.md §五之二），而且家庭类的条目占号但不出卡。
  //
  // 校验字样是因为它错得看不出来：「老马第1847天」「老马的第 1847 天。」
  // 单独看一条都通顺，四条片子排在一起才露馅，而那时候片子已经发出去了。
  if (cfg.hook !== undefined && !/^老马的第 \d+ 天$/.test(cfg.hook))
    err(
      `收尾卡「${cfg.hook}」不是日子牌的字样。写成 \`老马的第 1847 天\`：` +
        `数字前后各一个空格、结尾不加标点。数字照 horse/CHANNEL_LAOMA.md §五之二 的分配表，一稿一天往下加`
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
  const p = process.argv[2];
  if (!p || !existsSync(p)) {
    console.log('用法：npx tsx src/laoma-check.ts jokes/laoma-001.json');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as JokeCfg;
  console.log(`《${cfg.cover?.title ?? cfg.id}》稿件体检\n`);
  process.exit(gate(cfg) ? 0 : 1);
}

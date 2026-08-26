// ── 稿件体检：把《治愈系稿件规范》里机器能查的那部分查掉 ──────────────
//
// 用法：npx tsx src/zhiyu-check.ts --ep makura
//       npx tsx src/zhiyu-check.ts --ep makura --text 样章-幕一.md   只查一份
//
// 规范在 `zhiyu/治愈系稿件规范.md`。**这里只查得了一半** ——
// 调子飘没飘、腻不腻、共鸣接不接得上，只有人听得出来。
// 所以「样章 → 试听 → 确认调性」那一步不能因为体检过了就省掉。
//
// 分两级：
//   ✗ **错**   —— 违反文本闸的硬条（叹号、问句、编辑记号）。这些没有例外
//   ⚠ **留意** —— 数值出了实测区间（段长、⏸ 密度）。**可能是对的**，
//                  但要知道自己在偏离，别是手滑

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolveEp, DEF } from './zhiyu-ep.js';
import { stripMarks, suspectMarks } from './zhiyu-audio.js';
import { checkDiction, 读用语豁免, 必答清单 } from './zhiyu-diction.js';

const { dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));
const argv = process.argv.slice(2);
const only = argv.indexOf('--text') >= 0 ? argv[argv.indexOf('--text') + 1] : null;

/**
 * 问号的豁免：`发布.json` 顶层写 `"免问号": "理由"`。
 *
 * **只放行问号这一条，闸没有整个关掉。** 叹号、编辑记号照旧硬拦。
 *
 * 为什么留这个口子：文本闸拦问号，是因为这条线的稿子一直是「念一本书」——
 * 问句一进来，念的人就从「读」变成了「问你」，深夜档的调子当场散掉。
 * 但 2026-08-26 那一期（《别人怎么看你，不归你管》）是原创随笔，
 * **开场那两句问句是稿子的骨头**，改成陈述句等于换一篇稿。
 *
 * **豁免要写在数据里、一期写一次** —— 不是把规则改松，是让例外看得见。
 * 那几处问号照样打印出来（降成 ⚠），谁扫一眼都知道这期开了口子。
 * 已出片的老期没有这个字段，闸对它们还是硬的。
 */
function 读豁免(): string | null {
  const f = `${PROJ}/发布.json`;
  if (!existsSync(f)) return null;
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as { 免问号?: string }).免问号 ?? null;
  } catch {
    return null;
  }
}
const Q_EXEMPT = 读豁免();

/**
 * 实测含停顿均速。**唯一出处是 zhiyu-lines.ts** ——
 * 心理线那份体检里也有同一个概念，散成两个常量迟早分叉。
 */
const CPM = DEF.cpm;
/** 规范第三节的实测区间 */
const LIMITS = {
  // 区间的下限上限都要**把通过了的稿子包进去** —— 第一版定 18–25 / 28–35，
  // 结果《方丈记》四幕报了四处警。通过了的稿子报警，说明是区间错了不是稿子错了。
  avgLine: [16, 26] as const,
  maxLine: 48,
  beatSec: [26, 36] as const,
};

interface Block { text: string; beat: boolean }

function parse(file: string): Block[] {
  const raw = readFileSync(file, 'utf8');
  const body = raw.split(/^---$/m).slice(1).join('---');
  return body
    .split(/\n\s*\n/)
    .map((p) =>
      p.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>')).join('')
    )
    .filter(Boolean)
    .map((t) => (t === '⏸' ? { text: '', beat: true } : { text: stripMarks(t), beat: false }))
    .filter((b) => b.beat || b.text);
}

const cn = (s: string) => [...s.replace(/\s/g, '')].length;
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;

function checkOne(file: string, name: string) {
  const blocks = parse(file);
  const says = blocks.filter((b) => !b.beat);
  const beats = blocks.length - says.length;
  const chars = says.reduce((s, b) => s + cn(b.text), 0);
  const sec = (chars / CPM) * 60;

  const err: string[] = [];
  const warn: string[] = [];

  // ── 硬条：文本闸 ──
  const bang = says.filter((b) => /[！!]/.test(b.text));
  if (bang.length) err.push(`${bang.length} 处感叹号：${bang[0].text.slice(0, 20)}`);
  const q = says.filter((b) => /[？?]/.test(b.text));
  if (q.length)
    (Q_EXEMPT ? warn : err).push(
      Q_EXEMPT
        ? `${q.length} 处问号 —— 本期已豁免（${Q_EXEMPT}）：${q[0].text.slice(0, 20)}`
        : `${q.length} 处问号（问句改陈述）：${q[0].text.slice(0, 20)}`
    );
  // ── 用语规范（全系通用）──
  //
  // 规范正文：`zhiyu/治愈频道_用语规范.md`，机器部分在 `zhiyu-diction.ts`。
  // ⚠ **三条线共用那一份**，不各写各的 —— 各写各的迟早分叉，
  // 而分叉之后「哪份是真的」只能靠读代码。
  for (const d of checkDiction(says.map((b) => ({ text: b.text, section: name })), 读用语豁免(PROJ)))
    (d.level === 'error' ? err : warn).push(`[${d.rule}] ${d.msg}`);

  const marks = suspectMarks(says.map((b) => b.text));
  if (marks.length) err.push(`${marks.length} 处可疑编辑记号（会被念出来）：${marks[0].slice(0, 20)}`);

  // ── 数值：出区间只提醒 ──
  const avg = chars / (says.length || 1);
  if (avg < LIMITS.avgLine[0] - 0.5 || avg > LIMITS.avgLine[1] + 0.5)
    warn.push(`平均段长 ${avg.toFixed(0)} 字，实测区间是 ${LIMITS.avgLine.join('–')}`);
  const longest = Math.max(...says.map((b) => cn(b.text)), 0);
  if (longest > LIMITS.maxLine)
    warn.push(`最长段 ${longest} 字，超过 ${LIMITS.maxLine}（一口气念不下来）`);

  if (!beats) {
    warn.push('一个 ⏸ 都没有');
  } else {
    const perChar = chars / beats;
    const perSec = sec / beats;
    if (perSec < LIMITS.beatSec[0] - 0.5 || perSec > LIMITS.beatSec[1] + 0.5)
      warn.push(
        `⏸ 密度 每 ${perChar.toFixed(0)} 字 / ${perSec.toFixed(0)} 秒一个，` +
          `实测区间是 ${LIMITS.beatSec.join('–')} 秒`
      );
    // ⏸ 前一句要收得住：以句号收尾才算
    const halfway = blocks
      .map((b, i) => (b.beat && i > 0 && !/[。」』）)]$/.test(blocks[i - 1].text) ? blocks[i - 1].text : null))
      .filter(Boolean) as string[];
    if (halfway.length)
      warn.push(`${halfway.length} 处 ⏸ 前一句没收住：${halfway[0].slice(-16)}`);
  }

  // ── 人味儿：机器只拦得住最粗的两种 AI 味（规范第十一节）──────────────
  //
  // **这两条查不出「没有中心思想」**，那只能人判断。它们拦的是两个
  // 有固定长相的坏味道，而这两个恰好是照着规范写、不照着真事写时必然出现的。

  // ① 占位式表述。「一件需要对方点头的事」——细节密度很高，可每个都能替换。
  //    《已读不回》通篇是这个：时间精确到分钟，内容一件具体的都没有。
  const VAGUE = /(某个?[人事物件天]|一[件个][^。，]{0,10}的[事人东]|有些人|很多人|大家都|人们|这种事情|那样的东西|一些东西)/;
  const vague = says.filter((b) => VAGUE.test(b.text));
  if (vague.length >= 3)
    warn.push(
      `${vague.length} 处占位式表述（「${vague[0].text.match(VAGUE)![0]}」这类）。
` +
        `      抽象是为了「普遍适用」，可听众记住的从来是具体的那一个 ——
` +
        `      **越具体越普遍**，见规范第十一节判据①`
    );

  // ② 落点是个名词。结尾几段里出现「叫做/名字/被称为」而没有一个可带走的动作，
  //    多半就是「知道它有名字」型收尾 —— 那等于承认这一期没给出东西。
  const ending = says.slice(-8).map((b) => b.text).join('');
  if (/(叫做|叫作|有个名字|有名字|被称为|这个说法)/.test(ending))
    warn.push(
      `结尾几段落在「它叫什么」上。**知道名字不改变任何事** ——
` +
        `      听众能带走的应该是一个动作或一个新看法，不是一个术语。见规范第十一节判据②`
    );
  const tag = err.length ? '✗' : warn.length ? '⚠' : '✓';
  console.log(
    `${tag} ${name.padEnd(18)} ${String(chars).padStart(5)} 字  ${mmss(sec).padStart(6)}  ` +
      `${says.length} 段 / ⏸ ${beats}`
  );
  for (const e of err) console.log(`    ✗ ${e}`);
  for (const w of warn) console.log(`    ⚠ ${w}`);
  return { chars, sec, err: err.length, warn: warn.length, name };
}

export function gate(): void {
  // **不能用默认 sort** —— 中文按码位排会把「幕三」排在「幕二」前面，
  // 上下期就配成了「幕一+幕三」，而且不报错，只是数字悄悄错了。按汉字数序排。
  const ORDER = ['一', '二', '三', '四', '五', '六', '七', '八'];
  const actNo = (f: string) => ORDER.indexOf(f.replace(/^幕/, '').slice(0, 1));
  const files = only
    ? [only]
    : readdirSync(PROJ)
        .filter((f) => /^幕.*\.md$/.test(f) && f !== '幕表.md')
        .sort((a, b) => actNo(a) - actNo(b));
  if (!files.length) {
    console.log(`《${BOOK}》还没有幕稿（${PROJ}/幕*.md）。样章阶段用 --text 样章-幕一.md`);
    return;
  }

  console.log(`《${BOOK}》　按 ${CPM} 字/分 算　规范见 zhiyu/治愈系稿件规范.md`);
  // 开了口子就说出来，别让它藏在一行 ⚠ 里
  if (Q_EXEMPT) console.log(`⚠ 本期免问号：${Q_EXEMPT}　（叹号、编辑记号照旧硬拦）`);
  console.log('');
  const rows = files.map((f) => {
    const p = `${PROJ}/${f}`;
    if (!existsSync(p)) throw new Error(`没有 ${p}`);
    return checkOne(p, f.replace(/\.md$/, ''));
  });

  const chars = rows.reduce((s, r) => s + r.chars, 0);
  const sec = rows.reduce((s, r) => s + r.sec, 0);
  console.log(`\n合计 ${chars} 字 / ${mmss(sec)}`);
  if (rows.length === 4) {
    const up = rows[0].sec + rows[1].sec;
    const down = rows[2].sec + rows[3].sec;
    console.log(`  上期（前两幕）${mmss(up)}　下期（后两幕）${mmss(down)}　目标 20 分钟上下`);
    for (const [n, s] of [['上期', up], ['下期', down]] as const)
      if (s < 17 * 60 || s > 24 * 60) console.log(`  ⚠ ${n} ${mmss(s)} 偏离 20 分钟较多`);
  }

  // ── 跨幕重复：整句一模一样的，要么是有意回扣，要么是复制粘贴忘了改 ──
  if (rows.length > 1 && !only) {
    const seen = new Map<string, string[]>();
    for (const f of files)
      for (const b of parse(`${PROJ}/${f}`).filter((x) => !x.beat && cn(x.text) >= 8))
        seen.set(b.text, [...(seen.get(b.text) ?? []), f.replace(/\.md$/, '')]);
    const dup = [...seen].filter(([, fs]) => new Set(fs).size > 1);
    if (dup.length) {
      console.log(`\n跨幕重复 ${dup.length} 句（**回扣是有意的，复制粘贴不是** —— 自己认一下）：`);
      for (const [t, fs] of dup.slice(0, 6)) console.log(`  ${[...new Set(fs)].join(' / ')}　${t.slice(0, 28)}`);
    }
  }

  const e = rows.reduce((s, r) => s + r.err, 0);
  const w = rows.reduce((s, r) => s + r.warn, 0);
  console.log(
    `\n${e ? `✗ ${e} 处违反文本闸，必须改` : '✓ 文本闸全过'}` +
      `${w ? `　⚠ ${w} 处数值出区间，自己判断是不是有意的` : ''}`
  );
  console.log(必答清单);
  console.log(`\n**机器只查得了一半。** 调子飘没飘、腻不腻、共鸣接不接得上，只能人听 ——`);
  console.log(`所以「样章 → 试听 → 确认调性」那一步不能因为体检过了就省。`);
  if (e) {
    console.error(
      `
体检没过：${e} 处违反文本闸。**不往下跑了。**
` +
        `带着这些错出片，成品是废的 —— 感叹号和问号会直接改掉这条线的调子。`
    );
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('zhiyu-check.ts')) gate();

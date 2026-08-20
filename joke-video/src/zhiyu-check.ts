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
import { resolveEp } from './zhiyu-ep.js';
import { stripMarks, suspectMarks } from './zhiyu-audio.js';

const { dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));
const argv = process.argv.slice(2);
const only = argv.indexOf('--text') >= 0 ? argv[argv.indexOf('--text') + 1] : null;

/** 规范第七节：整幕实测，不是样章外推 */
const CPM = 226;
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
  if (q.length) err.push(`${q.length} 处问号（问句改陈述）：${q[0].text.slice(0, 20)}`);
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

  const tag = err.length ? '✗' : warn.length ? '⚠' : '✓';
  console.log(
    `${tag} ${name.padEnd(18)} ${String(chars).padStart(5)} 字  ${mmss(sec).padStart(6)}  ` +
      `${says.length} 段 / ⏸ ${beats}`
  );
  for (const e of err) console.log(`    ✗ ${e}`);
  for (const w of warn) console.log(`    ⚠ ${w}`);
  return { chars, sec, err: err.length, warn: warn.length, name };
}

function main() {
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

  console.log(`《${BOOK}》　按 ${CPM} 字/分 算　规范见 zhiyu/治愈系稿件规范.md\n`);
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
  console.log(`\n**机器只查得了一半。** 调子飘没飘、腻不腻、共鸣接不接得上，只能人听 ——`);
  console.log(`所以「样章 → 试听 → 确认调性」那一步不能因为体检过了就省。`);
  if (e) process.exitCode = 1;
}

main();

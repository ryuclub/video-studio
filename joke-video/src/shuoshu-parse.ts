// ── 稿件解析：markdown 散文 → 结构化的逐段脚本 ──────────────────────
//
// 用法：npx tsx src/shuoshu-parse.ts ../shuoshu/liaozhai-E01-huapi.md
//
// 说书稿是散文，机器不知道每段该用谁的声音、该怎么演。这里做**能自动的部分**，
// 把**必须人判断的部分**明确标出来，而不是猜一个值蒙混过去。
//
// 能自动：
//   · 按 ## 切幕
//   · 按空行切段
//   · 「某某说：」直接点名的对白 → 认出说话人
//   · 文言直引（「」包起来的）→ 标 引文 节拍
//   · 一幕最后一段 → 标 收
//
// 必须人判断（输出里标成 ? 或 TODO）：
//   · 「他说」「她说」「它说」—— 机器分不清是谁，得看上下文
//   · 每段该给什么节拍 —— 这是编辑活，也是 B 版比 A 版好的全部原因
//
// **不做静默猜测。** 猜错一个说话人，成片里就是另一个角色在说话，
// 而且要听 15 分钟才能发现。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { BEAT_NAMES } from './shuoshu-beat.js';
import { resolveCast } from './cast.js';
import { epFromScript } from './shuoshu-ep.js';

export interface ShuoshuLine {
  /** 全局序号，从 1 开始 */
  no: number;
  /** 属于哪一幕 */
  act: string;
  /** 送进 TTS 的文本（标点保留，停顿靠它） */
  text: string;
  /** 谁在说。'说书人' 是旁白 */
  who: string;
  /** 节拍标签，见 shuoshu-beat.ts */
  beat: string;
  /** 说话人是机器猜的、需要人确认 */
  needsReview?: boolean;
  /** 为什么需要确认 */
  reviewNote?: string;
}

/**
 * 「某某说：」里的称呼 → 音色。只认**明确点名**的，代词一律不猜。
 *
 * **这张表跟着稿件走，不写死在代码里。**每期的人名都不一样，写死意味着
 * 每期改一次源码；更糟的是忘了改也不报错——E02 的对白会全部退化成
 * 「需要人工判断」，而那正是整条管线唯一的瓶颈。
 *
 * 稿件头部这么写（`---` 之前）：
 *
 *     - 选角：王生=书生 · 陈氏=妇人 · 道士=老道 · 姑娘=艳鬼 · 蒲松龄=说书人
 *
 * 一个角色有几个称呼就写几条（姑娘/女子 都指同一个人）。
 * 音色名必须是选角表里有的，写错在这里就炸，不会等到合成。
 */
function parseCastMap(header: string): Record<string, string> {
  const line = /^[-*]\s*选角[：:]\s*(.+)$/m.exec(header)?.[1];
  if (!line) {
    throw new Error(
      '稿件头部缺「- 选角：」那一行。\n' +
        '格式：- 选角：王生=书生 · 陈氏=妇人 · 道士=老道\n' +
        '（左边是稿子里的称呼，右边是 cast.ts 里的音色名。有几个称呼写几条）'
    );
  }
  const out: Record<string, string> = {};
  for (const pair of line.split(/[·•、,，]/)) {
    const m = /^\s*([^=＝\s]+)\s*[=＝]\s*([^\s]+)\s*$/.exec(pair);
    if (!m) throw new Error(`选角这一条看不懂：「${pair.trim()}」\n应该是「称呼=音色名」`);
    resolveCast(m[2]); // 音色名写错立刻炸，别等合成到一半
    out[m[1]] = m[2];
  }
  return out;
}

/** 代词开头的对白：机器分不清指谁 */
const PRONOUN = /^(他|她|它)(对自己)?[说问道][：:]/;

export function parse(md: string): { title: string; lines: ShuoshuLine[] } {
  const title = /^#\s+(.*)$/m.exec(md)?.[1] ?? '未命名';
  // 头部的元信息块（原文出处/字数/选角）不进正文，但选角那一行要读出来
  const cut = md.indexOf('\n---\n');
  if (cut < 0) throw new Error('稿件里找不到分隔头部和正文的 --- 那一行');
  const NAMED = parseCastMap(md.slice(0, cut));
  const body = md.slice(cut + 5);

  const lines: ShuoshuLine[] = [];
  let act = '（无幕标题）';
  let no = 0;

  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const b of blocks) {
    const h = /^##\s*〔?(.+?)〕?$/.exec(b);
    if (h) {
      act = h[1].trim();
      continue;
    }
    if (b.startsWith('#') || b === '---') continue;

    no++;
    const line: ShuoshuLine = { no, act, text: b, who: '说书人', beat: '常规' };

    // ① 明确点名的对白
    const named = /^(?:.{0,8}?[。，])?([一-龥]{1,3})[说问道][：:]\s*(.+)$/s.exec(b);
    if (named && NAMED[named[1]]) {
      line.who = NAMED[named[1]];
      line.text = named[2].trim();
    } else if (PRONOUN.test(b)) {
      // ② 代词 —— 不猜
      line.needsReview = true;
      line.reviewNote = '代词开头，机器分不清是谁在说';
    } else if (/[说问道][：:]/.test(b)) {
      // ③ 有对白特征但没匹配上（「姑娘摇头。她说：」这类嵌套）
      line.needsReview = true;
      line.reviewNote = '有对白特征但没解析出说话人';
    }

    // ④ 文言直引
    if (/^「.+」$/.test(b)) line.beat = '引文';

    lines.push(line);
  }

  // ⑤ 每一幕的最后一段标「收」
  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1 || lines[i + 1].act !== lines[i].act) {
      if (lines[i].beat === '常规' && lines[i].who === '说书人') lines[i].beat = '收';
    }
  }

  return { title, lines };
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.log('用法：npx tsx src/shuoshu-parse.ts <稿件.md>');
    return;
  }
  const { title, lines } = parse(readFileSync(src, 'utf8'));
  const id = basename(src).replace(/\.md$/, '');
  // 期号从稿件文件名推（liaozhai-E02-nie.md → E02），对应目录没有就建一个
  const { dir } = epFromScript(src);
  mkdirSync(dir, { recursive: true });

  // ── 不覆盖手工标注 ────────────────────────────────────────────────
  //
  // script.json 一旦标注过就**不再是解析产物，是人的活儿**：165 段的说话人
  // （其中 18 段代词对白是逐条判断的）和节拍全在里面。这里再写一遍就全没了，
  // 而且要重标一遍才会发现。
  //
  // 所以认出标注过的文件就**改道**写到 script.parsed.json，让人自己去 diff。
  // 判据：annotated 字段，或者任何一段带了 parts（分声部只可能是手工标的）。
  const dst = `${dir}/script.json`;
  const annotated = (() => {
    if (!existsSync(dst)) return false;
    try {
      const prev = JSON.parse(readFileSync(dst, 'utf8'));
      return Boolean(prev.annotated) || (prev.lines ?? []).some((l: { parts?: unknown }) => l.parts);
    } catch {
      return false; // 读不动就当没标过
    }
  })();

  const out = annotated ? `${dir}/script.parsed.json` : dst;
  writeFileSync(out, JSON.stringify({ id, title, lines }, null, 2) + '\n');

  const byAct = new Map<string, number>();
  for (const l of lines) byAct.set(l.act, (byAct.get(l.act) ?? 0) + 1);
  const byWho = new Map<string, number>();
  for (const l of lines) byWho.set(l.who, (byWho.get(l.who) ?? 0) + 1);
  const review = lines.filter((l) => l.needsReview);

  console.log(`《${title}》　${lines.length} 段\n`);
  console.log('分幕：');
  for (const [a, n] of byAct) console.log(`  ${a.padEnd(12)}${String(n).padStart(4)} 段`);
  console.log('\n说话人（自动识别）：');
  for (const [w, n] of byWho) console.log(`  ${w.padEnd(8)}${String(n).padStart(4)} 段`);

  console.log(`\n需要人工确认的 ${review.length} 段：`);
  for (const l of review) console.log(`  第${String(l.no).padStart(3)}段  ${l.reviewNote}　「${l.text.slice(0, 26)}…」`);

  if (annotated) {
    console.log(`\n⚠ ${dst} **已经标注过，没有覆盖它。**`);
    console.log(`  这一遍的解析结果落到 ${out}，自己 diff 一下要不要合。`);
    console.log('  （标注是人的活儿：说话人 + 节拍。覆盖掉要重标一遍才会发现）');
  } else {
    console.log(`\n→ ${out}`);
  }
  console.log(`节拍可选：${BEAT_NAMES.join(' / ')}`);
  console.log('\n下一步：确认上面这些段的说话人，再逐段标节拍（默认「常规」不用改）');
}

main();

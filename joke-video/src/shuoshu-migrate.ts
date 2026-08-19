// ── 标注迁移：稿件改版了，别把上一版的标注扔掉 ────────────────────────
//
// 用法：npx tsx src/shuoshu-migrate.ts --ep E01
//
// 场景：稿件改了一版（E01 从 165 段扩到 232 段），解析器把新稿写进
// `script.parsed.json`，但**旧的 `script.json` 里有一整轮人工标注**——
// 说话人（其中代词对白是逐条判断的）和节拍。全部重标一遍是几个小时。
//
// 这里做的事很笨但很有效：**按段落文本逐字匹配**，把旧标注搬到新稿上。
// 文本一模一样 = 同一段，标注照搬；文本变了 = 得人看，标 needsReview。
//
// 实测 E01 v1→v2：232 段里 103 段逐字相同，直接搬走 44%。
// 而且 TTS 缓存也是按台词做键的，**这 103 段连合成都不用重跑**。
//
// **不做模糊匹配。** 试过按相似度搬，但"相似"的两段往往是**改了语气或
// 拆了句子**的——那恰恰是节拍要重新判断的地方，搬过去等于埋一个不会报错的雷。
// 宁可标成待确认，让人看一眼。

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolveEp } from './shuoshu-ep.js';

interface Part {
  who: string;
  text: string;
  beat: string;
}
interface Line {
  no: number;
  act: string;
  text: string;
  who?: string;
  beat?: string;
  parts?: Part[];
  needsReview?: boolean;
  reviewNote?: string;
}

function main() {
  const { dir } = resolveEp(process.argv.slice(2));
  const oldPath = `${dir}/script.json`;
  const newPath = `${dir}/script.parsed.json`;
  if (!existsSync(newPath)) throw new Error(`没有 ${newPath}——先跑 shuoshu-parse.ts 解析新稿`);
  if (!existsSync(oldPath)) throw new Error(`没有 ${oldPath}——没有旧标注可搬，直接把 parsed 改名就行`);

  const oldDoc = JSON.parse(readFileSync(oldPath, 'utf8')) as { lines: Line[] };
  const newDoc = JSON.parse(readFileSync(newPath, 'utf8')) as { id: string; title: string; lines: Line[] };

  // 旧稿按文本索引。同文本重复出现的段落只认第一条（重复段落本来就该同样处理）
  const byText = new Map<string, Line>();
  for (const l of oldDoc.lines) if (!byText.has(l.text)) byText.set(l.text, l);

  let moved = 0;
  let review = 0;
  const fresh: Line[] = [];

  for (const l of newDoc.lines) {
    const hit = byText.get(l.text);
    if (hit) {
      // 搬 who/beat/parts，**不搬 no/act**（新稿的段号和分幕才是准的）
      if (hit.parts) {
        l.parts = hit.parts;
        delete l.who;
        delete l.beat;
      } else {
        l.who = hit.who;
        l.beat = hit.beat;
      }
      delete l.needsReview;
      delete l.reviewNote;
      moved++;
      continue;
    }
    // 幕尾的「收」是解析器自动打的，那个可以留着；其余新段落一律待确认
    if (l.needsReview) review++;
    fresh.push(l);
  }

  const outDoc = {
    id: newDoc.id,
    title: newDoc.title,
    migratedFrom: oldDoc.lines.length,
    lines: newDoc.lines,
  };
  copyFileSync(oldPath, `${dir}/script.v1.json`);
  writeFileSync(oldPath, JSON.stringify(outDoc, null, 2) + '\n');

  console.log(`旧稿 ${oldDoc.lines.length} 段 → 新稿 ${newDoc.lines.length} 段`);
  console.log(`  搬过来 ${moved} 段（逐字相同，TTS 缓存也命中）`);
  console.log(`  要人标 ${newDoc.lines.length - moved} 段，其中 ${review} 段是机器分不清说话人的对白`);
  console.log(`\n旧标注备份 → ${dir}/script.v1.json`);
  console.log(`合并结果   → ${oldPath}`);

  const byAct = new Map<string, { n: number; todo: number }>();
  for (const l of newDoc.lines) {
    const e = byAct.get(l.act) ?? { n: 0, todo: 0 };
    e.n++;
    if (fresh.includes(l)) e.todo++;
    byAct.set(l.act, e);
  }
  console.log('\n幕            段数  待标');
  for (const [a, v] of byAct) console.log(`  ${a.padEnd(12)}${String(v.n).padStart(4)}${String(v.todo).padStart(6)}`);
}

main();

// ── 稿件 json → 配音稿 .md（`long-parse` 的逆运算）─────────────────────
//
// 用法：
//   npx tsx tools/long-unparse.mts jokes/laoma-long-001.json horse/长片/稿件/laoma-long-001.md
//
// ── 为什么会需要一个逆运算 ──
//
// ⚠ **2026-08-26：001 的稿源没了。**
// `长片_出片方案.md` 抬头写着「稿件在素材包：`E:\ryu\laoma\长片001_定稿v3.md`（配音的源，以它为准）」，
// 而那个目录现在只剩一张 png。**那份 md 从来没进过 git。**
//
// 于是这条线同时处在两个危险里：
//
//   一、`long-parse` 是**覆盖写**。源没了还照着文档去跑一次 —— 001 当场清零。
//   二、文档说「稿子是源，json 是产物」，**可现在唯一的真相是那份产物。**
//
// 所以这个脚本干两件事：**把稿子从 json 里反出来，并且让稿源从此进仓库。**
//
// ── 判据：往返一致 ──
//
// 反出来的 md 再喂给 `long-parse`，除了 `dur`/`audio`（那两个是 `align` 回填的，
// 不从稿子来），**其余字段必须逐字节一致**。脚本自己会验，不一致就不写盘。
//
// 这跟改渲染器之后 `md5sum -c` 验样张是同一条纪律：
// **「搬完还一样吗」要能自动答，不能靠看。**

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.log('用法：npx tsx tools/long-unparse.mts <稿件.json> <输出.md>');
  process.exit(1);
}

interface Line {
  who: 'ma' | 'niu';
  _layer?: string;
  padAfter?: number;
  note?: string;
  shuopo?: boolean;
  say?: { text: string }[];
  text?: string;
}
interface Cfg {
  id: string;
  title?: string;
  lines: Line[];
  _sections?: Array<{ name: string; from: number; to: number }>;
}

/** 跟 `long-parse` 的 `DEFAULT_PAD` 是同一个数。不一致的话往返就对不上 */
const DEFAULT_PAD = 0.4;

const cfg = JSON.parse(readFileSync(src, 'utf8')) as Cfg;
const txt = (l: Line) => (l.say ?? []).map((s) => s.text).join('') || l.text || '';

/**
 * 谁在说 ＋ 哪一层 → 稿子里的标记。
 *
 * ⚠ **缺省值按人分，两个人反着来**（稿件规范 §八）：
 * 老马不写后缀 ＝ 旁白，**老牛不写后缀 ＝ 台词**。
 * 反着写的话，往返一趟老牛那 14 句就会全变成旁白 —— 正是那条注释记着的原始错误。
 */
function mark(l: Line): string {
  // 说破段有自己的标记，它在分层上是台词但要能被体检认出来
  if ((l as { shuopo?: boolean }).shuopo) return l.who === 'ma' ? '【马·破】' : '【牛·破】';
  const layer = l._layer ?? (l.who === 'niu' ? '台词' : '旁白');
  const who = l.who === 'ma' ? '马' : '牛';
  const isDefault = l.who === 'ma' ? layer === '旁白' : layer === '台词';
  if (isDefault) return `【${who}】`;
  // `long-parse` 认 `台` 和 `台词` 两种写法，反写统一用 v3 那个短的
  return `【${who}·${layer === '台词' ? '台' : layer}】`;
}

/**
 * `⏸` 后缀（**行内那一种**）。
 *
 * ⚠ **带说明的静场不能写成行内。** `long-parse` 的 `readPause` 对行内只取秒数，
 * **`note` 只从单独成行的引用块（`> ⏸**2.0 — 说明**`）来**，而且落到**上一句**头上。
 * 头一版把说明写成行内，往返回来两句的 `note` 全丢了 —— 而且不报错，
 * 因为秒数是对的，只是那句「为什么停这么久」没了。
 */
function pause(l: Line): string {
  const pa = l.padAfter ?? DEFAULT_PAD;
  if (l.note) return ''; // 交给下面那行独立的引用块
  return pa === DEFAULT_PAD ? '' : ` ⏸${pa}`;
}

/** 带说明的静场：单独成行的引用块，跟在那一句后面 */
function soloPause(l: Line): string | null {
  return l.note ? `> ⏸**${l.padAfter ?? DEFAULT_PAD} — ${l.note}**` : null;
}

const secOf = (i: number) => cfg._sections?.find((s) => i >= s.from && i <= s.to);

const out: string[] = [
  `# 长片 ${cfg.id.replace(/^laoma-long-/, '')}《${cfg.title ?? cfg.id}》· 定稿 v3（人情味版）`,
  '',
  `> ⚠ **这份是从 \`${src}\` 反出来的**（\`tools/long-unparse.mts\`，2026-08-26）。`,
  '> 原始稿源在素材包 `E:\\ryu\\laoma\\长片001_定稿v3.md`，**那个文件已经不在了，而且从来没进过 git**。',
  '> 所以从这一版起 **稿源进仓库**，`long-parse` 以这一份为源。',
  '>',
  '> 反出来的内容跟 json 往返一致（`dur`/`audio` 除外，那两个是 `align` 回填的）。',
  '> 稿子怎么标见 [`../长片_稿件规范.md`](../长片_稿件规范.md) §八。',
  '',
];

let lastSec = '';
cfg.lines.forEach((l, i) => {
  const sec = secOf(i);
  if (sec && sec.name !== lastSec) {
    lastSec = sec.name;
    out.push('', `## ${sec.name}`, '');
  }
  out.push(`${mark(l)}${txt(l)}${pause(l)}`);
  const solo = soloPause(l);
  if (solo) out.push('', solo);
});
out.push('');

const md = out.join('\n');

// ── 往返验证：反出来的 md 再 parse 一遍，跟原 json 比 ──
const probe = `${tmpdir()}/long-unparse-probe.json`;
const tmpMd = `${tmpdir()}/long-unparse-probe.md`;
writeFileSync(tmpMd, md, 'utf8');
const r = spawnSync('npx', ['tsx', 'tools/long-parse.mts', tmpMd, probe], {
  encoding: 'utf8',
  shell: true,
});
if (r.status !== 0) {
  console.error('往返失败：反出来的 md 解析不了\n' + (r.stderr ?? '').slice(-800));
  process.exit(1);
}

/** 只比从稿子来的那些字段。`dur`/`audio` 是 align 回填的，不该参与 */
const strip = (c: Cfg) => ({
  lines: c.lines.map((l) => {
    const { ...rest } = l as Record<string, unknown>;
    delete rest.dur;
    delete rest.audio;
    return rest;
  }),
  _sections: c._sections,
});

const before = JSON.stringify(strip(cfg));
const after = JSON.stringify(strip(JSON.parse(readFileSync(probe, 'utf8')) as Cfg));

if (before !== after) {
  console.error('⚠ **往返不一致，没写盘。**');
  const a = JSON.parse(before).lines as Record<string, unknown>[];
  const b = JSON.parse(after).lines as Record<string, unknown>[];
  if (a.length !== b.length) console.error(`  句数 ${a.length} → ${b.length}`);
  let shown = 0;
  for (let i = 0; i < Math.min(a.length, b.length) && shown < 5; i++) {
    const x = JSON.stringify(a[i]);
    const y = JSON.stringify(b[i]);
    if (x !== y) {
      console.error(`  第 ${i} 句不一致：\n    原 ${x}\n    反 ${y}`);
      shown++;
    }
  }
  process.exit(1);
}

mkdirSync(dirname(dst), { recursive: true });
if (existsSync(dst)) {
  const bak = `${dst}.${Date.now()}.bak`;
  writeFileSync(bak, readFileSync(dst));
  console.log(`  旧的备份成 ${bak}`);
}
writeFileSync(dst, md, 'utf8');
console.log(`${dst}`);
console.log(`  ${cfg.lines.length} 句 · ${cfg._sections?.length ?? 0} 章 · **往返一致**`);
console.log(`  从此稿源在仓库里，long-parse 以它为源：`);
console.log(`    npx tsx tools/long-parse.mts ${dst} ${src}`);

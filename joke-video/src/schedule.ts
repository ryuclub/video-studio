// ── 醒木不响 · 跨线档期表 ─────────────────────────────────────────────
//
// 用法：npm run schedule            往后四周排成什么样
//      npm run schedule -- --weeks 8
//
// ── 一条原则，从老马线搬过来 ──
//
// **目录树本身就是排期账本，不另建一张表。**（`horse/SCHEDULE.md` §〇）
// 表和目录两头记，迟早对不上。所以这个文件只定义**档期表**（下面那个 SLOTS），
// 谁排在哪一档**从期号目录名读**，不在任何地方另存一份。
//
// **别把可变状态编进不可变标识里**（同上）。目录名分两半：
//
//     2026-08-25_1800JST_婴宁-E05
//     └── 可变，负责排序 ──┘ └ 不变，负责身份 ┘
//
// 改期只动前缀，期号永不改动。成片、字幕按**后一半**命名（`婴宁-E05.mp4`），
// 所以挪档只是给目录改个名，不用重新出片、不用改发布文案里的文件名。
//
// ── 时刻写 JST ──
//
// 跟老马线同一条理由：排期锚的是 UTC+8，人在日本，墙上钟差一小时。
// **目录名一律记 JST**（实际操作时看的那个时间），免得某天照自己的表发早一小时。

import { readdirSync, existsSync, statSync } from 'node:fs';
import { OUT_SHUOSHU, OUT_ZHIYU, OUT_CHAN, OUT_XINLI } from './paths.js';

/** 一条内容线在频道上的档位 */
export interface LineSpec {
  /** 期号目录在哪 */
  root: string;
  /** 允许的发布日（0 = 周日） */
  weekdays: number[];
  /** 每个发布日的时刻（JST，四位） */
  times: Record<number, string>;
  /** 排不排。false = 手上有存货但暂时不占档 */
  scheduled: boolean;
  note?: string;
}

/**
 * **档期表。改排期只改这张表。**（2026-08-23 定）
 *
 * ```
 * 周二 18:00  说书
 * 周三 18:00  小故事大道理
 * 周四 18:00  说书
 * 周六 18:00  说书
 * 周日 18:00  治愈
 * ```
 *
 * 一周五更，**说书占三档**——所以瓶颈在写稿：一期 5000 汉字，一周要三期。
 * 出片手册 §十 那两条路（甲·囤稿定时跑 / 乙·每天叫模型）在这个频率下不再是选择题，
 * 得先囤够。
 *
 * ⚠ **老马线是另一个频道**（碎嘴老马），它的档在 `horse/SCHEDULE.md`：
 * 周二 / 周四 / 周日 **21:00 JST**。跟这儿的 18:00 同日不同时，不打架。
 */
export const LINES: Record<string, LineSpec> = {
  说书: {
    root: OUT_SHUOSHU,
    weekdays: [2, 4, 6],
    times: { 2: '1800', 4: '1800', 6: '1800' },
    scheduled: true,
  },
  小故事大道理: {
    root: OUT_CHAN,
    weekdays: [3],
    times: { 3: '1800' },
    scheduled: true,
    note: '禅佛典向。《百喻经》那套「故事 + 说破」',
  },
  治愈: {
    root: OUT_ZHIYU,
    weekdays: [0],
    times: { 0: '1800' },
    scheduled: true,
  },
  // ⚠ **心理洞察不进档期（2026-08-23 决定）。**
  //
  // 理由是**写不出好稿子**，不是产能不够 —— 所以加档、囤稿都解决不了它。
  // 已出的两期（《已读不回的四十分钟》《第三个人一开口》）留着，不撤。
  //
  // 顺带记一笔，免得下次再绕：**心理洞察和「小故事大道理」是两条线，不是一条。**
  // 小故事大道理是禅佛典向（`zhiyu/禅佛典向_小故事大道理_书目与稿件.md`，
  // 《百喻经》那套故事＋说破，已出《第七个饼》），心理洞察是
  // `zhiyu/心理洞察出片方案.md` 那条；连封面配色档都分开（心理 ink / 禅佛典 night）。
  // 周三那一档归禅佛典。
  心理洞察: {
    root: OUT_XINLI,
    weekdays: [],
    times: {},
    scheduled: false,
    note: '不进档期：稿子写不好。已出两期留着',
  },
};

const WD = ['日', '一', '二', '三', '四', '五', '六'];

export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 目录名的前一半：`2026-08-25_1800JST` */
export const slotTag = (d: Date, time: string) => `${ymd(d)}_${time}JST`;

/**
 * 目录名长这样才算排过期的：**日期 _ 时刻JST _ 类型 _ 稿件名-序号**
 *
 *     2026-08-25_1800JST_说书_婴宁-E05
 *     └─ 1 ─┘ └ 2 ┘    └3┘ └── 4 ──┘
 */
export const SLOT_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4})JST_([^_]+)_(.+)$/;

export interface DirName {
  date: string;
  time: string;
  /** 类型，也就是线名：说书 / 治愈 / 小故事大道理 */
  line: string;
  /** 稿件名-序号。**这一段是身份，永不改动** */
  slug: string;
}

/** 拆目录名。老格式（没有档期前缀）返回 null */
export function parseDir(dirName: string): DirName | null {
  const m = SLOT_RE.exec(dirName);
  return m ? { date: m[1], time: m[2], line: m[3], slug: m[4] } : null;
}

/**
 * 目录名里**不变的那一段**（身份），如 `婴宁-E05`。
 *
 * **类型不算在身份里**：它已经写在目录名上、也写在交付包名上了，
 * 再进成片文件名就成了 `说书_婴宁-E05.mp4` —— 一个说书目录里的片子标着"说书"，是废话。
 *
 * 老目录 `2026-08-18_liaozhai-E01` 没有档期前缀，去掉日期剩下的就是身份。
 */
export function slugOf(dirName: string): string {
  return parseDir(dirName)?.slug ?? dirName.replace(/^\d{4}-\d{2}-\d{2}_/, '');
}

const ls = (p: string): string[] =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(`${p}/${d}`).isDirectory()) : [];

export interface Booked {
  line: string;
  dir: string;
  slug: string;
  date: string;
  time: string;
}

/** 扫所有线的期号目录，把**已经排过期的**收上来。这就是那本账 */
export function booked(): Booked[] {
  const out: Booked[] = [];
  for (const [line, spec] of Object.entries(LINES))
    for (const d of ls(spec.root)) {
      const p = parseDir(d);
      if (!p) continue;
      // 目录名里的类型跟它所在的线对不上，多半是手改目录名改错了 —— 说出来，别默默按目录走
      if (p.line !== line) console.warn(`! ${spec.root}/${d} 的类型写着「${p.line}」，但它在「${line}」目录下`);
      out.push({ line, dir: d, slug: p.slug, date: p.date, time: p.time });
    }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/** 这一档被占了没有。一档只发一条 */
const taken = (date: string, time: string, all = booked()) =>
  all.find((b) => b.date === date && b.time === time);

/**
 * 这条线**下一个空档**是哪一天。
 *
 * @param from 从哪天起算（含当天）。默认今天
 *
 * 已经排出去的档不会被重复用 —— 判据只有目录名，没有第二本账。
 */
export function nextSlot(line: string, from = new Date()): { date: Date; tag: string; time: string } {
  const spec = LINES[line];
  if (!spec) throw new Error(`没有这条线：${line}\n可选：${Object.keys(LINES).join(' / ')}`);
  const all = booked();
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 400; i++) {
    const d = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + i);
    if (!spec.weekdays.includes(d.getDay())) continue;
    const time = spec.times[d.getDay()];
    if (taken(ymd(d), time, all)) continue;
    return { date: d, tag: slotTag(d, time), time };
  }
  throw new Error(`${line} 一年之内都排满了？该查查目录名是不是不对`);
}

// ── CLI ──────────────────────────────────────────────────────────────

function main() {
  const i = process.argv.indexOf('--weeks');
  const weeks = i >= 0 ? Number(process.argv[i + 1]) : 4;
  const all = booked();
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  console.log('醒木不响 · 档期表（改排期改 src/schedule.ts 的 LINES）\n');
  for (const [line, s] of Object.entries(LINES)) {
    const days = s.weekdays.map((w) => `周${WD[w]} ${s.times[w].replace(/(\d\d)(\d\d)/, '$1:$2')}`).join('　');
    console.log(`  ${line.padEnd(7)}${s.scheduled ? days : '（不单独占档）'}${s.note ? '　—— ' + s.note : ''}`);
  }
  console.log(`\n往后 ${weeks} 周：\n`);

  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const [line, s] of Object.entries(LINES)) {
      if (!s.scheduled || !s.weekdays.includes(d.getDay())) continue;
      const time = s.times[d.getDay()];
      const b = taken(ymd(d), time, all);
      const who = b ? `${b.slug}` : '—— 空';
      console.log(`  ${ymd(d)} 周${WD[d.getDay()]} ${time.replace(/(\d\d)(\d\d)/, '$1:$2')}  ${line.padEnd(7)}${who}`);
    }
  }

  const legacy = Object.entries(LINES)
    .filter(([, s]) => s.scheduled)
    .map(([line]) => {
      const n = ls(LINES[line].root).filter((d) => !SLOT_RE.test(d)).length;
      return `${line} ${n}`;
    });
  console.log(`\n还没排期的老目录（不动它们，已发布的保持原状）：${legacy.join('　')}`);
  console.log('每一档只发一条；谁占了哪一档，判据只有目录名 —— 没有第二本账。');
}

if (process.argv[1]?.includes('schedule') && !process.argv[1]?.includes('laoma')) main();

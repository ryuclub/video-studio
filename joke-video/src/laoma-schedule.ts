// ── 老马线的目录与排期校验 ──────────────────────────────────────────
//
// 用法：
//   npm run laoma:schedule            扫一遍排期树
//
// 规范见 `horse/SCHEDULE.md`。FAIL 退出码 1，只有 WARN 退出码 0。
//
// ── 它守的是哪句话 ──
//
// **别把可变状态编进不可变标识里。** 发布时间会变（频率手动控，必然会挪），
// 期号不会变。所以目录名把两样分开写：
//
//   2026-08-26_2200JST_段子-1851
//   └─ 可变，负责排序 ─┘ └ 不变，负责身份 ┘
//
// 改期只动前缀，期号永不改动。**目录树本身就是排期账本** ——
// 不另建一张表，因为表和目录两头记，迟早对不上。
//
// ⚠ **2026-08-23：看盘专辑停掉了**，这儿只剩段子一条。物件库留着。
//
// ── 期次目录里有什么 ──
//
// **成片就在期次目录里**（2026-08-23 搬的，此前它在 `projects/段子与儿童故事/`
// 底下用老命名）：
//
//   projects/老马/段子/_待发/2026-08-25_2100JST_段子-1851/
//       publish.json   排期与身份
//       out.mp4        成片
//       thumb.png      发布用竖版封面
//       方案.md        这一条为什么这么做
//       发布文案.md    复制源
//       index.html     单条预览页
//       stills/  cover/
//
// **稿件不在里面**，它在 `jokes/laoma-00N.json` —— 体检、TTS、渲染、预览
// 全按那个平目录跑。`publish.json` 的 `script` 字段指过去。
// **一份东西一个家**：复制一份稿件进来的话，改哪一份都对，那就是两份稿子了。

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_LAOMA } from './paths.js';
import type { JokeCfg } from './types.js';

/**
 * 排期树的根 = **老马的成品根**。这两样是同一棵树，不是两处。
 *
 * ⚠ 2026-08-23 从 `horse/排期`（只放 publish.json 的影子树）搬到了成品根 ——
 * 影子树意味着一条片子有两个家，而**目录树本身就是排期账本**这句话，
 * 只有在成片真的躺在那个目录里的时候才成立。
 */
const ROOT = `${OUT_LAOMA}/段子`;
/** 指针（`script`）按**仓库根**相对路径写 —— 这个脚本的 cwd 是 joke-video/ */
const REPO = '..';
/** 还没定发布日的期次：出了片但没排期，目录名用这个前缀占位 */
const UNSLOTTED = /^未排期_段子_(?:.+)_(\d+)$/;
/** 栏目：目录名中间那一截的头一段。不在这张表里就是写错了 */
const COLUMNS = ['工位', '一个人住', '众目睽睽', '回家'];

// **只有一个系列。** 2026-08-23 之前这儿并排放着「看盘」，那个专辑停掉了 ——
// 结构留成表驱动的，不是为了以后再开一个，是因为把 `段子` 硬编进正则和路径里
// 反而更难读（现在改排期档只改下面这张表）。
type Series = '段子';

interface SeriesSpec {
  /** 期号补零位数。0 = 不补（天数号本来就是四位） */
  idPad: number;
  /** 期号怎么走。天数号是跳号 2–4 */
  numbering: 'jump';
  /** 允许的发布日（0 = 周日） */
  weekdays: number[];
  /** 每个发布日的时刻（JST，四位） */
  times: Record<number, string>;
  /** 允许发的平台 */
  platforms: string[];
}

// ⚠ **目录名里那个时刻是 JST。**
// 人在日本，写进目录名的就是**实际操作时看的那个时间**，
// 免得某天照自己的表发早一小时。
//
// ⚠ **排期档 2026-08-23 改过一次**：原来是 周三 2200 / 周六 1900 / 周日 2200，
// 现在是**周二 / 周四 / 周日，都是 2100**。改排期只改这张表 ——
// 已经排好的目录要跟着改名（目录名前缀是可变的那一半）。
const SERIES: Record<Series, SeriesSpec> = {
  段子: {
    idPad: 0,
    numbering: 'jump',
    weekdays: [2, 4, 0],
    times: { 2: '2100', 4: '2100', 0: '2100' },
    platforms: ['youtube', 'douyin', 'channels'],
  },
};

/** 待发库存低于这个数就该补产了 */
const MIN_STOCK = 7;
/** 段子跳号的步长区间 */
const JUMP_MIN = 2;
const JUMP_MAX = 4;
/** 国内平台跟 YouTube 错开几天 */
const LAG_MIN = 3;
const LAG_MAX = 7;

// `<日期>_<时刻>JST_段子_<栏目>_<稿件内容>_<天数号>`
// 中间两截合起来当一组抓（`.+` 惰性到最后一个下划线），**身份是最后那个数**。
const NAME_RE = /^(\d{4}-\d{2}-\d{2})_(\d{4})(JST)_(段子)_(.+)_(\d+)$/;

const fails: string[] = [];
const warns: string[] = [];
const fail = (m: string) => fails.push(m);
const warn = (m: string) => warns.push(m);

const ls = (p: string): string[] =>
  existsSync(p) ? readdirSync(p).filter((n) => !n.startsWith('.') && statSync(join(p, n)).isDirectory()) : [];

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

export interface PublishCfg {
  series?: Series;
  id?: number;
  /** 稿件在哪（仓库根相对路径）。**成片不写在这儿，按稿件的 id 反查** */
  script?: string;
  /** 有意的大跳号（段子）。校验放行 */
  big_jump?: boolean;
  /**
   * 历史条目：+1 连号时代出的片子（laoma-001–009）。
   *
   * **成片已经把收尾卡烧进去了，回不去** —— 标了它，跳号步长那条提醒不再报。
   * 这不是给新稿子用的开关：新稿子步长不对就是不对。
   */
  legacy?: boolean;
  platforms?: Record<string, { at?: string }>;
}

interface Item {
  series: Series;
  bucket: '_待发' | '_已发';
  name: string;
  date: string;
  time: string;
  id: number;
  path: string;
  dt: Date;
}

/** `_已发` 里没记发布日的天数号。汇总报一行，见 collect() */
const unslottedDone: string[] = [];

function collect(series: Series): Item[] {
  const out: Item[] = [];
  for (const bucket of ['_待发', '_已发'] as const) {
    const dir = join(ROOT, bucket);
    for (const name of ls(dir)) {
      // 出了片还没定日子的：`未排期_段子-1857`。**它是个正常状态，不是错** ——
      // 出片在前、排期在后，中间这段时间它就长这样。
      //
      // ⚠ **`_已发` 里的未排期条目只汇总报一行。** 那是 001–004 那种
      // 「2026-08-23 之前发的，日期没记」的历史条目 —— 它们永远补不上日期了，
      // 一条一条报四行、天天报，**这条检查就会被当成背景噪音**。
      const u = UNSLOTTED.exec(name);
      if (u) {
        if (bucket === '_已发') unslottedDone.push(u[1]);
        else
          warn(
            `[${series}/_待发] 还没定发布日：${name}　` +
              `（定了就 \`mv\` 成 <日期>_2100JST_段子_<栏目>_<稿件内容>_${u[1]}，并把日期写进 publish.json）`
          );
        continue;
      }
      const m = NAME_RE.exec(name);
      if (!m) {
        fail(
          `[${series}/${bucket}] 目录名不合规：${name}　` +
            `（要 YYYY-MM-DD_HHMMJST_${series}_栏目_稿件内容_天数号，` +
              `例：2026-08-25_2100JST_段子_工位_对齐了三次_1851）`
        );
        continue;
      }
      const [, date, time, , sName, mid, idStr] = m;
      // `mid` = `<栏目>_<稿件内容>`。**稿件内容只给人看，校验不认它** —— 身份是天数号；
      // 栏目认一下，写错了目录就归不了类
      const col = mid.split('_')[0];
      if (!COLUMNS.includes(col))
        fail(`[${series}/${bucket}] 栏目「${col}」不在四栏目里（${COLUMNS.join(' / ')}）：${name}`);
      if (sName !== series) {
        fail(`[${bucket}] 目录在 ${series}/ 底下却标着 ${sName}：${name}`);
        continue;
      }
      const spec = SERIES[series];
      if (spec.idPad && idStr.length !== spec.idPad) fail(`[${series}] 期号要补零到 ${spec.idPad} 位：${name}`);
      out.push({
        series,
        bucket,
        name,
        date,
        time,
        id: Number(idStr),
        path: join(dir, name),
        dt: new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00+09:00`),
      });
    }
  }
  return out.sort((a, b) => a.dt.getTime() - b.dt.getTime() || a.id - b.id);
}

function checkDuplicates(items: Item[], series: Series): void {
  const seen = new Map<number, Item>();
  for (const it of items) {
    const dup = seen.get(it.id);
    if (dup) fail(`[${series}] 期号重复 ${it.id}：${dup.name} ／ ${it.name}`);
    else seen.set(it.id, it);
  }
}

function checkNumbering(items: Item[], series: Series): void {
  const spec = SERIES[series];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    const d = cur.id - prev.id;

    // 天数号是**工龄不是集数**，跳号暗示我们只看到他被抽出来的几天
    if (d <= 0) {
      fail(`[${series}] 天数号没递增：${prev.id} → ${cur.id}（${cur.name}）`);
      continue;
    }
    const pub = readJson<PublishCfg>(join(cur.path, 'publish.json'));
    if (pub?.big_jump || pub?.legacy) continue;
    if (d < JUMP_MIN || d > JUMP_MAX)
      warn(
        `[${series}] 跳号步长 ${d}，不在 ${JUMP_MIN}–${JUMP_MAX}：${prev.id} → ${cur.id}（${cur.name}）` +
          ` —— 有意的大跳在 publish.json 标 big_jump: true`
      );
  }
}

function checkSlot(it: Item): void {
  const spec = SERIES[it.series];
  const wd = it.dt.getDay();
  const zh = '日一二三四五六'[wd];
  if (!spec.weekdays.includes(wd)) {
    warn(`[${it.series}] 发布日不在排期表里（周${zh}）：${it.name}`);
    return;
  }
  const want = spec.times[wd];
  if (want && it.time !== want) warn(`[${it.series}] 周${zh}该是 ${want}JST，实际 ${it.time}JST：${it.name}`);
}

/**
 * 期次目录 → 稿件 → 成片，一路指过去，每一环都核。
 *
 * ⚠ **期号跟稿件的对应关系只有这儿记着。** 段子的目录叫 `段子-1851`，
 * 稿件叫 `laoma-005.json` —— 两个号是两回事（文件号按「先做哪条」落盘，
 * 天数号是工龄），中间那根线断了就没人能把它们对起来。
 */
function checkPointers(it: Item): void {
  const p = join(it.path, 'publish.json');
  if (!existsSync(p)) {
    fail(`[${it.series}/${it.bucket}] 缺 publish.json：${it.name}　（期次目录里只有它，缺了这个目录就没有意义）`);
    return;
  }
  const pub = readJson<PublishCfg>(p);
  if (!pub) {
    fail(`[${it.series}] publish.json 解析失败：${it.name}`);
    return;
  }
  if (pub.series && pub.series !== it.series)
    fail(`[${it.series}] publish.json 写着 series=${pub.series}，跟目录对不上：${it.name}`);
  if (pub.id != null && Number(pub.id) !== it.id)
    fail(`[${it.series}] publish.json 的 id=${pub.id} 跟目录期号 ${it.id} 对不上：${it.name}`);

  // ── YouTube 首发时间必须跟目录名一致 ──
  //
  // 目录名负责排序，json 负责操作。两个数**必须是同一个时刻** ——
  // 不一致的时候没人知道该信哪个，而这正是「改期只改了一半」的样子。
  const yt = pub.platforms?.youtube?.at;
  if (!yt) {
    warn(`[${it.series}] publish.json 缺 platforms.youtube.at：${it.name}`);
  } else {
    const ytDt = new Date(yt);
    if (Math.abs(ytDt.getTime() - it.dt.getTime()) > 60_000)
      fail(
        `[${it.series}] publish.json 的 YouTube 时间跟目录名对不上：${it.name}` +
          `（名 ${it.dt.toISOString()} ／ json ${ytDt.toISOString()}）`
      );
    for (const key of ['douyin', 'channels']) {
      const at = pub.platforms?.[key]?.at;
      if (!at) continue;
      if (!SERIES[it.series].platforms.includes(key)) {
        fail(`[${it.series}] 不该发到 ${key}：${it.name}`);
        continue;
      }
      const lag = Math.round((new Date(at).getTime() - ytDt.getTime()) / 86_400_000);
      if (lag < LAG_MIN || lag > LAG_MAX)
        warn(`[${it.series}] ${key} 跟 YouTube 隔 ${lag} 天，建议 ${LAG_MIN}–${LAG_MAX}：${it.name}`);
    }
  }

  // ── 稿件指针 ──
  if (!pub.script) {
    fail(`[${it.series}] publish.json 缺 script（稿件在哪，仓库根相对路径）：${it.name}`);
    return;
  }
  const sp = join(REPO, pub.script);
  if (!existsSync(sp)) {
    fail(`[${it.series}] script 指的稿件不存在：${pub.script}（${it.name}）`);
    return;
  }
  const cfg = readJson<JokeCfg>(sp);
  if (!cfg) {
    fail(`[${it.series}] 稿件解析失败：${pub.script}`);
    return;
  }

  // 期号 = 收尾卡上那个天数
  const no = Number(cfg.hook?.match(/第\s*(\d+)\s*天/)?.[1]);
  if (Number.isNaN(no))
    warn(`[${it.series}] 稿件 ${pub.script} 的收尾卡里读不出天数：${it.name}`);
  else if (no !== it.id) fail(`[${it.series}] 稿件的天数号是 ${no}，目录期号是 ${it.id}，两个对不上：${it.name}`);

  // ── 成片就在这个目录里 ──
  const film = join(it.path, 'out.mp4');
  if (!existsSync(film)) {
    if (it.bucket === '_已发') fail(`[${it.series}] 已发条目没有成片（${it.name}/out.mp4）`);
    else warn(`[${it.series}] 还没出片：${it.name}`);
  }
  if (it.bucket === '_已发' && !existsSync(join(it.path, 'thumb.png')))
    fail(`[${it.series}] 已发条目没有封面（${it.name}/thumb.png）`);
}

function checkBuckets(items: Item[], series: Series, today: Date): { pending: number; published: number } {
  const pending = items.filter((i) => i.bucket === '_待发');
  const overdue = pending.filter((i) => i.dt < today);
  for (const it of overdue) warn(`[${series}] 待发条目已经过期了，疑似漏发：${it.name}`);
  const future = pending.length - overdue.length;
  // **库存肉眼可见**：_待发/ 里几个目录就是还剩几期
  if (future < MIN_STOCK) warn(`[${series}] 待发库存只剩 ${future} 期（阈值 ${MIN_STOCK}），该补产了`);
  for (const it of items.filter((i) => i.bucket === '_已发'))
    if (it.dt > today) warn(`[${series}] 已发条目的日期在未来：${it.name}`);
  return { pending: future, published: items.length - pending.length };
}

/**
 * 段子的天数号跟台词里的数字撞车。
 *
 * ⚠ **只报提醒。** 天数号在收尾卡上，台词里那个数在字幕上，同屏出现两个 1863
 * 观众会以为它们有关系 —— 但这是观感问题，不是硬伤。
 */
function checkLedger(items: Item[]): void {
  const p = 'horse/used-numbers.json';
  if (!existsSync(p)) return;
  const ledger = readJson<{ album?: string; day: number; nums: number[] }[]>(p);
  if (!ledger) {
    fail(`${p} 解析失败`);
    return;
  }
  const pool = new Set(ledger.flatMap((e) => e.nums));
  for (const it of items.filter((i) => i.series === '段子'))
    if (pool.has(it.id)) warn(`[段子] 天数号 ${it.id} 跟台词数字账本撞号：${it.name}`);
}

export function runSchedule(today = new Date()): { fails: string[]; warns: string[] } {
  fails.length = 0;
  warns.length = 0;
  unslottedDone.length = 0;
  const stats: Record<string, { pending: number; published: number }> = {};
  const all: Item[] = [];

  for (const series of Object.keys(SERIES) as Series[]) {
    const items = collect(series);
    all.push(...items);
    checkDuplicates(items, series);
    checkNumbering(items, series);
    for (const it of items) {
      checkSlot(it);
      checkPointers(it);
    }
    stats[series] = checkBuckets(items, series, today);
  }
  checkLedger(all);
  if (unslottedDone.length)
    warn(
      `[段子] _已发 里有 ${unslottedDone.length} 条没记发布日（第 ${unslottedDone.join('、')} 天）——` +
        `2026-08-23 之前发的，日期补不上了。知道哪条是哪天就 \`mv\` 上前缀`
    );

  const line = '─'.repeat(58);
  console.log(line);
  for (const [s, v] of Object.entries(stats))
    console.log(`  ${s}    待发 ${String(v.pending).padStart(3)} 期   已发 ${String(v.published).padStart(3)} 期`);
  console.log(line);

  const next = all.filter((i) => i.bucket === '_待发' && i.dt >= today).sort((a, b) => a.dt.getTime() - b.dt.getTime())[0];
  if (next) console.log(`  下一条　${next.name}`);

  if (fails.length) {
    console.log(`\nFAIL (${fails.length})`);
    fails.forEach((m) => console.log(`  ✗ ${m}`));
  }
  if (warns.length) {
    console.log(`\nWARN (${warns.length})`);
    warns.forEach((m) => console.log(`  ! ${m}`));
  }
  if (!fails.length && !warns.length) console.log('\n  全部通过。');
  console.log('');
  return { fails, warns };
}

if (process.argv[1]?.endsWith('laoma-schedule.ts')) {
  const { fails: f } = runSchedule();
  process.exit(f.length ? 1 : 0);
}

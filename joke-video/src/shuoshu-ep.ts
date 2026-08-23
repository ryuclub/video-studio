// ── 期号解析：一条命令服务 17 期，而不是每期改一遍常量 ────────────────
//
// 以前 EP 是硬编码的（`const EP = '2026-08-18_liaozhai-E01'`），散在五个文件里。
// 那样跑 E02 会**把音频写进 E01 的目录** —— 这是数据损坏，不是麻烦。
//
// 现在统一从这里取。**不给默认值、不猜**：说不清是哪一期就报错，
// 把可选项列出来让人选。写错目录的代价（覆盖掉一期成品）远大于多敲一个参数。
//
// 期号目录长这样：`projects/说书/<日期>_liaozhai-E01/`
// 简写匹配：`--ep E01` 认得出上面那个目录，不用敲全名。

import { OUT_SHUOSHU } from './paths.js';
import { nextSlot, slugOf } from './schedule.js';
import { readdirSync, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const ROOT = OUT_SHUOSHU;

export interface Ep {
  /** 目录名，如 2026-08-25_1800JST_婴宁-E05 */
  id: string;
  /** 相对 joke-video/ 的目录路径 */
  dir: string;
  /**
   * 目录名里**不变的那一半**（身份），如 `婴宁-E05`。
   *
   * 成片、字幕按它命名，不按 `id` —— 因为 `id` 的前缀是档期，**档期是会挪的**。
   * 按 `id` 命名的话，挪一次档就得把 mp4/srt 一起改名，发布文案里的文件名也跟着断。
   * 见 `schedule.ts` 顶上那条「别把可变状态编进不可变标识里」。
   *
   * 老目录（`2026-08-18_liaozhai-E01`）没有档期前缀，去掉日期就是身份。
   */
  slug: string;
}

export function listEps(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).filter((d) => statSync(`${ROOT}/${d}`).isDirectory());
}

const asEp = (id: string): Ep => ({ id, dir: `${ROOT}/${id}`, slug: slugOf(id) });

/**
 * 从命令行解析期号。
 * @param argv 直接传 process.argv.slice(2)
 *
 * 认三种写法：`--ep 2026-08-18_liaozhai-E01` / `--ep E01` / `--ep liaozhai-E01`
 */
export function resolveEp(argv: string[]): Ep {
  const i = argv.indexOf('--ep');
  const hint = i >= 0 ? argv[i + 1] : undefined;
  const all = listEps();
  if (!all.length) throw new Error(`${ROOT} 下一个期号目录都没有`);

  if (!hint) {
    throw new Error(
      `要哪一期？加 --ep\n可选：\n${all.map((a) => `  ${a}　（简写 ${/E\d+/.exec(a)?.[0] ?? a}）`).join('\n')}`
    );
  }

  const exact = all.filter((a) => a === hint);
  const loose = all.filter((a) => a.toLowerCase().includes(hint.toLowerCase()));
  const hit = exact.length ? exact : loose;
  if (!hit.length) throw new Error(`没有这一期：${hint}\n可选：${all.join(' / ')}`);
  if (hit.length > 1) throw new Error(`「${hint}」对上了好几期，写全一点：${hit.join(' / ')}`);
  return asEp(hit[0]);
}

/**
 * 从稿件路径推期号，没有对应目录就建一个。
 *
 * `liaozhai-E05-yingning.md` → 找带 `E05` 的目录 → 没有就建一个。
 * 解析是一期的第一步，这时候目录本来就还不存在，所以只有这里允许创建。
 *
 * ── 新目录名（2026-08-23 起）──
 *
 *     2026-08-25_1800JST_说书_婴宁-E05
 *     └── 下一个空的说书档 ──┘ └类型┘ └篇名-期号┘
 *
 * **档期是自动挑的**：`schedule.ts` 按周二/周四/周六 18:00 往后找第一个没被占的档。
 * 排满了就往下一周走，一档只发一条 —— 判据是目录名，没有第二本账。
 * 要挪档，直接给目录改前缀，别改后半截。
 *
 * 篇名从稿件第一行的 `# 第 5 期《婴宁》` 里取。取不到就退回文件名里的拼音段。
 */
export function epFromScript(scriptPath: string): Ep {
  const stem = basename(scriptPath).replace(/\.md$/, '');
  const tag = /E\d+/i.exec(stem)?.[0]?.toUpperCase();
  if (!tag) throw new Error(`稿件文件名里看不出期号（要带 E01 这样的标记）：${stem}`);

  const hit = listEps().filter((d) => d.toUpperCase().includes(tag));
  if (hit.length > 1) throw new Error(`${tag} 对上了好几个目录：${hit.join(' / ')}`);
  if (hit.length === 1) return asEp(hit[0]);

  // 篇名：稿件第一行 `# 第 5 期《婴宁》`。**用中文篇名不用拼音** ——
  // 目录名是给人看的，`婴宁-E05` 一眼知道是哪一期，`liaozhai-E05` 要去查
  const title = /《([^》]+)》/.exec(readFileSync(scriptPath, 'utf8').split('\n')[0] ?? '')?.[1];
  const name = title ?? /^[a-z]+-E\d+-(.+)$/i.exec(stem)?.[1] ?? stem;
  const slot = nextSlot('说书');
  // 目录名：日期 _ 时刻JST _ 类型 _ 稿件名-序号
  const id = `${slot.tag}_说书_${name}-${tag}`;
  mkdirSync(`${ROOT}/${id}`, { recursive: true });
  console.log(`新建期号目录：${ROOT}/${id}`);
  console.log(`  档期：${slot.tag.replace('_', ' ').replace('JST', ' JST')}（说书线下一个空档）`);
  return asEp(id);
}

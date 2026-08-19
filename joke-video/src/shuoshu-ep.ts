// ── 期号解析：一条命令服务 17 期，而不是每期改一遍常量 ────────────────
//
// 以前 EP 是硬编码的（`const EP = '2026-08-18_liaozhai-E01'`），散在五个文件里。
// 那样跑 E02 会**把音频写进 E01 的目录** —— 这是数据损坏，不是麻烦。
//
// 现在统一从这里取。**不给默认值、不猜**：说不清是哪一期就报错，
// 把可选项列出来让人选。写错目录的代价（覆盖掉一期成品）远大于多敲一个参数。
//
// 期号目录长这样：`shuoshu/projects/<日期>_liaozhai-E01/`
// 简写匹配：`--ep E01` 认得出上面那个目录，不用敲全名。

import { readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const ROOT = '../shuoshu/projects';

export interface Ep {
  /** 目录名，如 2026-08-18_liaozhai-E01 */
  id: string;
  /** 相对 joke-video/ 的目录路径 */
  dir: string;
}

export function listEps(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).filter((d) => statSync(`${ROOT}/${d}`).isDirectory());
}

const asEp = (id: string): Ep => ({ id, dir: `${ROOT}/${id}` });

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
 * `liaozhai-E02-nie.md` → 找带 `E02` 的目录 → 没有就建 `<今天>_liaozhai-E02`。
 * 解析是一期的第一步，这时候目录本来就还不存在，所以只有这里允许创建。
 */
export function epFromScript(scriptPath: string): Ep {
  const stem = basename(scriptPath).replace(/\.md$/, '');
  const tag = /E\d+/i.exec(stem)?.[0]?.toUpperCase();
  if (!tag) throw new Error(`稿件文件名里看不出期号（要带 E01 这样的标记）：${stem}`);

  const hit = listEps().filter((d) => d.toUpperCase().includes(tag));
  if (hit.length > 1) throw new Error(`${tag} 对上了好几个目录：${hit.join(' / ')}`);
  if (hit.length === 1) return asEp(hit[0]);

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const series = /^([a-z]+)-/i.exec(stem)?.[1] ?? 'shuoshu';
  const id = `${today}_${series}-${tag}`;
  mkdirSync(`${ROOT}/${id}`, { recursive: true });
  console.log(`新建期号目录：${ROOT}/${id}`);
  return asEp(id);
}

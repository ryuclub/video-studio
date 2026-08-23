// ── 治愈线的期号解析：一条命令服务全季，而不是每本书改一遍常量 ────────
//
// 做《方丈记》的时候六个脚本各写了一行 `const EP = '2026-08-19_hojoki'`。
// 一本书的时候没问题，加第二本（《枕草子》）就成了陷阱：
// **忘了改哪一个，那一步就把新书的产物写进方丈记的目录** —— 这是数据损坏，不是麻烦。
// 说书线早就栽过同一跤，那边的注释写着一模一样的话。
//
// 所以统一从这里取，**不给默认值、不猜**：说不清是哪一本就报错，
// 把可选项列出来让人选。写错目录的代价（覆盖掉一本已经做完的）
// 远大于多敲一个参数。
//
// 目录长这样：`projects/治愈/<日期>_<书名拼音>/`
// 简写匹配：`--ep makura` 或 `--ep 枕草子` 都认得出。

import { LINES, DEFAULT_LINE, type Line } from './zhiyu-lines.js';
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';

// ── 三条线共用这条管线，靠 --line 分流 ──────────────────────────────
//
// 治愈（旁白书）和心理洞察（现象型/清单体）**骨架完全一样**：
// 和纸底、木格窗框、竖排标题、印章、进度线、蜗牛，一份代码。
// 差别只有色板和镜位集，那两样在 zhiyu-scene.ts 里按 line 取。
//
// **缺省是治愈**，所以既有的八个脚本一个字都不用改，命令也照旧。
// 要心理线就多给一个 --line 心理。

const lineArg = process.argv.indexOf('--line');
export const LINE = lineArg >= 0 ? process.argv[lineArg + 1] : DEFAULT_LINE;
if (!LINES[LINE])
  throw new Error(`没有这条线：${LINE}
可选：${Object.keys(LINES).join(" / ")}`);

/** 当前线路的全部差异。**加第三条线只改 zhiyu-lines.ts** */
export const DEF: Line = LINES[LINE];

const ROOT = DEF.out;

export interface Ep {
  /** 哪条线。治愈 / 心理 */
  line: string;
  /** 目录名，如 2026-08-19_hojoki */
  id: string;
  /** 相对 joke-video/ 的目录路径 */
  dir: string;
  /** 发布.json 里的书名，用来给报错和日志加人话 */
  book: string;
}

function bookOf(id: string): string {
  const f = `${ROOT}/${id}/发布.json`;
  if (!existsSync(f)) return id;
  try {
    return (JSON.parse(readFileSync(f, 'utf8')) as { book?: string }).book ?? id;
  } catch {
    return id;
  }
}

export function listEps(): string[] {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT).filter((d) => statSync(`${ROOT}/${d}`).isDirectory());
}

const asEp = (id: string): Ep => ({ line: LINE, id, dir: `${ROOT}/${id}`, book: bookOf(id) });

/**
 * 从命令行解析是哪一本。
 * @param argv 直接传 process.argv.slice(2)
 *
 * 认三种写法：`--ep 2026-08-19_hojoki` / `--ep hojoki` / `--ep 方丈记`
 * （最后一种靠 发布.json 里的 book 字段匹配）
 */
export function resolveEp(argv: string[]): Ep {
  const i = argv.indexOf('--ep');
  const hint = i >= 0 ? argv[i + 1] : undefined;
  const all = listEps();
  if (!all.length) throw new Error(`${ROOT} 下一本书都没有（--line ${LINE}）`);

  if (!hint)
    throw new Error(
      `要哪一本？加 --ep\n可选：\n` +
        all.map((a) => `  ${a}　《${bookOf(a)}》　（简写 ${a.replace(/^\d{4}-\d{2}-\d{2}_/, '')}）`).join('\n')
    );

  const k = hint.toLowerCase();
  const exact = all.filter((a) => a === hint);
  const loose = all.filter((a) => a.toLowerCase().includes(k) || bookOf(a).includes(hint));
  const hit = exact.length ? exact : loose;
  if (!hit.length)
    throw new Error(`没有这一本：${hint}\n可选：${all.map((a) => `${a}《${bookOf(a)}》`).join(' / ')}`);
  if (hit.length > 1) throw new Error(`「${hint}」对上了好几本，写全一点：${hit.join(' / ')}`);
  return asEp(hit[0]);
}

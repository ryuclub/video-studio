// ── 心理洞察线稿件体检 ────────────────────────────────────────────────
//
// 用法：npx tsx src/xinli-check.ts --line 心理 --ep 已读不回
//
// **但正常不用手敲** —— `zhiyu-episode.ts` 起手就会调它，有错不往下跑。
//
// ── 为什么要有这个东西 ──
//
// E01 第一版是这么出的：落稿 → 音频 → 画面 → 成片 → 拿 ffprobe 量时长，
// **这时才发现稿子从一开始就不达标**（1647 字，而结构表要 1900–2100，
// 命名段缺 35、展开段缺 79）。整条链白跑一遍。
//
// 稿源 §出稿检查表 里「结构字数落在区间内」本来就写着，但它是个复选框，
// 没有任何代码在守。说书线早就得出过同一个结论并且照做了：
// **文档拦不住人，体检才拦得住。** 这份就是把那张表里机器能查的部分变成代码。
//
// ── 只查得了一半 ──
//
// 腻不腻、换气句有没有真的换到气、现象段够不够像监控录像 —— 只有人听得出来。
// 体检过了不等于稿子好，只等于「没有明显的硬伤」。

import { readFileSync, existsSync } from 'node:fs';
import { resolveEp } from './zhiyu-ep.js';
import { checkDiction, 读用语豁免, 必答清单 } from './zhiyu-diction.js';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

/**
 * **实测值，不是估的。** E01 全片 1647 字 / 383.3 秒（含全部停顿）。
 *
 * 稿源 §十 写的「暂定 200–210 字/分」跟这个差得远，别拿它折时长 ——
 * 那个数的来历跟治愈线当年那次一样，很可能是把「整期含停顿均速」
 * 和「说话速度」混了。治愈线为此废掉过六条候选音色。
 *
 * 同音色同节拍下治愈线是 226（方丈记）/ 235（枕草子上篇），
 * 这条线更快是文本本身的差别（短句多、逗号少），不是音色调过。
 */
export const CPM = 258;

/**
 * 稿源 §三 的结构表。**这是这条线的骨头** ——
 * 六段各有各的活，哪一段瘦了就是那件活没干完：
 *
 *   现象  一个具体的现代场景，无人称、像监控录像
 *   确认  「这事很常见」。放下防备，不是安慰
 *   命名  古典文本给出机制，机制要有名字
 *   展开  **这个机制原本是干什么用的** —— 它一定曾经有用。
 *         这一段是这条线和厚黑学的分界，短了整期就变成「你有毛病」
 *   代价  有用的东西在什么条件下开始伤人
 *   归位  不给建议，只给「你现在知道这是什么了」
 */
export const BUDGET: Record<string, [number, number]> = {
  现象: [200, 250],
  // 80–100 是按老 5 条定的。规则 6 要求段末预告一句中心思想句，
  // 那句本身就 40 字上下 —— 区间不动的话，照规则写的稿子必然超标。
  确认: [110, 150],
  // 引句是独立的结构槽，不算进前后段。第一版没给它们段标记，
  // 结果 23 个字的引句被算进【确认】，把一段合规的稿子报成超标。
  前置引句: [15, 40],
  中位引句: [15, 40],
  尾引句: [8, 30],
  命名: [400, 500],
  展开: [400, 500],
  代价: [350, 450],
  // 同上：规则 8 把归位段从「这是什么」扩到「这是什么 ＋ 可以放下什么」，
  // 规则 9 又要求全篇最能安慰人的一句落在这儿。200–250 装不下。
  归位: [250, 320],
};

/**
 * §三 硬规则 5。**这条 2026-08-20 改过，两头都卡：**
 *
 * 位置多了【确认】—— 规则 6 要求在确认段末尾预告一次中心思想句，
 * 那一句是第一次用「你」。原来只放行代价／归位，照规则 6 写会被自己拦下。
 *
 * 下限是新加的。原来只有上限 5，于是 E01 第一版写出了一篇几乎零第二人称的稿子，
 * 体检全绿 —— 听众没有可以站进去的位置，这是「听完不知道说了啥」的一半原因。
 * **上限防滥用，下限防端着。**
 */
const YOU_SECTIONS = new Set(['确认', '代价', '归位']);
/**
 * 上限从 5 提到 16。**5 是按老 5 条定的，跟规则 8、9 直接打架** ——
 * 规则 8 要归位段说出「可以放下什么」，规则 9 要全篇最能安慰人的一句落在那儿，
 * 这两件事都是对着听众说的，一段下来自然就是七八次。E01 重写稿全篇 11 次。
 *
 * **真正在防滥用的是位置那一条，不是这个数。** 现象／命名／展开三段一次都不许有，
 * 那三段占全篇一半还多；剩下的地方本来就是该跟人说话的地方。
 * 这个数留着只防一种情况：整篇「你你你」地戳人。
 */
const YOU_MAX = 16;
/** 后半段（代价＋归位）至少要用到的次数 */
const YOU_MIN_LATE = 2;
const YOU_LATE = new Set(['代价', '归位']);

/** §四 禁用词表（频道通则 + 本线加的那批） */
const BANNED = [
  '愿你', '余生', '温柔以待', '治愈', '正能量',
  '看穿', '识破', '高情商', '社交牛人', '精神内耗', '必看',
];

export interface Section {
  name: string;
  chars: number;
  paras: string[];
}

/** 按 `### 【段名】` 切段。`###` 行不进音频，loadAct 会丢掉，这里只拿它当分界 */
export function parseSections(file: string): {
  sections: Section[];
  beats: number;
  total: number;
  meta: string;
} {
  const raw = readFileSync(file, 'utf8');
  // 第一个 --- 之前是稿头元信息（副标题／机制／中心思想句／床音），不进音频。
  // 规则 6 要在这里找「中心思想」，所以得单独留一份，不能像正文那样丢掉 > 行。
  const meta = raw.split(/^---$/m)[0];
  const body = raw.split(/^---$/m).slice(1).join('---');
  const sections: Section[] = [];
  let cur: Section | null = null;
  let beats = 0;
  let total = 0;
  for (const p of body.split(/\n\s*\n/)) {
    const h = p.match(/###\s*【(.+?)】/);
    if (h) {
      cur = { name: h[1], chars: 0, paras: [] };
      sections.push(cur);
      continue;
    }
    const t = p
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('>'))
      .join('');
    if (!t) continue;
    if (t === '⏸') {
      beats++;
      continue;
    }
    const n = [...t.replace(/\s/g, '')].length;
    total += n;
    if (cur) {
      cur.chars += n;
      cur.paras.push(t);
    }
  }
  return { sections, beats, total, meta };
}

export const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;

export function checkXinli(dir: string, act = '正文'): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  const file = `${dir}/${act}.md`;
  if (!existsSync(file)) {
    err(`没有稿子：${file}`);
    return out;
  }
  const { sections, beats, total, meta } = parseSections(file);

  // ── 用语规范（全系通用）──────────────────────────────────────────
  //
  // 规范正文：`zhiyu/治愈频道_用语规范.md`，机器部分在 `zhiyu-diction.ts`。
  // ⚠ **三条线共用那一份**，不各写各的 —— 各写各的迟早分叉，
  // 而分叉之后「哪份是真的」只能靠读代码。
  for (const d of checkDiction(sections.flatMap((s) => s.paras.map((text) => ({ text, section: s.name }))), 读用语豁免(dir)))
    out.push({ level: d.level, msg: `[${d.rule}] ${d.msg}` });

  // ── 结构：六段齐不齐、各段字数在不在区间 ──
  const got = new Set(sections.map((s) => s.name));
  for (const name of Object.keys(BUDGET))
    if (!got.has(name)) err(`缺【${name}】段。六段结构是这条线的骨头，不能省`);

  for (const s of sections) {
    const b = BUDGET[s.name];
    if (!b) {
      warn(`【${s.name}】不在结构表里，字数没查`);
      continue;
    }
    const [lo, hi] = b;
    if (s.chars < lo)
      err(
        `【${s.name}】${s.chars} 字，不足 ${lo}（缺 ${lo - s.chars}）。` +
          (s.name === '展开'
            ? '　**展开段是这条线和厚黑学的分界** —— 它要说清「这个机制原本有用」，短了整期就变成在指认听众有毛病'
            : '')
      );
    else if (s.chars > hi) warn(`【${s.name}】${s.chars} 字，超出 ${hi}（多 ${s.chars - hi}）`);
  }

  // ── 片长：用实测语速折，别用稿源那个暂定值 ──
  const sec = (total / CPM) * 60;
  const [lo, hi] = Object.values(BUDGET).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  out.push({
    level: 'warn',
    msg: `全文 ${total} 字（区间 ${lo}–${hi}），按实测 ${CPM} 字/分约 ${mmss(sec)}　⏸ ${beats} 个`,
  });

  // ── 硬规则 5：「你」的次数与位置 ──
  let you = 0;
  let late = 0;
  for (const s of sections)
    for (const p of s.paras) {
      const m = p.match(/你/g);
      if (!m) continue;
      you += m.length;
      if (!YOU_SECTIONS.has(s.name))
        err(
          `【${s.name}】出现「你」：${p.slice(0, 28)}…　` +
            `硬规则 5：只能在 ${[...YOU_SECTIONS].join('／')} 段`
        );
      if (YOU_LATE.has(s.name)) late += m.length;
    }
  if (you > YOU_MAX) err(`「你」共 ${you} 次，上限 ${YOU_MAX}`);
  if (late < YOU_MIN_LATE)
    err(
      `代价＋归位两段一共只用了 ${late} 次「你」，下限 ${YOU_MIN_LATE}。` +
        `　**全篇没有第二人称，听众就没有可以站进去的位置** —— E01 第一版就栽在这儿，` +
        `形式全对，听完不知道在说谁`
    );

  // ── §四 禁用词 ──
  for (const s of sections)
    for (const p of s.paras)
      for (const w of BANNED) if (p.includes(w)) err(`【${s.name}】出现禁用词「${w}」：${p.slice(0, 28)}…`);

  // ── 现象段必须无人称 ──
  const xian = sections.find((s) => s.name === '现象');
  if (xian)
    for (const p of xian.paras)
      if (/你|我们|大家|有没有过/.test(p))
        err(`【现象】要无人称、纯外部描写，像监控录像：${p.slice(0, 28)}…`);

  // ── 归位段不许出行动建议 ──
  const gui = sections.find((s) => s.name === '归位');
  if (gui)
    for (const p of gui.paras)
      if (/应该|建议|不妨|试着|记得|要学会/.test(p))
        err(`【归位】不给行动建议，只到「这是什么」：${p.slice(0, 28)}…`);

  // ── 硬规则 6：中心思想句必须先写出来 ──
  //
  // 只查得了「有没有写」，查不了「正文里那两次是不是真的坐实了它」——
  // 但光是逼着人在动笔前把这一句写出来，就能挡掉一半 AI 味儿：
  // 写不出中心思想句的稿子，写出来也是没有中心思想的。
  const idea = meta.match(/中心思想[：:]s*(.+)/);
  if (!idea || idea[1].trim().length < 8)
    err(
      '稿头缺「中心思想：…」一行（硬规则 6）。' +
        '　**写不出这一句就不许开写** —— 它要在确认段末尾预告一次、归位段坐实一次'
    );
  else if (!/你/.test(idea[1]))
    warn(`中心思想句里没有「你」：${idea[1].trim().slice(0, 30)}…　落点是说给听众的，通常得有`);

  // ── 硬规则 8：归位段禁止三连否定 ──
  //
  // 「没有解法」「它会一直这样」「还是会这样」连着出现，等于告诉人没救。
  // 不承诺会好起来、和告诉人没用，是两回事 —— 后者听众根本不需要听人讲一遍。
  if (gui) {
    const neg = (t: string) => /没有解法|不会改变|一直这样|还是会|治不了|没有办法|无解/.test(t);
    for (let i = 0; i + 2 < gui.paras.length; i++)
      if (neg(gui.paras[i]) && neg(gui.paras[i + 1]) && neg(gui.paras[i + 2])) {
        err(`【归位】三段连着否定（硬规则 8）：${gui.paras[i].slice(0, 20)}…`);
        break;
      }
  }

  // ── 引文：⏸ 成对包住引句。稿源要求引句前后各静音一次 ──
  if (beats % 2 !== 0) warn(`⏸ 有 ${beats} 个，奇数 —— 引句应该前后各一个，检查是不是漏了`);

  // ── 编辑记号：星号、引用记号漏进正文会被念出来 ──
  for (const s of sections)
    for (const p of s.paras)
      if (/[*_`|※▪●■→✓]/.test(p)) err(`【${s.name}】残留编辑记号：${p.slice(0, 28)}…`);

  return out;
}

/** 报告 + 有错就停。给 zhiyu-episode.ts 起手调 */
export function gate(dir: string, act = '正文'): void {
  const issues = checkXinli(dir, act);
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  if (errors.length) {
    console.error(
      `\n体检没过：${errors.length} 个错。**不往下跑了。**\n` +
        `E01 第一版就是带着「命名缺 35、展开缺 79」一路跑到成片才发现的，整条链白跑一遍。`
    );
    process.exit(1);
  }
  console.log(`  ✓ 体检通过${issues.length ? `，${issues.length} 个提醒` : ''}`);
  // 机器判不了的那几样，每期印一遍。**清单写了却没人看得见，是「用语太书面」反复失守的第三个机制**
  console.log(必答清单);
}

if (process.argv[1] && process.argv[1].endsWith('xinli-check.ts')) {
  const { dir, book } = resolveEp(process.argv.slice(2));
  console.log(`《${book}》稿件体检`);
  gate(dir);
}

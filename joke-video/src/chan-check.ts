// ── 禅佛典线（小故事大道理）稿件体检 ──────────────────────────────────
//
// 用法：npx tsx src/chan-check.ts --line 禅佛典 --ep e01-第七个饼
//
// **但正常不用手敲** —— `zhiyu-episode.ts` 起手就会调它，有错不往下跑。
//
// ── 为什么又是一份，而不是给 xinli-check 加参数 ──
//
// 两条线的结构表长得像（都是「几段各有各的活」），但**查的东西不一样**：
// 心理线查的是「你」的下限、归位段有没有滑出建议、中心思想句在不在稿头；
// 这条线查的是说破句、诊断词的重定义、故事段有没有提前抬出抽象词、
// 回看段有没有出现「错蠢愚」。
//
// 把它们塞进一个函数会做出一个「什么都能配、什么都配不对」的东西
// （`zhiyu-lines.ts` 顶上那句话说的就是这个）。共用的那一半 ——
// 按 `### 【段名】` 切段、数字数、认 ⏸ —— 直接 import 过来，不抄。
//
// ── 只查得了一半 ──
//
// 说破句离了这个故事还成不成立、扩写有没有偷偷加心理描写、宽慰是不是
// 落在了判决上 —— 只有人读得出来。体检过了不等于稿子好，只等于没有明显硬伤。

import { existsSync, readFileSync } from 'node:fs';
import { resolveEp } from './zhiyu-ep.js';
import { parseSections, mmss, type Issue } from './xinli-check.js';

/**
 * **实测值。** E01《第七个饼》1960 字 / 473.6 秒（含全部停顿）＝ 248.3。
 *
 * 稿源 §九 写的「190 字/分为暂定值」差了 31%，按它折 E01 是 10:19，
 * 实际 7:53 —— 那个数跟治愈线当年那次是同一个来历，很可能是把
 * 「整期含停顿均速」和「说话速度」混了（治愈线为此废掉过六条候选音色）。
 *
 * 同音色下治愈线 226、心理线 258，这条线 248 落在两者之间：
 * 故事段句子长（往慢里拉），但短句独立成段的地方多、⏸ 只有 7 个（往快里拉）。
 * **一期不够定一个数**，E02、E03 再各出一个再说。
 */
export const CPM = 248;

/**
 * 稿源 §三 的结构表。**七段各有各的活**：
 *
 *   冷开场   反常动作 ＋ 现实锚点两拍。留人靠反常不靠熟悉
 *   故事     一口气讲完，中间不评论、不铺垫、不预告
 *   回看     不是指出他错在哪，是说明他为什么会这样。**说破句落在这儿**
 *   引申     现实场景（≤3 个）→ 一条道理 → 一句不承诺的宽慰
 *   收束     收束句 ＋ 静音 ＋ 佛典原文一句 ＋ 结束
 *
 * 冷开场两拍（100–150 ＋ 60–80）在稿子里是同一个段标记，所以合起来查。
 * 引句是独立的结构槽，不算进前后段 —— 心理线第一版就栽在这儿（23 字的
 * 引句被算进【确认】，把一段合规的稿子报成超标）。
 */
export const BUDGET: Record<string, [number, number]> = {
  冷开场: [160, 230],
  前置引句: [15, 40],
  故事: [700, 900],
  回看: [200, 250],
  中位引句: [15, 40],
  引申: [500, 600],
  收束: [150, 200],
};

/**
 * §三 硬规则 1：**故事讲完之前不许出现任何抽象词。**
 *
 * 提前一次，后面的说破就废了 —— 听众已经知道结论了，故事就成了例证。
 *
 * 「空」这个字最容易误伤（「挑子空了」是没货，不是佛家的空），
 * 但**照样拦**：字面撞上就换一个说法，代价是一次小改写，
 * 而放过去的代价是整期的落点。E01 那句「卖菜的挑子早就空了」
 * 就是被这条拦下来改成「见了底」的。
 */
const ABSTRACT = ['空', '执着', '无常', '烦恼', '觉悟', '修行', '智慧', '禅', '因果', '业障'];

/** §三 硬规则 7：回看段不许出现这三个字。这是宽慰与训诫的分界线 */
const BLAME = ['错', '蠢', '愚'];

/** §三 硬规则 4：「你」只能在引申段，上限 5 */
const YOU_SECTION = '引申';
const YOU_MAX = 5;

/**
 * §一 标题命名规则 ＋ §〇之二 四条底线的禁用词。
 * 前一批是鸡汤腔，后一批是「不承诺会好起来」落在字面上的样子。
 */
const BANNED = [
  '愿你', '余生', '温柔以待', '治愈', '疗愈', '正能量', '放过自己',
  '一切都会过去', '熬过去', '都是财富', '都算数',
  '这个故事告诉我们', '希望大家',
];

/** §三 硬规则 5：收束不给行动建议。§〇之二 底线 2 是同一条 */
const ADVICE = /应该|建议|不妨|试着|记得|要学会|愿我们/;

/**
 * 每一段里有几个 ⏸。`parseSections` 只给总数（它把 ⏸ 当成分隔记号数掉了），
 * 而这条线要查的是位置，所以在这儿单独扫一遍。**切段规则跟它保持一致**。
 */
function beatsPerSection(file: string): Record<string, number> {
  const body = readFileSync(file, 'utf8').split(/^---$/m).slice(1).join('---');
  const out: Record<string, number> = {};
  let cur = '';
  for (const p of body.split(/\n\s*\n/)) {
    const h = p.match(/###\s*【(.+?)】/);
    if (h) {
      cur = h[1];
      out[cur] ??= 0;
      continue;
    }
    if (p.trim() === '⏸' && cur) out[cur]++;
  }
  return out;
}

export function checkChan(dir: string, act = '正文'): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  const file = `${dir}/${act}.md`;
  if (!existsSync(file)) {
    err(`没有稿子：${file}`);
    return out;
  }
  const { sections, beats, total, meta } = parseSections(file);

  // ── 结构：七段齐不齐、各段字数在不在区间 ──
  const got = new Set(sections.map((s) => s.name));
  for (const name of Object.keys(BUDGET))
    if (!got.has(name)) err(`缺【${name}】段。七段结构是这条线的骨头，不能省`);

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
          (s.name === '故事'
            ? '　**故事段是这条线的本体** —— 扩写只加环境和动作（硬规则 6），短了就只剩一个梗概加一段道理'
            : '')
      );
    else if (s.chars > hi) warn(`【${s.name}】${s.chars} 字，超出 ${hi}（多 ${s.chars - hi}）`);
  }

  const sec = (total / CPM) * 60;
  const [lo, hi] = Object.values(BUDGET).reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  out.push({
    level: 'warn',
    msg: `全文 ${total} 字（区间 ${lo}–${hi}），按实测 ${CPM} 字/分约 ${mmss(sec)}　⏸ ${beats} 个`,
  });

  // ── 硬规则 1：故事讲完之前不许有抽象词 ──
  const beforeEnd = ['冷开场', '前置引句', '故事'];
  for (const s of sections) {
    if (!beforeEnd.includes(s.name)) continue;
    for (const p of s.paras)
      for (const w of ABSTRACT)
        if (p.includes(w))
          err(
            `【${s.name}】提前抬出抽象词「${w}」（硬规则 1）：${p.slice(0, 28)}…　` +
              `提前一次，后面的说破就废了`
          );
  }

  // ── 硬规则 7：回看段不许出现「错」「蠢」「愚」 ──
  const hui = sections.find((s) => s.name === '回看');
  if (hui)
    for (const p of hui.paras)
      for (const w of BLAME)
        if (p.includes(w))
          err(
            `【回看】出现「${w}」（硬规则 7）：${p.slice(0, 28)}…　` +
              `这是宽慰与训诫的分界线，落在字面上就是这三个字`
          );

  // ── 硬规则 12：诊断词必须带着重定义一起出场 ──
  //
  // 查得了「有没有一句 X 不是 A，是 B」，查不了那个 B 好不好。
  // 但光是逼着人把重定义写出来，就挡掉了「他就是贪」这种骂人式的落点。
  if (hui) {
    const t = hui.paras.join('');
    if (!/不是.{1,24}[，,。].{0,8}是/.test(t))
      err(
        '【回看】找不到「X 不是 A，是 B」那半句（硬规则 12）。' +
          '　**诊断词不带重定义就退回骂人** —— 「这叫执着」是评价，' +
          '「执着不是放不下，是怕松手之后连自己做过什么都没人记得」才是宽慰'
      );
  }

  // ── 硬规则 4：「你」的次数与位置 ──
  let you = 0;
  for (const s of sections)
    for (const p of s.paras) {
      const m = p.match(/你/g);
      if (!m) continue;
      you += m.length;
      if (s.name !== YOU_SECTION)
        err(`【${s.name}】出现「你」：${p.slice(0, 28)}…　硬规则 4：只能在【${YOU_SECTION}】段`);
    }
  if (you > YOU_MAX) err(`「你」共 ${you} 次，上限 ${YOU_MAX}（硬规则 4）`);

  // ── 硬规则 8：引申段的现实场景一律无人称 ──
  const yin = sections.find((s) => s.name === '引申');
  if (yin)
    for (const p of yin.paras)
      if (/你是不是也|有没有那么一刻|有没有过|我们每个人/.test(p))
        err(`【引申】现实场景要无人称（硬规则 8）：${p.slice(0, 28)}…`);

  // ── 硬规则 5 ＋ 底线 2：收束不给行动建议 ──
  const shou = sections.find((s) => s.name === '收束');
  if (shou)
    for (const p of shou.paras)
      if (ADVICE.test(p)) err(`【收束】不给行动建议（硬规则 5）：${p.slice(0, 28)}…`);

  // ── 禁用词：鸡汤腔 ＋ 四条底线落在字面上的样子 ──
  for (const s of sections)
    for (const p of s.paras)
      for (const w of BANNED) if (p.includes(w)) err(`【${s.name}】出现禁用词「${w}」：${p.slice(0, 28)}…`);

  // ── 硬规则 11：说破句先于故事定下来，写在稿头 ──
  //
  // 跟心理线的「中心思想句」是同一件事，只是这条线叫说破句。
  // 写不出这一句的稿子，写出来也是没有落点的。
  const shuo = meta.match(/说破句[：:]\s*(.+)/);
  if (!shuo || shuo[1].trim().length < 8)
    err(
      '稿头缺「说破句：…」一行（硬规则 11）。' +
        '　**写不出这一句就不许开写** —— 先有故事再找道理，找出来的一定是通用道理'
    );
  const zhen = meta.match(/诊断词[：:]\s*(.+)/);
  if (!zhen || zhen[1].trim().length < 4)
    warn('稿头没写「诊断词：…」一行（硬规则 12）。回看段那个名字应该在动笔前就定下来');

  // ── ⏸：查的是位置，不是奇偶 ──
  //
  // 心理线那份查的是「⏸ 总数是不是偶数」。这条线不能照抄：
  // 冷开场两拍之间还有一个换气用的 ⏸，总数天然是奇数，
  // 照抄的话每一期都会报一条假警。
  //
  // 真正要守的是两件事：**引句前后各一个**（§三之二 播读格式），
  // 以及**收尾仪式**（静音 1.2 → 经文 → 静音 1.2）—— 后者是这条线的识别点，
  // 少一个 ⏸ 经文就贴着上一句出来，仪式感当场没了。
  const perAct = beatsPerSection(file);
  for (const name of ['前置引句', '中位引句'])
    if (got.has(name) && perAct[name] !== 2)
      err(`【${name}】有 ${perAct[name] ?? 0} 个 ⏸，应该前后各一个（§三之二 播读格式）`);
  if (got.has('收束') && perAct['收束'] !== 2)
    err(
      `【收束】有 ${perAct['收束'] ?? 0} 个 ⏸，收尾仪式要两个（静音 → 经文 → 静音）。` +
        `　**这是这条线的识别点**，少一个经文就贴着上一句出来`
    );
  out.push({ level: 'warn', msg: `⏸ 共 ${beats} 个（引句 2×2 ＋ 收尾 2 ＋ 冷开场换气）` });

  // ── 编辑记号：星号、竖线之类漏进正文会被念出来 ──
  for (const s of sections)
    for (const p of s.paras)
      if (/[*_`|※▪●■→✓]/.test(p)) err(`【${s.name}】残留编辑记号：${p.slice(0, 28)}…`);

  return out;
}

/** 报告 + 有错就停。给 zhiyu-episode.ts 起手调 */
export function gate(dir: string, act = '正文'): void {
  const issues = checkChan(dir, act);
  const errors = issues.filter((i) => i.level === 'error');
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  if (errors.length) {
    console.error(
      `\n体检没过：${errors.length} 个错。**不往下跑了。**\n` +
        `心理线 E01 第一版就是带着「命名缺 35、展开缺 79」一路跑到成片才发现的，整条链白跑一遍。`
    );
    process.exit(1);
  }
  console.log(`  ✓ 体检通过${issues.length ? `，${issues.length} 个提醒` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('chan-check.ts')) {
  const { dir, book } = resolveEp(process.argv.slice(2));
  console.log(`《${book}》稿件体检`);
  gate(dir);
}

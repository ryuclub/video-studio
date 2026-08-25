// ── 长片配音稿（.md）→ 稿件 json ──────────────────────────────────────
//
// 用法：
//   npx tsx tools/long-parse.mts <配音版定稿.md> <输出.json>
//
// ⚠ **2026-08-25 换了源。** 原来读的是叙事稿（`老马长片001_老牛走的那天.md`），
// 靠「他说…」认老牛的话、靠句号断句、靠规则推停顿 —— 那是在**猜**稿子的意图，
// 而且猜错过两句（「他说完就走了」被切成「完就走了」）。
//
// 现在读的是**配音版定稿**，稿子自己把两件事标死了：
//
//   【马】/【牛】   谁在说
//   ⏸0.5           这一句之后静音几秒（也可以单独成行：`> ⏸**8.0 — 静场**`）
//
// **规则全从稿子来，脚本一条都不发明。** 没标 ⏸ 的按 0.4（＋padBefore 0.2 ＝ 句间 0.6）。
//
// ⚠ **一段一句。** 稿子把几句话排成一段，是因为它们要一口气读下去（旁白句长、
// 台词句短，长短对比本身就是两个人的区分）。**别再按句号拆** —— 拆开就等于
// 在每个句号后面塞进 0.6 秒，那不是稿子的意思。
//
// ⚠ **稿子是源，json 是产物。** 改稿改 .md 重跑；别手改 json。
//
// ⚠ 只管音频。画面（16 镜、楼道／楼下门口、鱼缸、camera 例外）一件都没做。

import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.log('用法：npx tsx tools/long-parse.mts <配音版定稿.md> <输出.json>');
  process.exit(1);
}

/** 没标 ⏸ 的句间停顿：0.2 + 0.4 = 0.6 秒 */
const DEFAULT_PAD = 0.4;
/** 每一句之前固定留 0.2 秒。老牛那 120 ms 的前后垫音由它一并覆盖 */
const PAD_BEFORE = 0.2;

/**
 * v2 的三层音质（稿子 §〇）。**说话人靠音色分，时态靠音质分。**
 *
 * ⚠ **现场台词那一层这一版没上。** 稿子自己说的：
 * 「先只做停顿和句长听一遍，觉得旁白和台词还黏在一起，再补现场混响。**别一次上三层。**」
 * 而回忆段那一层是 v2 的四处改动之一，且 §十之四 点名「两个音色都要加」，所以照做。
 */
const LAYER: Record<string, string[] | undefined> = {
  旁白: undefined,
  台词: undefined, // ← 稿子说的「别一次上三层」，这一层留到下一版
  回忆: ['lowpass=f=6500', 'volume=-1.5dB', 'aecho=0.9:0.25:28:0.05'],
};
/** 现场台词那一层的滤镜，留在这儿备用（上的时候把 LAYER.台词 指过来） */
const LIVE_ROOM = ["aecho=0.85:0.35:18:0.06"];
void LIVE_ROOM;

/** §十之三：「没有没有」是被夸之后的推辞，rate 再降 5% —— 人推辞的时候语速会掉 */
const SLOWER: Array<{ text: string; rate: string; why: string }> = [
  { text: '没有没有。', rate: '-5%', why: '§十之三：被夸之后的推辞，人推辞的时候语速会掉' },
];

interface Row {
  who: 'ma' | 'niu';
  layer: string;
  text: string;
  padAfter: number;
  /** 稿子里那句静场说明，原样存进 note，出片时看得见为什么停这么久 */
  note?: string;
}

const md = readFileSync(src, 'utf8');
const rows: Row[] = [];
let solo = 0; // 单独成行的静场，落到上一句的 padAfter 上
let soloNote = '';

/** 抠出 `⏸0.5` / `⏸**8.0 — 静场…**` 里的秒数和说明 */
const readPause = (s: string): { sec: number; note: string } | null => {
  const m = s.match(/⏸\*{0,2}\s*([0-9]+(?:\.[0-9]+)?)([^\n]*)/);
  if (!m) return null;
  return { sec: Number(m[1]), note: m[2].replace(/[*—\-\s]+/g, ' ').trim() };
};

for (const raw of md.split('\n')) {
  const t = raw.trim();
  if (!t) continue;
  // 引用块：只有带 ⏸ 的才是静场，别的是写给人看的说明（「以下为回忆段…」）
  if (t.startsWith('>')) {
    const p = readPause(t);
    if (p) {
      solo = Math.max(solo, p.sec);
      soloNote = p.note;
    }
    continue;
  }
  // `【马】` / `【马·台词】` / `【牛·回忆】` —— 前半是谁，后半是哪一层
  const m = t.match(/^【(马|牛)(?:·(台词|回忆|旁白))?】\s*(.+)$/);
  if (!m) continue; // 标题、分隔线、改动记录那几节，一概不念
  if (solo && rows.length) {
    rows[rows.length - 1].padAfter = solo;
    rows[rows.length - 1].note = soloNote || undefined;
    solo = 0;
    soloNote = '';
  }
  const who = m[1] === '马' ? 'ma' : 'niu';
  const layer = m[2] ?? '旁白';
  const p = readPause(m[3]);
  const text = m[3].replace(/⏸.*$/, '').trim();
  rows.push({ who, layer, text, padAfter: p ? p.sec : DEFAULT_PAD });
}
// 稿子末尾那条 `⏸**3.0 — 黑场**` 在最后一句之后，循环里没人接
if (solo && rows.length) {
  rows[rows.length - 1].padAfter = solo;
  rows[rows.length - 1].note = soloNote || undefined;
}

if (!rows.length) {
  console.error('一句都没解析出来 —— 稿子里没有 【马】/【牛】 标记？先看一眼 md');
  process.exit(1);
}

const cfg = {
  _:
    `老马 · **长片 001**《老牛走的那天》**配音版 v2**。稿源：${src}` +
    `（**稿子是源，这份 json 是产物** —— 改稿改 md，重跑 tools/long-parse.mts）。\n\n` +
    `谁说哪句、每处停几秒，**全部由稿子里的 【马】/【牛】 和 ⏸ 标死**，脚本不发明规则。\n\n` +
    `⚠ **老马仍旧是云希（仓库定稿的那条音色），不是稿子抬头写的晓晓** —— 用户 2026-08-25 定：` +
    `老马坚持他原本的声色。前面 18 条短片里的老马都是这条，换了就是两个人。\n\n` +
    `⚠ **老马全片单一参数**：现场档、说破那三句的慢半档全部撤掉。区分靠句长和语气词` +
    `（v2 §九：台词 ≤8 字、可以带「啊」，旁白一个语气词都不许有）。\n\n` +
    `⚠ **三层音质只上了回忆那一层**（lowpass 6500 ＋ 轻回声，两个音色都加，见 \`line.tone\`）。` +
    `现场台词的混响**没上** —— 稿子 §〇 自己说的：先只做停顿和句长听一遍，**别一次上三层**。\n\n` +
    `⚠ **原来那个 8 秒静场作废**（v2 §〇之二：没有画面变化的地方，静场不超过 1.5 秒）。` +
    `现在最长的一处是 2.0 秒，稿子要求那儿同时换一次声音层（室内空调→窗外车流）—— ` +
    `**那一层没做**，环境音要等场景落地。\n\n` +
    `⚠ **现在只做音频。** 画面一件没做。`,
  id: 'laoma-long-001',
  format: 'long',
  type: 'A',
  scene: 'office-desk',
  _scene: '占位。长片六个场景（S1–S6）一个都没接。',
  pace: 'longform',
  intro: 0,
  opening: { style: 'figure-first' },
  ambience: 'none',
  _ambience:
    '⚠ 稿子要求「8 秒静场不是绝对无声，铺环境音底噪」。**管线的 ambience 只有 grass/cicada 两条写死的**（开场草声、片尾蝉鸣），给不了一层通片的房间底噪 —— 现在是在 mixdown 之后用 ffmpeg 单独垫的一层恒定底噪，不分场景。分场景的床音（工位空调／楼道回声／楼下风）要等场景先落地。',
  bgm: { enabled: false },
  characters: [
    { id: 'ma', rig: 'horse', side: 'left', x: 290, scale: 1, cast: '老马', keepX: true },
    { id: 'niu', rig: 'none', side: 'right', cast: '老牛' },
  ],
  _characters: '老牛 `rig: "none"` —— 只有声音，不出画面。长片的画面还没开工。',
  lines: rows.map((r, i) => ({
    who: r.who,
    /** 最后一句标 punch：长片没有落点句，但定格点是从它推出来的（preflight 也拦） */
    beat: i === rows.length - 1 ? 'punch' : 'setup',
    padBefore: PAD_BEFORE,
    padAfter: r.padAfter,
    // 老牛比老马低 1 dB（双音色方案 §六）。6–9 kHz 那 2 dB 在音色的 tone 里
    ...(r.who === 'niu' ? { gain: 0.89 } : {}),
    ...(LAYER[r.layer] ? { tone: LAYER[r.layer] } : {}),
    ...(SLOWER.find((s) => s.text === r.text) ? { delivery: { rate: SLOWER.find((s) => s.text === r.text)!.rate } } : {}),
    ...(r.note ? { note: r.note } : {}),
    say: [{ text: r.text }],
  })),
  cues: { introHiss: false, replyWood: false, punchSlide: false, freezeThud: false, subtitlePop: false },
  camera: 'static',
  subtitleStyle: 'side',
  endHold: 0,
};

writeFileSync(dst, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

const chars = rows.reduce((n, r) => n + r.text.length, 0);
const pause = rows.reduce((n, r) => n + r.padAfter + PAD_BEFORE, 0);
const ox = rows.filter((r) => r.who === 'niu');
const marked = rows.filter((r) => r.padAfter !== DEFAULT_PAD).length;
console.log(dst);
console.log(`  ${rows.length} 句 · ${chars} 字 · 停顿共 ${pause.toFixed(1)}s（其中 ${marked} 处是稿子标死的）`);
const byLayer = (k: string) => rows.filter((r) => r.layer === k).length;
console.log(`  老马 ${rows.length - ox.length} 句 · 老牛 ${ox.length} 句`);
console.log(
  `  三层：旁白 ${byLayer('旁白')} · 现场台词 ${byLayer('台词')}（${
    LAYER.台词 ? '已加混响' : '**混响没上** —— 稿子 §〇「别一次上三层」'
  }） · 回忆 ${byLayer('回忆')}（${LAYER.回忆 ? '已加过去处理' : '没加'}）`
);
for (const s of SLOWER) if (!rows.some((r) => r.text === s.text)) console.log(`  ⚠ 降速那句「${s.text}」在稿子里找不到了`);
console.log(`  估算片长 ${((chars / 5.6 + pause) / 60).toFixed(1)} 分（老马实测 5.6 字/秒，含标点；老牛更慢）`);
console.log('  老牛的话：');
for (const r of ox) console.log(`    「${r.text}」　停 ${r.padAfter}s`);
console.log('  长于 1.2 秒的静场：');
for (const r of rows) if (r.padAfter >= 1.2) console.log(`    ${r.padAfter}s　在「${r.text.slice(-14)}」之后${r.note ? `　（${r.note}）` : ''}`);

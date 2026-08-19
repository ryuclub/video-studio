// ── 说书出片前体检：把「能跑但结果不对」拦在最前面 ──────────────────────
//
// 用法：npx tsx src/shuoshu-preflight.ts --ep E02
//
// 段子线有 `preflight.ts`，说书线一直没有——这条线的静默失败模式跟那边不一样，
// 所以单开一份，两边不共用。
//
// ── 这条线真正会翻车的地方 ──
//
// 报错的都不可怕，跑一半崩了重跑就是（TTS 有缓存）。可怕的是**跑完了、
// 文件都在、但东西是错的**，而这些只有出片之后用眼睛/耳朵才发现：
//
//   ① **节拍全是「常规」** —— 稿子解析完不标注也能出片，出来是全程一个调。
//      E01 就是这么翻的一次，全片重来。这是本条线第一号静默失败
//   ② **说话人还挂着 needsReview** —— 那些段会按说书人念，
//      对白变成旁白，听感是"这人怎么自己跟自己说话"
//   ③ **场景图密度塌了** —— 某张图挂了三分钟。不报错，但观众看到的是一张静止图
//   ④ **场景段号超出稿件** —— 图排在音频结束之后，等于没有
//   ⑤ **封面数据缺一项** —— shuoshu-cover.ts 会炸，但要等到第五步才炸
//
// 所以体检**不看代码能不能跑，只看结果对不对**。ship 起手先跑这个。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { COMPOSITION_NAMES } from './shuoshu-scene.js';
import { MOTIFS, SERIES } from './shuoshu-cover.js';
import { BEAT_NAMES } from './shuoshu-beat.js';
import { CAST_NAMES } from './cast.js';
import { resolveEp } from './shuoshu-ep.js';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

/** 一张场景图最多挂多久。超过这个数观众就开始盯着一张静止画面发呆 */
const MAX_SCENE_SEC = 75;
/** 节拍标注的下限。E01 v2 是 74%，E02 是 70%，低于这个数基本等于没标 */
const MIN_ANNOTATED = 0.35;

export function preflightShuoshu(dir: string): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  // ── 稿件 ──
  const scriptPath = `${dir}/script.json`;
  if (!existsSync(scriptPath)) {
    err(`没有 script.json。先跑：npx tsx src/shuoshu-parse.ts <稿件.md>`);
    return out;
  }
  const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as {
    lines: { no: number; act: string; who?: string; beat?: string; needsReview?: boolean; text: string }[];
  };
  const lines = script.lines ?? [];
  if (!lines.length) return [{ level: 'error', msg: 'script.json 里一段都没有' }];

  const review = lines.filter((l) => l.needsReview);
  if (review.length) err(`${review.length} 段说话人还没确认（第 ${review.slice(0, 6).map((l) => l.no).join(' / ')}${review.length > 6 ? ' …' : ''} 段）`);

  const badBeat = lines.filter((l) => l.beat && !BEAT_NAMES.includes(l.beat));
  for (const l of badBeat) err(`第 ${l.no} 段的节拍「${l.beat}」不在节拍表里`);

  const badCast = lines.filter((l) => l.who && !CAST_NAMES.includes(l.who));
  for (const l of badCast) err(`第 ${l.no} 段的音色「${l.who}」不在选角表里`);

  // ① 头号静默失败：没标注也能出片，出来全程一个调
  const annotated = lines.filter((l) => l.beat && l.beat !== '常规').length / lines.length;
  if (annotated < MIN_ANNOTATED)
    err(
      `节拍基本没标：只有 ${(annotated * 100).toFixed(0)}% 的段落不是「常规」（下限 ${MIN_ANNOTATED * 100}%）。\n` +
        `      现在出片会是全程一个调子——E01 就是这么翻过一次，全片重来。`
    );

  // ── 场景 ──
  const scenesPath = `${dir}/scenes.json`;
  if (!existsSync(scenesPath)) {
    err(`没有 scenes.json`);
    return out;
  }
  const doc = JSON.parse(readFileSync(scenesPath, 'utf8')) as {
    cover?: Record<string, string>;
    scenes?: { no: number; comp: string; title: string }[];
  };
  const scenes = doc.scenes ?? [];
  if (!scenes.length) err('scenes.json 里一张图都没有');

  const maxNo = Math.max(...lines.map((l) => l.no));
  for (const s of scenes) {
    if (!COMPOSITION_NAMES.includes(s.comp)) err(`场景「${s.comp}」不存在。可用：${COMPOSITION_NAMES.join(' / ')}`);
    if (s.no > maxNo) err(`场景「${s.title}」挂在第 ${s.no} 段，但稿件只有 ${maxNo} 段——这张图排在音频结束之后`);
    if (!s.title?.trim()) err(`第 ${s.no} 段那张图没有题字`);
    if (s.title && s.title.length > 14) warn(`题字「${s.title}」${s.title.length} 字，超过 14 字会挤到画面外`);
  }
  const nos = scenes.map((s) => s.no);
  for (let i = 1; i < nos.length; i++)
    if (nos[i] <= nos[i - 1]) err(`场景段号不是递增的：第 ${nos[i - 1]} 段之后又出现第 ${nos[i]} 段`);

  // ── 封面 ──
  const cover = doc.cover;
  if (!cover) err('scenes.json 里没有 cover 那一段，封面出不来（而出片会因为找不到 cover.png 直接停）');
  else {
    for (const k of ['title', 'hook1', 'hook2', 'accent', 'seal', 'epLabel', 'motif'])
      if (!cover[k]) err(`封面缺 ${k}`);
    if (cover.motif && !MOTIFS[cover.motif]) err(`封面符号「${cover.motif}」不存在。可用：${Object.keys(MOTIFS).join(' / ')}`);
    if (cover.series && !SERIES[cover.series]) err(`书系「${cover.series}」不存在。可用：${Object.keys(SERIES).join(' / ')}`);
    if (cover.accent && cover.hook1 && cover.hook2 && !(cover.hook1 + cover.hook2).includes(cover.accent))
      warn(`强调字「${cover.accent}」在两句钩子里都找不到，等于没有强调色`);
    if (cover.title && ([...cover.title].length < 2 || [...cover.title].length > 6))
      warn(`篇名「${cover.title}」${[...cover.title].length} 字，字号表只覆盖 2–6 字`);
    // 微信那张显示出来只有 120–200px，篇名是全图唯一读得出的东西。
    // 五字以上在这个尺寸上糊成一竖条——横版还撑得住，方版撑不住
    if (cover.title && [...cover.title].length >= 5)
      warn(`篇名「${cover.title}」${[...cover.title].length} 字，微信 1:1 那张在 200px 上会糊。先看 cover/check-square-200.png`);
  }

  // ── 有音频之后才能查的：画面密度 ──
  const manifestPath = `${dir}/audio/全片.manifest.json`;
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { duration: number; cues: { no: number; start: number }[] };
    const startOf = (no: number) => m.cues.find((c) => c.no >= no)?.start ?? m.duration;
    for (let i = 0; i < scenes.length; i++) {
      const a = startOf(scenes[i].no);
      const b = i + 1 < scenes.length ? startOf(scenes[i + 1].no) : m.duration;
      if (b - a > MAX_SCENE_SEC)
        warn(`「${scenes[i].title}」要挂 ${(b - a).toFixed(0)} 秒（上限 ${MAX_SCENE_SEC}）——这一段观众盯着一张静止图`);
    }
    // 场景图数量对不上稿件长度也提一句
    const per = m.duration / scenes.length;
    if (per > 45) warn(`平均每张图 ${per.toFixed(0)} 秒，${scenes.length} 张撑 ${(m.duration / 60).toFixed(1)} 分钟偏少`);
  }

  return out;
}

function main() {
  const { id, dir } = resolveEp(process.argv.slice(2));
  const issues = preflightShuoshu(dir);
  const errors = issues.filter((i) => i.level === 'error');
  console.log(`《${id}》体检`);
  if (!issues.length) {
    console.log('  ✓ 没发现问题');
    return;
  }
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  console.log(`\n${errors.length} 个错 / ${issues.length - errors.length} 个提醒`);
  if (errors.length) process.exit(1);
}

if (process.argv[1]?.includes('shuoshu-preflight')) main();

// ── 整期音频：把两幕拼成一期，出 wav + 时间轴清单 ──────────────────────
//
// 用法：npx tsx src/zhiyu-episode.ts            上下两期都出
//       npx tsx src/zhiyu-episode.ts --part 上
//
// **不是把两条幕的 wav 首尾接起来。** 那样会有两处淡入淡出的音乐、
// 两次独立的响度归一、接缝处底噪相位跳变。整期必须重新拼一次：
//
//   两幕的段落连成一条 → 幕之间垫「幕末」2.2s → 全期一层底噪
//   → 一次后期链 → 一次响度归一 → **一条连续的音乐床**（只在片头淡入、片尾淡出）
//
// 顺带出 `<期>.manifest.json`：每一段的 start/end。
// 画面切点和字幕都从它来 —— 音频重出、时长变了，两边自动跟着走，不用重新对时。
// 这是从说书线搬的做法（`shuoshu-video.ts` 的注释里写了为什么）。

import { resolveEp, DEF } from './zhiyu-ep.js';
import { gate as gateXinli } from './xinli-check.js';
import { gate as gateZhiyu } from './zhiyu-check.js';
import { gate as gateChan } from './chan-check.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { zhengyin, report, type YinTable } from './zhengyin.js';
import { CASTS } from './cast.js';
import { getBeat } from './zhiyu-beat.js';
import { readWav, writeWav } from './audio/wav.js';
import { SR } from './config.js';
import {
  ff, dur, pinkNoise, master, bed, chainAndNormalize, mixBed, mmss, FADE_OUT, stripMarks, suspectMarks,
  loudness, mustHaveAudio, BGM_LUFS,
} from './zhiyu-audio.js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));
/**
 * 主讲音色。**线级缺省在 zhiyu-lines.ts，别在这儿写死。**
 *
 * 2026-08-26 加了期级覆盖：`发布.json` 里写 `"cast": "夜读男"` 就换这一期的主讲。
 *
 * ⚠ **为什么要期级、不能直接改线级**：治愈 / 心理 / 禅佛典**三条线共用「夜读」**
 * （禅佛典那条的注释写着「听众认的是这个声音」）。
 * 改线级等于一次动三条线上所有已出片的期 —— 那是连带影响，不是这次要做的事。
 *
 * ⚠ **换主讲不是换参数，是换人。** 同一条线上两期主讲不同，听众会当成两个节目。
 * 所以这个字段**每用一次都要想清楚**，别顺手抄给下一期
 * （跟 `免问号` 那个字段一个道理，见 发布.json 里那句）。
 */
const CAST: string = (() => {
  const f = `${PROJ}/发布.json`;
  if (!existsSync(f)) return DEF.cast;
  const over = (JSON.parse(readFileSync(f, 'utf8')) as { cast?: string }).cast;
  if (over && over !== DEF.cast) console.log(`  主讲：${over}（这一期覆盖了线级的「${DEF.cast}」）`);
  return over ?? DEF.cast;
})();

const argv = process.argv.slice(2);
const only = argv.indexOf('--part') >= 0 ? argv[argv.indexOf('--part') + 1] : null;

/** 一段话，或一个停顿点 */
type Block = { kind: 'say'; text: string; act: string } | { kind: 'beat' } | { kind: 'actEnd' };

/** 清单里的一条。`no` 是全期连续编号，画面和字幕都按它对齐 */
export interface Cue {
  no: number;
  act: string;
  text: string;
  start: number;
  end: number;
}

function loadAct(file: string, act: string): Block[] {
  const raw = readFileSync(file, 'utf8');
  const body = raw.split(/^---$/m).slice(1).join('---');
  return body
    .split(/\n\s*\n/)
    .map((p) =>
      p.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>')).join('')
    )
    .filter(Boolean)
    // **先认 ⏸ 再削记号。** 顺序反了 ⏸ 会被当成编辑记号削掉、然后被 filter 掉，
    // 结果是停顿点全部静默消失。跟 zhiyu-listen.ts 那份必须一致。
    .map((t): Block => (t === '⏸' ? { kind: 'beat' } : { kind: 'say', text: stripMarks(t), act }))
    .filter((b) => b.kind !== 'say' || b.text);
}

interface PubDoc {
  parts: { part: string; acts: string[]; epTitle: string }[];
  /** 床音。见 bedOf() */
  bed?: string | null;
  /** 本期正音表。见 zhengyin.ts —— Edge 会把小句开头的多音字读错 */
  正音?: YinTable;
}

/**
 * 床音：`发布.json` 顶层的 `bed` 字段。
 *
 *   缺省      → `musics/1.wav`（治愈线一直以来的行为，两期已出片的不受影响）
 *   `"空"`    → 不垫床，成片只有人声 + 底噪
 *   其它      → `musics/<值>.wav`
 *
 * 「空」这一档是心理洞察线要的（稿源 §主讲与音频：现象型用「空」）。
 * **不垫床不等于静音** —— 那一层 −62dBFS 的粉噪底噪照旧，
 * 它跟音乐床是两件事：底噪管的是「停顿里有没有房间」，
 * 音乐管的是「整条听下来有没有底」。把底噪也关掉，停顿会立刻露馅。
 */
function bedOf(doc: PubDoc): string | null {
  const v = doc.bed;
  if (v === undefined || v === null) return DEF.defaultBed;
  if (v === '空' || v === '') return null;
  // **带斜杠或带扩展名就当成路径**（相对仓库根），否则还是老规矩 musics/<名>.wav。
  // 2026-08-26 放开的：床音本来写死在 musics/ 且只认 .wav，
  // 可素材不一定放在那儿、也不一定是 wav（这一次给的是 voice/治愈系02.mp3）。
  // ffmpeg 那头本来就不挑格式，挑的是这一行。**老期一个字不用改**：
  // 不带斜杠不带扩展名的值走的还是原来那条路。
  const looksLikePath = v.includes('/') || v.includes('\\') || /\.[a-z0-9]{2,4}$/i.test(v);
  if (looksLikePath) return `../${v.replace(/^\.?[/\\]/, '')}`;
  return `../zhiyu/musics/${v}.wav`;
}

async function buildPart(p: PubDoc['parts'][number], bgm: string | null, doc: PubDoc) {
  const OUT = `${PROJ}/成片/${p.part}`;
  const TMP = `${OUT}/_tmp`;
  mkdirSync(TMP, { recursive: true });

  // ── 拼段落。幕与幕之间是「幕末」，不是普通段间 ──
  const blocks: Block[] = [];
  p.acts.forEach((a, i) => {
    if (i > 0) blocks.push({ kind: 'actEnd' });
    blocks.push(...loadAct(`${PROJ}/${a}.md`, a));
  });
  const says = blocks.filter((b): b is Extract<Block, { kind: 'say' }> => b.kind === 'say');
  const chars = says.reduce((s, b) => s + [...b.text.replace(/\s/g, '')].length, 0);
  console.log(`${p.part}篇《${p.epTitle}》　${p.acts.join(' + ')}`);
  console.log(`  ${says.length} 段 / ${chars} 字 / ${blocks.filter((b) => b.kind === 'beat').length} 个 ⏸\n`);

  // 削完还剩的可疑符号**只报不拦** —— 正文里偶尔真会用破折号省略号，
  // 但 ※ ▪ ★ 这类几乎一定是编辑记号，念出来就毁一段
  const odd = suspectMarks(says.map((b) => b.text));
  if (odd.length) {
    console.log(`⚠ ${odd.length} 段里还有可疑符号，确认不是编辑记号：`);
    for (const t of odd.slice(0, 5)) console.log(`    ${t.slice(0, 30)}`);
    console.log('');
  }

  // ── 合成。id 按期分，TTS 按内容哈希缓存，所以跟单幕试听共用同一批缓存 ──
  const id = `_zhiyu/${EP}-ep${p.part}`;
  // 正音：只换送给 TTS 的字，字幕和画面上的仍是原文。见 zhengyin.ts 顶上那段实测
  const yin = says.map((b) => zhengyin(b.text, doc.正音));
  const allHits = yin.flatMap((y) => y.hits);
  if (allHits.length) {
    console.log(`正音 ${allHits.length} 处（只改送给 TTS 的文本）：`);
    for (const l of report(allHits)) console.log(l);
    console.log('');
  }

  await synthesizeJoke({
    id,
    type: 'B',
    scene: 'abstract',
    characters: [{ id: '_', rig: 'none', side: 'left', cast: CAST }],
    lines: yin.map((y) => ({ who: '_', text: y.tts, beat: 'setup' as const })),
  });

  const GAP = getBeat('常规').pause;
  const BEAT = getBeat('停顿点').pause;
  const ACT_END = getBeat('幕末').pause;

  const parts = says.map((_, i) => readWav(`voice/${id}/${i + 1}-_.wav`).data);
  const speech = parts.reduce((s, x) => s + x.length, 0);

  // 先量总长，才好一次性铺底噪
  let pause = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'beat') pause += BEAT;
    else if (b.kind === 'actEnd') pause += ACT_END;
    else if (i < blocks.length - 1 && blocks[i + 1].kind === 'say') pause += GAP;
  }
  const HEAD = 0.5;
  const total = speech + Math.round((pause + 1) * SR);

  const mix = pinkNoise(total);
  const cues: Cue[] = [];
  let at = Math.round(HEAD * SR);
  let k = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.kind === 'beat') { at += Math.round(BEAT * SR); continue; }
    if (b.kind === 'actEnd') { at += Math.round(ACT_END * SR); continue; }
    const wav = parts[k];
    const start = at / SR;
    for (let j = 0; j < wav.length; j++) mix[at + j] += wav[j];
    at += wav.length;
    cues.push({ no: k + 1, act: b.act, text: b.text, start, end: at / SR });
    k++;
    if (i < blocks.length - 1 && blocks[i + 1].kind === 'say') at += Math.round(GAP * SR);
  }
  const rawFile = `${TMP}/raw.wav`;
  writeWav(rawFile, mix, SR);

  // ── 后期链 + 响度 + 一条连续的音乐床 ──
  const voice = `${TMP}/voice.wav`;
  const vl = chainAndNormalize(rawFile, voice, TMP);
  const length = dur(voice);
  if (length < FADE_OUT * 2) throw new Error(`这一期只有 ${length.toFixed(1)}s，比音乐淡出还短，八成是稿子没读进来`);

  const wav = `${OUT}/${p.part}篇.wav`;
  let l: { i: number; tp: number };
  if (bgm) {
    l = mixBed(voice, bed(master(bgm, length, TMP), length, `${TMP}/bed.wav`), wav);
  } else {
    // 不垫床：人声原样落盘。**响度还是要量一遍**，不能拿 chainAndNormalize
    // 的返回值顶替 —— 那是归一之前算的，写进 manifest 就是个假数。
    ff(['-i', voice, '-c:a', 'pcm_s16le', wav]);
    mustHaveAudio(wav);
    l = loudness(wav);
  }

  writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify(
      {
        part: p.part, epTitle: p.epTitle, acts: p.acts,
        duration: length, chars,
        beats: { 常规: GAP, 停顿点: BEAT, 幕末: ACT_END },
        loudness: { i: l.i, tp: l.tp, voiceOnly: vl.i },
        cues,
      },
      null,
      1
    )
  );
  rmSync(TMP, { recursive: true, force: true });

  // 幕与幕的分界，出片时要用（画面在这里换一次进度）
  const actStarts = p.acts.map((a) => cues.find((c) => c.act === a)!.start);
  console.log(`  → ${wav}`);
  console.log('     床音 ' + (bgm ? bgm.split('/').pop() + ' @ ' + BGM_LUFS + ' LUFS' : '空（只有人声 + 底噪）'));
  console.log(`     ${mmss(length)}　${l.i.toFixed(1)} LUFS / 真峰 ${l.tp.toFixed(1)} dBFS`);
  p.acts.forEach((a, i) => console.log(`     ${mmss(actStarts[i])}　${a}`));
  return { part: p.part, length, cues: cues.length };
}

async function main() {
  if (!CASTS[CAST]) throw new Error(`cast.ts 里没有「${CAST}」`);

  // ── 体检在最前面，拦在 TTS 之前 ──────────────────────────────────
  //
  // **顺序不能反。** TTS 是这条链上第一个花时间的步骤，稿子不合格的话
  // 后面音频、画面、成片全是白跑。E01 第一版就是渲完成片、拿 ffprobe
  // 量时长才发现稿子从落笔就不达标的（命名缺 35、展开缺 79）。
  //
  // 心理线先有这道闸。治愈线的体检是 zhiyu-check.ts，还没挂进来。
  if (DEF.check === 'zhiyu') {
    console.log(`《${BOOK}》稿件体检`);
    gateZhiyu();
    console.log('');
  }
  if (DEF.check === 'xinli' || DEF.check === 'chan') {
    const gate = DEF.check === 'xinli' ? gateXinli : gateChan;
    console.log(`《${BOOK}》稿件体检`);
    const doc0 = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;
    for (const p of doc0.parts) for (const a of p.acts) gate(PROJ, a);
    console.log('');
  }
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;
  const bgm = bedOf(doc);
  if (bgm && !existsSync(bgm)) throw new Error(`没有这个音乐：${bgm}`);
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    await buildPart(p, bgm, doc);
    console.log('');
  }
}

main();

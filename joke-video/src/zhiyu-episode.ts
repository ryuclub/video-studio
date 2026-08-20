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

import { resolveEp } from './zhiyu-ep.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { CASTS } from './cast.js';
import { getBeat } from './zhiyu-beat.js';
import { readWav, writeWav } from './audio/wav.js';
import { SR } from './config.js';
import {
  ff, dur, pinkNoise, master, bed, chainAndNormalize, mixBed, mmss, FADE_OUT, stripMarks, suspectMarks,
} from './zhiyu-audio.js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));
const CAST = '夜读';

const argv = process.argv.slice(2);
const only = argv.indexOf('--part') >= 0 ? argv[argv.indexOf('--part') + 1] : null;
const BGM_FILE = `../zhiyu/musics/1.wav`;

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
}

async function buildPart(p: PubDoc['parts'][number]) {
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
  await synthesizeJoke({
    id,
    type: 'B',
    scene: 'abstract',
    characters: [{ id: '_', rig: 'none', side: 'left', cast: CAST }],
    lines: says.map((b) => ({ who: '_', text: b.text, beat: 'setup' as const })),
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

  const bedFile = bed(master(BGM_FILE, length, TMP), length, `${TMP}/bed.wav`);
  const wav = `${OUT}/${p.part}篇.wav`;
  const l = mixBed(voice, bedFile, wav);

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
  console.log(`     ${mmss(length)}　${l.i.toFixed(1)} LUFS / 真峰 ${l.tp.toFixed(1)} dBFS`);
  p.acts.forEach((a, i) => console.log(`     ${mmss(actStarts[i])}　${a}`));
  return { part: p.part, length, cues: cues.length };
}

async function main() {
  if (!CASTS[CAST]) throw new Error(`cast.ts 里没有「${CAST}」`);
  if (!existsSync(BGM_FILE)) throw new Error(`没有这个音乐：${BGM_FILE}`);
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    await buildPart(p);
    console.log('');
  }
}

main();

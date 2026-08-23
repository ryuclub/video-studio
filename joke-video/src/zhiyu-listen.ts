// ── 治愈线试听件：正片稿 + 定稿音色 + 背景音乐床 ──────────────────────
//
// 用法：npx tsx src/zhiyu-listen.ts [--text 幕一-三米见方.md] [--bgm 1] [--gap 1.25 --beat 1.6]
//
// 跟 zhiyu-sample.ts / zhiyu-ab.ts 的区别：那两个是**选音色**的（多条候选、
// 一次只动一个变量）。音色已经定稿，它们的候选 cast 也已经按纪律从 cast.ts
// 删掉了，现在跑会报错。这个脚本只有一条音色，变量换成了**稿子和音乐**。
//
// 音色定稿参数见 zhiyu/治愈系出片方案.md 第二节：
//   cast「夜读」 pitch 0.83 / formant 0.83 / 朗读速度不动
//   后期 highshelf 8kHz −3dB → 窄压缩 2:1 → 响度 −21 LUFS
//   deesser 和 aecho 都是**排除掉的弯路**，别再加回来。
//
// 停顿分两级。**数值不是幕表里那组**：幕表按选题稿件写的是段间 1.25s、⏸ 处
// 2.5–3.5s，第一版试听（v1）就是那么出的，反馈是「⏸ 处停得太久」。
// 底噪那一层是有用的（v1 干声在停顿处实测 −61.5dB，是房间声不是死寂），
// 但它只解决了「停顿像不像卡带」，没解决「停顿该多长」。
//
// 挨批的**只有 ⏸ 那一级**，v2 把段间也一起收了，收过头。见下面 PAUSES 的注释。
// 现在的值是**听出来的**，不是规范里抄的。改之前先看 listen/说明.md。

import {
  ff, dur, loudness, mustHaveAudio, pinkNoise, master, bed, mmss,
  ROOM_TONE_DBFS, SPEECH_LUFS, BGM_LUFS, FADE_IN, FADE_OUT, CHAIN,
  stripMarks, suspectMarks,
} from './zhiyu-audio.js';
import { resolveEp, DEF } from './zhiyu-ep.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { synthesizeJoke } from './tts.js';
import { zhengyin, report, type YinTable } from './zhengyin.js';
import { CASTS } from './cast.js';
import { getBeat } from './zhiyu-beat.js';
import { readWav, writeWav } from './audio/wav.js';
import { measure } from './audio/measure.js';
import { SR } from './config.js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
/**
 * 床音。**不写 `--bgm` 就跟成片同源**（`zhiyu-lines.ts` 的 `defaultBed`）。
 *
 * 原来这儿硬写 `1.wav` 当缺省 —— 治愈线碰巧就是它，所以一直没露馅；
 * 心理和禅佛典的缺省早就不是它了，**试听过了的调性和成片不是一回事**，
 * 正是这个文件和 `zhiyu-audio.ts` 开头都在防的那件事。
 */
const BGM_FILE = argv.includes('--bgm') ? `../zhiyu/musics/${arg('bgm', '1')}.wav` : DEF.defaultBed;
const TEXT = arg('text', '幕一-三米见方.md');
const TEXT_FILE = `${PROJ}/${TEXT}`;
/**
 * **一份稿子一个目录。** 早先所有稿子都往 listen/ 根上写，换稿会把上一条
 * 试听件连同它的说明一起盖掉 —— 而通过了的那条正是最不能丢的东西
 * （调性和节奏的判断都挂在它身上）。
 */
const NAME = TEXT.replace(/\.md$/, '');
const OUT = `${PROJ}/listen/${NAME}`;
const TMP = `${OUT}/_tmp`;

/** 主讲音色。**唯一出处是 zhiyu-lines.ts** —— 抄一份就会跟成片分叉 */
const CAST = DEF.cast;

// 底噪电平、后期链、响度目标、音乐床 —— **全部从 zhiyu-audio.ts 来**。
// 这里一度各留了一份，结果整期出片改到 −40 之后，试听件还在 −42：
// **试听件和成片变成了两个声音**，而这种不一致要等有人戴耳机对比才发现。
// 那正是那个公用件存在的理由，别再往这儿抄常量。

/**
 * 停顿档位。`gap` 是段与段之间，`beat` 是 ⏸ 处。
 *
 * **默认这一档已经定稿，数值在 zhiyu-beat.ts，不在这里** —— 那张表是全线的
 * 唯一出处，改停顿要去改它，别在这儿加常量。三轮试听的账也写在那个文件顶上。
 *
 * `--gap`/`--beat` 是给下一轮 A/B 用的：给了就在默认档之外**再多出一条**，
 * 人声要重拼但 TTS 有缓存，多出一档很便宜。听完就把参数丢掉，别写死回来。
 */
const PAUSES: { tag: string; gap: number; beat: number }[] = [
  { tag: '', gap: getBeat('常规').pause, beat: getBeat('停顿点').pause },
];
if (argv.includes('--gap') || argv.includes('--beat')) {
  const gap = Number(arg('gap', String(PAUSES[0].gap)));
  const beat = Number(arg('beat', String(PAUSES[0].beat)));
  PAUSES.push({ tag: `（${gap}-${beat}）`, gap, beat });
}

/**
 * 把稿子读成「段落 + 停顿点」。
 * 空行分段（markdown 里单个换行是折行不是分段，所以段内要拼起来，中文不加空格）；
 * 单独一行的 ⏸ 是停顿点，不念；段首的编辑记号由 `stripMarks` 削掉，也不念。
 *
 * **跟 zhiyu-episode.ts 的那份必须一致** —— 试听件和成片读出来的段落不一样，
 * 等于试听白听。哪天再多一个解析规则，两边一起改。
 */
type Block = { kind: 'say'; text: string } | { kind: 'beat' };
function loadScript(file: string): Block[] {
  const raw = readFileSync(file, 'utf8');
  const body = raw.split(/^---$/m).slice(1).join('---');
  return body
    .split(/\n\s*\n/)
    .map((p) =>
      p.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>')).join('')
    )
    .filter(Boolean)
    // **先认 ⏸ 再削记号。** 顺序反了 ⏸ 自己就会被当成编辑记号削掉 ——
    // 削完是空段，再被 filter 掉，结果是**停顿点全部静默消失**，
    // 日志只显示「0 个停顿点」，音频短一截而没有任何报错。这是踩过的。
    .map((t): Block => (t === '⏸' ? { kind: 'beat' } : { kind: 'say', text: stripMarks(t) }))
    .filter((b) => b.kind === 'beat' || b.text);
}

async function main() {
  if (!CASTS[CAST]) throw new Error(`cast.ts 里没有「${CAST}」`);
  if (!existsSync(BGM_FILE)) throw new Error(`没有这个音乐：${BGM_FILE}`);
  mkdirSync(TMP, { recursive: true });

  // 试听不读 发布.json（它只要一幕），但正音表在那儿 ——
  // **不读的话试听和成片会是两个读音**，而这正是 zhiyu-audio.ts 顶上警告过的那类分叉。
  const PUB = `${PROJ}/发布.json`;
  const doc = existsSync(PUB) ? (JSON.parse(readFileSync(PUB, 'utf8')) as { 正音?: YinTable }) : {};

  const blocks = loadScript(TEXT_FILE);
  const says = blocks.filter((b): b is { kind: 'say'; text: string } => b.kind === 'say');
  const chars = says.reduce((s, b) => s + [...b.text.replace(/\s/g, '')].length, 0);
  console.log(`${TEXT_FILE}\n  ${says.length} 段 / ${chars} 字 / ${blocks.length - says.length} 个停顿点\n`);

  // 削完还剩的可疑符号**只报不拦** —— 正文里偶尔真会用破折号省略号，
  // 但 ※ ▪ ★ 这类几乎一定是编辑记号，念出来就毁一段
  const odd = suspectMarks(says.map((b) => b.text));
  if (odd.length) {
    console.log(`⚠ ${odd.length} 段里还有可疑符号，确认不是编辑记号：`);
    for (const t of odd.slice(0, 5)) console.log(`    ${t.slice(0, 30)}`);
    console.log('');
  }

  // ── 合成 ──
  const id = `_zhiyu/${EP}-${NAME}`;
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

  const parts = says.map((_, i) => readWav(`voice/${id}/${i + 1}-_.wav`).data);
  const speech = parts.reduce((s, p) => s + p.length, 0);

  // 母床按最松的一档估长度，各档从它上面裁
  const longest = Math.max(...PAUSES.map((p) => p.gap * blocks.length + p.beat * blocks.length));
  const src = master(BGM_FILE, speech / SR + longest + 2, TMP);

  const made: { tag: string; gap: number; beat: number; name: string; len: number; i: number; tp: number }[] = [];
  for (const [n, P] of PAUSES.entries()) {
    // ── 拼接：段间 gap，⏸ 处 beat，全程垫底噪 ──
    let gapTotal = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind === 'beat') gapTotal += P.beat;
      else if (i < blocks.length - 1 && blocks[i + 1].kind !== 'beat') gapTotal += P.gap;
    }
    const total = speech + Math.round(gapTotal * SR) + SR; // 首尾各留半秒
    const mix = pinkNoise(total);
    let at = Math.round(SR / 2), k = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind === 'beat') {
        at += Math.round(P.beat * SR);
        continue;
      }
      const p = parts[k++];
      for (let j = 0; j < p.length; j++) mix[at + j] += p[j];
      at += p.length;
      if (i < blocks.length - 1 && blocks[i + 1].kind !== 'beat') at += Math.round(P.gap * SR);
    }
    writeWav(`${TMP}/raw.wav`, mix, SR);

    // ── 后期链 + 响度归一。测了再加固定增益，不用 ffmpeg 的 loudnorm 滤镜 ──
    const voice = `${OUT}/人声-无音乐${P.tag}.wav`;
    ff([
      '-i', `${TMP}/raw.wav`,
      '-af', 'highshelf=f=8000:g=-3,acompressor=ratio=2:attack=30:release=200',
      '-ar', String(SR), '-ac', '1', `${TMP}/chain.wav`,
    ]);
    const pre = loudness(`${TMP}/chain.wav`);
    ff([
      '-i', `${TMP}/chain.wav`,
      '-af', `volume=${(SPEECH_LUFS - pre.i).toFixed(2)}dB`,
      '-ar', String(SR), '-ac', '1', voice,
    ]);
    mustHaveAudio(voice);
    const length = dur(voice);

    // ── 混音乐 ──
    const bedFile = bed(src, length, `${TMP}/bed${P.tag || '-main'}.wav`);
    const bl = loudness(bedFile);
    const name = `试听-${NAME}${P.tag}.wav`;
    ff([
      '-i', voice, '-i', bedFile,
      '-filter_complex',
        `[0:a]aformat=channel_layouts=stereo[v];[1:a]volume=${(BGM_LUFS - bl.i).toFixed(2)}dB[m];` +
        `[v][m]amix=inputs=2:duration=first:normalize=0[a]`,
      '-map', '[a]', '-ar', String(SR), `${OUT}/${name}`,
    ]);
    mustHaveAudio(`${OUT}/${name}`);
    const l = loudness(`${OUT}/${name}`);
    made.push({ tag: P.tag || '主版', gap: P.gap, beat: P.beat, name, len: length, i: l.i, tp: l.tp });
    console.log(
      `  ${n + 1}. 段间 ${P.gap}s / ⏸ ${P.beat}s → ${Math.floor(length / 60)}:${String(Math.round(length % 60)).padStart(2, '0')}　` +
        `${l.i.toFixed(1)} LUFS / 真峰 ${l.tp.toFixed(1)} dBFS`
    );
  }

  // ── 指标测在纯人声上（不含底噪和停顿），否则底噪把基频统计带偏 ──
  const dry = new Float32Array(speech);
  let z = 0;
  for (const p of parts) { dry.set(p, z); z += p.length; }
  const m = measure(dry, SR);
  const spoken = speech / SR;
  const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
  const main = made[0];

  writeFileSync(
    `${OUT}/说明.md`,
    `# 《方丈记》· 幕一试听件

稿子是 [../../${TEXT}](../../${TEXT})，${says.length} 段 / ${chars} 字。
音色是定稿的 \`${CAST}\`，参数和后期链从 v1 起一个字没动 —— 四轮改的都只是停顿。
音色的来历和排除掉的六条弯路在
[zhiyu/治愈系出片方案.md](../../../../../zhiyu/治愈系出片方案.md) 第二节。

## 停顿：已定稿

| | 段间 | ⏸ 处 | 片长 | 反馈 |
|---|---|---|---|---|
| v1 | 1.25s | 3.0s | 4:23 | ⏸ 处停得太久 |
| v2 | 0.6s | 1.6s | 3:43 | 太紧 |
| **v3** | **1.25s** | **1.6s** | **4:13** | **✅ 定稿** |

v2 是收过头了：**挨批的只有 ⏸ 那一级**，段间不该跟着一起动。

定稿的数值现在住在 [\`joke-video/src/zhiyu-beat.ts\`](../../../../../joke-video/src/zhiyu-beat.ts)，
**那张表是全线唯一的出处**，要改停顿改它，别在试听脚本里加常量。
音乐档同样已定：**${BGM_LUFS} LUFS**（v1 三档里选的），比人声低 ${Math.abs(BGM_LUFS - SPEECH_LUFS)} LU。

## 这一版的文件

| 文件 | 段间 | ⏸ 处 | 片长 | 成片响度 |
|---|---|---|---|---|
${made.map((x) => `| \`${x.name}\` | ${x.gap}s | ${x.beat}s | ${mmss(x.len)} | ${x.i.toFixed(1)} LUFS |`).join('\n')}

\`人声-无音乐*.wav\` 是垫在底下的干声，判**稿子调性**用它（没有音乐干扰）。
${
  made.length > 1
    ? `\n多出来的那条是 \`--gap\`/\`--beat\` 传出来的 A/B 档。**听完把参数丢掉**，
别写死回 zhiyu-beat.ts —— 除非它真的赢了定稿那条。\n`
    : ''
}

## 停顿这一档的来历

选题稿件给治愈档定的是段间 0.8–1.2s、**⏸ 处 2.5–3.5s、硬切 4.0s**，
理由写在方案文档第一节：垫了房间底噪之后，长停顿才不像卡带。

**底噪那一层是成立的** —— v1 干声在停顿处实测 −61.5dB，是房间声不是死寂。
但它只解决了「停顿像不像卡带」，没解决「停顿该多长」。
说书线当年也从 1.2–2.2s 压到 1.0 以内，反馈同样是「停多了」。
规范里那组数字站不住，现在这组是听出来的。

## 音乐

\`${BGM_FILE.split('/').pop()}\`，${BGM_LUFS} LUFS，比人声低 ${Math.abs(BGM_LUFS - SPEECH_LUFS)} LU。
三条素材里挑它的理由是量出来的：

| | 时长 | LRA（起伏） | 4kHz 以上 | 首尾电平 |
|---|---|---|---|---|
| **1.wav** | 10.3s | **0.6 LU** | −52.4 dB | −18.0 / −17.9 |
| 2.wav | 36.0s | 6.8 LU | −55.1 dB | −31.5 / −17.3 |
| The Enchanted Castle | 13.0s | 2.4 LU | −48.0 dB | −19.2 / −17.3 |

LRA 0.6 说明它几乎没有起伏，是条持续的 pad —— **不会在人声底下冒头**，
这正是助眠档要的。首尾电平又对齐，本来就是给循环用的。
2.wav 带淡入（首尾差 14dB），硬接会爆音，而且 6.8 LU 的涨落在深夜档会把人拽醒；
Enchanted Castle 的 1kHz 那一档最厚，正好是人声的地盘。

床是**自己跟自己交叉淡化、翻倍**接出来的（不是 \`-stream_loop\`，那个会在接缝爆音），
淡入 ${FADE_IN}s、淡出 ${FADE_OUT}s。母床只接一次，两档停顿从同一条上裁 ——
停顿一改片长就变，重接一遍是白费。

## 链路

\`\`\`
Edge 合成 → 变声(pitch ${CASTS[CAST].morph.pitch} / formant ${CASTS[CAST].morph.formant})
→ 按段拼接（段间 ${PAUSES[0].gap}s，⏸ 处 ${PAUSES[0].beat}s）+ ${ROOM_TONE_DBFS}dBFS 粉噪底噪
→ highshelf 8kHz −3dB → 窄压缩 2:1 (30ms/200ms)
→ 响度归一 ${SPEECH_LUFS} LUFS
→ 混入音乐床（人声居中，音乐保留立体声）
\`\`\`

底噪那一层照旧留着 —— 停顿虽然短了，TTS 插的仍是绝对静音（实测 −227dB），
现实里没有这种东西。输出是立体声：稿件要求「戴耳机暗房听」，
音乐的宽度在耳机上才有意义。

## 实测

| | |
|---|---|
| 基频 | ${m.f0} Hz |
| 半音标准差 | ${m.f0Sd}（目标 1.5–2.5，见方案文档「一条没解决的」） |
| 说话速度 | ${((chars / spoken) * 60).toFixed(0)} 字/分 |
| 含停顿均速（主版） | ${((chars / main.len) * 60).toFixed(0)} 字/分 |
| 成片响度 | ${main.i.toFixed(1)} LUFS / 真峰 ${main.tp.toFixed(1)} dBFS |

**含停顿均速**是反推字数配额的那个数：按 ${((chars / main.len) * 60).toFixed(0)} 字/分，
20 分钟 ≈ **${Math.round(((chars / main.len) * 60 * 20) / 100) * 100} 字**，
22 分钟 ≈ ${Math.round(((chars / main.len) * 60 * 22) / 100) * 100} 字。
交付是每期两幕、20 分钟上下，详见 [../../幕表.md](../../幕表.md)。

⏸ 的密度是 **每 ${(chars / (blocks.length - says.length)).toFixed(0)} 字 / ${(main.len / (blocks.length - says.length)).toFixed(0)} 秒一个**。
幕表原来写「每 3–4 分钟一个」，那是按稿件的 ⏸ 长达 2.5–3.5 秒定的 ——
⏸ 收到 1.6 秒之后它不再是「硬切」而是换气，密一点反而自然。
这个密度跟通过了的那条样章一致（35 秒），是照着它写的。
`
  );

  console.log(`\n${made.length * 2} 个文件 → ${OUT}/`);
  console.log(`先听：${main.name}`);
}

main();

// ── 「悬」这一停到底留多久：出几个长度让耳朵挑 ──────────────────────
//
// 用法：npx tsx src/shuoshu-pause.ts
//
// A/B 试听里「他看见」后面留了 2.2s，反馈是"有明显的停留空白，不太好"。
// 与其我猜一个数再来回改，不如把同一段渲成几个长度并排听 —— 合成有缓存，
// 变的只是插进去的静音长度，出三版几秒钟的事。
//
// 顺带验证一个猜想：**问题可能不在长度，在"死寂"。**
// 真人停两秒，听众能听到他换气、听到现场；我们插的是绝对的零。
// 所以最后一版在停顿里垫了极低的房间底噪（−48dB 的粉噪），长度不变，
// 听听是不是就不"空"了。

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { readWav, resample, writeWav } from './audio/wav.js';
import { trimSilence } from './audio/align.js';
import { normalize, softClip } from './audio/dsp.js';
import { SR, PEAK_DBFS } from './config.js';

const OUT_DIR = '../shuoshu/projects/2026-08-18_liaozhai-E01/ab-test';

/** 幕二那段的后半，直接切到关键处，不用每次听前面 20 秒 */
const BEATS = [
  { text: '王生凑过去，往里看。', delivery: '叙缓', gain: 0.72, tag: '扣子' },
  { text: '他看见', delivery: '叙缓', gain: 0.7, tag: '悬' },
  { text: '屋里坐着一个鬼。', delivery: '叙平', gain: 1.08, tag: '揭底' },
];

/** 房间底噪：极低电平的粉噪，让停顿不是绝对的零 */
function roomTone(n: number, level: number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  // 固定种子的线性同余，保证每次跑出来一样（不用 Math.random，结果要可复现）
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  for (let i = 0; i < n; i++) {
    const w = rand();
    // 三级一阶低通叠加 ≈ 粉噪，比白噪听着自然
    b0 = 0.99765 * b0 + w * 0.099;
    b1 = 0.963 * b1 + w * 0.2965;
    b2 = 0.57 * b2 + w * 1.0526;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * level;
  }
  return out;
}

async function render(name: string, holdPause: number, hookPause: number, tone: boolean) {
  const parts: Float32Array[] = [];
  const pauses = [hookPause, holdPause, 0.8];

  for (const [i, b] of BEATS.entries()) {
    const id = `_pause/${i}`;
    await synthesizeJoke({
      id,
      type: 'B',
      scene: 'abstract',
      pace: 'bedtime',
      characters: [{ id: '_', rig: 'none', side: 'left', cast: '说书人' }],
      lines: [{ who: '_', text: b.text, beat: 'setup', delivery: b.delivery }],
    });
    const p = `voice/${id}/1-_.wav`;
    if (!existsSync(p)) throw new Error(`合成失败：${p}`);
    const raw = resample(readWav(p), SR);
    const tr = trimSilence(raw, SR);
    const body = raw.slice(tr.start, tr.end);
    const scaled = new Float32Array(body.length);
    for (let k = 0; k < body.length; k++) scaled[k] = body[k] * b.gain;
    parts.push(scaled);

    const n = Math.round(pauses[i] * SR);
    // 底噪版：停顿里垫 −48dB 的粉噪，长度一个字没变
    parts.push(tone ? roomTone(n, 0.004) : new Float32Array(n));
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  writeWav(`${OUT_DIR}/${name}.wav`, normalize(softClip(out), PEAK_DBFS), SR);
  return out.length / SR;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // 悬固定在 1.4（上一轮定的），这一轮只变扣子。
  //
  // 反馈"往里看和他看见之间还是停多了"。实测 A 版这里是 0.64s，B 版 1.28s，正好两倍。
  // 但真正的问题可能是**连着两个大停**：一句三个字的话，前后各挂一个一秒半的空白，
  // 2.76 秒静音夹着 3 个字。说书的扣子应该只有一个 —— 正常、正常、停住、揭开。
  const V = [
    { name: '扣子-0.6秒', hook: 0.6, hold: 1.4, tone: false },
    { name: '扣子-0.9秒', hook: 0.9, hold: 1.4, tone: false },
    { name: '扣子-1.2秒-当前', hook: 1.2, hold: 1.4, tone: false },
  ];
  const rows: string[] = [];
  for (const v of V) {
    const d = await render(v.name, v.hold, v.hook, v.tone);
    rows.push(`| ${v.name} | ${v.hook}s | ${v.hold}s | ${v.tone ? '有（−48dB 粉噪）' : '无（绝对静音）'} | ${d.toFixed(1)}s |`);
    console.log(`  ${v.name}.wav　${d.toFixed(1)}s`);
  }

  writeFileSync(
    `${OUT_DIR}/停顿选型.md`,
    `# 「往里看 → 他看见」之间留多久

只截了幕二的后三句（凑过去 → 他看见 → 屋里坐着一个鬼），不用每次听前面 20 秒。
**三版只有第一处停顿不同**，配音本身和「悬」都完全一样。

| 版本 | 扣子（往里看之后） | 悬（他看见之后） | 停顿里 | 时长 |
|---|---|---|---|---|
${rows.join('\n')}

参照：**A 版这里是 0.64s**，B 版当前 1.28s，正好两倍。

## 为什么怀疑问题不在单个值

看 B 版最后 5 秒的空白分布：

\`\`\`
往里看 →〈停 1.28s〉→ 他看见 →〈停 1.48s〉→ 屋里坐着一个鬼
\`\`\`

一句三个字的话，前后各挂一个一秒半的停顿 —— **2.76 秒静音夹着 3 个字**。

说书的扣子应该**只有一个**：正常 → 正常 → 停住 → 揭开。
连着两个大停不是吊胃口，是卡壳。而真正该停的是「他看见」之后那一刻，
前面那个是多余的。所以这一轮把悬锁死在 1.4，只往下收扣子。

## 还没试的那条路

TTS 的停顿是**绝对静音**（实测 −227dB，现实里不存在的东西）。
真人停两秒，听众听得到换气和现场；我们插的是虚无，所以同样长度会读成"卡住了"。

如果收到 0.6 还是觉得空，那就不是长度问题 —— 我把 −48dB 的房间底噪接进正式混音，
那是全局的，165 段的停顿都受益，而且长停可以放回去，张力不必为了"不空"而牺牲。

## 选完之后

告诉我哪一版，我改 \`src/shuoshu-beat.ts\` 里 \`扣子\` 那一个数（只出现一次），
全片跟着变。
`
  );
  console.log(`\n→ shuoshu/projects/2026-08-18_liaozhai-E01/ab-test/`);
}

main();

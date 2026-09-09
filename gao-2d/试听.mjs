#!/usr/bin/env node
/* ===========================================================================
   gao-2d/试听.mjs — 用 Edge TTS 出一版**试听**人声（方案 §5.2 附）

   用法（cwd 一律是仓库根）：
     node gao-2d/试听.mjs uk_potholes
     node gao-2d/试听.mjs uk_potholes --voice en-GB-ThomasNeural
     node gao-2d/试听.mjs uk_potholes --rate -10%

   段文本从 工作表.md §3 那个代码块读（`01  Ninety-seven years.` 这种行），
   产物落到 projects/高总/<slug>/audio/_试听/ ，跟 ElevenLabs 的正片原件
   `audio/段/` **分开放**，免得混。

   ── 这不是成品 ──

   正片走 ElevenLabs v3 英式 RP 男声（方案 §5.1）。这儿只是拿免费的 Edge TTS
   听个节奏、量个语速，用来回答两件事：
     · 稿子实际多长 —— §4.1 按「30 秒」写，v5 说那是错的，实际要 55–60 秒
     · 段内那 7 处 ‖（3.2s）引擎到底给不给停顿（§5.2 那笔账）
   花钱之前先听一遍，比生成完再返工便宜。

   ⚠ Edge TTS 的语速跟 ElevenLabs speed=0.9 不是一回事，量出来的数**只能当参考**，
     不能直接写进方案。要定稿的数字得等真音频。
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const argv = process.argv.slice(2);
const SLUG = argv.find((a) => !a.startsWith('--'));
const 取 = (名, 默认) => (argv.includes(名) ? argv[argv.indexOf(名) + 1] : 默认);
/* 英式 RP 男声，播报底子 —— Edge 这边最接近 §5.1 要求的就是 Ryan */
const VOICE = 取('--voice', 'en-GB-RyanNeural');
const RATE = 取('--rate', '+0%');

if (!SLUG) { console.error('用法：node gao-2d/试听.mjs <slug> [--voice X] [--rate ±N%]'); process.exit(1); }

const 稿件 = path.join('gao-2d/稿件', SLUG);
const 工作 = path.join('projects/高总', SLUG);
const 出目录 = path.join(工作, 'audio/_试听');

const 清单 = path.join(稿件, '分句.mjs');
const 工作表 = path.join(稿件, '工作表.md');
for (const f of [清单, 工作表]) if (!fs.existsSync(f)) { console.error(`没有 ${f}`); process.exit(1); }
const cfg = (await import(pathToFileURL(path.resolve(清单)).href)).default;

/* ---- 段文本：从工作表 §3 的代码块里捞 ---------------------------------- */
const md = fs.readFileSync(工作表, 'utf8');
const 第三节 = md.split(/^##\s*3\./m)[1]?.split(/^##\s*4\./m)[0] ?? '';
const 文本 = new Map();
for (const m of 第三节.matchAll(/^\s*(\d{2})\s{2,}(.+?)\s*$/gm)) 文本.set(m[1], m[2]);

if (文本.size !== cfg.segments.length) {
  console.error(`工作表 §3 捞到 ${文本.size} 段，分句清单是 ${cfg.segments.length} 段 —— 对不上，先修工作表`);
  process.exit(1);
}

/* ---- 生成 --------------------------------------------------------------
   仓库 src/steps/tts.ts 踩过的坑：长连接跑一阵之后服务端会把它掐掉，之后
   toStream **不报错、只返回空流**（写出 0 字节）。所以空音频要当「连接死了」
   处理，重新握手再来，而不是判定音色名非法。九段不多，但照样得防。 */
let 客户端 = null;
async function 握手() {
  const t = new MsEdgeTTS();
  await t.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  return t;
}
async function 一次(text, out) {
  客户端 ??= await 握手();
  const { audioStream } = 客户端.toStream(text, { rate: RATE });
  await new Promise((res, rej) => {
    const w = fs.createWriteStream(out);
    audioStream.pipe(w);
    w.on('finish', res); w.on('error', rej); audioStream.on('error', rej);
  });
  if (fs.statSync(out).size === 0) { 客户端 = null; throw new Error('返回空音频'); }
}
async function 合成(text, out) {
  for (let i = 1; ; i++) {
    try { await 一次(text, out); return; }
    catch (e) { if (i >= 3) throw e; 客户端 = null; console.log(`    第 ${i} 次失败（${e.message}），重握手…`); }
  }
}

const 时长 = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  if (!isFinite(d)) throw new Error(`读不出时长：${f}`);
  return d;
};

fs.rmSync(出目录, { recursive: true, force: true });
fs.mkdirSync(出目录, { recursive: true });

console.log(`\n${SLUG}　试听版　音色 ${VOICE}　语速 ${RATE}\n` + '-'.repeat(78));
const rows = [];
for (const s of cfg.segments) {
  // 只取**前导**数字：'01.mp3' 全局去非数字会变成 '013'，把扩展名里的 3 也算进来
  const 号 = (s.file.match(/^(\d+)/)?.[1] ?? '').padStart(2, '0');
  const txt = 文本.get(号);
  if (!txt) { console.error(`\n工作表 §3 里没有第 ${号} 段的文本`); process.exit(1); }
  const out = path.join(出目录, s.file.replace(/\.\w+$/, '.mp3'));
  process.stdout.write(`  ${号} 合成中…`);
  await 合成(txt, out);
  const d = 时长(out);
  const 词 = txt.split(/\s+/).filter(Boolean).length;
  rows.push({ 号, 词, d, pause: s.pauseAfter ?? 0, txt });
  console.log(`\r  ${号}  ${d.toFixed(2)}s  ${词} 词  ${(词 / d).toFixed(2)} 词/秒   ${txt.slice(0, 44)}`);
}

const 和 = (f) => +rows.reduce((a, r) => a + f(r), 0).toFixed(2);
const 语音 = 和((r) => r.d), 停顿 = 和((r) => r.pause), 词数 = 和((r) => r.词);
console.log('-'.repeat(78));
console.log(`语音 ${语音}s ＋ 段末停顿 ${停顿}s ＝ **${(语音 + 停顿).toFixed(2)}s**`);
console.log(`共 ${词数} 词，净语速 ${(词数 / 语音).toFixed(2)} 词/秒`);
console.log(`\n→ 段音频在 ${出目录}`);
console.log(`→ 拼成一条试听轨：node gao-2d/配音.mjs ${SLUG} --试听`);
console.log(`\n⚠ 这是 Edge TTS，不是 ElevenLabs。语速只能当参考，定稿数字要等真音频。`);

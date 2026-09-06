#!/usr/bin/env node
/**
 * tts-match —— 配音试配台
 *
 * 拿一份稿子逐行过 Edge TTS，量出每行真实时长，报出总长和实测语速。
 * 用来在正式出片之前把「稿子多长 / 语速多少 / 时间轴对不对」这三件事定死，
 * 而不是靠字数估。
 *
 *   node tts-match.mjs --file 稿子.txt --pick zh-CN-YunjianNeural --rate +20% --pitch -10Hz
 *
 * 稿子一行一段，空行和 # 开头的行跳过。
 * 输出：out/<name>/seg1.mp3 … + manifest.json（时间轴，可直接喂给出片脚本）
 *
 * 常用参数
 *   --file    稿件路径（必填）
 *   --pick    音色，默认 zh-CN-YunjianNeural（云健·浑厚，主讲员）
 *   --rate    语速，Edge 语法：+20% / -4% / 默认 -4%
 *   --pitch   音高，Edge 语法：-10Hz / +5% / 默认不改
 *   --out     输出目录，默认 out/tts-match
 *   --target  期望总长（秒），给了就报偏差
 *   --dry     只算不合成（拿上次的 manifest 重算时间轴）
 *   --配音    配音层 JSON（见下）。给了它就**不能**再给 --pick/--rate/--pitch
 *
 * ## 配音层：送给 TTS 的文本 ≠ 屏幕上的文本
 *
 * 稿子是**观众看到的**那份 —— 它同时是字幕的源（出片脚本直接拿 `segments[].text` 上屏）。
 * 所以「念的时候在这儿停一下」「这个字念成那个音」**不能写进稿子**，写进去就上屏了。
 * 这些写在配音层里，只改送给 TTS 的那一份。
 *
 *   {
 *     "音色": "zh-CN-YunxiNeural", "语速": "+6%", "音高": null,
 *     "逐句": {
 *       "4": { "停": [["一套", 0.4]], "音": [["量", "良"]], "重": ["贵一点"] }
 *     }
 *   }
 *
 * | 字段 | 干什么 | 谁消费 |
 * |---|---|---|
 * | `停` | 在某个词后面加个停顿。**给秒数就挑最接近的标点**，也可以直接写标点 | TTS |
 * | `音` | 同音字替身（多音字念错时用）。⚠ 必须**完全同音、且替身本身不是多音字** | TTS |
 * | `重` | 哪几个词该重读 | **没人消费，以后也不会有** —— 后续走的是克隆音，同样是 TTS、同样没有重音控制 |
 *
 * ⚠ **停顿只能靠标点。** `<break>` 和 `<mstts:express-as>` 在 Edge 这个端点上是**被拒**的
 * （2026-09-06 实测：连接直接断在 `Stream closed before the synthesis completed`，
 * 不是「不生效」而是「合不出来」）。Azure Speech Service 那个订阅端点支持，但我们不在那上面。
 * 所以配音层存的是**意图**（停多久），落地方式按端点来 —— 哪天换 Azure，同一份 JSON 出真 SSML。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const exec = promisify(execFile);

/* ---------- 参数 ---------- */
function argv(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const FILE = argv('file');
// ⚠ 这三个给了 --配音 之后会被配音层覆盖，所以是 let
let VOICE = argv('pick', 'zh-CN-YunjianNeural');
let RATE = argv('rate', '-4%');
let PITCH = argv('pitch', null);
const OUTDIR = argv('out', 'out/tts-match');
const TARGET = argv('target', null);
const DRY = argv('dry', false);
const PLAN_FILE = argv('配音', null);

if (!FILE) {
  console.error('要给 --file 稿件路径。跑 `node tts-match.mjs` 看用法。');
  process.exit(1);
}

/* ---------- 稿件 ---------- */
const lines = fs
  .readFileSync(FILE, 'utf8')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));

if (!lines.length) {
  console.error('稿件里没有可用行。一行一段，空行和 # 开头的会跳过。');
  process.exit(1);
}

const hanzi = (s) => [...s].filter((c) => /[一-龥]/.test(c)).length;

/* ---------- 配音层 ---------- */

/**
 * **标点值多少秒**（2026-09-06 实测，音色 `zh-CN-YunxiNeural`、rate `+6%`）。
 * 同一句话只换中间那个标点，量出来的净增：
 *
 * ⚠ **换音色或换语速要重量。** 这张表是那一组参数下的数，不是普适常数。
 * ⚠ **省略号比逗号还短**（0.29 < 0.38），这条反直觉，别照「视觉上更长」猜。
 * ⚠ 停顿长短只是一半 —— 句号会把语调收下去、问号会挑上去。**要的是停顿就别用句号问号**。
 */
const 标点值 = [
  ['……', 0.29], ['、', 0.38], ['，', 0.38], ['——', 0.38],
  ['：', 0.41], ['；', 0.50], ['。', 0.79], ['！', 0.79], ['？', 0.91],
];

/** 稿子里出现 `<` 就当场停 —— 有人把 SSML 写进稿子了，那玩意会**原样烧进字幕** */
function 查标签(lines) {
  const 中 = lines.filter((l) => l.includes('<'));
  if (!中.length) return;
  console.error('稿子里有 `<` —— 看着像 SSML：');
  中.slice(0, 3).forEach((l) => console.error('  ' + l));
  console.error('');
  console.error('  **稿子是观众看到的那份，它同时是字幕的源** —— 标签会原样烧进画面。');
  console.error('  停顿／正音／重音写到配音层里（--配音 配音.json），那份只改送给 TTS 的文本。');
  console.error('  另外：<break> 和 <mstts:express-as> 在 Edge 这个端点上是被拒的，合不出来。');
  process.exit(1);
}

/** 把一行稿子变成「念的那一份」。屏上那份原样不动 */
function 念法(行, 条) {
  if (!条) return 行;
  let 念 = 行;
  for (const [原, 替] of 条.音 || []) {
    if (!念.includes(原)) { console.error(`配音层：这句里没有「${原}」，替不了 —— ${行}`); process.exit(1); }
    念 = 念.split(原).join(替);
  }
  for (const [词, 停] of 条.停 || []) {
    if (!念.includes(词)) { console.error(`配音层：这句里没有「${词}」，停不了 —— ${行}`); process.exit(1); }
    let 点 = 停;
    if (typeof 停 === 'number') {
      // 给秒数就挑最接近的标点。**挑完要打出来** —— 粒度只有九档，别让人以为是连续的
      点 = 标点值.reduce((a, b) => (Math.abs(b[1] - 停) < Math.abs(a[1] - 停) ? b : a))[0];
      console.log(`      停 ${停}s → 「${点}」(${标点值.find((x) => x[0] === 点)[1]}s)　在「${词}」后`);
    } else if (!标点值.some((x) => x[0] === 点)) {
      console.error(`配音层：「${点}」不在量过的标点表里。只能用 ${标点值.map((x) => x[0]).join(' ')}`);
      process.exit(1);
    }
    念 = 念.replace(词, 词 + 点);
  }
  return 念;
}

查标签(lines);

let PLAN = null;
if (PLAN_FILE) {
  if (process.argv.includes('--pick') || process.argv.includes('--rate') || process.argv.includes('--pitch')) {
    console.error('给了 --配音 就别再给 --pick/--rate/--pitch —— 两个地方说了算，迟早对不上。');
    console.error('  参数写在配音层里，命令行只给 --配音。');
    process.exit(1);
  }
  PLAN = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  if (!PLAN.音色 || !PLAN.语速) { console.error(`${PLAN_FILE} 里要有「音色」和「语速」`); process.exit(1); }
  VOICE = PLAN.音色; RATE = PLAN.语速; PITCH = PLAN.音高 || null;
  // 逐句的键是句号，越界了多半是稿子改过而配音层没跟着改 —— 那是会静默走偏的
  for (const k of Object.keys(PLAN.逐句 || {})) {
    if (!(+k >= 1 && +k <= lines.length)) {
      console.error(`配音层写了第 ${k} 句，但稿子只有 ${lines.length} 句 —— 稿子改了配音层没跟上？`);
      process.exit(1);
    }
  }
}

/* ---------- 合成 ---------- */
fs.mkdirSync(OUTDIR, { recursive: true });

async function durationSec(f) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * 长连接跑几十行之后服务端会掐掉，之后 toStream 安静地返回空流 —— 不报错，
 * 只写出 0 字节。所以空音频要当成「连接死了」处理，重新握手再来。
 * 这个坑仓库的 src/steps/tts.ts 里已经踩过，这里照抄它的处理。
 */
let client = null;
async function tts(text, outFile) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (!client) {
        client = new MsEdgeTTS();
        await client.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      }
      const prosody = { rate: RATE };
      if (PITCH) prosody.pitch = PITCH;
      const { audioStream } = client.toStream(text, prosody);
      await new Promise((res, rej) => {
        const w = fs.createWriteStream(outFile);
        audioStream.pipe(w);
        w.on('finish', res);
        w.on('error', rej);
        audioStream.on('error', rej);
      });
      if (fs.statSync(outFile).size === 0) throw new Error('返回空音频');
      return;
    } catch (e) {
      client = null;
      if (attempt >= 3) throw e;
    }
  }
}

console.log(`稿件 ${FILE}　${lines.length} 段`);
console.log(`音色 ${VOICE}　rate ${RATE}${PITCH ? `　pitch ${PITCH}` : ''}\n`);

const segs = [];
let t0 = 0;
let 改了 = 0;
for (let i = 0; i < lines.length; i++) {
  const file = path.join(OUTDIR, `seg${i + 1}.mp3`);
  const 条 = PLAN?.逐句?.[String(i + 1)];
  if (条?.停?.some((x) => typeof x[1] === 'number')) console.log(`  第 ${i + 1} 句`);
  const 念 = 念法(lines[i], 条);
  // ⚠ **合成喂的是「念」，manifest 的 text 仍旧是屏上那份** —— 字幕读的是 text
  if (!DRY) await tts(念, file);
  const dur = await durationSec(file);
  const seg = {
    index: i + 1, text: lines[i], file: file.replace(/\\/g, '/'),
    chars: hanzi(lines[i]), start: +t0.toFixed(3), duration: +dur.toFixed(3),
    end: +(t0 + dur).toFixed(3),
  };
  if (念 !== lines[i]) { seg.念 = 念; 改了++; }
  segs.push(seg);
  t0 += dur;
}
if (PLAN) {
  const 重 = Object.entries(PLAN.逐句 || {}).filter(([, v]) => v.重?.length);
  console.log(`
配音层 ${PLAN_FILE}　${改了} 句的念法跟屏上不一样`);
  if (重.length) {
    console.log(`⚠ 「重」这一栏有 ${重.length} 句，**现在没人消费** —— Edge 做不了重音。`);
    console.log('   写稿时的备忘而已 —— 想标重音就说明那句该改结构。');
  }
}

/* ---------- 报表 ---------- */
const total = t0;
const chars = segs.reduce((a, s) => a + s.chars, 0);
const cpm = (chars / total) * 60;

console.log('段   字数     时长        起—止           节选');
for (const s of segs) {
  const head = [...s.text].slice(0, 14).join('') + ([...s.text].length > 14 ? '…' : '');
  console.log(
    ` ${String(s.index).padStart(2)}  ${String(s.chars).padStart(4)}  ` +
    `${(s.duration.toFixed(2) + 's').padStart(7)}  ` +
    `${(s.start.toFixed(2) + '–' + s.end.toFixed(2)).padStart(14)}   ${head}`,
  );
}
console.log(`\n合计 ${total.toFixed(2)}s　汉字 ${chars}　实测语速 ${cpm.toFixed(0)} 字/分`);

if (TARGET) {
  const t = parseFloat(TARGET);
  const d = total - t;
  console.log(
    `目标 ${t}s　偏差 ${(d > 0 ? '+' : '') + d.toFixed(2)}s　` +
    `压到目标需 ${((chars / t) * 60).toFixed(0)} 字/分，或砍到 ${Math.round(chars * (t / total))} 字`,
  );
}

const manifest = {
  script: FILE, 配音层: PLAN_FILE || null,
  voice: VOICE, rate: RATE, pitch: PITCH || null,
  total: +total.toFixed(3), chars, cpm: +cpm.toFixed(1),
  generatedAt: new Date().toISOString(), segments: segs,
};
const mf = path.join(OUTDIR, 'manifest.json');
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
console.log(`\n音频 ${OUTDIR}/seg*.mp3\n时间轴 ${mf.replace(/\\/g, '/')}`);

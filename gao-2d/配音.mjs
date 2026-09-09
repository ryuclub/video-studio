#!/usr/bin/env node
/* ===========================================================================
   gao-2d/配音.mjs — 逐段 TTS → 一条人声轨（出片方案 §5.2）

   用法（cwd 一律是仓库根）：
     node gao-2d/配音.mjs uk_potholes --check   只核对分句与工作表，不碰音频
     node gao-2d/配音.mjs uk_potholes --dry     量时长、算时间轴，不合成
     node gao-2d/配音.mjs uk_potholes           合成人声轨

   分句清单 gao-2d/稿件/<slug>/分句.mjs
   段音频   projects/高总/<slug>/audio/段/01.mp3 … 09.mp3   （ElevenLabs 逐段导出）
   成品     projects/高总/<slug>/audio/<slug>_voice.wav

   做四件事：
     1. **核对**分句清单跟工作表对不对得上（见 核对() —— 这一步是新加的）
     2. 按顺序拼接，段间硬插纯静音（48kHz 单声道 PCM）
     3. 双遍 loudnorm 归一到 −16 LUFS（先测再套，比单遍准）
     4. 回吐每段的**实测**起止时间码，并跟 时间表.mjs 里的预填值比总长

   第 4 件是这个脚本存在的理由：方案 §7.2 规定时间码从音频来，工作表 §5 那一列
   是按语速估的。不跑这一步，预填值会一路带到成片里。

   ── 跟交接过来的 assemble_voice.mjs 的四处不同（理由见方案 §16）──
     · 配置按 slug 找，不再手写 audio/<slug>.segments.mjs 路径 —— 跟 build.mjs 一致。
     · 目录按仓库通例两分：配置在 gao-2d/稿件/，产物在 projects/高总/。
     · sh() **失败就抛**。原稿是 `spawnSync(...)` 不看返回值，ffmpeg 挂了照样
       往下走，最后 concat 拿到的是上一次的旧段子 —— build.mjs 犯过同一个错。
     · 新增 核对()：分句清单的 pauseAfter 只覆盖**段末**的停顿标记，段内那些
       没有任何机制实现。原稿和方案都说「按 ‖ 插静音」，实际做不到。闸装在这儿，
       因为这是能改它的最便宜的那个表示。
   =========================================================================== */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SR = 48000;
const 停顿符 = String.fromCharCode(0x2016);   // ‖ —— 写码点，免得被终端编码吃掉

const argv = process.argv.slice(2);
const SLUG = argv.find((a) => !a.startsWith('--'));
const CHECK = argv.includes('--check');
const DRY = argv.includes('--dry');
/** 拿 试听.mjs 出的 Edge TTS 段子拼，产物另存，不覆盖正片。听节奏用，不是成品 */
const 试听 = argv.includes('--试听');

if (!SLUG) { console.error('用法：node gao-2d/配音.mjs <slug> [--check|--dry]'); process.exit(1); }

const 稿件 = path.join('gao-2d/稿件', SLUG);
const 工作 = path.join('projects/高总', SLUG);
const 清单 = path.join(稿件, '分句.mjs');
if (!fs.existsSync(清单)) { console.error(`没有分句清单：${清单}`); process.exit(1); }
const cfg = (await import(pathToFileURL(path.resolve(清单)).href)).default;

const TMP = path.join(工作, 试听 ? '_tmp/voice-试听' : '_tmp/voice');
const 段目录 = path.join(工作, 试听 ? 'audio/_试听' : (cfg.dir ?? 'audio/段'));
const 出 = path.join(工作, 试听 ? 'audio/_试听_voice.wav' : (cfg.out ?? `audio/${SLUG}_voice.wav`));
const TARGET = cfg.targetLUFS ?? -16;

const ensure = (d) => fs.mkdirSync(d, { recursive: true });
const 重建 = (d) => { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); };
const r3 = (n) => Math.round(n * 1000) / 1000;
const 和 = (a) => r3(a.reduce((x, y) => x + y, 0));

/** 跑外部命令，**失败就停**。理由见头部第三条。 */
const sh = (c, a) => {
  const r = spawnSync(c, a, { stdio: 'inherit' });
  if (r.error) throw new Error(`跑不起来 ${c}：${r.error.message}\n  （PATH 里有它吗？）`);
  const code = r.status > 0x7fffffff ? r.status - 0x100000000 : r.status;
  if (code !== 0) throw new Error(`${c} 退出码 ${code}，报错在上面。命令是：\n  ${c} ${a.join(' ')}`);
};
/** 取输出的那种，同样不许静默失败 */
const run = (c, a) => {
  const r = spawnSync(c, a, { encoding: 'utf8' });
  if (r.error) throw new Error(`跑不起来 ${c}：${r.error.message}`);
  return r;
};

function 时长(file) {
  const p = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat((p.stdout || '').trim());
  if (!isFinite(d)) throw new Error(`读不出时长：${file}\n${p.stderr}`);
  return d;
}

/* ---- 核对：分句清单 vs 工作表 vs 时间表 -------------------------------- */
/**
 * 三样东西必须自洽，任何一处对不上，出来的片子都是错的而且不报错：
 *   分句.mjs 的 out   ←→  时间表.mjs 的 audio     对不上 build 找不到音频
 *   分句.mjs 的段数   ←→  工作表 §3 的段数        对不上就是漏段或多段
 *   分句.mjs 的停顿   ←→  工作表 §2 的 ‖ 标记      差额落在段内，没机制实现
 */
function 核对() {
  const 硬伤 = [], 提醒 = [];

  /* ① out 跟时间表的 audio 对不对得上 */
  const 表 = path.join(稿件, '时间表.mjs');
  let 总长 = null;
  if (fs.existsSync(表)) {
    const t = fs.readFileSync(表, 'utf8');
    const m = t.match(/audio:\s*'([^']+)'/);
    const 我的 = (cfg.out ?? `audio/${SLUG}_voice.wav`).replace(/\\/g, '/');
    /* 试听版本来就不该跟时间表的 audio 一致 —— 它是另存的，不参与出片 */
    if (!试听 && m && m[1] !== 我的)
      硬伤.push(`分句清单出到 ${我的}，时间表却写 audio: '${m[1]}' —— build.mjs 会找不到`);
    const ends = [...t.matchAll(/end:\s*([0-9.]+)/g)].map((x) => +x[1]);
    if (ends.length) 总长 = Math.max(...ends);
  } else 提醒.push(`没有 ${表}，跳过时间码比对`);

  /* ② 段数：工作表 §3 那个代码块里 `01 …` `02 …` 的行数 */
  const 工作表 = path.join(稿件, '工作表.md');
  let 停顿全部 = [];
  if (fs.existsSync(工作表)) {
    const md = fs.readFileSync(工作表, 'utf8');
    /* 只在 §3 那一节里找，别扫全文 —— §5 六列时间表里也有形似的行 */
    const 第三节 = md.split(/^##\s*3\./m)[1]?.split(/^##\s*4\./m)[0] ?? '';
    const 表文 = new Map();
    for (const x of 第三节.matchAll(/^\s*(\d{2})\s{2,}(.+?)\s*$/gm)) 表文.set(x[1], x[2]);

    if (表文.size && 表文.size !== cfg.segments.length)
      硬伤.push(`工作表 §3 是 ${表文.size} 段，分句清单是 ${cfg.segments.length} 段`);

    /* 文本漂移：分句清单的 text 是给机器读的，工作表 §3 是给人看的，两份必须一致。
       改稿只改了一边是最容易犯的错，而且不报错 —— 出来的音频跟稿子对不上。
       比对时忽略首尾空白和连续空格，其余一字不差。 */
    const 规整 = (s) => s.replace(/\s+/g, ' ').trim();
    for (const s of cfg.segments) {
      const 号 = (s.file.match(/^(\d+)/)?.[1] ?? '').padStart(2, '0');
      const 表 = 表文.get(号);
      if (!表) { if (表文.size) 硬伤.push(`工作表 §3 里没有第 ${号} 段`); continue; }
      if (!s.text) { 硬伤.push(`分句清单第 ${号} 段没有 text，出声.mjs 生成不了`); continue; }
      if (规整(表) !== 规整(s.text))
        硬伤.push(`第 ${号} 段文本两处不一致：\n      工作表  ${表}\n      分句清单 ${s.text}`);
    }

    /* ③ 停顿：§2 稿面里的 ‖ 标记。§5 六列时间表会重复一遍同样的值，去重靠取前一半 */
    const 全 = [...md.matchAll(new RegExp(停顿符 + '\\s*([0-9.]+)', 'g'))].map((x) => +x[1]);
    停顿全部 = 全.length && 全.length % 2 === 0
      && String(全.slice(0, 全.length / 2)) === String(全.slice(全.length / 2))
      ? 全.slice(0, 全.length / 2) : 全;
  } else 提醒.push(`没有 ${工作表}，跳过停顿比对`);

  const 段末 = cfg.segments.map((s) => s.pauseAfter ?? 0);
  if (停顿全部.length) {
    const 差 = r3(和(停顿全部) - 和(段末));
    const 处 = 停顿全部.length - 段末.filter((v) => v > 0).length;
    if (差 > 0.05)
      提醒.push(`稿面有 ${停顿全部.length} 处停顿标记合计 ${和(停顿全部)}s，`
        + `分句清单只实现了段末的 ${和(段末)}s —— **段内 ${处} 处、${差}s 没有任何机制实现**，`
        + `只能指望引擎从句号里读出来。要么把这些点也切成独立段，要么把稿面的数值去掉别承诺它`);
  }

  return { 硬伤, 提醒, 总长, 停顿: 和(段末) };
}

const r = 核对();
console.log(`\n${SLUG}　${cfg.segments.length} 段　目标 ${TARGET} LUFS\n` + '-'.repeat(72));
if (r.提醒.length) console.log('提醒\n' + r.提醒.map((m) => '  · ' + m).join('\n') + '\n');
if (r.硬伤.length) {
  console.log('待解决\n' + r.硬伤.map((m) => '  · ' + m).join('\n') + '\n');
  process.exit(1);
}
if (!r.提醒.length) console.log('分句清单跟工作表、时间表对得上。\n');
if (CHECK) process.exit(0);

/* ---- 段音频在不在 ------------------------------------------------------ */
const segs = cfg.segments.map((s, i) => ({ ...s, idx: i + 1, path: path.join(段目录, s.file) }));
const 缺 = segs.filter((s) => !fs.existsSync(s.path));
if (缺.length) {
  console.error(`缺段音频（${段目录}）：\n` + 缺.map((s) => '  · ' + s.file).join('\n'));
  console.error('\n先按工作表 §3 的九段文本逐段过 ElevenLabs，导出成 01.mp3 … 命名放进去。');
  process.exit(1);
}

/* ---- 修剪首尾静音 ------------------------------------------------------
 *
 * **这一步不能省，省了每处停顿都会比稿面多出近一秒。**
 *
 * TTS 逐段生成时，每一段都自带引子和收尾的静音 —— Kokoro `bm_george` 实测
 * 首 0.27s、尾 0.55s，合计 0.82s/段。不修剪就直接拼的话，段间实际间隔是
 *
 *     上一段尾静音 0.55 ＋ pauseAfter ＋ 下一段首静音 0.27  ＝  pauseAfter + 0.82s
 *
 * 稿面写 1.2s，听到的是 2.02s。段数越多错得越多：16 段白送 13.14s。
 * 修剪之后 pauseAfter 是段间间隔的**唯一**来源，稿面写多少就是多少。
 *
 * 留 KEEP 这一点点余量，是因为齐着波形切会削掉爆破音的起始瞬态（p / t / k
 * 那一下），听感是「字被咬掉半个」。30ms 听不出来，又够护住起音。
 */
const 阈值 = cfg.trimThreshold ?? '-45dB';
const KEEP = cfg.trimKeep ?? 0.03;
const 修剪 = (cfg.trim ?? true)
  ? [`silenceremove=start_periods=1:start_duration=0:start_silence=${KEEP}:start_threshold=${阈值}:detection=peak`,
     'areverse',
     `silenceremove=start_periods=1:start_duration=0:start_silence=${KEEP}:start_threshold=${阈值}:detection=peak`,
     'areverse'].join(',')
  : null;

重建(TMP);                       // 先清空 —— 上一次段数更多的话，旧的 c*.wav 会留在这儿
for (const s of segs) {
  s.裁 = path.join(TMP, 'c' + String(s.idx).padStart(2, '0') + '.wav');
  const 前 = ['-y', '-v', 'error', '-i', s.path];
  const 后 = ['-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', s.裁];
  sh('ffmpeg', 修剪 ? 前.concat(['-af', 修剪], 后) : 前.concat(后));
  s.原时长 = 时长(s.path);
  s.净时长 = 时长(s.裁);
}
const 剪掉 = r3(和(segs.map((s) => s.原时长 - s.净时长)));

/* ---- 量时长、算时间轴 --------------------------------------------------
 * 用**修剪后**的时长算。拿原始时长算出来的时间码，跟成品对不上。 */
let t = 0;
const rows = [];
for (const s of segs) {
  const d = s.净时长;
  const pause = s.pauseAfter ?? 0;
  rows.push({ ...s, start: r3(t), speech: r3(d), pause, end: r3(t + d + pause) });
  t += d + pause;
}
const 总 = r3(t);

console.log('段   起点     语音     停顿     终点   文件');
for (const x of rows)
  console.log(`${String(x.idx).padStart(2)}  ${String(x.start).padStart(6)}  ${String(x.speech).padStart(6)}`
    + `  ${String(x.pause).padStart(6)}  ${String(x.end).padStart(6)}   ${x.file}`);
console.log('-'.repeat(72));
console.log(`总长 ${总}s（净语音 ${和(rows.map((x) => x.speech))}s ＋ 停顿 ${和(rows.map((x) => x.pause))}s）`);
if (修剪)
  console.log(`修剪首尾静音共 ${剪掉}s（${segs.length} 段，平均 ${r3(剪掉 / segs.length)}s/段）`
    + ` —— 不剪的话这些会叠进段间间隔，每处停顿都比稿面长`);

/* 跟时间表的预填值比总长 —— 这是「时间码从音频来」那条规矩的落点 */
if (r.总长 != null) {
  const 漂 = r3(总 - r.总长);
  console.log(`时间表预填 ${r.总长}s，实测 ${总}s，差 ${漂 > 0 ? '+' : ''}${漂}s`
    + (Math.abs(漂) > 1 ? '　⚠ 差得不小，时间表那一列要按下面重排' : '　（在 1s 内，可接受）'));
}

console.log('\n实测时间码（层与素材自己填；一段音频配两个画面块就拆成两行，拆点落在句号处）：\n');
for (const x of rows)
  console.log(`  { id: ${x.idx}, start: ${x.start.toFixed(1)}, end: ${x.end.toFixed(1)}, layer: '?' },  /* ${x.file} */`);
console.log('');

if (DRY) process.exit(0);

/* ---- 合成 --------------------------------------------------------------
 * 直接用上面修剪好的 c*.wav —— 别再从 s.path 转一遍，那样修剪就白做了，
 * 而且时间码是按修剪后算的，两边会对不上。 */
const parts = [];
segs.forEach((s, i) => {
  parts.push(s.裁);
  const pause = s.pauseAfter ?? 0;
  if (pause > 0) {
    const g = path.join(TMP, `g${String(i + 1).padStart(2, '0')}.wav`);
    sh('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=mono`,
      '-t', String(pause), '-c:a', 'pcm_s16le', g]);
    parts.push(g);
  }
});

const list = path.join(TMP, 'concat.txt');
fs.writeFileSync(list, parts.map((p) => `file '${path.resolve(p).replace(/\\/g, '/')}'`).join('\n') + '\n');
const raw = path.join(TMP, 'raw.wav');
sh('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', raw]);

/* 双遍 loudnorm：先测一遍拿到实际值，再套进去。单遍是盲的，会偏 1–2 LUFS */
console.log('测量响度…');
const m = run('ffmpeg', ['-hide_banner', '-i', raw,
  '-af', `loudnorm=I=${TARGET}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']);
const json = (m.stderr.match(/\{[\s\S]*?\}/) || [])[0];
if (!json) console.log('⚠ loudnorm 测量没读到 JSON，退回单遍归一（会偏，但不会错到离谱）');
const af = json ? (() => {
  const d = JSON.parse(json);
  return `loudnorm=I=${TARGET}:TP=-1.5:LRA=11:measured_I=${d.input_i}:measured_TP=${d.input_tp}`
    + `:measured_LRA=${d.input_lra}:measured_thresh=${d.input_thresh}`
    + `:offset=${d.target_offset}:linear=true`;
})() : `loudnorm=I=${TARGET}:TP=-1.5:LRA=11`;

ensure(path.dirname(出));
sh('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', af, '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', 出]);

const 实 = r3(时长(出));
console.log(`\n完成 -> ${出}`);
console.log(`时长 ${实}s，目标响度 ${TARGET} LUFS`);
if (Math.abs(实 - 总) > 0.15)
  console.log(`⚠ 与预估差 ${r3(实 - 总)}s —— loudnorm 可能改了时长，时间码以这条实际的为准`);
console.log('\n下一步：把上面那张时间码填回 时间表.mjs，再跑 node gao-2d/build.mjs ' + SLUG + ' --check');

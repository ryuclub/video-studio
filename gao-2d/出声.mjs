#!/usr/bin/env node
/* ===========================================================================
   gao-2d/出声.mjs — 用 Kokoro 在本地批量生成分段人声（出片方案 §5.2）

   用法（cwd 一律是仓库根）：
     node gao-2d/出声.mjs --音色                列出全部音色，英式男声单独拎出来
     node gao-2d/出声.mjs --试音                一句话跑遍英式男声，挑一个
     node gao-2d/出声.mjs uk_potholes           按 分句.mjs 批量出 01.wav…09.wav
     node gao-2d/出声.mjs uk_potholes --only 7  只重出第 7 段

   分句清单 gao-2d/稿件/<slug>/分句.mjs   （text / voice / speed 都在里面）
   段音频   projects/高总/<slug>/audio/段/01.wav…
   试音     projects/高总/_试音/<音色>.wav      全频道共用，不属于某一条稿

   出来的 wav 交给 配音.mjs 拼接、插静音、归一化、回吐时间码。

   ── 跟交接过来的 tts_kokoro.mjs 的四处不同（理由见方案 §16）──
     · **`list_voices()` 返回 void，不是数组。** 原稿 `const voices = tts.list_voices()`
       拿到 undefined，接着 `Object.keys(undefined)` 直接抛。正确的是 `tts.voices`
       这个 getter。这条不改根本跑不起来。
     · 英式男声按**元数据**（language 'en-gb' ＋ gender 'Male'）筛，不只看 `bm_` 前缀 ——
       前缀是命名约定，元数据才是事实。
     · 配置按 slug 找，产物按仓库通例代码／产物两分。
     · 每段落盘后**当场量时长和词速**并汇总。方案 §4.1 的「30 秒」是个待修正的错误
       （v5 §16 一），这个数得靠实测攒出来，顺手就量了。
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { KokoroTTS } from 'kokoro-js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = 'q8';      // fp32 / fp16 / q8 / q4 / q4f16 —— q8 体积小且几乎无损
const DEVICE = 'cpu';    // Node 下只有 cpu

/* 试音句：同时考数字读法、口音、慢速下的停顿感 */
const 试音句 = 'If yours was done today, the next one is due in twenty one twenty-three.';

const argv = process.argv.slice(2);
const SLUG = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const 列音色 = argv.includes('--音色');
const 试音 = argv.includes('--试音');
const ONLY = argv.includes('--only') ? Number(argv[argv.indexOf('--only') + 1]) : null;

if (!SLUG && !列音色 && !试音) {
  console.error('用法：node gao-2d/出声.mjs <slug> [--only N] | --音色 | --试音');
  process.exit(1);
}

const 时长 = (f) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  const d = parseFloat((r.stdout || '').trim());
  return isFinite(d) ? d : NaN;
};

console.log(`加载模型 ${MODEL}（${DTYPE} / ${DEVICE}）…首次运行要下权重，之后走本地缓存。`);
const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: DEVICE });

/* ⚠ list_voices() 是 `(): void`，只往 stdout 打印。要拿数据得用 voices getter。 */
const 音色表 = tts.voices;
const 全部 = Object.keys(音色表);
/**
 * 英式男声：按元数据筛，不只信 bm_ 前缀。
 * ⚠ gender 要**整串**匹配 —— `/male/i` 会把 "Female" 也匹配上（里面就含 male），
 *   四个 bf_ 女声因此混进来过。
 */
const 英男 = 全部.filter((k) => {
  const v = 音色表[k] ?? {};
  return /gb|british/i.test(v.language ?? '') && /^\s*male\s*$/i.test(v.gender ?? '');
});

/* ---- 列音色 ------------------------------------------------------------ */
if (列音色) {
  console.log(`\n共 ${全部.length} 个音色。命名约定：af_/am_ = 美式女/男，bf_/bm_ = 英式女/男。\n`);
  console.log(`本频道要的是英式男声（方案 §5.1：英式 RP 男声 35–50 岁，播报底子）：\n`);
  for (const k of 英男) {
    const v = 音色表[k];
    console.log(`  ${k.padEnd(12)} ${(v.name ?? '').padEnd(10)} ${v.language ?? ''}  `
      + `质量 ${v.targetQuality ?? '?'} / 总评 ${v.overallGrade ?? '?'}${v.traits ? '  ' + v.traits : ''}`);
  }
  console.log(`\n其余 ${全部.length - 英男.length} 个：`);
  console.log('  ' + 全部.filter((k) => !英男.includes(k)).join(' '));
  console.log('\n下一步：node gao-2d/出声.mjs --试音　把上面这几个英式男声各念一句，听着挑。\n');
  process.exit(0);
}

/* ---- 试音 -------------------------------------------------------------- */
if (试音) {
  if (!英男.length) { console.error('没筛出英式男声，先跑 --音色 看看实际的元数据。'); process.exit(1); }
  const 目录 = 'projects/高总/_试音';
  fs.mkdirSync(目录, { recursive: true });
  console.log(`\n试音句：${试音句}\n`);
  for (const v of 英男) {
    const out = path.join(目录, `${v}.wav`);
    const a = await tts.generate(试音句, { voice: v, speed: 0.9 });
    await a.save(out);
    const d = 时长(out);
    console.log(`  ${v.padEnd(12)} ${d.toFixed(2)}s   ${out}`);
  }
  console.log('\n三样一起听：数字读法对不对（twenty one twenty-three）、是不是英式、慢速下的停顿感。');
  console.log('选定之后写进 稿件/<slug>/分句.mjs 的 voice 字段。\n');
  process.exit(0);
}

/* ---- 批量生成 ---------------------------------------------------------- */
const 稿件 = path.join('gao-2d/稿件', SLUG);
const 工作 = path.join('projects/高总', SLUG);
const 清单 = path.join(稿件, '分句.mjs');
if (!fs.existsSync(清单)) { console.error(`没有分句清单：${清单}`); process.exit(1); }
const cfg = (await import(pathToFileURL(path.resolve(清单)).href)).default;

const voice = cfg.voice;
const speed = cfg.speed ?? 0.9;
if (!voice) { console.error('分句清单里没有 voice 字段。先跑 --试音 选一个。'); process.exit(1); }
if (!全部.includes(voice)) {
  console.error(`音色 ${voice} 不在列表里。可选的英式男声：${英男.join(' ')}`);
  process.exit(1);
}
const 缺文本 = cfg.segments.filter((s) => !s.text);
if (缺文本.length) {
  console.error('这些段没有 text，没法生成：\n' + 缺文本.map((s) => '  · ' + s.file).join('\n'));
  process.exit(1);
}

const 段目录 = path.join(工作, cfg.dir ?? 'audio/段');
fs.mkdirSync(段目录, { recursive: true });

const 要出 = ONLY
  ? cfg.segments.filter((s) => Number(s.file.match(/^(\d+)/)?.[1]) === ONLY)
  : cfg.segments;
if (ONLY && !要出.length) { console.error(`没有第 ${ONLY} 段`); process.exit(1); }

console.log(`\n${SLUG}　音色 ${voice}　速度 ${speed}　${要出.length} 段\n` + '-'.repeat(76));
const rows = [];
for (const s of 要出) {
  /* 分句清单里若还写着 .mp3（v1 遗留），落盘一律改成 .wav —— Kokoro 出的是 PCM */
  const out = path.join(段目录, s.file.replace(/\.\w+$/i, '.wav'));
  const a = await tts.generate(s.text, { voice, speed });
  await a.save(out);
  const d = 时长(out);
  const 词 = s.text.trim().split(/\s+/).filter(Boolean).length;
  rows.push({ file: path.basename(out), 词, d, pause: s.pauseAfter ?? 0 });
  console.log(`  ${path.basename(out).padEnd(9)} ${d.toFixed(2)}s  ${String(词).padStart(3)} 词  `
    + `${(词 / d).toFixed(2)} 词/秒   ${s.text.slice(0, 42)}${s.text.length > 42 ? '…' : ''}`);
}

const 和 = (f) => +rows.reduce((a, r) => a + f(r), 0).toFixed(2);
console.log('-'.repeat(76));
if (!ONLY) {
  const 语音 = 和((r) => r.d), 停顿 = 和((r) => r.pause), 词数 = 和((r) => r.词);
  console.log(`语音 ${语音}s ＋ 段末停顿 ${停顿}s ＝ **${(语音 + 停顿).toFixed(2)}s**`);
  console.log(`共 ${词数} 词，净语速 ${(词数 / 语音).toFixed(2)} 词/秒（方案 §5.1 记的是 2.5）`);
}
console.log(`\n→ ${段目录}`);
console.log(`→ 下一步：node gao-2d/配音.mjs ${SLUG}\n`);

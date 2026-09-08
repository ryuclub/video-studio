#!/usr/bin/env node
/**
 * 停顿测量 —— 在 GPT-SoVITS 上，一个标点值多少秒
 *
 *   node voice-clone/停顿测量.mjs --ref <参考音频> --ref-text "..."
 *
 * 老石线「标点是唯一的语气工具」那条规范，靠的是一张
 * 「哪个标点停多久」的对照表。现在那张表是**按 Edge 量的**
 * （见 shi-2d/老石出片方案.md §二之二），换后端必须整张重测。
 *
 * 做法跟当初量 Edge 那张表一样：**同一句话，只换中间那个标点**，
 * 拿「有标点」减「无标点」，得到净增的停顿时长。
 *
 * ⚠ **它的前端会归一化标点**（实测：`「」` 直接删掉、全角转半角）。
 * 所以这张表量的是「**归一化之后还剩什么**」——
 * 照着稿子上写的标点去量，量的是一张不存在的表。
 * 脚本会把服务端认到的文本一起报出来，好对上号。
 *
 * ⚠ **量出来的数只对当前这个 GPT 模型有效。** 停顿是 GPT 模型管的韵律，
 * 换成石老板微调之后的模型**要重量一遍**。今天能提前定下来的是
 * 「归一化留下哪些标点」和这套量法，不是那几个秒数。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const HOST = String(argv('host', 'http://127.0.0.1:9880')).replace(/\/$/, '');
const REF = argv('ref', null);
const REF_TEXT = argv('ref-text', null);
const SEED = parseInt(argv('seed', '42'), 10);
const 遍 = parseInt(argv('repeat', '1'), 10);
const OUT = argv('out', path.join(os.tmpdir(), 'sovits-pause'));

if (!REF || !REF_TEXT) {
  console.error('要给 --ref 和 --ref-text。');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/**
 * 载句。前后两半都是老石线里真出现过的说法，长度相当，
 * 这样净增才干净 —— 换个载句量出来的绝对值会不一样，比例才是稳的。
 */
const 前 = argv('前', '空一个月是正常周转');
const 后 = argv('后', '空半年那就得问了');

/**
 * Edge 那张表里有的全都要有对应项，好横着比。
 *
 * ⚠ **换过一个载句复核过**：前端把 `、，：；,` **五个归一成同一个 `,`**、
 * 把 `——` 直接删掉（音频跟无标点的字节完全一致）。所以这一列里
 * 真正互不相同的只有 6 档，不是 12 档 —— 详见 voice-clone/音色克隆方案.md。
 * 想省时间就跑 `--少 1`，只测那 6 档。
 */
const 全 = ['', '……', '、', '，', '——', '：', '；', '。', '！', '？', ',', '.'];
const 少 = ['', '……', '，', '。', '！', '？'];
const 标点 = argv('少', false) ? 少 : 全;

const dur = (f) =>
  parseFloat(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    }).trim(),
  );

async function 合成(text, tag) {
  const r = await fetch(`${HOST}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      text_lang: 'zh',
      ref_audio_path: REF,
      prompt_text: REF_TEXT,
      prompt_lang: 'zh',
      text_split_method: 'cut0',
      seed: SEED,
      speed_factor: 1.0,
      media_type: 'wav',
      streaming_mode: false,
      batch_size: 1,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const f = path.join(OUT, tag + '.wav');
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return dur(f);
}

console.log(`\n服务 ${HOST}　seed ${SEED}　载句「${前}◇${后}」　每项 ${遍} 遍`);
console.log('─'.repeat(72));

// 预热一次，不计入（第一句 RTF 是稳态的 1.8 倍，也会带偏时长测量的稳定性）
await 合成(前 + '。' + 后, 'warmup');

const 结果 = [];
for (let i = 0; i < 标点.length; i++) {
  const p = 标点[i];
  const text = 前 + p + 后;
  const ds = [];
  for (let k = 0; k < 遍; k++) ds.push(await 合成(text, `p${i}_${k}`));
  const 均 = ds.reduce((a, b) => a + b, 0) / ds.length;
  const 抖 = Math.max(...ds) - Math.min(...ds);
  结果.push({ p, 均, 抖, ds });
  console.log(
    `${(p || '(无)').padEnd(4, '　')}  ${均.toFixed(3)}s` +
      (遍 > 1 ? `　抖动 ${抖.toFixed(3)}s` : '') +
      (i === 0 ? '   ← 基准' : ''),
  );
}

const 基 = 结果[0].均;
console.log('─'.repeat(72));
console.log('净增（减掉无标点的基准）：\n');
console.log('| 标点 | 净增 |');
console.log('|---|---|');
for (const r of 结果.slice(1)) {
  console.log(`| \`${r.p}\` | ${(r.均 - 基).toFixed(2)}s |`);
}
console.log(`\n基准（无标点）${基.toFixed(3)}s`);
console.log(`音频留在 ${OUT}`);
console.log(
  '\n⚠ 这几个数只对当前这个 GPT 模型有效。换成石老板微调后的模型要重量一遍 ——\n' +
    '   停顿是 GPT 模型管的韵律，不是前端的固定规则。\n',
);

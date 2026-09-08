#!/usr/bin/env node
/**
 * 推理测速 —— GPT-SoVITS 在这台机器上一句话要多久
 *
 *   node voice-clone/推理测速.mjs --ref <参考音频> --ref-text "参考音频念的是什么"
 *
 * 量的是 **RTF（real-time factor）= 推理耗时 ÷ 出来的音频时长**。
 * RTF < 1 就是比实时快。官方给 v2ProPlus 的参考值是 M4 CPU 上 0.526。
 *
 * ⚠ **第一句必然特别慢**，那是模型预热，不是稳态。所以第一句单独报、不计入统计 ——
 * 拿预热那一次去估「一期要多久」会高估一大截。
 *
 * ⚠ 跟 `tts-match.mjs --backend sovits` 用**同一组参数**（cut0 / 钉死的 seed），
 * 不然量出来的数不是出片时的数。
 *
 * 零依赖，只要服务起着。
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
const OUT = argv('out', path.join(os.tmpdir(), 'sovits-speed'));

if (!REF || !REF_TEXT) {
  console.error('要给 --ref 和 --ref-text。');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/** 老石线的真实句子 —— 长短分布跟出片时一致，量出来的数才作数 */
const 句子 = [
  '房源上写着「即入居可」，你先别高兴。',
  '这四个字的意思只有一个：现在没人住。',
  '它不告诉你的是，空了多久。',
  '空一个月，是正常周转。',
  '空半年，那就得问了：为什么别人看了都没租。',
  '房子空着是要花钱的。空着还挂在网上，一定有原因。',
];

const dur = (f) =>
  parseFloat(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    }).trim(),
  );

async function once(text, i) {
  const t0 = Date.now();
  const r = await fetch(`${HOST}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      text_lang: 'zh',
      ref_audio_path: REF,
      prompt_text: REF_TEXT,
      prompt_lang: 'zh',
      text_split_method: 'cut0', // 不切，跟 tts-match 保持一致
      seed: SEED,
      speed_factor: 1.0,
      media_type: 'wav',
      streaming_mode: false,
      batch_size: 1,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ms = Date.now() - t0;
  const f = path.join(OUT, `s${i}.wav`);
  fs.writeFileSync(f, buf);
  return { ms, sec: dur(f), file: f, chars: [...text].filter((c) => /[一-龥]/.test(c)).length };
}

console.log(`\n服务 ${HOST}　参考 ${REF}　seed ${SEED}`);
console.log('─'.repeat(70));

const rows = [];
for (let i = 0; i < 句子.length; i++) {
  const r = await once(句子[i], i + 1);
  const rtf = r.ms / 1000 / r.sec;
  const 预热 = i === 0;
  rows.push({ ...r, rtf, 预热 });
  console.log(
    `${String(i + 1).padStart(2)}  ${r.chars} 字　音频 ${r.sec.toFixed(2)}s　` +
      `耗时 ${(r.ms / 1000).toFixed(2)}s　RTF ${rtf.toFixed(3)}${预热 ? '   ← 预热，不计入' : ''}`,
  );
}

const 稳 = rows.filter((r) => !r.预热);
const 总音频 = 稳.reduce((a, r) => a + r.sec, 0);
const 总耗时 = 稳.reduce((a, r) => a + r.ms, 0) / 1000;
console.log('─'.repeat(70));
console.log(`稳态 ${稳.length} 句：音频合计 ${总音频.toFixed(2)}s，推理合计 ${总耗时.toFixed(2)}s`);
console.log(`**RTF ${(总耗时 / 总音频).toFixed(3)}**　（官方 v2ProPlus 在 M4 CPU 上是 0.526）`);
console.log(`预热那一句 RTF ${rows[0].rtf.toFixed(3)}，是稳态的 ${(rows[0].rtf / (总耗时 / 总音频)).toFixed(1)} 倍`);
const 一期 = 40; // 老石线一期成片大约 40 秒
console.log(`\n照这个速度，老石线一期（约 ${一期}s 成片）要 ${(一期 * (总耗时 / 总音频)).toFixed(0)}s`);
console.log(`音频留在 ${OUT}\n`);

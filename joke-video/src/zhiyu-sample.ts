// ── 治愈系主讲音色校准：定女主讲用哪一条 ────────────────────────────
//
// 用法：npx tsx src/zhiyu-sample.ts
//
// 这条线跟聊斋的根本区别：**只有一个人从头讲到尾**，没有角色要区分。
// 所以校准的不是"分离度"，是三件别的事（见 zhiyu/治愈系旁白书目_选题稿件.md）：
//
//   ① 半音标准差落在 1.5–2.5 —— <1 发死会被听成非人声，>3.5 就"有感情"了
//   ② 实测语速 —— 稿件里 190 字/分是**估值**，要用实测值重算全部字数配额
//   ③ 戴耳机暗房听十分钟，有没有任何一处让你睁眼（这条只能人来）
//
// **候选池只有两个发音人**：Edge 的普通话女声就 Xiaoxiao 和 Xiaoyi，
// 凑不出稿件要求的"三个候选发音人"，所以做成 2 发音人 × 2 档音高。

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { synthesizeJoke } from './tts.js';
import { CASTS } from './cast.js';
import { readWav, writeWav } from './audio/wav.js';
import { measure } from './audio/measure.js';
import { SR } from './config.js';

const EP = '2026-08-19_hojoki';
const PROJ = `../zhiyu/projects/${EP}`;
const OUT = `${PROJ}/voice-samples`;

/** 候选。四条都用同一段稿子，只有音色不同 —— 变量只留一个 */
const CANDIDATES = ['夜读', '夜读方丈记'];

/**
 * 句间停顿。稿件要求助眠档 0.8–1.2s，这里取中间值。
 *
 * **这个长度只有垫了房间底噪才成立。** 说书线当年把停顿压到 1 秒以内，
 * 根因不是长度本身，是 TTS 插的空白是绝对静音（实测 −227dB），
 * 没有底噪时越长越像"卡带"。底噪那一层已经在 shuoshu-build.ts 里做好了，
 * 治愈线直接继承 —— 否则这条线自己的规范（段间 2.5–3.5s）根本落不了地。
 */
const GAP = 1.1;
/** 房间底噪电平。跟说书线同一个值，那是量出来的：落在人声以下约 36dB */
const ROOM_TONE_DBFS = -62;

function pinkNoise(n: number, seed = 20260819): Float32Array {
  let a = seed >>> 0;
  const white = () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = white();
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  let e = 0;
  for (const v of out) e += v * v;
  const g = Math.pow(10, ROOM_TONE_DBFS / 20) / (Math.sqrt(e / n) || 1);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** 从试听稿里取正文：--- 之后、每个非空行一句 */
function loadScript(): string[] {
  const raw = readFileSync(`${PROJ}/试听稿.md`, 'utf8');
  const body = raw.split(/^---$/m).slice(1).join('---');
  return body.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('>'));
}

/** 测响度（LUFS）和真峰（dBTP） */
function loudness(file: string): { i: number; tp: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = (r.stderr ?? '').slice(-2500);
  return {
    i: Number(/^\s+I:\s+(-?[\d.]+)\s+LUFS/m.exec(tail)?.[1] ?? NaN),
    tp: Number(/^\s+Peak:\s+(-?[\d.]+)\s+dBFS/m.exec(tail)?.[1] ?? NaN),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const lines = loadScript();
  const chars = lines.reduce((s, l) => s + [...l.replace(/\s/g, '')].length, 0);
  console.log(`试听稿 ${lines.length} 句 / ${chars} 字\n`);

  const rows: string[] = [];
  for (const cast of CANDIDATES) {
    if (!CASTS[cast]) throw new Error(`没有这个音色：${cast}`);
    const id = `_zhiyu/${cast}`;
    await synthesizeJoke({
      id,
      type: 'B',
      scene: 'abstract',
      characters: [{ id: '_', rig: 'none', side: 'left', cast }],
      lines: lines.map((text) => ({ who: '_', text, beat: 'setup' as const })),
    });

    // 拼接：句与句之间留 GAP，全程垫底噪
    const parts = lines.map((_, i) => readWav(`voice/${id}/${i + 1}-_.wav`).data);
    const speech = parts.reduce((s, p) => s + p.length, 0);
    const gap = Math.round(GAP * SR);
    const total = speech + gap * (parts.length - 1) + SR; // 首尾各留半秒
    const mix = pinkNoise(total);
    let at = Math.round(SR / 2);
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) mix[at + i] += p[i];
      at += p.length + gap;
    }

    const rawFile = `${OUT}/_raw-${cast}.wav`;
    writeWav(rawFile, mix, SR);

    // 后期链：稿件指定的四件。de-esser 在最前 ——
    // 齿音是这条线的隐形杀手，深夜戴耳机一个"次"音能把人从半睡里拽出来
    const chain = [
      'deesser=i=0.4:m=0.5:f=0.5',
      'highshelf=f=8000:g=-3',
      'acompressor=ratio=2:attack=30:release=200',
      'aecho=0.85:0.9:12:0.12', // 12ms，比聊斋厉鬼档的 20ms 还短：不要空间感，只要不干
    ].join(',');
    const dst = `${OUT}/${cast}.wav`;
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', rawFile, '-af', chain, '-ar', String(SR), '-ac', '1', dst], { encoding: 'utf8' });

    // 响度：测了再加固定增益，不用 ffmpeg 的 loudnorm 滤镜（说书线的结论）
    const before = loudness(dst);
    const gainDb = -21 - before.i;
    const tmp = `${OUT}/_ln-${cast}.wav`;
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', dst, '-af', `volume=${gainDb.toFixed(2)}dB`, tmp], { encoding: 'utf8' });
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', tmp, '-c', 'copy', dst], { encoding: 'utf8' });
    const after = loudness(dst);

    // 指标测在**纯人声**上（不含底噪和停顿），否则底噪会把基频统计带偏
    const dry = new Float32Array(speech);
    let k = 0;
    for (const p of parts) { dry.set(p, k); k += p.length; }
    const m = measure(dry, SR);
    const cpm = (chars / (speech / SR)) * 60;
    const c = CASTS[cast];

    rows.push(
      `| \`${cast}\` | ${c.base.replace('zh-CN-', '').replace('Neural', '')} | ${c.rate} | ` +
        `${c.morph.pitch} / ${c.morph.formant} | **${m.f0}** | **${m.f0Sd}** | **${cpm.toFixed(0)}** | ` +
        `${after.i.toFixed(1)} | ${after.tp.toFixed(1)} |`
    );
    console.log(
      `  ${cast.padEnd(7)} 基频 ${String(m.f0).padStart(3)}Hz　半音标准差 ${m.f0Sd.toFixed(2)}　` +
        `语速 ${cpm.toFixed(0)} 字/分　响度 ${after.i.toFixed(1)} LUFS`
    );
  }

  const dur = (n: number) => `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}`;
  writeFileSync(
    `${OUT}/说明.md`,
    `# 《方丈记》· 女主讲音色校准

四条用的是**同一段稿子**（\`../试听稿.md\`），只有音色不同 —— 变量只留一个。
稿子是正片会用到的真实段落，不是「测试测试」。

后期链是稿件指定的四件，四条都过了同一条链：

\`\`\`
deesser → highshelf 8kHz −3dB → 窄压缩 2:1 (30ms/200ms) → aecho 12ms
→ 响度归一到 −21 LUFS
\`\`\`

全程垫了 ${ROOM_TONE_DBFS}dBFS 粉噪当房间底噪，句间停顿 ${GAP}s。
**没有底噪的话这个停顿长度不成立** —— TTS 插的是绝对静音，
说书线试过，越长越像"卡带"不像"酝酿"。

## 四条候选

| 音色 | 发音人 | 语速 | pitch/formant | 基频 Hz | 半音标准差 | 实测字/分 | LUFS | 真峰 |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

**判据**（来自选题稿件的主讲员设定）：

- 基频 180–195Hz；《方丈记》再低 1 个半音 → **170–184Hz**
- 半音标准差 **1.5–2.5**：<1 发死会被听成非人声，>3.5 就"有感情"了
- 语速 180–200 字/分；《方丈记》再慢 8% → **166–184 字/分**
- 响度 −20 ~ −23 LUFS，真峰 −3 dBTP

## 只有你能判的那一条

稿件里写得很直白：**戴耳机，在暗房里听 10 分钟，只判断一件事——有没有任何一处让你睁眼。**

数字能筛掉明显不合格的，但"耐不耐听"没有指标。四条里挑一条，或者告诉我
"再低一点 / 再慢一点 / 换个方向"，我调完重跑这个脚本。

## 定下来之后才动的事

主讲音色是这条线的地基，**没定之前不写正片稿**——
稿件自己也写着：字数配额要用**实测语速**重算，而实测语速依赖选定的音色。
上表最后一列就是这个实测值。
`
  );
  console.log(`\n${CANDIDATES.length} 条 → ${OUT}/`);
  console.log(`每条约 ${dur(chars / 3 + lines.length * GAP)}，戴耳机听。`);
}

main();

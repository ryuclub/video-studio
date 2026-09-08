#!/usr/bin/env node
/**
 * 录音体检 —— 一段录音能不能拿去训音色克隆，先让机器说
 *
 *   node voice-clone/录音体检.mjs <音频文件> [--参考]
 *
 * 为什么要有这个脚本：克隆训练是**云 GPU 上跑一次几十分钟**的事，素材不合格
 * 要等到试听才发现，一轮就废掉半天。判据全是量出来的，那就该拦在**录音**
 * 这个最便宜的表示上，而不是拦在训练结果上。
 *
 * 两种档位：
 *   默认      —— 训练集（微调用）。要 10 分钟以上、信噪比 30 dB 以上。
 *   --参考    —— 推理时那段 5~10 秒的参考音频。短，但对噪声一样苛刻。
 *
 * 零依赖，只要 PATH 上有 ffmpeg / ffprobe。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SR = 32000; // 分析用采样率（GPT-SoVITS 训练也是 32k）
const WIN = 0.02; // 20ms 帧
const HOP = 0.01;

/* ---------------- 参数 ---------------- */
const args = process.argv.slice(2);
const REF = args.includes('--参考') || args.includes('--ref');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法: node voice-clone/录音体检.mjs <音频文件> [--参考]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error('找不到文件: ' + file);
  process.exit(2);
}

/* ---------------- 源格式 ---------------- */
function probe(f) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels',
      '-of', 'default=nw=1',
      f,
    ],
    { encoding: 'utf8' },
  );
  const kv = {};
  for (const line of out.trim().split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  return kv;
}

/* ---------------- 解码成单声道 PCM ---------------- */
function decode(f) {
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', f, '-ac', '1', '-ar', String(SR), '-f', 's16le', '-c:a', 'pcm_s16le', '-'],
    { maxBuffer: 1 << 30 },
  );
  const n = buf.length >> 1;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  return x;
}

/**
 * ebur128 的汇总写在 stderr，而且 ffmpeg 正常退出 —— 所以要显式收 stderr，
 * 不能指望 catch。
 */
function loudness(f) {
  const r = spawnSync(
    'ffmpeg',
    ['-v', 'info', '-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const out = String(r.stderr || '');
  const re = /I:\s*(-?[\d.]+)\s*LUFS/g;
  let m, last = null;
  while ((m = re.exec(out))) last = parseFloat(m[1]);
  const tp = /Peak:\s*(-?[\d.]+)\s*dBFS/.exec(out);
  return { lufs: last, truePeak: tp ? parseFloat(tp[1]) : null };
}

/* ---------------- FFT（迭代基 2） ---------------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const halfLen = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < halfLen; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + halfLen] * cr - im[i + k + halfLen] * ci;
        const vi = re[i + k + halfLen] * ci + im[i + k + halfLen] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + halfLen] = ur - vr;
        im[i + k + halfLen] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

/* ---------------- 逐帧能量 ---------------- */
function frames(x) {
  const w = Math.round(WIN * SR), h = Math.round(HOP * SR);
  const out = [];
  for (let s = 0; s + w <= x.length; s += h) {
    let acc = 0;
    for (let i = s; i < s + w; i++) acc += x[i] * x[i];
    out.push({ start: s, rms: Math.sqrt(acc / w) });
  }
  return out;
}

/* ---------------- 平均功率谱 ---------------- */
function spectrum(x, picks, N = 2048) {
  const mag = new Float64Array(N / 2);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let cnt = 0;
  for (const f of picks) {
    if (f.start + N > x.length) continue;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[f.start + i] * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] += re[k] * re[k] + im[k] * im[k];
    cnt++;
  }
  if (!cnt) return null;
  for (let k = 0; k < N / 2; k++) mag[k] /= cnt;
  return { mag, binHz: SR / N };
}

/* ---------------- 窄带啸叫：比邻域中位数高出一大截的单根谱线 ---------------- */
function whistles(spec) {
  const { mag, binHz } = spec;
  const n = mag.length;
  const half = Math.round(400 / binHz); // ±400Hz 邻域
  const found = [];
  for (let k = Math.round(200 / binHz); k < n - 1; k++) {
    if (mag[k] < mag[k - 1] || mag[k] < mag[k + 1]) continue;
    const lo = Math.max(0, k - half), hi = Math.min(n - 1, k + half);
    const nb = [];
    for (let j = lo; j <= hi; j++) if (Math.abs(j - k) > 2) nb.push(mag[j]);
    if (!nb.length) continue;
    nb.sort((a, b) => a - b);
    const med = nb[nb.length >> 1];
    const over = 10 * Math.log10(mag[k] / Math.max(med, 1e-30));
    if (over > 15) found.push({ hz: Math.round(k * binHz), over: +over.toFixed(1) });
  }
  // 一根啸叫会连出好几个 bin，每 300Hz 只留最强的那个
  found.sort((a, b) => b.over - a.over);
  const keep = [];
  for (const f of found) if (!keep.some((k) => Math.abs(k.hz - f.hz) < 300)) keep.push(f);
  return keep.slice(0, 5);
}

/**
 * 频谱上限 —— 找编码器切高频的那道**悬崖**，不是「99% 能量落在哪」。
 *
 * 语音能量本来就压在 4kHz 以下，按累积能量算的话再干净的录音也报 4~5kHz，
 * 那个数分不出「好麦」和「微信语音」。低码率编码是在某个频率上一刀切平，
 * 所以判据换成：从顶上往下扫，第一个还高于「峰值 -60dB」的 bin。
 */
function rolloff(spec) {
  const { mag, binHz } = spec;
  let peak = 0;
  for (let k = 0; k < mag.length; k++) if (mag[k] > peak) peak = mag[k];
  const floor = peak * Math.pow(10, -60 / 10);
  for (let k = mag.length - 1; k > 0; k--) if (mag[k] > floor) return Math.round(k * binHz);
  return 0;
}

/* ================= 量 ================= */
const meta = probe(file);
const x = decode(file);
const dur = x.length / SR;
const { lufs } = loudness(file);

const fr = frames(x);
const rmsSorted = fr.map((f) => f.rms).sort((a, b) => a - b);
const noiseDb = db(pct(rmsSorted, 0.1));
// 语音帧 = 高于「本底 + 10dB」的那些，取中位数当语音电平
const speechFrames = fr.filter((f) => db(f.rms) > noiseDb + 10);
const speechSorted = speechFrames.map((f) => f.rms).sort((a, b) => a - b);
const speechDb = speechSorted.length ? db(pct(speechSorted, 0.5)) : db(pct(rmsSorted, 0.9));
const snr = speechDb - noiseDb;
const speechRatio = speechFrames.length / fr.length;

/**
 * 削波：**看比例和最长连续，不是只数个数**。
 *
 * 2026-09-08 改的。原来是「clipped === 0 才算过」，太死板 ——
 * 发布过的成片经过限幅器，峰值贴着 0 dBFS，必然有几个样本擦到顶。
 * 实测两段老石的成片：0.041% / 0.0024%，最长连续 12 / 6 个样本（0.4 毫秒），
 * **听不出来，也没有信息损失**。真正该拦的是「大段被削平」——
 * 那种连续几十上百个样本顶死，波形整片没了。
 */
let clipped = 0, peak = 0, dc = 0, 连 = 0, 最长连 = 0;
for (let i = 0; i < x.length; i++) {
  const a = Math.abs(x[i]);
  if (a > peak) peak = a;
  if (a >= 32700 / 32768) {
    clipped++; 连++;
    if (连 > 最长连) 最长连 = 连;
  } else 连 = 0;
  dc += x[i];
}
dc /= x.length;
const 削比 = (clipped / x.length) * 100;

/**
 * 逐 30 秒的有声占比 —— 抓「后半段被吃掉」这类**全片统计看不出来**的损坏。
 *
 * 2026-09-07 踩到的：RNNoise 的 `sh` 模型在这份 11 分钟录音上，
 * 前 5 分钟正常，**08:30 之后把人声整个当噪声压掉**（削 24~37 dB，
 * 有声占比从 60% 掉到 7%）。而全片统计报出来的是
 * 「信噪比 23.4 dB ✅、有声占比 57% ✅」—— **两条判据都被平均值骗过去了**，
 * 信噪比甚至因为「后半段变安静」而变好看。
 *
 * 所以这条不看平均，看**最差的那一段**。
 */
const 段长 = 30 * SR;
const 逐段 = [];
for (let s = 0; s + 5 * SR < x.length; s += 段长) {
  const e = Math.min(x.length, s + 段长);
  const r = [];
  for (let p = s; p + Math.round(WIN * SR) <= e; p += Math.round(HOP * SR)) {
    let a = 0;
    const w = Math.round(WIN * SR);
    for (let i = p; i < p + w; i++) a += x[i] * x[i];
    r.push(Math.sqrt(a / w));
  }
  if (r.length < 50) continue;
  const sorted = [...r].sort((a, b) => a - b);
  const nf = db(sorted[Math.floor(sorted.length * 0.1)]);
  逐段.push({ at: s / SR, 占比: r.filter((v) => db(v) > nf + 10).length / r.length });
}
const 占比表 = 逐段.map((o) => o.占比).sort((a, b) => a - b);
const 段中位 = 占比表.length ? 占比表[占比表.length >> 1] : 1;
const 段最低 = 占比表.length ? 占比表[0] : 1;
const 塌陷 = 逐段.filter((o) => o.占比 < 段中位 * 0.5);

const quiet = fr.filter((f) => db(f.rms) <= noiseDb + 3).slice(0, 400);
const noiseSpec = quiet.length >= 4 ? spectrum(x, quiet) : null;
const voiceSpec = speechFrames.length >= 4 ? spectrum(x, speechFrames.slice(0, 400)) : null;
const tones = noiseSpec ? whistles(noiseSpec) : [];
const bw = voiceSpec ? rolloff(voiceSpec) : null;

/* ---------------- 判据 ---------------- */
const checks = [
  {
    /**
     * ⚠ 参考音频档的 3~10 秒**是 GPT-SoVITS 的硬约束，不是建议**。
     * 超出范围 `api_v2.py` 直接返回 400（2026-09-07 实测：拿一段 10.94s 的进去，
     * 报「参照音声が3～10秒の範囲外です」）。所以这里按硬区间拦，别只拦下限。
     */
    k: '时长',
    v: dur.toFixed(1) + 's',
    ok: REF ? dur >= 3 && dur <= 10 : dur >= 600,
    want: REF
      ? '3~10s —— 这是 GPT-SoVITS 的硬区间，超出直接 400，不是「差不多就行」'
      : '≥ 10 分钟（600s）；20~30 分钟更稳',
  },
  {
    k: '信噪比',
    v: `${snr.toFixed(1)} dB（语音 ${speechDb.toFixed(1)} / 本底 ${noiseDb.toFixed(1)}）`,
    ok: snr >= 30,
    warn: snr >= 20,
    want: '≥ 30 dB。低于 20 dB 模型会把底噪当音色学进去',
  },
  {
    /**
     * ⚠ 这条只管**下界**。
     *
     * 2026-09-08 改的：原来是「−12 ~ −1 dBFS」双边卡，把上界也拦了。
     * 结果四段**已发布的成片**全被这一条判死 —— 它们经过限幅器，峰值就贴在 0.0 dBFS，
     * 那是正常的母带处理，**不是损坏**（削波实测 0.0225%、最长 0.8ms）。
     *
     * 「贴不贴顶」本身说明不了问题，**该看的是削波严不严重** —— 那条判据在下面。
     * 这一条留着只为抓它原本要抓的那件事：**峰值太小＝离麦太远或增益不够**。
     */
    k: '峰值',
    v: db(peak).toFixed(1) + ' dBFS' + (db(peak) > -1 ? '（贴顶，看下面的削波那条）' : ''),
    ok: db(peak) >= -12,
    want: '≥ -12 dBFS。太小说明离麦太远或者增益不够。' +
      '**贴到 0 不算问题** —— 发布成片经过限幅器本来就贴顶，真正要看的是削波那条',
  },
  {
    k: '整体响度',
    v: lufs === null ? '未知' : lufs.toFixed(1) + ' LUFS',
    ok: lufs !== null && lufs >= -30 && lufs <= -14,
    want: '-30 ~ -14 LUFS（正常口播 -16 ~ -24）',
  },
  {
    // 停顿处是**数字零**说明这份文件被降噪或者噪声门处理过 —— 训练要原始文件。
    // 处理过的文件信噪比会报出一个漂亮到不可能的数（实测重降噪那版报 141 dB），
    // 所以这条要单独拦，否则「信噪比 ✅」会把人骗过去。
    k: '降噪痕迹',
    v: noiseDb < -90 ? `停顿处是数字静音（本底 ${noiseDb.toFixed(0)} dB）` : '无',
    ok: noiseDb >= -90,
    want: '原始文件直接给。降过噪的听着干净，但音色细节和齿音已经被削掉了',
  },
  {
    k: '削波',
    v: clipped === 0
      ? '无'
      : `${clipped} 个 = ${削比.toFixed(4)}%，最长连续 ${最长连} 个样本（${(最长连 / SR * 1000).toFixed(1)}ms）`,
    // 限幅器过冲（比例极小、连续很短）放行；大段削平才拦
    ok: 削比 < 0.5 && 最长连 <= 100,
    warn: 削比 < 2 && 最长连 <= 400,
    want: '比例 < 0.5% 且最长连续 ≤ 100 个样本（约 3ms）。' +
      '发布过的成片贴着 0 dBFS 擦几个样本是正常的；**大段被削平才是真损坏**，那补不回来',
  },
  {
    k: '频谱上限',
    v: bw === null ? '未知' : (bw / 1000).toFixed(1) + ' kHz',
    ok: bw !== null && bw >= 9000,
    want: '≥ 9 kHz。低于这个基本是微信语音／低码率转码，高频没了克隆出来发闷',
  },
  {
    k: '窄带啸叫',
    v: tones.length ? tones.map((t) => `${t.hz}Hz(+${t.over}dB)`).join('、') : '无',
    ok: tones.length === 0,
    warn: tones.length > 0 && tones.every((t) => t.over < 25),
    want: '无。有就先查源头（电源／风扇／灯），notch 掉是下策',
  },
  {
    k: '直流偏置',
    v: dc.toFixed(5),
    ok: Math.abs(dc) < 0.01,
    want: '|DC| < 0.01',
  },
  {
    k: '有声占比',
    v: (speechRatio * 100).toFixed(0) + '%',
    ok: speechRatio >= 0.45 && speechRatio <= 0.95,
    want: '45% ~ 95%。太低是大段空白，太高是没有句间停顿（或者噪声大到分不开）',
  },
  {
    // ⚠ 上面那条是**全片平均**，会被「一半好一半坏」骗过去。这条看最差的一段。
    k: '逐段一致',
    v: 逐段.length < 2
      ? '文件太短，不查'
      : `逐 30s 有声占比 ${(段最低 * 100).toFixed(0)}%~${(占比表[占比表.length - 1] * 100).toFixed(0)}%` +
        (塌陷.length ? `，${塌陷.length} 段塌陷（${塌陷.slice(0, 4).map((o) => Math.floor(o.at / 60) + ':' + String(Math.floor(o.at % 60)).padStart(2, '0')).join(' ')}${塌陷.length > 4 ? ' …' : ''}）` : ''),
    ok: 逐段.length < 2 || 塌陷.length === 0,
    want: '没有哪一段的有声占比掉到中位数的一半以下 —— 那是「这一段的人声被吃掉了」，' +
      '而全片平均和信噪比都看不出来（信噪比反而会因为变安静而更好看）',
  },
  {
    k: '源格式',
    v: `${meta.codec_name} ${meta.sample_rate}Hz ${meta.channels}ch ` +
      (meta.bit_rate ? Math.round(meta.bit_rate / 1000) + 'kbps' : ''),
    ok: Number(meta.sample_rate) >= 32000,
    want: '原始采样率 ≥ 32kHz。wav 最好；m4a 要 128kbps 以上',
  },
];

/* ---------------- 报告 ---------------- */
console.log('');
console.log('录音体检 · ' + (REF ? '参考音频档（推理用）' : '训练集档（微调用）'));
console.log(path.resolve(file));
console.log('─'.repeat(72));
for (const c of checks) {
  const mark = c.ok ? '✅' : c.warn ? '⚠ ' : '❌';
  console.log(`${mark} ${c.k.padEnd(5, '　')}  ${c.v}`);
  if (!c.ok) console.log('        　　　　要 ' + c.want);
}
console.log('─'.repeat(72));

const bad = checks.filter((c) => !c.ok && !c.warn);
const warn = checks.filter((c) => !c.ok && c.warn);
if (!bad.length && !warn.length) {
  console.log('结论：可以拿去' + (REF ? '当参考音频' : '训练'));
} else if (!bad.length) {
  console.log('结论：勉强能用，但 ' + warn.map((c) => c.k).join('、') + ' 会带进克隆音里');
} else {
  console.log('结论：不能用。卡在 ' + bad.map((c) => c.k).join('、'));
  console.log('重录要求见 voice-clone/音色克隆方案.md「二、采集」');
}
console.log('');
process.exit(bad.length ? 1 : 0);

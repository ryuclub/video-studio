/* 从配音算每帧张嘴权重：RMS + 起振/释放平滑 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FPS = 30, SR = 16000;
const pcmFile = 'vo.raw';
execFileSync('ffmpeg', ['-y','-loglevel','error','-i','vo.mp3',
  '-f','s16le','-acodec','pcm_s16le','-ac','1','-ar',String(SR), pcmFile]);

const buf = fs.readFileSync(pcmFile);
const n = buf.length / 2;
const perFrame = Math.round(SR / FPS);            // 每帧 533 个采样
const frames = Math.floor(n / perFrame);

/* 逐帧 RMS */
const rms = new Float32Array(frames);
for (let f = 0; f < frames; f++) {
  let sum = 0;
  for (let i = 0; i < perFrame; i++) {
    const s = buf.readInt16LE((f * perFrame + i) * 2) / 32768;
    sum += s * s;
  }
  rms[f] = Math.sqrt(sum / perFrame);
}

/* 归一化到 95 分位，避免个别爆音把整体压扁 */
const sorted = [...rms].sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
const floor = sorted[Math.floor(sorted.length * 0.15)] || 0;   // 静音底

/* 起振快、释放慢 —— 嘴张开比闭合快，这是真人的样子 */
const ATTACK = 0.55, RELEASE = 0.18;
const out = new Float32Array(frames);
let v = 0;
for (let f = 0; f < frames; f++) {
  let x = (rms[f] - floor) / Math.max(1e-6, p95 - floor);
  x = Math.max(0, Math.min(1, x));
  x = Math.pow(x, 0.65);                          // 提一下小音量，不然只有重音才张嘴
  v += (x - v) * (x > v ? ATTACK : RELEASE);
  out[f] = +v.toFixed(4);
}
fs.writeFileSync('envelope.json', JSON.stringify({ fps: FPS, frames, values: [...out] }));
fs.unlinkSync(pcmFile);

const nz = out.filter(x => x > 0.15).length;
console.log(`帧数 ${frames}（${(frames / FPS).toFixed(2)}s）`);
console.log(`张嘴帧占比 ${(nz / frames * 100).toFixed(1)}%　峰值 ${Math.max(...out).toFixed(2)}`);
console.log('写入 envelope.json');

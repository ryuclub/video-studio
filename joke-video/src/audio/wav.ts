// ── WAV 读写：纯 Node 实现，本地不需要 Python ─────────────────────────

import { writeFileSync, readFileSync } from 'node:fs';

export interface Audio {
  sampleRate: number;
  data: Float32Array; // 单声道
}

export function writeWav(path: string, data: Float32Array, sampleRate: number): void {
  const n = data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** 读 WAV（支持 8/16/24/32-bit PCM 与 32-bit float，多声道自动混为单声道） */
export function readWav(path: string): Audio {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`不是有效的 WAV 文件: ${path}（mp3/m4a 先用 ffmpeg 转一下）`);
  }
  let pos = 12;
  let fmt = 1;
  let channels = 1;
  let sampleRate = 48000;
  let bits = 16;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = b.readUInt16LE(body);
      channels = b.readUInt16LE(body + 2);
      sampleRate = b.readUInt32LE(body + 4);
      bits = b.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataStart = body;
      dataLen = Math.min(size, b.length - body);
    }
    pos = body + size + (size % 2);
  }
  if (dataStart < 0) throw new Error(`WAV 缺少 data 块: ${path}`);

  const bytes = bits / 8;
  const frames = Math.floor(dataLen / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataStart + (i * channels + c) * bytes;
      let v = 0;
      if (fmt === 3 && bits === 32) v = b.readFloatLE(o);
      else if (bits === 16) v = b.readInt16LE(o) / 32768;
      else if (bits === 24) v = ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) / 2147483648;
      else if (bits === 32) v = b.readInt32LE(o) / 2147483648;
      else if (bits === 8) v = (b[o] - 128) / 128;
      acc += v;
    }
    out[i] = acc / channels;
  }
  return { sampleRate, data: out };
}

/** 线性重采样到目标采样率 */
export function resample(a: Audio, target: number): Float32Array {
  if (a.sampleRate === target) return a.data;
  const ratio = target / a.sampleRate;
  const n = Math.round(a.data.length * ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(a.data.length - 1, i0 + 1);
    const f = src - i0;
    out[i] = a.data[i0] * (1 - f) + a.data[i1] * f;
  }
  return out;
}

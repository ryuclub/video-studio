// 用合成音代替配音，纯粹用来自测 align/build 链路（正式出片跑 npm run voice）
import { writeWav } from '../src/audio/wav.js';
import { SR } from '../src/config.js';
import { mkdirSync } from 'node:fs';

const id = process.argv[2] ?? 'snake-poison';
mkdirSync(`voice/${id}`, { recursive: true });

const mk = (speech: number, f: number) => {
  const n = Math.floor((0.3 + speech + 0.4) * SR);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (t > 0.3 && t < 0.3 + speech) {
      const syl = 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 4.5));
      d[i] = Math.sin(t * 2 * Math.PI * f) * 0.5 * syl;
    }
  }
  return d;
};
writeWav(`voice/${id}/1-small.wav`, mk(1.5, 320), SR);
writeWav(`voice/${id}/2-big.wav`, mk(1.1, 150), SR);
writeWav(`voice/${id}/3-small.wav`, mk(1.9, 320), SR);
console.log(`已生成假配音到 voice/${id}/（自测用）`);

// ── 基频探针：量一个多音字到底读成了第几声 ──────────────────────────
//
// 用法：
//   npx tsx src/tone-check.ts --句 "假也批了" --字 假 --比 架,甲
//
// 「比」给的是参照字，必须跟被测字**在同一个位置上**能整句通顺。
// 脚本会把整句合成三遍（原句 / 换成每个参照字），
// 只比那一个音节的基频曲线 —— 谁跟谁像，就是读成了谁的调。
//
// ── 为什么需要它 ──
//
// 做这条链的人听不出来，或者根本不在现场听。
// **「我觉得读对了」不是结论，是猜。** 这个脚本把它变成两个数。
//
// ── 一个坑：句末的三声也是降的 ──
//
// 第一版拿「持续下降」判四声，结果三声参照字也报四声 ——
// 句末的三声读成「半上」，只降不升。**调型不够，得看音高绝对值**：
// 四声起点高（300+ Hz），三声整条曲线都压在低位（200 出头）。
// 现在的判法是拿被测字跟参照字的曲线比远近，不再自己判调型。
//
// ── ⚠ 两个盲区，2026-08-22 在老马 009 上撞到的 ──
//
// **一、同调不同音的字，这个脚本一个字都判不了。**
// 它量的是**基频曲线**，也就是声调 —— 声母韵母它看不见。所以凡是两个读音
// 共用一个调的多音字，探针给出的两条曲线一模一样，「距离」小得毫无意义：
//
//   落  là（一个不落） / luò（落下）      两个都是四声
//   血  xuè / xiě                        两个都是四声
//   都  dōu / dū                         两个都是一声
//
// 009 的稿子里原来写着「该在的人一个不落」，Edge 的默认读法是 luò，
// **而这个脚本证明不了它错，也证明不了它对**。结论不是「凑合上」，是
// **量不了的音就别用** —— 换一个同义的安全字（那条改成了「一个不少」）。
// 正音层（`zhengyin.ts`）的替身字机制也帮不上忙：它靠的是同音替换，
// 而这里两个读音本来就不同音，替身字选哪个都得先知道该读哪个。
//
// **二、句子的韵律会盖过字本身的调。**
// 参照字是放进同一个句子里合成的，所以量到的是「这个位置的调型」而不是
// 「这个字的调型」。位置越靠句中、韵律越强，几个参照字的曲线就越接近。
// 009 测「说完就散会」的「散」，四声参照「退」距离 5、三声参照「懒」距离 8 ——
// **8 和 5 分不出胜负**。这种时候脚本的结论只能当参考，
// 真正的依据是「散会」本身是个固定词。
//
// 两条合起来是一句话：**这个探针只在「两个读音不同调、而且字在小句开头」
// 的时候才给得出硬结论** —— 那也正好是 `zhengyin.ts` 那张表覆盖的场景。

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const SR = 16000;
const HOP = 160; // 10ms
const WIN = 640; // 40ms
const LO = Math.floor(SR / 400);
const HI = Math.floor(SR / 70);

async function pcm(text: string, voice: string, tmp: string): Promise<Float32Array> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate: '0%', pitch: '0Hz' } as any);
  const chunks: Buffer[] = [];
  const buf = await new Promise<Buffer>((res, rej) => {
    const t = setTimeout(() => rej(new Error('TTS 超时')), 20_000);
    audioStream.on('data', (c: Buffer) => chunks.push(c));
    audioStream.on('end', () => {
      clearTimeout(t);
      res(Buffer.concat(chunks));
    });
    audioStream.on('error', (e) => {
      clearTimeout(t);
      rej(e);
    });
  });
  try {
    tts.close();
  } catch {
    /* 关不掉无所谓 */
  }
  const mp3 = join(tmp, 'p.mp3');
  const raw = join(tmp, 'p.raw');
  writeFileSync(mp3, buf);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', mp3, '-ar', String(SR), '-ac', '1', '-f', 's16le', raw]);
  if (r.status !== 0) throw new Error('ffmpeg 解码失败');
  const b = readFileSync(raw);
  const x = new Float32Array(b.length / 2);
  for (let i = 0; i < x.length; i++) x[i] = b.readInt16LE(i * 2) / 32768;
  return x;
}

/** 自相关基频。清音和静音返回 0 */
function f0(x: Float32Array): number[] {
  const out: number[] = [];
  for (let s = 0; s + WIN < x.length; s += HOP) {
    let e = 0;
    for (let i = 0; i < WIN; i++) e += x[s + i] * x[s + i];
    if (e / WIN < 1e-4) {
      out.push(0);
      continue;
    }
    let best = 0;
    let bv = 0;
    for (let lag = LO; lag <= HI; lag++) {
      let c = 0;
      for (let i = 0; i + lag < WIN; i++) c += x[s + i] * x[s + i + lag];
      c /= WIN - lag;
      if (c > bv) {
        bv = c;
        best = lag;
      }
    }
    out.push(bv / (e / WIN) > 0.35 ? SR / best : 0);
  }
  return out;
}

/** 切成连续浊音段。短于 50ms 的丢掉 */
function segments(c: number[]): number[][] {
  const r: number[][] = [];
  let s = -1;
  for (let i = 0; i < c.length; i++) {
    if (c[i] > 0 && s < 0) s = i;
    else if (c[i] === 0 && s >= 0) {
      if (i - s >= 5) r.push(c.slice(s, i));
      s = -1;
    }
  }
  if (s >= 0 && c.length - s >= 5) r.push(c.slice(s));
  return r;
}

const avg = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;

/** 一个音节压成两个数：前半均值 → 后半均值 */
function shape(seg: number[]): [number, number] {
  const h = Math.ceil(seg.length / 2);
  return [avg(seg.slice(0, h)), avg(seg.slice(-h))];
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

async function main() {
  const sent = arg('--句');
  const ch = arg('--字');
  const refs = (arg('--比') ?? '').split(/[,，]/).filter(Boolean);
  const voice = arg('--音色', 'zh-CN-XiaoxiaoNeural')!;
  if (!sent || !ch || !refs.length) {
    console.error('用法：npx tsx src/tone-check.ts --句 "假也批了" --字 假 --比 架,甲');
    process.exit(1);
  }
  if (!sent.includes(ch)) throw new Error(`「${sent}」里没有「${ch}」`);

  const tmp = mkdtempSync(join(tmpdir(), 'tone-'));
  const idx = [...sent].indexOf(ch);

  // 被测字是这句里第几个音节 —— 拿它到浊音段序号。
  // 汉字和浊音段不是严格一一对应（清声母开头的字会跟前一段粘），
  // 所以只在被测字位于句首或句尾时可靠，其余位置靠参照句同位置对比兜底。
  const atHead = idx === 0;

  const pick = (segs: number[][]) => (atHead ? segs[0] : segs[segs.length - 1]);

  const rows: { name: string; s: [number, number] }[] = [];
  for (const [name, text] of [[ch, sent] as const, ...refs.map((r) => [r, sent.replace(ch, r)] as const)]) {
    const segs = segments(f0(await pcm(text, voice, tmp)));
    const seg = pick(segs);
    if (!seg) throw new Error(`「${text}」测不到浊音段`);
    rows.push({ name, s: shape(seg) });
  }

  const me = rows[0];
  console.log(`\n「${sent}」　测「${ch}」　音色 ${voice}\n`);
  for (const r of rows) {
    const d = Math.hypot(r.s[0] - me.s[0], r.s[1] - me.s[1]);
    const tag = r === me ? '← 被测' : d < 25 ? `距离 ${d.toFixed(0)}　**就是它**` : `距离 ${d.toFixed(0)}`;
    console.log(`  ${r.name}　${r.s[0].toFixed(0).padStart(4)} → ${r.s[1].toFixed(0).padStart(4)} Hz　${tag}`);
  }
  const near = rows.slice(1).sort((a, b) => Math.hypot(a.s[0] - me.s[0], a.s[1] - me.s[1]) - Math.hypot(b.s[0] - me.s[0], b.s[1] - me.s[1]))[0];
  console.log(`\n  → 读得跟「${near.name}」一个调。\n`);
}

main();

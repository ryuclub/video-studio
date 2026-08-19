// ── 说书整期合成：script.json → 一条 wav + 时间轴 ──────────────────────
//
// 用法（--ep 必填，简写认得出：E01 / E02）：
//   npx tsx src/shuoshu-build.ts --ep E01                全片
//   npx tsx src/shuoshu-build.ts --ep E01 --preview      前三幕试听（约 4 分钟）
//   npx tsx src/shuoshu-build.ts --ep E01 --acts 幕二,幕三  只出这几幕（幕名前缀匹配）
//   npx tsx src/shuoshu-build.ts --ep E01 --to 幕一        从头出到这一幕为止
//
// **--ep 不给默认值是故意的**：默认成 E01 的话，跑 E02 忘了加参数就会把
// E01 的成品音频覆盖掉，而且不报错。多敲六个字符换掉一整期的返工。
//
// 做三件事：
//   ① 把每段拆成**声部**（一段里可能是「说书人报名 + 角色说话」两个声音）
//   ② 每个声部按节拍取念法/音量/停顿，合成、去首尾静音、拼起来
//   ③ 落一份时间轴 manifest —— 静态画面的切点和 SRT 都从它来，不用重新对时
//
// ── 关于断点续传 ──
//
// 不落自己的断点文件：**tts.ts 的两级缓存就是断点**（.cache/base-*.mp3 按
// 台词+音色+韵律做键，.cache/mix-*.wav 按变声参数做键）。跑到一半挂了直接重跑，
// 合成过的段落走缓存，秒过。真正要防的是 Edge 偶发的网络失败——那个在这里重试三次。
//
// 所以「改一段台词只有那一段重新联网」也是白送的：缓存键里有台词本身。

import { mkdirSync, writeFileSync, existsSync, rmSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { readWav, resample, writeWav } from './audio/wav.js';
import { trimSilence } from './audio/align.js';
import { normalize, softClip } from './audio/dsp.js';
import { SR, PEAK_DBFS } from './config.js';
import { getBeat } from './shuoshu-beat.js';
import { DELIVERIES, addPercent } from './cast.js';
import { cueToSrt, toSrt, type SrtCue } from './shuoshu-srt.js';
import { resolveEp } from './shuoshu-ep.js';

const { id: EP, dir: PROJ } = resolveEp(process.argv.slice(2));
const OUT_DIR = `${PROJ}/audio`;

interface Part {
  who: string;
  text: string;
  beat: string;
}
interface Line {
  no: number;
  act: string;
  text: string;
  who?: string;
  beat?: string;
  parts?: Part[];
}

/** 一个声部：合成的最小单位 */
interface Seg extends Part {
  /** 属于第几段（一段可能拆成多个声部） */
  no: number;
  /** 段内第几个声部 */
  sub: number;
  act: string;
}

/**
 * 送进 TTS 之前的文本清洗。
 *
 * **破折号 Edge 完全不认**（实测 1.763s → 1.760s，纹丝不动），所以：
 *   · 句尾的「——」是"话没说完，吊着"，那个停顿由节拍给，破折号本身删掉
 *   · 句中的「——」是个停顿，换成逗号才有效
 * 直引的「」也删掉：引号念不出来，留着只是给人看的。
 */
export function forTTS(text: string): string {
  return text
    .replace(/[「」『』]/g, '')
    .replace(/[—－]{2,}\s*$/, '')
    .replace(/[—－]{2,}/g, '，')
    .replace(/\.{3,}|…+\s*$/, '')
    .trim();
}

/** 一段拆成声部。没标 parts 的段就是一个声部，用行级的 who/beat */
export function toSegs(lines: Line[]): Seg[] {
  const out: Seg[] = [];
  for (const l of lines) {
    const parts: Part[] = l.parts ?? [{ who: l.who ?? '说书人', beat: l.beat ?? '常规', text: l.text }];
    parts.forEach((p, i) => {
      if (!p.who) throw new Error(`第 ${l.no} 段第 ${i + 1} 个声部没有说话人`);
      getBeat(p.beat); // 节拍名写错的话在这里炸，不要等合成到一半
      out.push({ ...p, no: l.no, sub: i, act: l.act });
    });
  }
  return out;
}

/**
 * 句子级微抖动：**真人不会每句同速。**
 *
 * 71 段常规原来参数完全相同，每段又是独立合成，等于 165 条一模一样的语调弧线——
 * 这是「机械」的另一半（另一半是音色，那个靠换云健解决）。
 *
 * **按段号定，不用随机数**：随机的话每次跑出来不一样，缓存全废，
 * 而且 A/B 两个版本的差别会混进抽签噪声，判断不了是方案好还是运气好。
 *
 * 只给说书人上。角色台词一共二十几段，抖不抖听不出来，
 * 反而会动到你已经认可的那几个声音。
 */
function jitterOf(no: number, sub: number): string {
  const h = ((no * 2654435761 + sub * 40503) >>> 0) % 5;
  return ['-3%', '-1.5%', '0%', '+1.5%', '+3%'][h];
}

/** 合成一个声部，返回去掉首尾静音的波形。失败重试三次——Edge 偶发抽风 */
async function renderSeg(s: Seg): Promise<Float32Array> {
  const id = `_shuoshu/${EP}/${s.no}-${s.sub}`;
  const bt = getBeat(s.beat);
  const text = forTTS(s.text);
  if (!text) throw new Error(`第 ${s.no} 段第 ${s.sub + 1} 个声部清洗后是空的：「${s.text}」`);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await synthesizeJoke({
        id,
        type: 'B',
        scene: 'abstract',
        pace: 'bedtime',
        characters: [{ id: '_', rig: 'none', side: 'left', cast: s.who }],
        lines: [
          {
            who: '_',
            text,
            beat: 'setup',
            delivery:
              s.who === '说书人'
                ? { ...DELIVERIES[bt.delivery], rate: addPercent(DELIVERIES[bt.delivery].rate, jitterOf(s.no, s.sub)) }
                : bt.delivery,
          },
        ],
      });
      const p = `voice/${id}/1-_.wav`;
      if (!existsSync(p)) throw new Error(`合成没落文件：${p}`);
      const raw = resample(readWav(p), SR);
      const tr = trimSilence(raw, SR);
      return raw.slice(tr.start, tr.end);
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error(`第 ${s.no} 段第 ${s.sub + 1} 个声部合成失败（重试 3 次）：${lastErr}`);
}

/**
 * 房间底噪。**这是为了让停顿听着像停顿，不是为了把停顿放长。**
 *
 * TTS 插的空白是**绝对静音**——实测 −227dB，现实里不存在这种东西。
 * 真人停两秒，听众听得到换气和现场；广播里的长停底下永远垫着环境声。
 * 没有底噪时，同样长度会读成「卡带」而不是「酝酿」。
 *
 * 上一轮的解法是把所有停顿压到 1 秒以内，绕开了这个问题。这一层是**正面补上它**：
 * 全片垫一层极轻的粉噪，停顿里就有了"房间"。
 * **节拍表的停顿数值一个都不动** —— 频道规范就是停顿不要太久，这条不改。
 *
 * 为什么是粉噪不是白噪：白噪高频重，听着像嘶嘶的电流；粉噪每倍频程 −3dB，
 * 接近真实房间的本底，人耳几乎察觉不到"有个噪声"，只觉得"不空"。
 *
 * **电平是量出来定的，不是拍的。** −50dBFS 那一版实测停顿里 −42.1dBFS、
 * 人声 −17.7dBFS —— **只低 24dB，戴耳机是听得见的嘶嘶声**，那不叫底噪叫噪声。
 * 降到 −62 之后落在人声以下约 36dB：停顿不空了，但你不会注意到有个噪声在响。
 */
const ROOM_TONE_DBFS = -62;

function pinkNoise(n: number, seed = 20260819): Float32Array {
  // Paul Kellet 的经济版粉噪滤波器：几个一阶低通并联逼近 −3dB/oct
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
  // 归一到目标 RMS
  let e = 0;
  for (const v of out) e += v * v;
  const rms = Math.sqrt(e / n) || 1;
  const g = Math.pow(10, ROOM_TONE_DBFS / 20) / rms;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** 用 ebur128 量整片响度、动态范围和真峰 */
function measureLoudness(path: string): { i: number; lra: number; tp: number } {
  const r = spawnSync(
    'ffmpeg',
    ['-nostats', '-hide_banner', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    // ebur128 每 100ms 打一行，12 分钟的片子有七千多行——**默认 1MB 的 maxBuffer 会被冲爆**，
    // 冲爆之后丢掉的正好是末尾的 Summary，于是"量不出真峰"。踩过一次。
    { encoding: 'utf8', maxBuffer: 1 << 28 }
  );
  const tail = (r.stderr ?? '').slice(-1200);
  const i = Number(/^\s+I:\s+(-?[\d.]+)\s+LUFS/m.exec(tail)?.[1]);
  const lra = Number(/^\s+LRA:\s+([\d.]+)\s+LU/m.exec(tail)?.[1]);
  // 「True peak:」小节底下那个 Peak，不是采样峰值——两者能差两三个 dB
  const tp = Number(/True peak:\s*\n\s+Peak:\s+(-?[\d.]+)\s+dBFS/m.exec(tail)?.[1]);
  if (!isFinite(i) || !isFinite(tp)) throw new Error(`量不出响度/真峰：${tail.slice(-300)}`);
  return { i, lra, tp };
}

/** 真峰上限。−1 dBFS 是转 mp3/aac 不破音的通行标准 */
const TRUE_PEAK_MAX = -1;

interface Loud {
  tp: number;
  before: number;
  after: number;
  lraBefore: number;
  lraAfter: number;
  gain: number;
}

/**
 * ceiling 压到 −3 而不是 −1.5：限幅器管的是**采样峰值**，而播放器重建波形时
 * 采样点之间会过冲（inter-sample peak）。实测限在 −1.5，真峰跑到 **+0.8 dBFS**——
 * 已经削顶了，mp3/aac 转码时会听见破音。留 3dB 余量之后真峰才落回安全区。
 */
/**
 * 响度归一化到广播标准。**峰值归一化不够。**
 *
 * 管线原来只做 `normalize(peak = −1dBFS)`，E01 全片量出来是 **−23.4 LUFS**，
 * 而播客/YouTube 的常规是 −16。差 7dB 意味着听众每次点开都要手动加音量。
 * 峰值只管最响的那一个瞬间，响度管的是整片的听感——说书这种动态大的内容，
 * 两者能差出十几 dB。
 *
 * **不用 ffmpeg 的 loudnorm 滤镜。** 试过，它的 `linear=true` 在这种素材上
 * 根本生效不了：整片要抬 7.4dB，而峰值本来就在 −1dBFS，抬上去必然过顶，
 * 于是 ffmpeg **悄悄退回动态压缩**（日志里只在 info 级说一句）。
 * 实测代价是 LRA 6.0 → 5.0，逐节拍量下来「扣子↔揭底」的音量差
 * 从设计的 3.75dB 被压到 2.61dB —— **节拍表的音量设计被吃掉了三成**。
 *
 * 所以自己控：**量 → 一个固定增益整片一起抬 → 前瞻限幅只削超标的瞬间**。
 * 固定增益不改变任何两段之间的相对关系（那是节拍表的全部价值），
 * 限幅只碰爆破音那几毫秒，不碰句子的持续电平。
 *
 * 这个素材的波峰因数约 22dB（TTS 的爆破音很尖），要到 −16 LUFS 就一定有削顶，
 * 区别只在于削的是**瞬间**还是**整句**。
 */
function loudnorm(src: string, dst: string, target = -16, ceiling = -3): Loud {
  const before = measureLoudness(src);
  const gain = target - before.i;

  spawnSync(
    'ffmpeg',
    [
      '-y', '-v', 'error', '-i', src,
      // 固定增益 + 前瞻限幅。**顺序很重要**：先整片一起抬，再只削超标的瞬间
      '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${ceiling}dB:attack=5:release=60:level=disabled`,
      '-ar', String(SR), '-ac', '1', dst,
    ],
    { encoding: 'utf8' }
  );
  let after = measureLoudness(dst);

  // 限幅器管的是采样峰值，真峰（采样点之间的重建过冲）还可能超标。
  // 超了就整片再降一点——**纯增益，不动任何两段之间的相对关系**，
  // 比把限幅压得更狠划算：那样削的是节拍表的音量设计。
  if (after.tp > TRUE_PEAK_MAX) {
    const trim = TRUE_PEAK_MAX - after.tp;
    const tmp = dst + '.trim.wav';
    spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', dst, '-af', `volume=${trim.toFixed(2)}dB`, '-ar', String(SR), '-ac', '1', tmp], { encoding: 'utf8' });
    renameSync(tmp, dst);
    after = measureLoudness(dst);
  }
  return { before: before.i, after: after.i, lraBefore: before.lra, lraAfter: after.lra, gain, tp: after.tp };
}

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n: string) => {
    const i = argv.indexOf(n);
    return i < 0 ? undefined : argv[i + 1];
  };

  const doc = JSON.parse(readFileSync(`${PROJ}/script.json`, 'utf8')) as { title: string; lines: Line[] };
  const acts = [...new Set(doc.lines.map((l) => l.act))];

  // 出哪几幕
  let pick = acts;
  let tag = '全片';
  if (argv.includes('--preview')) {
    // 前三块 ≈ 4.6 分钟。**先听这个再跑全片** —— 165 段跑一遍要四分钟，
    // 音色或节拍要是不对，全片重跑不如先在五分之一的量上发现
    pick = acts.slice(0, 3);
    tag = '试听-前三幕';
  } else if (flag('--acts')) {
    const want = flag('--acts')!.split(/[,，]/);
    pick = acts.filter((a) => want.some((w) => a.startsWith(w.trim())));
    tag = pick.join('+');
  } else if (flag('--to')) {
    const end = acts.findIndex((a) => a.startsWith(flag('--to')!.trim()));
    if (end < 0) throw new Error(`没有这一幕：${flag('--to')}\n可选：${acts.join(' / ')}`);
    pick = acts.slice(0, end + 1);
    tag = `到${acts[end]}`;
  }
  if (!pick.length) throw new Error(`没选中任何幕。可选：${acts.join(' / ')}`);

  const segs = toSegs(doc.lines.filter((l) => pick.includes(l.act)));
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`《${doc.title}》　${tag}`);
  console.log(`${pick.join(' / ')}`);
  console.log(`${segs.length} 个声部\n`);

  const parts: Float32Array[] = [];
  const cues: object[] = [];
  const srt: SrtCue[] = [];
  let at = 0; // 采样点游标，用来记时间轴
  const t0 = Date.now();

  for (const [i, s] of segs.entries()) {
    const bt = getBeat(s.beat);
    const ms = Date.now();
    const body = await renderSeg(s);
    const cached = Date.now() - ms < 400;

    const scaled = new Float32Array(body.length);
    for (let k = 0; k < body.length; k++) scaled[k] = body[k] * bt.gain;
    parts.push(scaled);

    const start = at / SR;
    at += scaled.length;
    const end = at / SR;
    const pauseN = Math.round(bt.pause * SR);
    parts.push(new Float32Array(pauseN));
    at += pauseN;

    cues.push({
      no: s.no,
      sub: s.sub,
      act: s.act,
      who: s.who,
      beat: s.beat,
      start: +start.toFixed(3),
      end: +end.toFixed(3),
      text: s.text,
    });

    // 字幕用**原文**（带破折号和「」），不用送 TTS 的清洗版——
    // 那两样是给眼睛看的，只是嘴念不出来
    srt.push(...cueToSrt({ start, end, text: s.text }, scaled, SR));

    const eta = ((Date.now() - t0) / (i + 1)) * (segs.length - i - 1) / 1000;
    console.log(
      `[${String(i + 1).padStart(3)}/${segs.length}] ${fmt(end).padStart(6)} ` +
        `${s.who.padEnd(4)} ${s.beat.padEnd(3)} ${cached ? '·' : '合'} ` +
        `${s.text.slice(0, 22)}${s.text.length > 22 ? '…' : ''}` +
        (i % 20 === 19 ? `　（剩约 ${Math.round(eta)}s）` : '')
    );
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const mix = new Float32Array(total);
  let w = 0;
  for (const p of parts) {
    mix.set(p, w);
    w += p.length;
  }
  // 底噪垫在归一化**之前**：这样它跟人声一起被抬，比例固定，
  // 换一期、换一版音频都不用重调
  const room = pinkNoise(mix.length);
  for (let i = 0; i < mix.length; i++) mix[i] += room[i];

  const out = normalize(softClip(mix), PEAK_DBFS);
  const wavPath = `${OUT_DIR}/${tag}.wav`;
  const rawPath = `${OUT_DIR}/${tag}.peak.wav`;
  writeWav(rawPath, out, SR);
  // 峰值归一化的中间产物只是 loudnorm 的输入，量完就删
  const lufs = loudnorm(rawPath, wavPath);
  rmSync(rawPath, { force: true });
  console.log(
    `\n响度 ${lufs.before.toFixed(1)} → ${lufs.after.toFixed(1)} LUFS　真峰 ${lufs.tp.toFixed(1)} dBFS　` +
      `动态范围 ${lufs.lraBefore.toFixed(1)} → ${lufs.lraAfter.toFixed(1)} LU`
  );

  const dur = out.length / SR;
  const speech = cues.reduce((n, c: any) => n + (c.end - c.start), 0);
  writeFileSync(
    `${OUT_DIR}/${tag}.manifest.json`,
    JSON.stringify({ ep: EP, title: doc.title, tag, acts: pick, duration: +dur.toFixed(3), cues }, null, 2) + '\n'
  );

  writeFileSync(`${OUT_DIR}/${tag}.srt`, toSrt(srt));

  const byWho = new Map<string, number>();
  for (const c of cues as any[]) byWho.set(c.who, (byWho.get(c.who) ?? 0) + (c.end - c.start));

  console.log(`\n${tag}　${fmt(dur)}　（说话 ${fmt(speech)}，留白 ${fmt(dur - speech)} = ${((1 - speech / dur) * 100).toFixed(0)}%）`);
  for (const [who, sec] of [...byWho].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${who.padEnd(4)}${fmt(sec).padStart(7)}　${((sec / speech) * 100).toFixed(0)}%`);
  }
  console.log(`\n→ ${OUT_DIR}/${tag}.wav`);
  console.log(`→ ${OUT_DIR}/${tag}.manifest.json　（画面切点从这份时间轴来）`);
  console.log(`→ ${OUT_DIR}/${tag}.srt　${srt.length} 条字幕`);
  console.log(`\n合成耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main();

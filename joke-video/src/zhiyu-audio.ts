// ── 治愈线的音频公用件 ────────────────────────────────────────────────
//
// `zhiyu-listen.ts`（单幕试听）和 `zhiyu-episode.ts`（整期出片）共用这一份。
// **不要在那两个文件里各抄一份** —— 房间底噪的电平、后期链的顺序、
// 响度目标这些东西一旦分叉，试听件和成片就不是一个声音了，
// 而这种不一致要等到有人戴耳机对比才会发现。
//
// 链路（顺序不能换）：
//
//   Edge 合成 → 变声 → 按节拍拼接 + 粉噪底噪
//   → highshelf 8kHz −3dB → 窄压缩 2:1 (30ms/200ms)
//   → 响度归一 −21 LUFS → 混音乐床
//
// **deesser 和 aecho 是排除掉的弯路，别再加回来**（见 zhiyu/治愈系出片方案.md 第二节）。

import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SR } from './config.js';

/** 房间底噪电平。跟说书线同一个值，那是量出来的：落在人声以下约 36dB */
export const ROOM_TONE_DBFS = -62;
/** 人声响度目标 */
export const SPEECH_LUFS = -21;
/**
 * 背景音乐响度。**已定档 −40**，比人声低 19 LU。
 *
 * 三轮的账：v1 出过 −34 / −38 / −42 三档，人选了 −42（低 21 LU）；
 * 做完两期之后反馈「可以再稍微大一些」，抬到 −40。
 * **没有回到 −38** —— 那一档是听过并且被放过去的，直接跳回去
 * 等于把上一轮的判断当没发生。−40 是两者之间没听过的那一格。
 */
export const BGM_LUFS = -40;
/** 音乐淡入淡出（秒） */
export const FADE_IN = 6;
export const FADE_OUT = 8;
/** 后期链。**顺序不能换，也不要往里加东西** */
export const CHAIN = 'highshelf=f=8000:g=-3,acompressor=ratio=2:attack=30:release=200';

/**
 * 跑 ffmpeg。**必须查退出码**：早先这里是 fire-and-forget，
 * 有一幕渲失败了脚本照样打印「done」，留下一个 0 字节的 wav，是人去 ls 才发现的。
 * 一个报成功的失败比一个失败糟得多。
 */
export function ff(args: string[]) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-nostats', ...args], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg 失败（退出码 ${r.status}）：${args[args.length - 1]}\n` +
        `  ${args.join(' ')}\n${(r.stderr ?? '').trim().split('\n').slice(-8).join('\n')}`
    );
  }
  return r;
}

export const dur = (f: string) =>
  Number(
    spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], {
      encoding: 'utf8',
    }).stdout.trim()
  );

/** 空文件也是失败，只是 ffmpeg 不一定会用退出码告诉你 */
export function mustHaveAudio(file: string) {
  const n = statSync(file).size;
  if (n < 1024) throw new Error(`产出是空的（${n} 字节）：${file}`);
}

/**
 * 测响度（LUFS）和真峰（dBTP）。
 *
 * **maxBuffer 必须调大。** `ebur128` 每帧都往 stderr 写一行，十来分钟的片子
 * 就是几千行、将近 1MB，正好顶到 `spawnSync` 默认的 1MB 上限 —— 一超，
 * 末尾的汇总块就被截掉，这里解析出 NaN，下一步拼出 `volume=NaNdB`，
 * ffmpeg 吐一个 0 字节的 wav。是按片长触发的坑，短的幕碰不到，长的幕必中。
 *
 * 解析不出来就直接炸。返回 NaN 会一路飘到滤镜参数里，错误现场离根因隔两层。
 */
export function loudness(file: string): { i: number; tp: number } {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 64 << 20 }
  );
  const tail = (r.stderr ?? '').slice(-2500);
  const i = Number(/^\s+I:\s+(-?[\d.]+)\s+LUFS/m.exec(tail)?.[1] ?? NaN);
  const tp = Number(/^\s+Peak:\s+(-?[\d.]+)\s+dBFS/m.exec(tail)?.[1] ?? NaN);
  if (!Number.isFinite(i) || !Number.isFinite(tp))
    throw new Error(`量不出响度：${file}\n  ffmpeg 尾部输出：\n${tail.split('\n').slice(-12).join('\n')}`);
  return { i, tp };
}

/**
 * 房间底噪。**这一层不是修饰，是前提**：
 * TTS 插的空白是绝对静音（实测 −227dB），现实里不存在这种东西。
 * 没有底噪时停顿会被听成「卡带」而不是「酝酿」——说书线和治愈线都撞过。
 */
export function pinkNoise(n: number, seed = 20260820): Float32Array {
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

/**
 * 把一小段音乐接成一条足够长的母床。
 * 不用 `-stream_loop`：硬接会在接缝爆音。改成**自己跟自己交叉淡化、翻倍逼近**，
 * 每轮长度 2L−d；qsin 是等功率曲线，两段不相关时接缝处不会塌一块。
 */
export function master(src: string, need: number, tmp: string): string {
  const XF = 2;
  let cur = `${tmp}/bed-0.wav`;
  ff(['-i', src, '-ar', String(SR), cur]);
  for (let i = 0; dur(cur) < need + XF; i++) {
    const next = `${tmp}/bed-${i + 1}.wav`;
    ff(['-i', cur, '-i', cur, '-filter_complex', `[0][1]acrossfade=d=${XF}:c1=qsin:c2=qsin`, next]);
    cur = next;
  }
  return cur;
}

/** 从母床上裁出指定长度、两头带淡入淡出的一条 */
export function bed(src: string, need: number, out: string): string {
  ff([
    '-i', src, '-t', String(need),
    '-af', `afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${(need - FADE_OUT).toFixed(2)}:d=${FADE_OUT}`,
    out,
  ]);
  return out;
}

/**
 * 后期链 + 响度归一。**测了再加固定增益，不用 ffmpeg 的 loudnorm 滤镜** ——
 * 说书线试过，`linear=true` 在这种素材上不行。
 */
export function chainAndNormalize(src: string, out: string, tmp: string): { i: number; tp: number } {
  const mid = `${tmp}/chain.wav`;
  ff(['-i', src, '-af', CHAIN, '-ar', String(SR), '-ac', '1', mid]);
  const pre = loudness(mid);
  ff(['-i', mid, '-af', `volume=${(SPEECH_LUFS - pre.i).toFixed(2)}dB`, '-ar', String(SR), '-ac', '1', out]);
  mustHaveAudio(out);
  return loudness(out);
}

/**
 * 混音乐床。人声是单声道，`aformat` 升立体声时 ffmpeg 会做 −3dB 的功率补偿，
 * 所以**每声道的 RMS 会低 3dB，但 LUFS 不变**（R128 两声道等权求和）。
 * 拿 volumedetect 去核会看到「混完反而小了」，那是量错了，别按那个去补增益。
 */
export function mixBed(voice: string, bedFile: string, out: string, target = BGM_LUFS) {
  const bl = loudness(bedFile);
  ff([
    '-i', voice, '-i', bedFile,
    '-filter_complex',
      `[0:a]aformat=channel_layouts=stereo[v];[1:a]volume=${(target - bl.i).toFixed(2)}dB[m];` +
      `[v][m]amix=inputs=2:duration=first:normalize=0[a]`,
    '-map', '[a]', '-ar', String(SR), out,
  ]);
  mustHaveAudio(out);
  return loudness(out);
}

export const mmss = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;

/**
 * 稿子里的**编辑记号不要念出来**。
 *
 * 稿子是给人看的，会带各种标记：`◇` 标换气句、`※` 标待改、`▸` 标层级。
 * 这些进了 TTS 就成了「菱形 她没有说为什么」—— 一个漏网毁一整段，
 * 而且要等有人戴耳机听到那一句才会发现。
 *
 * 所以不是白名单是**从宽削**：段首任何一串非文字符号一律去掉。
 * 保留引号和书名号 —— 那些是正文的一部分（「让人高兴的事」）。
 */
export function stripMarks(t: string): string {
  return t.replace(/^[^\p{Script=Han}\p{L}\p{N}「『《（(“‘]+/u, '').trim();
}

/** 削完还剩的可疑符号。**不拦只报** —— 正文里偶尔真会用到破折号省略号 */
export function suspectMarks(lines: string[]): string[] {
  const bad = /[◇◆▸▪●■□※☆★→←↑↓✓✔✗#*_~`|]/u;
  return lines.filter((t) => bad.test(t));
}

// ── 变声：把 TTS 出来的基础人声改造成角色音色 ────────────────────────
//
// Edge 中文一共只有 11 个音色，而且 SSML 的 pitch 只能抬基频、动不了共振峰
// （实测 +50Hz 频谱质心只挪 7%，听感是"同一个人捏着嗓子"）。段子最需要的
// 小孩和老人这两端，光靠原生音色根本做不出来。所以要有这一层。
//
//   pitch   音高倍率。决定性别感/年龄感。
//   formant 共振峰倍率。>1 声道变短（体型小），<1 体型大。
//   tempo   语速倍率。能用 SSML rate 解决的就别用这个（见下）。
//
// 关键：pitch 和 formant 必须分开调。只抬 pitch 得到的是花栗鼠电音，因为
// 真实的小孩不只是音高高，声道也短。两个按不同比例动才有"换了个人"的感觉。
// 这个解耦依赖 rubberband 滤镜（ffmpeg 编译期可选，gyan.dev 的 full build 带）。

import { spawnSync } from 'node:child_process';

export const MORPH_SR = 48000;

export interface MorphParams {
  pitch: number;
  formant: number;
  tempo: number;
  /** 附加 ffmpeg 滤镜，做质感 */
  tone?: string[];
}

/** 质感模块 */
export const TONE = {
  /** 亮 —— 童声用，提亮并去掉低频免得像变速带 */
  bright: ['highpass=f=150', 'equalizer=f=3400:t=q:w=1.2:g=3'],
  /** 细 */
  thin: ['highpass=f=170', 'treble=g=3.5:f=4200', 'equalizer=f=3000:t=q:w=1.4:g=2'],
  /** 粗 —— 加低频，压出胸腔感 */
  thick: ['bass=g=4:f=170', 'acompressor=threshold=-18dB:ratio=3:attack=8:release=180', 'lowpass=f=9000'],
  /** 苍老 —— 声带不稳的轻微颤抖 + 高频衰减 */
  aged: ['vibrato=f=5.2:d=0.11', 'lowpass=f=7000', 'equalizer=f=900:t=q:w=1.2:g=1.5'],
  /** 沙哑 */
  raspy: ['aexciter=level_in=1:level_out=1:amount=2.5:blend=1', 'equalizer=f=1800:t=q:w=1.8:g=2.5'],
  /** 鼻音 */
  nasal: ['equalizer=f=1050:t=q:w=1.1:g=6', 'equalizer=f=520:t=q:w=1.0:g=-5', 'lowpass=f=6500'],
  /** 播音 —— 只做规整，不做怪 */
  broadcast: [
    'equalizer=f=240:t=q:w=1.0:g=1.5',
    'equalizer=f=6500:t=q:w=1.6:g=-2',
    'acompressor=threshold=-16dB:ratio=2.5:attack=12:release=220',
  ],
} as const;

let rubberbandCache: boolean | null = null;

/** rubberband 是编译期可选滤镜，很多 ffmpeg 发行版没带 */
export function hasRubberband(): boolean {
  if (rubberbandCache !== null) return rubberbandCache;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  rubberbandCache = r.status === 0 && /\brubberband\b/.test(r.stdout ?? '');
  return rubberbandCache;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v)));

/** atempo 单级只接受 0.5–2，超出要拆成多级串联 */
function atempoChain(factor: number): string[] {
  const out: string[] = [];
  let f = factor;
  if (!isFinite(f) || f <= 0) return [];
  while (f < 0.5) {
    out.push('atempo=0.5');
    f /= 0.5;
  }
  while (f > 2) {
    out.push('atempo=2.0');
    f /= 2;
  }
  if (Math.abs(f - 1) > 1e-4) out.push(`atempo=${f.toFixed(6)}`);
  return out;
}

/** 这套参数等于什么都不做？是的话可以跳过整条 ffmpeg 变声链 */
export function isIdentity(p: MorphParams): boolean {
  return (
    Math.abs(p.pitch - 1) < 1e-3 &&
    Math.abs(p.formant - 1) < 1e-3 &&
    Math.abs(p.tempo - 1) < 1e-3 &&
    !p.tone?.length
  );
}

/**
 * 构造滤镜链。
 *
 * 有 rubberband 时分两级实现 pitch/formant 解耦：
 *   ① asetrate + atempo 把音高和共振峰一起推到 formant 倍率，时长复原
 *   ② rubberband 只把音高拉回目标值（formant=preserved 保住①推上去的共振峰）
 * 结果：共振峰 = formant，音高 = pitch，互不干扰。
 *
 * 没有 rubberband 就退化成单级重采样，pitch 与 formant 锁死（取 pitch，忽略
 * formant），角色区分度打折但能出声。
 */
export function buildFilter(p: MorphParams): { filter: string; degraded: boolean } {
  const pitch = clamp(p.pitch, 0.4, 2.6);
  const formant = clamp(p.formant, 0.4, 2.0);
  const tempo = clamp(p.tempo, 0.5, 2.0);
  const rb = hasRubberband();
  const parts: string[] = [];

  // asetrate 是「改写采样率标记」，实际速度倍率 = 目标值 ÷ 输入真实采样率。
  // Edge 给的基础音是 24kHz，不先归一化到 MORPH_SR，后面每个 asetrate 都会
  // 白送 48000/24000 = 2 倍加速——表现就是"全部音色语速快到听不清"。必须在链首。
  parts.push(`aresample=${MORPH_SR}`);

  if (rb) {
    if (Math.abs(formant - 1) > 1e-3) {
      parts.push(`asetrate=${Math.round(MORPH_SR * formant)}`, `aresample=${MORPH_SR}`, ...atempoChain(1 / formant));
    }
    const residual = pitch / formant;
    if (Math.abs(residual - 1) > 1e-3) {
      parts.push(`rubberband=pitch=${residual.toFixed(6)}:formant=preserved:pitchq=quality:channels=together`);
    }
  } else if (Math.abs(pitch - 1) > 1e-3) {
    parts.push(`asetrate=${Math.round(MORPH_SR * pitch)}`, `aresample=${MORPH_SR}`, ...atempoChain(1 / pitch));
  }

  parts.push(...atempoChain(tempo));
  if (p.tone?.length) parts.push(...p.tone);
  parts.push(`aformat=sample_rates=${MORPH_SR}:channel_layouts=mono`);

  return { filter: parts.join(','), degraded: !rb };
}

/**
 * mp3 → 变声 → 48k 单声道 wav。
 * 注意不做 loudnorm：整片的电平统一交给 audio/mix.ts 的 GAIN 处理，
 * 在这里做会让每句响度被单独拉平，对话的语气强弱就没了。
 */
/**
 * 只拉长开头一段，后面不动 —— 做「妈~~~妈」这种呼唤。
 *
 * **不能用分句拼接来做。** 分句是两次独立合成、两个音节起头，听着是"妈…妈"两声；
 * 这里要的是一口气里前一个字的元音持续拉长。所以必须在**同一段连续音频**上
 * 切开、只拉伸前半、再接回去——音色和基频天然一致，接缝落在两字之间的辅音
 * 闭合处（能量低谷），听不出来。
 *
 * @param splitSec 切分点（秒），用 findDip() 找
 * @param tempo    前段的拉伸倍率，越小拖得越长
 */
export function stretchHead(inPath: string, outPath: string, splitSec: number, tempo: number): void {
  const t = splitSec.toFixed(4);
  const filter =
    `[0:a]aresample=${MORPH_SR},asplit=2[a][b];` +
    `[a]atrim=end=${t},asetpts=PTS-STARTPTS,rubberband=tempo=${tempo.toFixed(4)}:pitchq=quality[h];` +
    `[b]atrim=start=${t},asetpts=PTS-STARTPTS[r];` +
    `[h][r]concat=n=2:v=0:a=1[o]`;
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', inPath, '-filter_complex', filter, '-map', '[o]', '-ar', String(MORPH_SR), '-ac', '1', outPath],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`拉长开头失败：${r.stderr?.slice(0, 400)}\n滤镜：${filter}`);
}

/**
 * 找两个字之间的能量低谷，当切分点。
 *
 * 只在有声区间的 [lo, hi] 比例范围里找——「妈妈」两字大致对半，
 * 低谷就是中间那个 m 的闭合。找错了接缝会落在元音中间，会听到"咔"一下。
 */
export function findDip(x: Float32Array, sr: number, lo = 0.3, hi = 0.62): number {
  const win = Math.floor(0.012 * sr);
  const rms = (i: number) => {
    let e = 0;
    const n = Math.min(win, x.length - i);
    for (let k = 0; k < n; k++) e += x[i + k] * x[i + k];
    return Math.sqrt(e / Math.max(1, n));
  };
  // 先定有声区间，别把首尾静音算进比例
  const gate = 0.012;
  let a = 0;
  let b = x.length;
  for (let i = 0; i + win < x.length; i += win)
    if (rms(i) > gate) {
      a = i;
      break;
    }
  for (let i = x.length - win; i >= 0; i -= win)
    if (rms(i) > gate) {
      b = i + win;
      break;
    }
  const span = b - a;
  let best = a + Math.floor(span * 0.5);
  let bestV = Infinity;
  for (let i = a + Math.floor(span * lo); i < a + span * hi; i += win) {
    const v = rms(i);
    if (v < bestV) {
      bestV = v;
      best = i;
    }
  }
  return best / sr;
}

export function morphToWav(inPath: string, outPath: string, p: MorphParams): { degraded: boolean } {
  const { filter, degraded } = buildFilter(p);
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', inPath, '-af', filter, '-ar', String(MORPH_SR), '-ac', '1', outPath],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) throw new Error(`变声失败：${r.stderr?.slice(0, 500)}\n滤镜链：${filter}`);
  return { degraded };
}

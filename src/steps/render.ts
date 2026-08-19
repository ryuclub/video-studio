import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config.js';
import type { Script, Timeline, Shot, RenderProfile } from '../types.js';
import { buildAss } from '../lib/ass.js';
import { shotClips } from './footage.js';
import { ffmpeg, run, durationMs, log } from '../lib/util.js';

/**
 * 分遍渲染，而不是一个巨型 filter_complex。
 *
 * 第一遍：每个镜头单独归一化成同编码/同分辨率/同帧率的片段（几何变换 + 运镜）
 * 第二遍：concat 拼接成一条无声视频
 * 第三遍：混音单独出一条 AAC 音轨（横竖版共用，见 buildAudioMix 里的原因）
 * 第四遍：调色 + 烧字幕 + 编码，音轨只 copy
 *
 * 三十多个镜头塞进一个 filter graph，ffmpeg 的内存和调试成本会失控；
 * 分开出问题时能定位到具体是哪个镜头。
 *
 * 注意调色（LUT/暗角）放在第二遍而不是第一遍 —— 第一遍用 ultrafast + 低 CRF
 * 只做中间产物，创作性的处理留到最后一次编码，画质损失只发生一次。
 */

/** 素材比例千奇百怪，统一「等比放大到覆盖画布再中心裁切」，不留黑边不变形 */
function geometryFilters(p: RenderProfile, kenBurns: boolean): string[] {
  const f = [
    `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase`,
    `crop=${p.width}:${p.height}`,
    `fps=${CONFIG.fps}`,
  ];
  if (kenBurns) {
    // 缓慢推近，避免静止画面显得死板。zoompan 实测开销很小，可以放心用
    f.push(
      `zoompan=z='min(zoom+0.0006,1.09)':d=1:` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${p.width}x${p.height}:fps=${CONFIG.fps}`,
    );
  }
  return f;
}

/** 成片里的一个连续画面段：某条素材播多长 */
interface Piece {
  file: string;
  durMs: number;
}

/** 切到下一条素材前至少要停留这么久，避免出现一闪而过的碎片 */
const MIN_PIECE_MS = 1200;

/**
 * 把一个镜头排布成若干片段：一条素材放完就切下一条，而不是把同一条循环播放。
 *
 * 镜头时长由稿件决定（可能十几秒），而免版权库的素材常常只有五六秒。
 * 老做法是 -stream_loop -1 循环补满，但重复非常显眼 —— 观众一眼看出是拼凑的。
 *
 * 收尾处理：如果剩下的时间不够 MIN_PIECE_MS，就并进上一段（让它多循环一点点），
 * 而不是硬塞一个零点几秒的闪切 —— 短暂重复远不如闪切扎眼。
 */
function planPieces(shot: Shot, p: RenderProfile): Piece[] {
  const clips = shotClips(shot, p.orientation);
  const need = shot.endMs - shot.startMs;
  const pieces: Piece[] = [];
  let acc = 0;

  for (let i = 0; acc < need; i++) {
    const clip = clips[i % clips.length];
    const remain = need - acc;
    let take = Math.min(clip.durationMs, remain);
    // 尾巴太短就不另起一段，直接并进这一段
    if (remain - take < MIN_PIECE_MS) take = remain;
    pieces.push({ file: clip.file, durMs: take });
    acc += take;
  }
  return pieces;
}

async function normalizePiece(
  piece: Piece,
  index: number,
  outDir: string,
  p: RenderProfile,
): Promise<string> {
  const durSec = piece.durMs / 1000;
  const out = path.join(outDir, `seg_${String(index).padStart(3, '0')}.mp4`);

  await ffmpeg([
    // 素材短于本段时长时仍需补满（只发生在并进来的那点尾巴上）
    '-stream_loop', '-1',
    '-i', piece.file,
    '-t', durSec.toFixed(3),
    '-an',
    '-vf', geometryFilters(p, true).join(','),
    // 中间产物：编码要快、质量要高，体积无所谓
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16',
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  return out;
}

/**
 * 滤镜参数里的路径要转义，Windows 盘符冒号是最常见的踩坑点。
 * 反斜杠先统一成正斜杠，再把 `:` 转成 `\:` —— 单个反斜杠，不是两个：
 * 参数外面已经套了一层单引号，ffmpeg 解引号时会把 `\\` 还原成 `\`，
 * 冒号就重新变成了选项分隔符，路径会从盘符处被切断。
 */
function escapeForFilter(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export { planPieces };

/**
 * 自检：音轨里不能有空洞。
 *
 * 时长自检拦不住这种问题 —— 时间戳是对的，头尾也对得上，只是中间整块整块地
 * 少了包。表现是播放到某处画面卡住、声音消失几秒，然后跳过去接着播。
 * 这种片子肉眼看文件大小和时长都正常，只有逐包查才发现得了。
 */
export async function assertAudioContinuous(file: string): Promise<void> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'packet=pts_time',
    '-of', 'csv=p=0',
    file,
  ]);
  const pts = out
    .split('\n')
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n))
    // 交错写入时包在文件里未必按时间排好，先排序再看间隔
    .sort((a, b) => a - b);

  // AAC 一包 1024 样本 = 21.3ms，留足余量，只抓真正的空洞
  const HOLE_MS = 100;
  const holes: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const gapMs = (pts[i] - pts[i - 1]) * 1000;
    if (gapMs > HOLE_MS) holes.push(`${pts[i - 1].toFixed(2)}s 处缺 ${(gapMs / 1000).toFixed(2)}s`);
  }
  if (holes.length > 0) {
    throw new Error(
      `${path.basename(file)} 的音轨有 ${holes.length} 处空洞：${holes.slice(0, 5).join('、')}` +
        `${holes.length > 5 ? ' …' : ''}`,
    );
  }
}

/**
 * 混音（loudnorm + 可选 BGM 闪避）单独跑一遍，产出一条现成的 AAC 音轨，
 * 视频那一遍只 -c:a copy。
 *
 * 这不是为了代码好看 —— loudnorm 和 libx264 放进同一次 ffmpeg run 会丢音频。
 * loudnorm 动态模式内部按 3 秒一块缓冲，视频编码把管线拖慢之后，整块整块的
 * 音频会被直接丢掉：实测 3 分 28 秒的成片里出现两个 3.00s 的空洞，播放器表现
 * 为「从 0:01 跳到 0:04，这段没有声音」。丢的位置取决于视频内容，横版竖版
 * 各不相同，所以特别难发现 —— 时长自检也拦不住，因为时间戳是对的，只是中间
 * 没有包。把音频摘出来单独编码，从根上避开。
 *
 * 链尾的 aresample=async=1:first_pts=0 补掉 loudnorm 自己在收尾处留下的
 * 那个几十毫秒的时间戳空洞，保证交出去的是连续的一整条。
 */
export async function buildAudioMix(dir: string, timeline: Timeline, targetMs: number): Promise<string> {
  const mixFile = path.join(dir, 'voice_mix.m4a');
  // 横竖版共用同一条音轨，第二次渲染直接复用
  if (fs.existsSync(mixFile)) {
    const fresh = fs.statSync(mixFile).mtimeMs >= fs.statSync(timeline.audioFile).mtimeMs;
    if (fresh) return mixFile;
  }

  /*
   * loudnorm 内部固定跑在 192kHz，输出也是 192kHz；AAC 编码器最高只到 96kHz，
   * 于是成片会变成 96kHz 单声道 —— 有音轨、能识别，但 Windows 自带播放器、
   * 微信、不少手机端会直接静音播放。所以链尾必须显式定回 48kHz 立体声。
   */
  const OUT_AUDIO =
    'aresample=48000:async=1:first_pts=0,' +
    'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

  const enc = [
    '-c:a', 'aac', '-b:a', CONFIG.audioBitrate, '-ar', '48000', '-ac', '2',
    '-t', (targetMs / 1000).toFixed(3),
    mixFile,
  ];

  if (fs.existsSync(CONFIG.bgmFile)) {
    // sidechaincompress：人声一出来自动把 BGM 压下去，比手调音量干净得多
    await ffmpeg([
      '-i', timeline.audioFile,
      '-stream_loop', '-1', '-i', CONFIG.bgmFile,
      '-filter_complex',
      `[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11[voice];` +
        `[voice]asplit=2[voice_out][voice_key];` +
        `[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.30[bgm];` +
        `[bgm][voice_key]sidechaincompress=threshold=0.04:ratio=12:attack=8:release=320[duck];` +
        // normalize=0 很关键：amix 默认把每路按 1/n 缩放，人声会平白掉 6dB，
        // loudnorm 校准的 -16 LUFS 就白做了。BGM 已经用 volume=0.30 压过，
        // 溢出交给后面的 alimiter 兜。
        `[voice_out][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
        `alimiter=limit=0.95,${OUT_AUDIO}[a]`,
      '-map', '[a]',
      ...enc,
    ]);
  } else {
    await ffmpeg([
      '-i', timeline.audioFile,
      '-filter_complex', `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,${OUT_AUDIO}[a]`,
      '-map', '[a]',
      ...enc,
    ]);
  }
  return mixFile;
}

export async function render(
  dir: string,
  script: Script,
  timeline: Timeline,
  shots: Shot[],
  p: RenderProfile,
): Promise<string> {
  const workDir = ensureDir(path.join(dir, `work_${p.name}`));

  // 横竖版各生成一份字幕，字号、边距、堆叠位置全部按 fontScale 重算
  const assFile = path.join(dir, `subtitle_${p.name}.ass`);
  fs.writeFileSync(assFile, buildAss(script, timeline, p), 'utf8');

  const pieces = shots.flatMap((s) => planPieces(s, p));
  const extra = pieces.length - shots.length;
  log(
    'render',
    `[${p.name}] 归一化 ${pieces.length} 个片段（${shots.length} 个镜头` +
      `${extra > 0 ? `，其中 ${extra} 次因素材放完而切下一条` : ''}）`,
  );
  const segs: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    segs.push(await normalizePiece(pieces[i], i, workDir, p));
  }

  const listFile = path.join(workDir, 'concat.txt');
  fs.writeFileSync(listFile, segs.map((f) => `file '${f}'`).join('\n'), 'utf8');

  const silentVideo = path.join(workDir, 'video_mute.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silentVideo]);

  /*
   * 成片长度以音频为准，画面去适配它 —— 稿件是主，画面是从。
   *
   * 绝不用 -shortest：那是拿画面长度去截音频，结尾的话会被吃掉。
   * 画面短了（镜头取整、concat 的毫秒级误差）就定格最后一帧补上，
   * 长了就由 -t 切掉。任何情况下 targetMs 都覆盖完整音频。
   */
  const audioMs = await durationMs(timeline.audioFile);
  const targetMs = Math.max(audioMs, timeline.totalMs);
  const videoMs = await durationMs(silentVideo);
  const shortfallMs = targetMs - videoMs;
  if (shortfallMs > 200) {
    log('render', `[${p.name}] 画面短 ${(shortfallMs / 1000).toFixed(2)}s，定格末帧补足`);
  }

  // 调色 + 暗角 + 字幕，一条链走完
  // tpad 放在链首，补出来的帧同样要过调色和字幕（尾巴上的字幕才不会丢）
  const padSec = Math.max(0, shortfallMs / 1000) + 2;
  const vChain: string[] = [`tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)}`];
  if (fs.existsSync(CONFIG.lutFile)) vChain.push(`lut3d='${escapeForFilter(CONFIG.lutFile)}'`);
  vChain.push('vignette=PI/5');
  vChain.push(`subtitles='${escapeForFilter(assFile)}'`);

  const outFile = path.join(dir, `${p.name}.mp4`);
  const mixFile = await buildAudioMix(dir, timeline, targetMs);

  await ffmpeg([
    '-i', silentVideo,
    '-i', mixFile,
    '-filter_complex', `[0:v]${vChain.join(',')}[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', CONFIG.preset, '-crf', CONFIG.crf,
    // 音轨已经在 buildAudioMix 里编好，这里只搬运，绝不重编
    '-c:a', 'copy',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    // 输出时长由音频定，多余的定格帧到这里被切掉
    '-t', (targetMs / 1000).toFixed(3),
    outFile,
  ]);

  await assertAudioContinuous(outFile);

  // 自检：成片必须装得下整条音频，少一句都算失败
  const outMs = await durationMs(outFile);
  if (outMs < audioMs - 250) {
    throw new Error(
      `成片 ${(outMs / 1000).toFixed(2)}s 短于音频 ${(audioMs / 1000).toFixed(2)}s，结尾被截断了`,
    );
  }

  const sizeMb = (fs.statSync(outFile).size / 1e6).toFixed(1);
  log('render', `完成 ${(outMs / 1000).toFixed(1)}s / ${sizeMb}MB → ${outFile}`);
  return outFile;
}

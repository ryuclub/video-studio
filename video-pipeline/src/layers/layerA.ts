import type { MotionPreset, Shot, Storyboard } from '../types';

/**
 * A 层：静图 + 运镜。
 *
 * ── 为什么要超采样 ──────────────────────────────────────────
 * zoompan 和 crop 的 x/y/zoom 都按「输入图的整数像素」取样。
 * 直接对 1920 宽的图做 6 秒缓推，每帧位移不到 1 像素，
 * ffmpeg 就会连续几帧停在同一位置、然后突然跳一格 —— 肉眼看到的就是一格一格的抖动。
 *
 * 解法：先把源图 scale 到 输出尺寸 × SS，让 1 个输入像素 = 1/SS 个输出像素，
 * 位移精度提高到 1/SS 像素，抖动就低于可察觉阈值了。
 * SS=4 是甜点：再高画质没有提升，渲染时间线性上涨。
 *
 * 代价：源图分辨率必须够。1080p 输出至少要 4K 源图，
 * 否则 scale 上去的是插值出来的糊像素，推近了会发虚。
 */
const SS_MAX = 4;
const SS_MIN = 2;

/**
 * 自适应超采样倍率。
 * 超过源图分辨率的放大是纯浪费 —— 插值不出新细节，只是让每帧多做一次昂贵的 scale。
 * 所以取「源图能提供的倍率」和 SS_MAX 的较小值，下限 2（半像素精度已经基本看不出抖动）。
 * 4K 源图 + 1080p 输出 → SS=2，渲染速度比一律 SS=4 快一倍以上。
 */
export function pickSupersample(srcWidth: number | undefined, outWidth: number): number {
  if (!srcWidth || srcWidth <= 0) return SS_MIN;
  const natural = Math.floor(srcWidth / outWidth);
  return Math.max(SS_MIN, Math.min(SS_MAX, natural));
}

/** 各预设的默认强度（缩放幅度 / 位移幅度），乘以 shot.intensity */
const DEFAULTS = {
  zoomAmount: 0.16, // 缓推/缓拉的总缩放量，16% 在 5 秒里刚好「感觉得到但注意不到」
  panAmount: 0.14, // 横移覆盖画面宽度的比例
  breathShift: 0.018, // 手持漂移幅度（相对画面宽度）
};

export function buildLayerAFilter(shot: Shot, sb: Storyboard, srcWidth?: number): string {
  const { width: W, height: H, fps } = sb;
  const SS = pickSupersample(srcWidth, W);
  const dur = shot.duration;
  const k = shot.intensity ?? 1;
  const motion: MotionPreset = shot.motion ?? 'zoomIn';
  const frames = Math.max(1, Math.round(dur * fps));

  if (motion === 'still') {
    // 画面里有文字/图表时必须走这条。完全静止，零抖动风险。
    return [
      `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${W}:${H}`,
      `fps=${fps}`,
      'format=yuv420p',
    ].join(',');
  }

  if (motion === 'zoomIn' || motion === 'zoomOut') {
    const amt = DEFAULTS.zoomAmount * k;
    const per = amt / frames; // 每帧缩放增量
    // zoompan 的 zoom 下限是 1.0，所以 zoomOut 是「从 1+amt 降到 1」
    const z =
      motion === 'zoomIn'
        ? `min(1+${per.toFixed(8)}*on,${(1 + amt).toFixed(5)})`
        : `max(${(1 + amt).toFixed(5)}-${per.toFixed(8)}*on,1.0)`;
    return [
      `scale=${W * SS}:${H * SS}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${W * SS}:${H * SS}`,
      `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${fps}`,
      'format=yuv420p',
    ].join(',');
  }

  if (motion === 'breath') {
    // 两个不同周期的正弦叠加，避免看出规律性。周期取质数比，几乎不会重复。
    const shift = Math.round(W * SS * DEFAULTS.breathShift * k);
    const sw = W * SS + shift * 2;
    const sh = H * SS + shift * 2;
    return [
      `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${sw}:${sh}`,
      `crop=${W * SS}:${H * SS}:'(in_w-out_w)/2+${shift}*sin(2*PI*t/7.3)':'(in_h-out_h)/2+${shift}*sin(2*PI*t/5.1+1.2)'`,
      `scale=${W}:${H}:flags=lanczos`,
      `fps=${fps}`,
      'format=yuv420p',
    ].join(',');
  }

  // panLeft / panRight / panUp / panDown
  const horizontal = motion === 'panLeft' || motion === 'panRight';
  const amt = DEFAULTS.panAmount * k;
  const sw = horizontal ? Math.round(W * SS * (1 + amt)) : W * SS;
  const sh = horizontal ? H * SS : Math.round(H * SS * (1 + amt));
  // t/dur 归一化到 0..1；panLeft = 视窗从右往左走，画面看起来向右流
  const fwd = `(t/${dur})`;
  const bwd = `(1-t/${dur})`;
  const prog = motion === 'panLeft' || motion === 'panUp' ? fwd : bwd;
  const x = horizontal ? `(in_w-out_w)*${prog}` : `(in_w-out_w)/2`;
  const y = horizontal ? `(in_h-out_h)/2` : `(in_h-out_h)*${prog}`;

  return [
    `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${sw}:${sh}`,
    `crop=${W * SS}:${H * SS}:'${x}':'${y}'`,
    `scale=${W}:${H}:flags=lanczos`,
    `fps=${fps}`,
    'format=yuv420p',
  ].join(',');
}

/** 构造 A 层完整的 ffmpeg 参数 */
export function layerAArgs(
  shot: Shot,
  sb: Storyboard,
  srcAbs: string,
  outFile: string,
  encode: string[],
  srcWidth?: number,
): string[] {
  return [
    '-y',
    '-loglevel', 'error',
    '-loop', '1',
    '-i', srcAbs,
    '-t', String(shot.duration),
    '-r', String(sb.fps),
    '-vf', buildLayerAFilter(shot, sb, srcWidth),
    ...encode,
    outFile,
  ];
}

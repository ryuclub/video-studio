import * as path from 'node:path';
import type { Shot, Storyboard } from '../types';
import { run, encodeArgs } from '../util/ffmpeg';
import { renderSvgSequence } from './svgRender';
import { buildSceneFrameFn } from './scenes';
import { validateScene } from './validateScene';

/**
 * 伪 B 层：不调任何 AI 服务，用脚本制造「看起来像 AI 生成」的动感。
 *
 * 四条分支，覆盖了实际做片时 90% 想用 AI 视频的场景：
 *   cinemagraph —— 静图局部动（云在飘、水在流、霓虹在闪）
 *   compose     —— 分层视差，制造伪 3D 纵深
 *   overlay     —— 全画面叠加（胶片颗粒、漏光、雨雪、扫描线）
 *   render      —— 代码渲染动效（图表、数字、时间轴、金句卡）
 *
 * 前三个吃素材，第四个纯代码。做金融/历史类文案片时 render 分支的使用率最高。
 */

export async function renderLayerB(
  shot: Shot,
  sb: Storyboard,
  projectRoot: string,
  buildDir: string,
  outFile: string,
  crf: number,
  preset: string,
): Promise<void> {
  const kind = shot.pseudo ?? 'overlay';
  const abs = (p: string) => path.resolve(projectRoot, p);
  const enc = encodeArgs(crf, preset);

  if (kind === 'render') {
    if (!shot.scene) throw new Error(`[${shot.id}] pseudo=render 必须提供 scene`);
    validateScene(shot.scene, shot.id);
    const frameFn = buildSceneFrameFn(shot.scene, sb.width, sb.height, {
      transparent: shot.transparent,
      scrim: shot.scrim,
    });
    await renderSvgSequence(frameFn, {
      width: sb.width,
      height: sb.height,
      fps: sb.fps,
      duration: shot.duration,
      outFile,
      tmpDir: path.join(buildDir, 'tmp', `${shot.id}-frames`),
      crf,
      preset,
      alpha: !!shot.transparent,
    });
    return;
  }

  if (kind === 'cinemagraph') {
    if (!shot.source) throw new Error(`[${shot.id}] cinemagraph 需要 source（底图）`);
    if (!shot.texture) throw new Error(`[${shot.id}] cinemagraph 需要 texture（循环素材）`);
    const { width: W, height: H } = sb;
    const inputs = [
      '-loop', '1', '-i', abs(shot.source),
      '-stream_loop', '-1', '-i', abs(shot.texture),
    ];
    // 有蒙版就按蒙版限定动态区域；没蒙版就整幅低透明度混合（更粗糙但不用抠图）
    let fc: string;
    if (shot.mask) {
      inputs.push('-loop', '1', '-i', abs(shot.mask));
      fc =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=rgba[base];` +
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=rgba[tex];` +
        `[2:v]scale=${W}:${H},format=gray[m];` +
        `[tex][m]alphamerge[texa];` +
        `[base][texa]overlay=0:0:format=auto,format=yuv420p[v]`;
    } else {
      const op = shot.overlayOpacity ?? 0.35;
      fc =
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gbrp[base];` +
        `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gbrp[tex];` +
        `[base][tex]blend=all_mode=${shot.overlayMode ?? 'screen'}:all_opacity=${op},format=yuv420p[v]`;
    }
    await run([
      '-y', '-loglevel', 'error',
      ...inputs,
      '-t', String(shot.duration),
      '-filter_complex', fc,
      '-map', '[v]',
      '-r', String(sb.fps),
      ...enc,
      outFile,
    ]);
    return;
  }

  if (kind === 'compose') {
    if (!shot.layers?.length) throw new Error(`[${shot.id}] compose 需要 layers`);
    await renderParallax(shot, sb, abs, enc, outFile);
    return;
  }

  // overlay
  {
    if (!shot.source) throw new Error(`[${shot.id}] overlay 需要 source`);
    const { width: W, height: H } = sb;
    const op = shot.overlayOpacity ?? 0.14;
    const mode = shot.overlayMode ?? 'screen';

    if (shot.overlayFile) {
      await run([
        '-y', '-loglevel', 'error',
        '-loop', '1', '-i', abs(shot.source),
        '-stream_loop', '-1', '-i', abs(shot.overlayFile),
        '-t', String(shot.duration),
        '-filter_complex',
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gbrp[b];` +
          `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gbrp[o];` +
          `[b][o]blend=all_mode=${mode}:all_opacity=${op},format=yuv420p[v]`,
        '-map', '[v]', '-r', String(sb.fps),
        ...enc, outFile,
      ]);
      return;
    }

    // 程序化胶片颗粒：不需要任何素材文件。
    // geq 逐像素跑，比较慢，但对 5 秒镜头完全可以接受。
    const amount = shot.grain ?? 40;
    await run([
      '-y', '-loglevel', 'error',
      '-loop', '1', '-i', abs(shot.source),
      '-f', 'lavfi', '-i', `nullsrc=s=${W}x${H}:r=${sb.fps}`,
      '-t', String(shot.duration),
      '-filter_complex',
      `[1:v]geq=lum='random(1)*${amount}':cb=128:cr=128,format=gbrp[g];` +
        `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=gbrp[b];` +
        `[b][g]blend=all_mode=${mode}:all_opacity=${op},format=yuv420p[v]`,
      '-map', '[v]', '-r', String(sb.fps),
      ...enc, outFile,
    ]);
  }
}

/**
 * 分层视差。
 * layers[0] 是最底层（背景），speed 是相对位移速度：
 * 背景给 0.2、中景 0.5、前景 1.0，就有明显纵深了。
 *
 * 前提是你有分好层的透明 PNG —— 这一步 ffmpeg 干不了，
 * 得手工抠或者用抠图模型。但一张图抠一次可以反复用。
 */
async function renderParallax(
  shot: Shot,
  sb: Storyboard,
  abs: (p: string) => string,
  enc: string[],
  outFile: string,
): Promise<void> {
  const { width: W, height: H } = sb;
  const layers = shot.layers!;
  const amp = Math.round(W * 0.06 * (shot.intensity ?? 1));

  const inputs: string[] = [];
  for (const l of layers) inputs.push('-loop', '1', '-i', abs(l.file));

  const parts: string[] = [];
  // 底层放大一点，位移时不会露出边缘黑边
  parts.push(
    `[0:v]scale=${W + amp * 2}:${H + amp * 2}:force_original_aspect_ratio=increase,crop=${W + amp * 2}:${H + amp * 2},format=rgba[l0]`,
  );
  for (let i = 1; i < layers.length; i++) {
    parts.push(
      `[${i}:v]scale=${W + amp * 2}:${H + amp * 2}:force_original_aspect_ratio=increase,crop=${W + amp * 2}:${H + amp * 2},format=rgba[l${i}]`,
    );
  }

  let prev = 'l0';
  for (let i = 1; i < layers.length; i++) {
    const sp = layers[i]!.speed;
    const dx = `${(amp * sp).toFixed(1)}*sin(2*PI*t/${(shot.duration * 2).toFixed(2)})`;
    parts.push(`[${prev}][l${i}]overlay=x='${dx}':y=0:format=auto[m${i}]`);
    prev = `m${i}`;
  }
  const base = layers[0]!.speed;
  parts.push(
    `[${prev}]crop=${W}:${H}:'${amp}+${(amp * base).toFixed(1)}*sin(2*PI*t/${(shot.duration * 2).toFixed(2)})':${amp},format=yuv420p[v]`,
  );

  await run([
    '-y', '-loglevel', 'error',
    ...inputs,
    '-t', String(shot.duration),
    '-filter_complex', parts.join(';'),
    '-map', '[v]', '-r', String(sb.fps),
    ...enc, outFile,
  ]);
}

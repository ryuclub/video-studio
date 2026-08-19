import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OverlayPlan, OverlaySpec, SceneSpec } from './types';
import { run, probeSize, probeDuration, encodeArgs } from './util/ffmpeg';
import { renderSvgSequence } from './layers/svgRender';
import { buildSceneFrameFn } from './layers/scenes';
import { validateScene } from './layers/validateScene';

/**
 * 把动效叠到一条已有视频上，不重走整条管线。
 *
 * 这是把这套东西用在**现有片子**上的入口：
 * 你已经剪好的片子不动，只在指定时间点浮出图表/数字/地图，播完自动消失。
 *
 * 流程：每个 overlay 渲成带 alpha 的 .mov → 一次 ffmpeg 把它们按时间点叠上去。
 * 底片只重编码一次，不管叠几个。
 */

export interface OverlayOntoOpts {
  base: string;
  plan: OverlayPlan;
  projectRoot: string;
  buildDir: string;
  outFile: string;
  crf: number;
  preset: string;
}

export async function overlayOnto(o: OverlayOntoOpts): Promise<void> {
  const { width: BW, height: BH } = await probeSize(o.base);
  const baseDur = await probeDuration(o.base);
  const fps = o.plan.fps ?? 30;
  if (!BW || !BH) throw new Error(`无法读取底片尺寸：${o.base}`);

  const items = [...o.plan.overlays].sort((a, b) => a.at - b.at);
  // grain 的颗粒是滤镜级的，不渲 SVG 帧；漏光那层照常走叠加
  const grains = items.filter((ov) => ov.scene.kind === 'grain');
  if (!items.length) throw new Error('overlays 为空');

  // ── 先做全量校验，别渲到一半才失败 ──
  const seen = new Set<string>();
  for (const ov of items) {
    if (!ov.id) throw new Error('存在没有 id 的 overlay');
    if (seen.has(ov.id)) throw new Error(`overlay id 重复：${ov.id}`);
    seen.add(ov.id);
    if (!(ov.duration > 0)) throw new Error(`[${ov.id}] duration 必须大于 0`);
    if (ov.at < 0) throw new Error(`[${ov.id}] at 不能为负`);
    if (ov.at + ov.duration > baseDur + 0.05) {
      throw new Error(
        `[${ov.id}] ${ov.at}s + ${ov.duration}s 超出底片长度 ${baseDur.toFixed(2)}s`,
      );
    }
    validateScene(ov.scene, ov.id);
    // itemAt 是相对面板起点的秒数，越界的话最后一条会在 fadeOut 里入场 —— 等于没做
    const last = ov.scene.itemAt?.[ov.scene.itemAt.length - 1];
    if (typeof last === 'number' && last > ov.duration - 1.5) {
      throw new Error(
        `[${ov.id}] itemAt 末条 ${last}s 距面板结束（${ov.duration}s）不足 1.5 秒，最后一条会在淡出里浮进来`,
      );
    }
  }
  warnIfCrowded(items);

  const genDir = path.join(o.buildDir, 'overlays');
  fs.mkdirSync(genDir, { recursive: true });

  // ── 逐个渲成带 alpha 的 .mov ──
  const rendered: { ov: OverlaySpec; file: string; w: number; h: number }[] = [];
  for (const ov of items) {
    const full = isFullFrame(ov.scene.kind);
    const scale = ov.scale ?? 0.55;
    // 面板宽高比按场景定：地图接近正方，硬塞进 16:9 会两边空一大片
    const [pw, ph] = panelSize(ov.scene, BW, BH, scale);
    const w = even(full ? BW : (ov.width ?? Math.round(pw)));
    const h = even(full ? BH : (ov.height ?? Math.round(ph)));
    const file = path.join(genDir, `${ov.id}.mov`);
    // 面板太小时字号会被压到读不清，尤其是坐标轴标签
    if (!full && w < 620) {
      console.warn(
        `  ⚠ ${ov.id} 面板仅 ${w}px 宽，文字会挤。scale 是「占底片宽度的比例」，竖版建议 0.85~0.92`,
      );
    }

    const frameFn = buildSceneFrameFn(ov.scene, w, h, {
      transparent: true,
      // 全幅效果不能有衬底：它要么本身就是一整块蒙版（闪白/聚光），
      // 要么是画在底片具体位置上的注记（箭头），衬底会把底片糊掉
      scrim: full ? false : (ov.scrim ?? true),
    });
    await renderSvgSequence(frameFn, {
      width: w,
      height: h,
      fps,
      duration: ov.duration,
      outFile: file,
      tmpDir: path.join(o.buildDir, 'tmp', `ov-${ov.id}`),
      alpha: true,
    });
    console.log(`  ✓ ${ov.id}  ${ov.scene.kind}  ${w}x${h}  @${ov.at}s +${ov.duration}s`);
    rendered.push({ ov, file, w, h });
  }

  // ── 一次性合成 ──
  const inputs: string[] = ['-i', o.base];
  for (const r of rendered) inputs.push('-i', r.file);

  const parts: string[] = [];
  let cur = '0:v';
  if (grains.length) {
    // 颗粒走 ffmpeg 的 noise 滤镜：all_seed 保证重渲一致，
    // allf=t+u 是「每帧换一次的均匀噪点」—— 不加 t 的话它是一层固定脏点，像脏镜头不像胶片
    const chain = grains
      .map((g) => {
        const st = Math.round(g.scene.strength ?? 12);
        const seed = Math.round(g.scene.seed ?? 11);
        const end = (g.at + g.duration).toFixed(3);
        return `noise=alls=${st}:allf=t+u:all_seed=${seed}:enable='between(t,${g.at.toFixed(3)},${end})'`;
      })
      .join(',');
    parts.push(`[0:v]${chain}[grained]`);
    cur = 'grained';
    for (const g of grains) {
      console.log(`  ✓ ${g.id}  grain  强度 ${g.scene.strength ?? 12}  @${g.at}s +${g.duration}s（滤镜层）`);
    }
  }
  rendered.forEach((r, idx) => {
    const i = idx + 1;
    const { ov } = r;
    const fi = ov.fadeIn ?? 0.5;
    const fo = ov.fadeOut ?? 0.5;
    const end = ov.at + ov.duration;

    // 淡入淡出作用在 alpha 上，衬底和内容一起进出
    const fades: string[] = ['format=rgba'];
    if (fi > 0) fades.push(`fade=t=in:st=0:d=${fi}:alpha=1`);
    if (fo > 0) fades.push(`fade=t=out:st=${Math.max(0, ov.duration - fo).toFixed(3)}:d=${fo}:alpha=1`);
    // 把这段素材在时间轴上挪到 at，再用 enable 精确开关
    fades.push(`setpts=PTS-STARTPTS+${ov.at.toFixed(3)}/TB`);
    parts.push(`[${i}:v]${fades.join(',')}[o${i}]`);

    const fullFrame = isFullFrame(ov.scene.kind);
    const x = fullFrame ? '0' : resolvePos(ov.x, BW, r.w, 'center');
    const y = fullFrame ? '0' : resolvePos(ov.y, BH, r.h, 'top');
    const label = idx === rendered.length - 1 ? 'vout' : `b${i}`;
    // eof_action=pass：素材放完后底片继续，不然会被截断
    parts.push(
      `[${cur}][o${i}]overlay=${x}:${y}:eof_action=pass:enable='between(t,${ov.at.toFixed(3)},${end.toFixed(3)})'[${label}]`,
    );
    cur = label;
  });
  parts.push(`[${cur}]format=yuv420p[vfinal]`);

  const args = [
    '-y', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[vfinal]',
  ];
  // 底片有音轨就原样搬过去，不重编码
  args.push('-map', '0:a?', '-c:a', 'copy');
  args.push('-r', String(fps), ...encodeArgs(o.crf, o.preset), o.outFile);

  await run(args);
}

/**
 * 必须铺满整幅画面的效果。
 * 它们的坐标是相对整幅画面的 0–1 归一值（箭头要指的是底片里的东西），
 * 或者本身就是一整块蒙版（闪白、聚光、漏光），塞进面板就没有意义了。
 */
const FULL_FRAME = new Set(['flash', 'spotlight', 'arrowAnnotate', 'grain']);
function isFullFrame(kind: string): boolean {
  return FULL_FRAME.has(kind);
}

/**
 * 各场景的默认面板宽高比。
 * 不给的话所有面板都跟底片同比（16:9），地图和金句卡会大量留白。
 */
const PANEL_ASPECT: Record<string, number> = {
  steps: 2.0,       // 兜底值；实际按条数算，见 aspectOf()
  subtitleStack: 2.8,   // 三行字，很扁
  maskTitle: 2.4,
  glitchTitle: 3.2,     // 一行大字
  compareBars: 1.9,
  japanMap: 0.92,   // 真轮廓是 1048×1141，比正方略高
  quote: 2.1,       // 引文是横向排布的几行字，扁一点更好看
  counter: 3.0,     // 数字并排，很扁
  timeline: 2.6,    // 时间轴天然横长
  lineChart: 1.78,
  barChart: 1.78,
};

/**
 * 面板尺寸。
 *
 * scale 统一表示「占底片**宽度**的比例」—— 一开始让近正方的场景按高度定尺寸，
 * 结果同一个 scale 在横版和竖版下含义不同：竖版 1080x1920 里 scale=0.42
 * 给柱状图算出 454px 宽的迷你卡片，标题都放不下。
 *
 * 高度按宽高比推导，再用底片高度的 72% 封顶（近正方场景在横版下会顶到这个上限）。
 */
const MAX_H_RATIO = 0.72;

/**
 * 宽高比。多数场景一个常数就够，steps 不行 ——
 * 两条的卡和五条的卡差着一倍高度，用同一个比例的话，五条会被挤成一团。
 */
function aspectOf(scene: SceneSpec, BW: number, BH: number): number {
  if (scene.kind === 'steps') {
    const n = Math.min(5, Math.max(2, scene.items?.length ?? 3));
    const hasNote = (scene.items ?? []).some((it) => !!it.note);
    // 四条的卡要比两条的卡高一倍，宽度不变 → 宽高比随条数往下走
    return Math.max(1.45, 2.5 - 0.35 * (n - 2) - (hasNote ? 0.25 : 0));
  }
  return PANEL_ASPECT[scene.kind] ?? BW / BH;
}

function panelSize(scene: SceneSpec, BW: number, BH: number, scale: number): [number, number] {
  const aspect = aspectOf(scene, BW, BH);
  let w = BW * scale;
  let h = w / aspect;
  const maxH = BH * MAX_H_RATIO;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return [w, h];
}

function even(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

/**
 * 位置解析。支持 '6%'、数字像素、'center'。
 * 默认水平居中、垂直靠上 —— 因为屏幕下 1/3 通常被字幕占满了。
 */
function resolvePos(
  v: string | number | undefined,
  baseSize: number,
  ovSize: number,
  fallback: 'center' | 'top',
): string {
  if (typeof v === 'number') return String(Math.round(v));
  if (typeof v === 'string') {
    const m = /^(-?[\d.]+)%$/.exec(v.trim());
    if (m) return String(Math.round((parseFloat(m[1]!) / 100) * baseSize));
    if (v.trim() === 'center') return String(Math.round((baseSize - ovSize) / 2));
    const n = parseFloat(v);
    if (isFinite(n)) return String(Math.round(n));
  }
  return fallback === 'center'
    ? String(Math.round((baseSize - ovSize) / 2))
    : String(Math.round(baseSize * 0.08));
}

/**
 * 密度检查。
 * 一篇 4 分钟稿子交给 LLM 判定，能识别出十几个「可以做图」的点，
 * 全做出来成片就变成数据大屏了。宁可漏，不可满。
 */
function warnIfCrowded(items: OverlaySpec[]): void {
  const MAX_TOTAL = 6;
  const MIN_GAP = 25;
  if (items.length > MAX_TOTAL) {
    console.warn(`  ⚠ 共 ${items.length} 个动效，建议控制在 ${MAX_TOTAL} 个以内，否则成片像数据大屏`);
  }
  const byKind = new Map<string, number>();
  for (const it of items) byKind.set(it.scene.kind, (byKind.get(it.scene.kind) ?? 0) + 1);
  for (const [k, n] of byKind) {
    if (n > 2) console.warn(`  ⚠ ${k} 用了 ${n} 次，同类建议不超过 2 次`);
  }
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const gap = items[i]!.at - (prev.at + prev.duration);
    if (gap < MIN_GAP) {
      console.warn(
        `  ⚠ ${prev.id} 与 ${items[i]!.id} 间隔仅 ${gap.toFixed(1)}s，建议至少 ${MIN_GAP}s`,
      );
    }
  }
}

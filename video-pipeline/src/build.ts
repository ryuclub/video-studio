#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Shot, Storyboard, ShotResult } from './types';
import { run, probeDuration, probeSvgSupport, encodeArgs, setVerbose, FfmpegError, FFPROBE } from './util/ffmpeg';
import { shotKey, cachePath, isCached, pruneOldVersions } from './util/cache';
import { layerAArgs } from './layers/layerA';
import { renderLayerB } from './layers/layerB';
import { loadLibrary, findInLibrary, renderLayerC } from './layers/layerC';
import { assemble } from './assemble';
import { overlayOnto } from './overlay';
import type { OverlayPlan } from './types';

interface Options {
  storyboard: string;
  out: string;
  crf: number;
  preset: string;
  concurrency: number;
  only: string[] | null;
  force: boolean;
  verbose: boolean;
  noAssemble: boolean;
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] ?? 'render';

  if (cmd === 'doctor') return doctor();
  if (cmd === 'overlay-onto') return overlayCmd(argv.slice(1));
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return usage();
  if (cmd !== 'render') {
    console.error(`未知命令：${cmd}`);
    usage();
    process.exit(1);
  }

  const o = parseOptions(argv.slice(1));
  setVerbose(o.verbose);

  const sbPath = path.resolve(o.storyboard);
  const projectRoot = path.dirname(sbPath);
  const buildDir = path.join(projectRoot, 'build');
  fs.mkdirSync(path.join(buildDir, 'shots'), { recursive: true });
  fs.mkdirSync(path.join(buildDir, 'tmp'), { recursive: true });

  const sb = readStoryboard(sbPath);
  const shots = o.only ? sb.shots.filter((s) => o.only!.includes(s.id)) : sb.shots;
  if (!shots.length) {
    console.error('没有匹配到任何镜头');
    process.exit(1);
  }

  const total = shots.reduce((a, s) => a + s.duration, 0);
  console.log(`《${sb.title}》 ${sb.width}x${sb.height}@${sb.fps}  ${shots.length} 镜  ${total.toFixed(1)}s`);
  const byTier = shots.reduce<Record<string, number>>((a, s) => {
    a[s.tier] = (a[s.tier] ?? 0) + 1;
    return a;
  }, {});
  console.log(`  分层：${Object.entries(byTier).map(([k, v]) => `${k}=${v}`).join('  ')}\n`);

  const library = loadLibrary(path.join(projectRoot, 'assets', 'library'));
  const results: (ShotResult | null)[] = new Array(shots.length).fill(null);
  const failures: { id: string; error: Error }[] = [];

  // 简单的并发池。ffmpeg 本身吃满多核，并发开太高反而慢，默认 CPU 数一半。
  let cursor = 0;
  const workers = Array.from({ length: Math.min(o.concurrency, shots.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= shots.length) return;
      const shot = shots[i]!;
      try {
        results[i] = await renderShot(shot, sb, projectRoot, buildDir, library, o);
      } catch (e) {
        failures.push({ id: shot.id, error: e as Error });
        console.error(`  ✗ ${shot.id}  ${describeError(e as Error)}`);
      }
    }
  });
  await Promise.all(workers);

  if (failures.length) {
    console.error(`\n${failures.length} 个镜头失败。修好后重跑即可 —— 成功的镜头已缓存，不会重渲。`);
    if (!o.verbose) console.error('加 --verbose 可以看到完整的 ffmpeg 命令行。');
    process.exit(1);
  }

  const ok = results.filter((r): r is ShotResult => r !== null);
  const cachedCount = ok.filter((r) => r.cached).length;
  console.log(`\n单镜完成：${ok.length} 个（命中缓存 ${cachedCount}）`);

  if (o.noAssemble || o.only) {
    console.log('跳过合成（--no-assemble 或 --only）');
    return;
  }

  console.log('合成中…');
  const outAbs = path.resolve(projectRoot, o.out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const timeline = await assemble(sb, ok, projectRoot, buildDir, outAbs, o.crf, o.preset);

  // 真实时间轴落盘，供字幕/注记/竖版切条使用
  const tlFile = path.join(buildDir, 'timeline.json');
  fs.writeFileSync(tlFile, JSON.stringify(timeline, null, 2), 'utf8');
  const drifted = timeline.filter((e) => Math.abs(e.drift) >= 0.05);
  if (drifted.length) {
    console.warn(
      `\n⚠ ${drifted.length} 个镜头因转场前移，成片时间与分镜表的 start 不一致：`,
    );
    for (const e of drifted.slice(0, 5)) {
      console.warn(`    ${e.id}  分镜 ${(e.start - e.drift).toFixed(2)}s → 成片 ${e.start.toFixed(2)}s（${e.drift.toFixed(2)}s）`);
    }
    if (drifted.length > 5) console.warn(`    …还有 ${drifted.length - 5} 个`);
    console.warn(`  真实时间轴已写入 ${path.relative(process.cwd(), tlFile)}，字幕请按它对齐。`);
  }

  const finalDur = await probeDuration(outAbs);
  console.log(`\n✓ ${path.relative(process.cwd(), outAbs)}  ${finalDur.toFixed(2)}s  ${(fs.statSync(outAbs).size / 1e6).toFixed(1)}MB`);

  if (sb.audio) {
    const audioAbs = path.resolve(projectRoot, sb.audio);
    if (fs.existsSync(audioAbs)) {
      const ad = await probeDuration(audioAbs);
      const gap = Math.abs(ad - total);
      if (gap > 0.5) {
        console.warn(
          `⚠ 画面总长 ${total.toFixed(2)}s 与音轨 ${ad.toFixed(2)}s 差 ${gap.toFixed(2)}s。` +
            `\n  解说片是音频主导，应该回头调整 storyboard 里的 duration 来贴合音轨。`,
        );
      }
    }
  }
}

async function renderShot(
  shot: Shot,
  sb: Storyboard,
  projectRoot: string,
  buildDir: string,
  library: Record<string, string[]>,
  o: Options,
): Promise<ShotResult> {
  const t0 = Date.now();
  const key = shotKey(shot, sb, projectRoot);
  const out = cachePath(buildDir, shot, key);

  if (!o.force && isCached(out)) {
    console.log(`  · ${shot.id}  [缓存] ${shot.tier}${shot.pseudo ? '/' + shot.pseudo : ''}`);
    return { id: shot.id, file: out, duration: shot.duration, cached: true, ms: 0 };
  }

  const enc = encodeArgs(o.crf, o.preset);

  if (shot.tier === 'A') {
    if (!shot.source) throw new Error('A 层必须提供 source');
    const src = path.resolve(projectRoot, shot.source);
    requireFile(src, shot.id, 'source');
    const srcW = await sourceWidth(src);
    warnIfLowRes(srcW, sb, shot.id, shot.motion);
    await run(layerAArgs(shot, sb, src, out, enc, srcW));
  } else if (shot.tier === 'B') {
    await renderLayerB(shot, sb, projectRoot, buildDir, out, o.crf, o.preset);
  } else {
    let file = shot.source;
    if (!file) {
      const hit = findInLibrary(library, shot.tags ?? []);
      if (!hit) throw new Error(`素材库里找不到匹配 tags [${(shot.tags ?? []).join(', ')}] 的素材`);
      file = path.join('assets', 'library', hit);
    }
    const src = path.resolve(projectRoot, file);
    requireFile(src, shot.id, 'source');
    await renderLayerC(shot, sb, src, out, o.crf, o.preset);
  }

  pruneOldVersions(buildDir, shot.id, key);
  const ms = Date.now() - t0;
  console.log(`  ✓ ${shot.id}  ${shot.tier}${shot.pseudo ? '/' + shot.pseudo : ''}  ${shot.duration}s  ${(ms / 1000).toFixed(1)}s`);
  return { id: shot.id, file: out, duration: shot.duration, cached: false, ms };
}

/** 读源图宽度，用来定超采样倍率；探测失败返回 undefined，走保守默认 */
async function sourceWidth(src: string): Promise<number | undefined> {
  try {
    const out = await run(
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', src],
      FFPROBE,
    );
    const w = parseInt(out.trim(), 10);
    return isFinite(w) && w > 0 ? w : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A 层运镜对源图分辨率有硬要求。
 * 源图不够大时 scale 上去的是插值像素，推近了会明显发虚 —— 提前警告比出片后重做便宜。
 */
function warnIfLowRes(w: number | undefined, sb: Storyboard, id: string, motion?: string): void {
  if (motion === 'still' || !w) return;
  if (w < sb.width * 2) {
    console.warn(
      `  ⚠ ${id} 源图仅 ${w}px 宽，运镜建议至少 ${sb.width * 2}px（理想 ${sb.width * 4}px），否则推近会发虚`,
    );
  }
}

function requireFile(p: string, id: string, field: string): void {
  if (!fs.existsSync(p)) throw new Error(`[${id}] ${field} 不存在：${p}`);
}

function readStoryboard(p: string): Storyboard {
  if (!fs.existsSync(p)) throw new Error(`storyboard 不存在：${p}`);
  let sb: Storyboard;
  try {
    sb = JSON.parse(fs.readFileSync(p, 'utf8')) as Storyboard;
  } catch (e) {
    throw new Error(`storyboard JSON 解析失败：${(e as Error).message}`);
  }
  const ids = new Set<string>();
  for (const s of sb.shots ?? []) {
    if (!s.id) throw new Error('存在没有 id 的镜头');
    if (ids.has(s.id)) throw new Error(`镜头 id 重复：${s.id}`);
    ids.add(s.id);
    if (!(s.duration > 0)) throw new Error(`[${s.id}] duration 必须大于 0`);
  }
  if (!sb.shots?.length) throw new Error('storyboard 里没有镜头');
  sb.width ??= 1920;
  sb.height ??= 1080;
  sb.fps ??= 30;
  return sb;
}

function parseOptions(argv: string[]): Options {
  const o: Options = {
    storyboard: 'storyboard.json',
    out: 'out/final.mp4',
    crf: 18,
    preset: 'medium',
    concurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
    only: null,
    force: false,
    verbose: false,
    noAssemble: false,
  };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--out') o.out = argv[++i]!;
    else if (a === '--crf') o.crf = parseInt(argv[++i]!, 10);
    else if (a === '--preset') o.preset = argv[++i]!;
    else if (a === '--concurrency' || a === '-j') o.concurrency = parseInt(argv[++i]!, 10);
    else if (a === '--only') o.only = argv[++i]!.split(',').map((s) => s.trim());
    else if (a === '--force') o.force = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--no-assemble') o.noAssemble = true;
    else rest.push(a);
  }
  if (rest[0]) o.storyboard = rest[0];
  return o;
}

/** overlay-onto <base.mp4> --spec overlays.json --out out.mp4 */
async function overlayCmd(argv: string[]): Promise<void> {
  let base = '';
  let spec = '';
  let out = 'out/overlaid.mp4';
  let crf = 18;
  let preset = 'medium';
  let verbose = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--spec') spec = argv[++i]!;
    else if (a === '--out') out = argv[++i]!;
    else if (a === '--crf') crf = parseInt(argv[++i]!, 10);
    else if (a === '--preset') preset = argv[++i]!;
    else if (a === '--verbose' || a === '-v') verbose = true;
    else if (!base) base = a;
  }
  setVerbose(verbose);
  if (!base || !spec) {
    console.error('用法：node dist/build.js overlay-onto <底片.mp4> --spec <overlays.json> [--out <输出>]');
    process.exit(1);
  }
  const baseAbs = path.resolve(base);
  const specAbs = path.resolve(spec);
  if (!fs.existsSync(baseAbs)) throw new Error(`底片不存在：${baseAbs}`);
  if (!fs.existsSync(specAbs)) throw new Error(`叠加规格不存在：${specAbs}`);

  const projectRoot = path.dirname(specAbs);
  const buildDir = path.join(projectRoot, 'build');
  fs.mkdirSync(path.join(buildDir, 'tmp'), { recursive: true });

  let plan: OverlayPlan;
  try {
    plan = JSON.parse(fs.readFileSync(specAbs, 'utf8')) as OverlayPlan;
  } catch (e) {
    throw new Error(`叠加规格 JSON 解析失败：${(e as Error).message}`);
  }

  console.log(`底片 ${path.basename(baseAbs)}  ${plan.overlays?.length ?? 0} 个动效\n`);
  const outAbs = path.resolve(out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  await overlayOnto({ base: baseAbs, plan, projectRoot, buildDir, outFile: outAbs, crf, preset });
  const d = await probeDuration(outAbs);
  console.log(`\n✓ ${path.relative(process.cwd(), outAbs)}  ${d.toFixed(2)}s  ${(fs.statSync(outAbs).size / 1e6).toFixed(1)}MB`);
}

async function doctor(): Promise<void> {
  console.log('环境检查\n');
  let fail = false;
  try {
    const v = await run(['-version']);
    console.log(`  ✓ ffmpeg  ${v.split('\n')[0]}`);
  } catch {
    console.log('  ✗ ffmpeg 不可用。装一个并加进 PATH，或设环境变量 FFMPEG_PATH');
    fail = true;
  }
  try {
    await run(['-version'], FFPROBE);
    console.log('  ✓ ffprobe');
  } catch {
    console.log('  ✗ ffprobe 不可用');
    fail = true;
  }

  const svg = await probeSvgSupport();
  if (svg) {
    console.log('  ✓ SVG 解码（librsvg）—— 伪B/render 分支零依赖可用');
  } else {
    let sharp = false;
    try {
      require('sharp');
      sharp = true;
    } catch {
      /* noop */
    }
    if (sharp) console.log('  ✓ SVG 走 sharp 降级路径（ffmpeg 不带 librsvg）');
    else {
      console.log('  ✗ 既没有 librsvg 也没有 sharp —— pseudo=render 会失败');
      console.log('      换带 librsvg 的 ffmpeg 构建，或 npm i sharp');
    }
  }

  console.log(`  · CPU ${os.cpus().length} 核，默认并发 ${Math.max(1, Math.floor(os.cpus().length / 2))}`);
  if (fail) process.exit(1);
}

function describeError(e: Error): string {
  if (e instanceof FfmpegError) {
    const line = e.stderr.split('\n').filter(Boolean).pop() ?? e.message;
    return `${e.message}\n      ${line}`;
  }
  return e.message;
}

function usage(): void {
  console.log(`用法：
  node dist/build.js doctor                    环境检查
  node dist/build.js render [storyboard.json] [选项]
  node dist/build.js overlay-onto <底片.mp4> --spec <overlays.json> [--out <输出>]
                                              把动效叠到已有视频上

选项：
  --out <file>          输出路径，默认 out/final.mp4
  --only s01,s07        只渲染指定镜头（调试用，自动跳过合成）
  --force               忽略缓存，全部重渲
  --crf <n>             画质，默认 18（越小越好，18~23 是常用区间）
  --preset <p>          x264 preset，默认 medium。赶时间用 veryfast
  -j, --concurrency <n> 并发镜头数，默认 CPU 核数的一半
  -v, --verbose         打印完整 ffmpeg 命令行
  --no-assemble         只渲单镜不合成`);
}

main().catch((e: Error) => {
  console.error(`\n错误：${describeError(e)}`);
  process.exit(1);
});

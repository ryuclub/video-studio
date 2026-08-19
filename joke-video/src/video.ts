// ── 出片：SVG → PNG 帧 → 管道喂给 ffmpeg ─────────────────────────────

import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { W, H, FPS, FONT, OUT } from './config.js';
import { paperTextureSvg } from './style/papercut.js';
import { renderFrame, type RenderCtx } from './render.js';

const resvgOpts = () => ({
  fitTo: { mode: 'original' as const },
  font: {
    loadSystemFonts: true,
    defaultFontFamily: FONT.split(',')[0].trim(),
  },
});

export function svgToPng(svg: string): Buffer {
  return new Resvg(svg, resvgOpts()).render().asPng();
}

export function ensureTexture(strength = 0.38): string {
  mkdirSync(OUT, { recursive: true });
  const p = `${OUT}/paper-texture-${strength}.png`;
  if (!existsSync(p)) writeFileSync(p, svgToPng(paperTextureSvg(W, H, strength)));
  return p;
}

/**
 * 光栅化线程池。
 *
 * 出片慢的原因只有一个：**逐帧光栅化，而且排着队一个个做**。
 * 实测单帧 240ms 里 99.6% 是 resvg，拼 SVG 只占 1ms —— 所以能并行的就是这一步，
 * 而每帧互不依赖，天然可并行。原来那个 for 循环只用了一个核。
 *
 * 唯一的约束是**喂给 ffmpeg 的顺序不能乱**（image2pipe 是按到达顺序排帧的，
 * 乱一帧画面就跳一下）。解法在 renderVideo 里：派发是乱序的，消费按帧号 await，
 * 所以先算完的帧会先在池子里等着，轮到它才写出去。
 *
 * 线程数默认 `核数-2`，上限 6：留两个核给 ffmpeg 编码和主线程拼 SVG，
 * 全占满反而会互相抢。用 `JOKE_WORKERS=N` 覆盖，`JOKE_WORKERS=1` 退回单线程。
 */
function makeRasterPool(n: number) {
  const url = new URL('./raster-worker.cjs', import.meta.url);
  const font = FONT.split(',')[0].trim();
  const ws = Array.from({ length: n }, () => new Worker(url, { workerData: { font } }));

  interface Job {
    svg: string;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }
  const queue: Job[] = [];
  const idle: Worker[] = [];
  const busy = new Map<Worker, Job>();

  const pump = () => {
    while (idle.length && queue.length) {
      const w = idle.pop()!;
      const job = queue.shift()!;
      busy.set(w, job);
      w.postMessage({ svg: job.svg });
    }
  };

  for (const w of ws) {
    w.unref(); // 别让空闲 worker 吊住进程退出
    idle.push(w);
    w.on('message', (m: { png?: Uint8Array; err?: string }) => {
      const job = busy.get(w);
      busy.delete(w);
      idle.push(w);
      if (!job) return;
      if (m.err) job.reject(new Error(`光栅化失败：${m.err}`));
      else job.resolve(Buffer.from(m.png!.buffer, m.png!.byteOffset, m.png!.byteLength));
      pump();
    });
    // worker 挂了要把在飞的那一帧也 reject，否则整条 await 永远悬着
    w.on('error', (e) => {
      const job = busy.get(w);
      busy.delete(w);
      job?.reject(e);
    });
  }

  return {
    size: n,
    raster: (svg: string) =>
      new Promise<Buffer>((resolve, reject) => {
        queue.push({ svg, resolve, reject });
        pump();
      }),
    close: () => Promise.all(ws.map((w) => w.terminate())),
  };
}

export async function renderVideo(
  ctx: RenderCtx,
  audioPath: string,
  outPath: string,
  opts: {
    texture?: number;
    crf?: number;
    preset?: string;
    /** 封面 PNG，会顶在最前面当第一帧 */
    coverPng?: Buffer;
    /** 封面占几帧，默认 1（约 33ms，肉眼看不见但平台取得到） */
    coverFrames?: number;
  } = {}
): Promise<void> {
  // texture=0 就不叠纸纹
  const strength = opts.texture ?? 0.38;
  const texture = strength > 0 ? ensureTexture(strength) : null;
  const body = Math.ceil(ctx.tl.duration * FPS);
  // 封面帧顶在最前面。音轨那边已经补了等长的静音，不会错位。
  const lead = opts.coverPng ? Math.max(1, opts.coverFrames ?? 1) : 0;
  const total = body + lead;

  const args = texture
    ? [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-framerate', String(FPS),
    '-loop', '1',
    '-i', texture,
    '-i', audioPath,
    '-filter_complex',
    `[1:v]scale=${W}:${H}[t];[0:v][t]overlay=0:0:format=auto,format=yuv420p[v]`,
    '-map', '[v]',
    '-map', '2:a',
    '-c:v', 'libx264',
    '-preset', opts.preset ?? 'medium',
    '-crf', String(opts.crf ?? 20),
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-frames:v', String(total),
    '-t', (total / FPS).toFixed(3),
    '-movflags', '+faststart',
    outPath,
      ]
    : [
    '-y',
    '-f', 'image2pipe',
    '-framerate', String(FPS),
    '-i', 'pipe:0',
    '-i', audioPath,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'libx264',
    '-preset', opts.preset ?? 'medium',
    '-crf', String(opts.crf ?? 20),
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-frames:v', String(total),
    '-t', (total / FPS).toFixed(3),
    '-movflags', '+faststart',
    outPath,
      ];

  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => {
    err += d.toString();
    if (err.length > 40000) err = err.slice(-20000);
  });

  const done = new Promise<void>((resolve, reject) => {
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}\n${err.slice(-3000)}`))));
    ff.on('error', reject);
  });

  const t0 = Date.now();
  const n = Number(process.env.JOKE_WORKERS) || Math.min(6, Math.max(1, cpus().length - 2));
  const pool = n > 1 ? makeRasterPool(n) : null;
  console.log(pool ? `  光栅化用 ${n} 线程` : '  光栅化单线程（JOKE_WORKERS=1）');

  // 在飞的帧数上限。给到线程数的 3 倍，让先算完的帧有地方等，
  // 不至于因为等某一帧写出去就把所有 worker 都晾着。
  // 再大只是多占内存（一帧 PNG 两三百 KB），换不到速度。
  const WINDOW = pool ? pool.size * 3 : 1;
  const active = new Map<number, Promise<Buffer>>();
  let cursor = 0;

  const svgOf = (f: number) => renderFrame(ctx, f - lead);
  const dispatch = () => {
    while (active.size < WINDOW && cursor < total) {
      const f = cursor++;
      active.set(
        f,
        f < lead
          ? Promise.resolve(opts.coverPng!)
          : pool
          ? pool.raster(svgOf(f))
          : Promise.resolve(svgToPng(svgOf(f)))
      );
    }
  };

  try {
    dispatch();
    // **按帧号顺序消费**：派发是乱序完成的，这里一帧一帧 await，
    // ffmpeg 收到的顺序就一定是对的
    for (let f = 0; f < total; f++) {
      const png = await active.get(f)!;
      active.delete(f);
      dispatch(); // 腾出一个位置就补一帧进去，池子始终是满的
      if (!ff.stdin.write(png)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()));
      if (f % 30 === 0 || f === total - 1) {
        const pct = (((f + 1) / total) * 100).toFixed(0);
        const spf = (Date.now() - t0) / (f + 1);
        const eta = ((total - f - 1) * spf) / 1000;
        process.stdout.write(`\r  渲染中 ${pct}%  (${f + 1}/${total} 帧, 剩余约 ${eta.toFixed(0)}s)   `);
      }
    }
  } finally {
    await pool?.close();
  }
  ff.stdin.end();
  await done;
  process.stdout.write('\n');
  console.log(`  渲染耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s（${(((Date.now() - t0) / total)).toFixed(0)} ms/帧）`);
}

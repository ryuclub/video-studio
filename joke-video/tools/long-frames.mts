// ── 长片：按对齐好的配音出帧，再合成成片 ────────────────────────────
//
// 用法：
//   npx tsx tools/long-frames.mts jokes/laoma-long-001.json <音轨.wav> <输出.mp4>
//
// ── 它替掉了方案里的 animatic.js ──
//
// 素材包那份 `animatic.js` 手写了一个 `seq`（[持续秒, 画面配置]），只覆盖 §六 傍晚
// 那一章、时长是估的。方案 §六之四 自己写着下一步：
// **「用每句音频的实际时长替换 seq 里的估算值 —— 动态分镜就变成成片的时间轴。」**
// 这个脚本就是那一步：谁在说、说什么、说多久、停多久，全是 `align` 回填的真实数字。
//
// 画面靠 `horse/长片/longform.cjs` 的 `frame()`（素材包给的渲染器）。

import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildTimeline } from '../src/beats/typeA.js';
import type { JokeCfg } from '../src/types.js';

const require = createRequire(import.meta.url);
const { frame } = require('../horse/长片/longform.cjs') as { frame: (o: Record<string, unknown>) => string };
const { Resvg } = require('@resvg/resvg-js');

const [cfgPath, audio, out] = process.argv.slice(2);
if (!cfgPath || !audio || !out) {
  console.log('用法：npx tsx tools/long-frames.mts <稿件.json> <音轨.wav> <输出.mp4>');
  process.exit(1);
}

/** 成片 12fps（方案 §六之五：8fps 时鱼有轻微台阶感） */
const FPS = 12;

/**
 * 章 → 场景 ＋ 标牌上写什么（《完整出片方案》§二 的六个场景）。
 *
 * ⚠ **八、晚上老牛不在场**（他已经走了）—— 那一章 `two:false`，
 * 画面上只剩老马和窗台上的鱼缸。这是全片最后一个视觉事实。
 */
const SCENE: Record<string, { scene: string; two: boolean; label: string }> = {
  '一、早上': { scene: 'office_dawn', two: true, label: '工位 · 清晨' },
  '二、老牛是谁': { scene: 'office_day', two: true, label: '工位 · 白天' },
  '三、他为什么走': { scene: 'corridor', two: true, label: '楼道' },
  '四、中午': { scene: 'dinner', two: true, label: '饭桌' },
  '五、下午': { scene: 'office_day', two: true, label: '工位 · 下午' },
  '六、傍晚': { scene: 'street_dusk', two: true, label: '楼下 · 傍晚' },
  '七、然后': { scene: 'street_dusk', two: true, label: '楼下 · 傍晚' },
  '八、晚上': { scene: 'office_night', two: false, label: '工位 · 夜' },
};

/** 鱼在缸里左右游（方案 §三：红点的移动轨迹本身就是故事线） */
const fishAt = (t: number) =>
  Math.max(0.06, Math.min(0.94, 0.5 + 0.3 * Math.sin(t * 0.55) + 0.12 * Math.sin(t * 1.31 + 1.2)));

/**
 * 旁白**只去句末标点，句中的照留**（2026-08-25 用户定，改过一次）。
 *
 * 头一版把逗号也换成了全角空格 —— 那是短片那条线的规矩（`tidyCaption`：
 * 结尾不留标点 ＋ 句中句号换逗号）。**长片不照搬**：长句里逗号是断句的手，
 * 去掉之后一整行读起来是平的。引号也去掉 —— 屏幕上那对符号比它标出来的东西还显眼。
 */
const stripTail = (s: string) => s.replace(/["‘’“”]/g, '').replace(/[。！？，、；：]+$/, '').trim();


/** 一句话拆成几小句（按句末标点）。**旁白太长就逐句上**，不再一次铺三行 */
const cut = (s: string): string[] => (s.match(/[^。！？]*[。！？]|[^。！？]+$/g) ?? [s]).map((x) => x.trim()).filter(Boolean);

/** 一小句里再断行：≤18 字一行，最多两行（三行会顶到画面中间） */
function wrapOne(text: string, max = 18): string[] {
  const chars = [...text];
  if (chars.length <= max) return [text];
  const half = Math.ceil(chars.length / 2);
  return [chars.slice(0, half).join(''), chars.slice(half).join('')];
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as JokeCfg & {
  _sections?: Array<{ name: string; from: number; to: number }>;
};
const tl = buildTimeline(cfg);
const sections = cfg._sections ?? [];
const secOfLine = (i: number) => sections.find((s) => i >= s.from && i <= s.to)?.name ?? sections[0]?.name;
const txt = (l: (typeof cfg.lines)[number]) => (l.say ?? []).map((s) => s.text).join('');

const DIR = `${tmpdir()}/laoma-long-frames`;
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const FONTS = [
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/msyh.ttc',
  '../fonts/ZCOOLKuaiLe-Regular.ttf',
  '../fonts/smiley-sans-v2.0.1/SmileySans-Oblique.otf',
];
const opt = { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Microsoft YaHei' } };
const MOUTH = ['A', 'O', 'E', 'I'];

const N = Math.round(tl.duration * FPS);
const t0 = Date.now();

/**
 * ⚠ **句与句之间那 0.2 秒不落在任何一段里**（`padBefore` 是段外的留白），
 * 而 `find` 找不到就得给个东西 —— 头一版回退到了「最后一章」，于是
 * **每说完一句就闪一下夜景**，第 0 帧也是夜景（第一句从 0.2 秒才起）。
 *
 * 现在：空隙里**沿用上一帧的场景**，开头沿用第一章。
 * 场景是连续的，人物站在那儿不会因为他停了半秒就换个屋子。
 */
let lastPlace = SCENE[sections[0]?.name ?? '一、早上'] ?? SCENE['一、早上'];

for (let f = 0; f < N; f++) {
  const t = f / FPS;
  const seg = tl.segments.find((s) => s.kind === 'line' && t >= s.start && t < s.end);
  const li = seg?.lineIndex;
  const line = li !== undefined ? cfg.lines[li] : undefined;
  if (li !== undefined) {
    const nm = secOfLine(li);
    if (nm && SCENE[nm]) lastPlace = SCENE[nm];
  }
  const place = lastPlace;

  const o: Record<string, unknown> = {
    scene: place.scene,
    two: place.two,
    label: place.label,
    t,
    fish: fishAt(t),
  };

  if (line) {
    const body = txt(line);
    const dur = line.silent ?? line.dur ?? 0;
    const speaking = t < seg!.start + dur;
    const k = Math.floor(t / 0.17);
    // **层次由稿子标死**（`_layer`：旁白／台词／回忆），不按句长猜 ——
    // 「老牛在这儿待了六年」11 个字，猜出来是台词，其实是旁白
    const layer = (line as { _layer?: string })._layer ?? '旁白';

    if (line.who === 'niu') {
      o.niu = body;
      if (speaking) o.mouthNiu = MOUTH[(k + 2) % 4];
    } else if (layer === '台词' || layer === '回忆') {
      o.ma = body;
      if (speaking) o.mouthMa = MOUTH[k % 4];
    } else {
      // ── 旁白：逐句上，从下往上浮 ──
      //
      // 一整段铺三行，观众读完还得等他念完；拆成小句、跟着念到哪一句就上哪一句，
      // 每一句自己浮上来。小句的时长按字数摊（跟 `partSpans` 一个算法）。
      const parts = cut(body);
      const chars = parts.map((p) => Math.max(1, [...p].length));
      const total = chars.reduce((a, b) => a + b, 0);
      let acc = seg!.start;
      let cur = parts.length - 1;
      let curStart = seg!.start;
      for (let i = 0; i < parts.length; i++) {
        const d = (dur * chars[i]) / total;
        if (t < acc + d || i === parts.length - 1) {
          cur = i;
          curStart = acc;
          break;
        }
        acc += d;
      }
      o.narr = wrapOne(stripTail(parts[cur]));
      o.narrProg = Math.min(1, (t - curStart) / 0.28); // 0.28 秒浮完
      if (speaking) o.mouthMa = MOUTH[k % 4];
    }
  }

  writeFileSync(`${DIR}/f${String(f).padStart(5, '0')}.png`, new Resvg(frame(o), opt).render().asPng());
  if (f % 240 === 0) process.stdout.write(`\r  ${f}/${N} 帧　${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`\r  ${N} 帧渲完，${((Date.now() - t0) / 1000).toFixed(0)}s`);

const r = spawnSync(
  'ffmpeg',
  ['-hide_banner', '-y', '-framerate', String(FPS), '-i', `${DIR}/f%05d.png`, '-i', audio,
   '-vf', 'fps=24,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-shortest', out],
  { encoding: 'utf8' }
);
if (r.status !== 0) {
  console.error(r.stderr?.split('\n').slice(-12).join('\n'));
  process.exit(1);
}
console.log(`→ ${out}`);

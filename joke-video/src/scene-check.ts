// ── 构图护栏：量出「这张图有没有伸进题字栏」 ──────────────────────────
//
// 用法：npm run scene:check                全部构图扫一遍
//       npm run scene:check -- 东廊 背像     只查这几个
//       npm run scene:check -- --png        顺带把越界的那几张存下来看
//
// ── 为什么要有这一道 ──
//
// `shuoshu-scene.ts` 文件头写着一条硬约束：**x > 1620、y 90–1050 不要放深墨** ——
// 那是右栏两列竖排字（题字 / 幕名）和朱印的地盘，构图伸进去就压在字上。
//
// 这条规矩撞过四次：
//   · E05 三次（灯市 / 满阶花 / 灯下 的屋顶伸到 x≈1750，朱印压在瓦上）
//   · E06 差点第四次（新加的六张里五张屋顶越界，写 scenes.json 的时候手工核出来的）
//
// **撞过三次半还在靠人记，就该进机器了。** 而且它完全是可以量的：
// 构图是确定性的（同一个 seed 渲出来一模一样），把右栏摘掉渲一张，
// 数一数那块区域里有多少深墨像素就行。
//
// 这跟 `cast-check.ts` 是同一类东西：**改了共享的东西之后跑一次的护栏**，
// 不是每次出片都跑的体检（全扫一遍一分多钟，挂在 ship 上太贵）。加了新构图就跑它。
//
// ── 判据是标定出来的，不是推出来的 ──
//
// 宣纸 #EDE4D2 亮度约 231，浓墨 #1A2028 约 31。单层叠上去：
//   透明度 0.2 → 191　　0.5 → 131　　0.78 → 75　　0.86 → 59
//
// 头一版按这张表取了 150，**当场翻车**：夜路和路上各报四万像素，
// 而那两张右边什么都没有。原因是 `mountains()` 画三层，**层与层是叠加的** ——
// 0.13 / 0.22 / 0.31 三层合起来等效 0.53，亮度落到 ≈152，正好压在 150 上，
// 湿边滤镜再一抖就有一半像素掉到界下。**一整片远山被判成了深墨。**
//
// 所以界压到 **110**，拿六张已知的图标定过：
//
//   夜路 41044 → 216　　路上 40364 → 0　　背像 712 → 4     （远山/树，本来就不该算）
//   东廊  2552 → 2448　 墙头  1280 → 1208　灯市  512 → 464 （屋顶/墙帽，本来就该算）
//
// 两类差着一个数量级，界划在 110–300 之间都成立。**容差取 300。**
// 灯市那 464 是真的（E05 的朱印就压在那片瓦上），所以容差不能放到 500。
//
// 教训跟这条线别的坑一样：**要知道多少算多，就在渲出来的图上量，别按公式推。**

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { COMPOSITION_NAMES, bareSvg, SW, SH } from './shuoshu-scene.js';
import { resolveEp } from './shuoshu-ep.js';

/** 右栏的地盘。跟 shuoshu-scene.ts 文件头那条注释是同一组数 */
export const ZONE = { x0: 1620, y0: 90, y1: 1050 };
/** 亮度低于这个就算深墨 */
const DARK = 110;
/**
 * 容差（全尺寸像素数）。湿边滤镜（feTurbulence + feDisplacementMap）会把墨迹
 * 推出去几个像素，边界上飘一点是正常的。
 * **300 是标定出来的**，见文件头那张表 —— 再放大就漏掉灯市那 464，
 * 而那一片瓦正是 E05 把朱印压没了的地方。
 */
const TOLERANCE = 300;
/** 渲图缩放。半尺寸够量了，而且快四倍 */
const SCALE = 0.5;

export interface SceneVerdict {
  comp: string;
  /** 区域里的深墨像素数，已折算回全尺寸 */
  dark: number;
  /** 越界那一块最左伸到哪儿（全尺寸 x）。没越界就没有 */
  leftmost?: number;
  ok: boolean;
}

/**
 * 渲一张「只有纸和构图」的图，量右栏区域里的深墨。
 *
 * **seed 用固定值。** 构图里的手抖是按 seed 定的，换个 seed 边界会飘几像素；
 * 护栏要的是可复现的判断，不是抽签。真正越界的那种飘几像素也还是越界。
 */
export function checkComposition(comp: string, seed = 7): SceneVerdict {
  const w = Math.round(SW * SCALE);
  const img = new Resvg(bareSvg(comp, seed), {
    fitTo: { mode: 'width', value: w },
    // **关掉系统字体扫描。** 这里一个字都不画，而 resvg 每次实例化扫一遍系统字体
    // 要半秒 —— 音波层那边实测从 2 张/秒 提到 350 张/秒，就是这一行。
    font: { loadSystemFonts: false, fontFiles: [] },
  }).render();

  const px = img.pixels;
  const W = img.width;
  const H = img.height;
  const sx = W / SW;
  const sy = H / SH;
  const zx0 = Math.round(ZONE.x0 * sx);
  const zy0 = Math.round(ZONE.y0 * sy);
  const zy1 = Math.round(ZONE.y1 * sy);

  let dark = 0;
  let leftmost = W;
  for (let y = zy0; y < zy1; y++) {
    for (let x = zx0; x < W; x++) {
      const i = (y * W + x) * 4;
      // 亮度：不用管 alpha，resvg 已经合到纸上了
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (lum < DARK) {
        dark++;
        if (x < leftmost) leftmost = x;
      }
    }
  }
  // 折算回全尺寸：半尺度下一个像素等于四个
  const full = Math.round(dark / (sx * sy));
  return {
    comp,
    dark: full,
    leftmost: full > TOLERANCE ? Math.round(leftmost / sx) : undefined,
    ok: full <= TOLERANCE,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const savePng = argv.includes('--png');
  // --ep E06：只查这一期用到的构图。全扫 84 个要一分多钟，挂在 ship 上太贵；
  // 一期用十几个，十几秒 —— 这样它才有资格每次出片都跑。
  const epIdx = argv.indexOf('--ep');
  const want = epIdx >= 0
    ? (() => {
        const { dir } = resolveEp(argv);
        const f = `${dir}/scenes.json`;
        if (!existsSync(f)) return [];
        const doc = JSON.parse(readFileSync(f, 'utf8')) as { scenes: { comp: string }[] };
        return [...new Set(doc.scenes.map((s) => s.comp))];
      })()
    : argv.filter((a) => !a.startsWith('-') && a !== argv[epIdx + 1]);
  const comps = want.length ? want : COMPOSITION_NAMES;

  const bad = want.filter((c) => !COMPOSITION_NAMES.includes(c));
  if (bad.length) {
    console.error(`没有这个构图：${bad.join(' / ')}`);
    process.exit(1);
  }

  console.log(`构图护栏｜题字栏 x>${ZONE.x0}、y ${ZONE.y0}–${ZONE.y1} 不许有深墨`);
  console.log(`（容差 ${TOLERANCE} 像素，湿边滤镜会飘一点）\n`);

  const t0 = Date.now();
  const verdicts = comps.map(checkComposition);
  const over = verdicts.filter((v) => !v.ok);

  for (const v of over)
    console.log(`  ✗ ${v.comp.padEnd(8)} 深墨 ${String(v.dark).padStart(6)} 像素，最左伸到 x=${v.leftmost}`);

  if (savePng && over.length) {
    mkdirSync('out/构图越界', { recursive: true });
    for (const v of over) {
      const png = new Resvg(bareSvg(v.comp, 7), {
        fitTo: { mode: 'original' },
        font: { loadSystemFonts: false, fontFiles: [] },
      })
        .render()
        .asPng();
      writeFileSync(`out/构图越界/${v.comp}.png`, png);
    }
    console.log(`\n  越界的 ${over.length} 张存到 out/构图越界/`);
  }

  console.log(`\n${comps.length} 个构图，${over.length} 个越界　（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  if (over.length) {
    console.log(
      '\n越界不等于必须改 —— **E01–E05 已经发布，那几期不回改**（规矩：已出片的不动）。\n' +
        '但新加的构图应该是干净的：把伸过去的元素往左收，或者把它压到 y>1050。\n' +
        '⚠ 这不是渲染报错。resvg 画到字底下不会吭声，只有出片之后用眼睛才看得见。'
    );
    // 已发布的那几期还越着界，所以**默认不掐断** —— 掐断的话这条护栏一天都活不下去。
    // 要当硬闸用（比如 CI）就加 --strict。
    if (argv.includes('--strict')) process.exit(1);
  }
}

if (process.argv[1]?.includes('scene-check')) main();

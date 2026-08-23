// ── 场景库：每个场景都是「远景 / 中景 / 近景」三层色块 ────────────────
// 推镜时三层不同速率移动 → 静图立刻有空间感（这是"伪B层"最便宜的动感来源）

import { piece, tornRect, tornEllipse, toPath, capsule, rng, n } from '../style/papercut.js';
import { P } from '../style/palette.js';
import { W, H, GROUND } from '../config.js';
import { scene as horseScene, SCENES as HORSE_SCENE_TABLE, GROUND as HORSE_GROUND } from '../../horse/scenes.mjs';
import { dressing } from '../../horse/dressing.mjs';
import { titleAbove as plaqueTitle } from '../../horse/plaque.mjs';

export interface Layers {
  far: string;
  mid: string;
  near: string;
  /**
   * 这个场景在 x 处的地面高度。不写就是平地 GROUND。
   *
   * **地面不平的场景必须实现它。** 角色和道具都按这个值落脚——
   * hillside 是条斜坡，早先大家一律站 GROUND，左边的悬空、右边的陷进土里。
   */
  ground?: (x: number) => number;
}
export type Scene = (ink: (c: string) => string, seed: number) => Layers;

function grassBlades(ink: (c: string) => string, seed: number, y: number, count: number, h: number, color: string, alpha = 1) {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = (i / count) * (W + 160) - 80 + (r() - 0.5) * 30;
    const hh = h * (0.6 + r() * 0.8);
    const bend = (r() - 0.5) * 70;
    out += `<path d="${toPath([
      [x - 11, y],
      [x + bend * 0.5, y - hh * 0.6],
      [x + bend, y - hh],
      [x + bend + 6, y - hh * 0.96],
      [x + 11, y],
    ])}" fill="${ink(color)}" opacity="${alpha}"/>`;
  }
  return out;
}

const grass: Scene = (ink, seed) => ({
  far:
    piece(tornRect(-120, 0, W + 240, GROUND - 210, seed + 1, 2, 40), ink(P.paperDeep), { shadow: false }) +
    piece(tornEllipse(W * 0.22, GROUND - 300, 300, 140, seed + 2, 2.4, 30), ink(P.neutral), { shadow: false, opacity: 0.28 }) +
    piece(tornEllipse(W * 0.82, GROUND - 250, 250, 110, seed + 3, 2.4, 30), ink(P.neutral), { shadow: false, opacity: 0.22 }) +
    `<circle cx="${W * 0.78}" cy="${GROUND - 700}" r="86" fill="${ink(P.accent)}" opacity="0.5"/>` +
    // 云：填一点天空的空
    piece(tornEllipse(W * 0.24, GROUND - 900, 210, 74, seed + 21, 2.2, 30), ink(P.paper), { shadow: false, opacity: 0.85 }) +
    piece(tornEllipse(W * 0.38, GROUND - 940, 130, 56, seed + 22, 2.2, 28), ink(P.paper), { shadow: false, opacity: 0.8 }) +
    piece(tornEllipse(W * 0.7, GROUND - 1060, 160, 60, seed + 23, 2.2, 28), ink(P.paper), { shadow: false, opacity: 0.7 }),
  mid:
    piece(tornRect(-120, GROUND - 200, W + 240, H, seed + 4, 2.2, 44), ink('#B9C4A0'), { shadow: false }) +
    grassBlades(ink, seed + 5, GROUND - 170, 26, 150, '#95A67C', 0.85),
  near:
    grassBlades(ink, seed + 7, H - 60, 16, 400, '#6E7F57', 0.95) +
    grassBlades(ink, seed + 9, H + 30, 11, 520, '#4E5C3E', 1),
});

const room: Scene = (ink, seed) => ({
  far:
    piece(tornRect(-120, 0, W + 240, GROUND - 120, seed + 1, 2, 40), ink(P.paperDeep), { shadow: false }) +
    // 窗
    piece(tornRect(W * 0.58, 380, 380, 420, seed + 2, 1.8, 22), ink('#BFD0DC'), { dy: 6 }) +
    `<path d="${capsule(W * 0.58 + 190, 380, W * 0.58 + 190, 800, 8)}" fill="${ink(P.paper)}"/>` +
    `<path d="${capsule(W * 0.58, 590, W * 0.58 + 380, 590, 8)}" fill="${ink(P.paper)}"/>`,
  mid: piece(tornRect(-120, GROUND - 110, W + 240, H, seed + 4, 2.2, 44), ink('#CDB89A'), { shadow: false }),
  near: piece(tornRect(-140, H - 300, W + 280, 400, seed + 6, 2.4, 40), ink('#8B6F4E'), { shadow: false }),
});

const office: Scene = (ink, seed) => ({
  far:
    piece(tornRect(-120, 0, W + 240, GROUND - 130, seed + 1, 2, 40), ink('#DCD8CC'), { shadow: false }) +
    piece(tornRect(120, 300, 300, 210, seed + 2, 1.6, 20), ink(P.primary), { dy: 6, opacity: 0.28 }) +
    piece(tornRect(560, 360, 380, 150, seed + 3, 1.6, 20), ink(P.neutral), { dy: 6, opacity: 0.3 }),
  mid: piece(tornRect(-120, GROUND - 120, W + 240, H, seed + 4, 2.2, 44), ink('#C6BEAC'), { shadow: false }),
  near: piece(tornRect(-140, H - 260, W + 280, 360, seed + 6, 2.4, 40), ink('#5E5346'), { shadow: false }),
});

const street: Scene = (ink, seed) => ({
  far:
    piece(tornRect(-120, 0, W + 240, GROUND - 160, seed + 1, 2, 40), ink('#CBD8DF'), { shadow: false }) +
    [0.08, 0.3, 0.52, 0.78].map((k, i) =>
      piece(tornRect(W * k - 60, GROUND - 160 - (280 + i * 130), 210, 300 + i * 140, seed + 10 + i, 1.8, 26), ink(P.neutral), {
        shadow: false,
        opacity: 0.3 + i * 0.08,
      })
    ).join(''),
  mid: piece(tornRect(-120, GROUND - 150, W + 240, H, seed + 4, 2.2, 44), ink('#9E9A92'), { shadow: false }),
  near: piece(tornRect(-140, H - 220, W + 280, 320, seed + 6, 2.4, 40), ink('#3E3B36'), { shadow: false }),
});

const abstract: Scene = (ink, seed) => ({
  far:
    piece(tornRect(-120, 0, W + 240, H, seed + 1, 2, 60), ink(P.paperDeep), { shadow: false }) +
    piece(tornEllipse(W * 0.5, GROUND - 520, 380, 380, seed + 2, 2.6, 40), ink(P.accent), { shadow: false, opacity: 0.28 }),
  mid: piece(tornRect(-120, GROUND - 90, W + 240, H, seed + 4, 2.4, 50), ink(P.neutral), { shadow: false, opacity: 0.35 }),
  near: '',
});

/**
 * 海边礁石。
 *
 * 中景那几块礁石是**故意**跟龟壳同色系（都走 P.neutral 一族）——
 * 「远处一块灰色的石头缓缓抬起头」这个梗要成立，龟妈妈缩着头时必须和背景礁石
 * 混在一起。改这里的颜色前先想想会不会把梗改没了。
 */
const shore: Scene = (ink, seed) => {
  const sea = GROUND - 250; // 海平线
  const r = rng(seed + 77);
  // 远处礁石群：大小错落，别排成一行
  let rocks = '';
  for (const [k, w, h, o] of [
    [0.1, 150, 78, 0.5],
    [0.29, 96, 50, 0.42],
    [0.62, 190, 96, 0.55],
    [0.86, 120, 62, 0.45],
  ] as [number, number, number, number][]) {
    rocks += piece(tornEllipse(W * k + (r() - 0.5) * 40, sea + 6, w, h, seed + 40 + w, 2.6, 26), ink(P.neutral), {
      shadow: false,
      opacity: o,
    });
  }
  // 浪线：三条横向短线，比画浪花便宜得多，也更贴剪纸风
  let waves = '';
  for (let i = 0; i < 7; i++) {
    const wy = sea + 40 + i * 26;
    const wx = (r() - 0.5) * 200;
    waves += `<path d="${capsule(W * 0.12 + wx, wy, W * 0.12 + wx + 150 + r() * 180, wy, 5)}"
      fill="${ink(P.paper)}" opacity="${0.5 - i * 0.05}"/>`;
  }
  return {
    far:
      piece(tornRect(-120, 0, W + 240, sea, seed + 1, 2, 40), ink('#DCDCD2'), { shadow: false }) +
      `<circle cx="${W * 0.74}" cy="${sea - 520}" r="78" fill="${ink(P.accent)}" opacity="0.42"/>` +
      piece(tornEllipse(W * 0.2, sea - 700, 200, 66, seed + 21, 2.2, 28), ink(P.paper), { shadow: false, opacity: 0.8 }) +
      piece(tornEllipse(W * 0.62, sea - 800, 150, 54, seed + 22, 2.2, 28), ink(P.paper), { shadow: false, opacity: 0.65 }) +
      // 海面
      piece(tornRect(-120, sea, W + 240, 300, seed + 3, 2.4, 44), ink('#9FB6BE'), { shadow: false }) +
      rocks +
      waves,
    mid:
      // 沙滩
      piece(tornRect(-120, GROUND - 150, W + 240, H, seed + 4, 2.2, 44), ink('#D8C9AC'), { shadow: false }) +
      // 角色脚下的礁石台
      piece(tornEllipse(W * 0.5, GROUND + 40, 520, 120, seed + 5, 2.8, 32), ink('#A79C8C'), { shadow: false, opacity: 0.7 }),
    near:
      piece(tornEllipse(W * 0.12, H - 90, 260, 130, seed + 6, 3, 30), ink('#6F6659'), { shadow: false }) +
      piece(tornEllipse(W * 0.92, H - 40, 300, 150, seed + 7, 3, 30), ink('#5C5449'), { shadow: false }),
  };
};



// ── 儿童睡前故事用：调子要比段子亮、暖，不能有段子那种冷幽默的灰 ──────

/**
 * 小花：红黄紫三色随机撒。故事原文点名了这三色，别自己改。
 *
 * `groundAt` 是地面高度函数——**花必须贴着地面长**。
 * 早先用固定 y，坡是斜的，左半边的花就全飘到天上去了。
 */
function flowers(
  ink: (c: string) => string,
  seed: number,
  groundAt: (x: number) => number,
  spanY: number,
  count: number,
  scale = 1
) {
  const r = rng(seed);
  const COLORS = ['#E8564A', '#F2C230', '#A879C9'];
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = r() * (W + 120) - 60;
    const y = groundAt(x) + 30 + r() * spanY;
    const s = (0.7 + r() * 0.6) * scale;
    const c = ink(COLORS[Math.floor(r() * 3)]);
    // 五瓣：四周四片 + 中心一点，比画真花瓣便宜得多也更贴绘本
    out += `<g transform="translate(${n(x)},${n(y)}) scale(${n(s)})">`;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      out += `<circle cx="${n(Math.cos(a) * 9)}" cy="${n(Math.sin(a) * 9)}" r="7" fill="${c}"/>`;
    }
    out += `<circle cx="0" cy="0" r="5" fill="${ink('#FFF2C4')}"/></g>`;
  }
  return out;
}

/**
 * 带花的草坡 —— 《小老鼠做蛋糕》主场景，8 个镜头里 7 个用它。
 *
 * 关键是**要看得出是坡**：地平线做成斜的，右高左低。
 * 现有 grass 是平地，放这个故事里"上山坡去玩""滚下去"都立不住。
 */
const hillside: Scene = (ink, seed) => {
  const r = rng(seed + 5);
  // 坡面：右高左低的一条曲线
  const slope = (x: number) => GROUND + 150 - (x / W) * 330;
  const slopePath = () => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) {
      const x = -80 + (i / 12) * (W + 160);
      pts.push([x, slope(x) + Math.sin(i * 1.7) * 12]);
    }
    return toPath([...pts, [W + 80, H + 40], [-80, H + 40]]);
  };
  return {
    ground: slope,
    far:
      // 天空铺到画布底，别只铺到 GROUND —— 坡在左边低于 GROUND，
      // 少铺那一块会从坡下露出页面底色（一道米色楔子）
      piece(tornRect(-120, 0, W + 240, H + 60, seed + 1, 2, 40), ink('#DCEBF2'), { shadow: false }) +
      `<circle cx="${W * 0.76}" cy="${GROUND - 1090}" r="92" fill="${ink('#FFD75E')}" opacity="0.75"/>` +
      // 远山：底边要压到坡线以下，不然像两团绿云飘在天上
      // 三层山脊，从远到近压低。**最远那层决定天空占多少**——
      // 早先只有两层、山顶在 y≈880，天空吃掉画幅 46%，角色缩在下三分之一。
      piece(tornEllipse(W * 0.32, GROUND - 330, 470, 400, seed + 4, 2.6, 30), ink('#BFD9B4'), { shadow: false, opacity: 0.6 }) +
      piece(tornEllipse(W * 0.86, GROUND - 250, 400, 350, seed + 3, 2.6, 30), ink('#A9CBA0'), { shadow: false, opacity: 0.72 }) +
      piece(tornEllipse(W * 0.24, GROUND - 60, 380, 270, seed + 2, 2.6, 30), ink('#8FBC8A'), { shadow: false, opacity: 0.8 }) +
      piece(tornEllipse(W * 0.2, GROUND - 960, 220, 78, seed + 21, 2.2, 30), ink('#FFFFFF'), { shadow: false, opacity: 0.85 }) +
      piece(tornEllipse(W * 0.62, GROUND - 1030, 160, 60, seed + 22, 2.2, 28), ink('#FFFFFF'), { shadow: false, opacity: 0.7 }),
    mid: `<path d="${slopePath()}" fill="${ink('#9BD07A')}"/>` + flowers(ink, seed + 7, slope, 300, 30, 0.9),
    near:
      grassBlades(ink, seed + 9, H - 40, 14, 260, '#6FA854', 0.9) +
      flowers(ink, seed + 11, () => H - 220, 170, 9, 1.7),
  };
};

/**
 * 坡下的乱石 —— 镜头3「突然看见山坡下全是大石头」专用。
 * 石头要占满下半画面，一眼看出"滚下去会撞碎"。
 */
const hillrocks: Scene = (ink, seed) => {
  const r = rng(seed + 13);
  // 坡沿的高度。420 时角色被挤在画幅最顶上一条；700 让角色有位置站，
  // 石头照样铺满下面六成，坡下全是大石头的信息一点没丢。
  const EDGE = 700;

  // 坡顶绿边的上沿。mid 层画这条折线，ground 也用它——**两者必须同一份坐标**，
  // 各写各的迟早对不上，角色就会浮在草皮上方或陷进去。
  const RIM: [number, number][] = [
    [-80, EDGE - 120],
    [W * 0.32, EDGE - 165],
    [W * 0.68, EDGE - 100],
    [W + 80, EDGE - 150],
  ];
  const rimY = (x: number) => {
    for (let i = 1; i < RIM.length; i++) {
      if (x <= RIM[i][0] || i === RIM.length - 1) {
        const [x0, y0] = RIM[i - 1];
        const [x1, y1] = RIM[i];
        return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return EDGE;
  };

  // 石头：**别按行排**。三条整齐的横带一眼假，要按面积随机撒、大小混着来、彼此压叠
  const rocks: string[] = [];
  const N = 60;
  for (let i = 0; i < N; i++) {
    // y 用均匀分布铺满整个石头区，别用幂函数——那会把石头全堆到下半，
    // 上面留一大片没内容的土色。「全是大石头」要的是铺满。
    const y = EDGE + 30 + ((i + r() * 0.9) / N) * (H - EDGE + 60);
    const depth = (y - EDGE) / (H - EDGE); // 越靠下越近
    const w = (80 + depth * 170) * (0.6 + r() * 0.8);
    const x = r() * (W + 300) - 150;
    // 近的更深更实，远的更浅
    const col = depth > 0.66 ? '#6E685E' : depth > 0.33 ? '#8C867B' : '#A9A398';
    rocks.push(
      `<g data-y="${n(y)}">` +
        piece(tornEllipse(x, y, w, w * (0.6 + r() * 0.22), seed + 40 + i, 3, 26), ink(col), { shadow: false }) +
        `</g>`
    );
  }
  // 按 y 排序，靠下的后画（近的压住远的）
  rocks.sort((a, b) => Number(a.match(/data-y="([\d.-]+)"/)![1]) - Number(b.match(/data-y="([\d.-]+)"/)![1]));

  return {
    // 这一镜的地面是**坡顶那条绿边**，不是画面底部——我们站在坡上往下看，
    // 石头在脚下更远处。早先没实现这个，角色回退到平地 GROUND=1290，
    // 正好悬在石头堆中间，脚下什么都没有。
    // 落在绿边的**下沿**（草皮和石头交界那条线），不是上沿——
    // 落上沿时角色整个顶出画幅，头会被切掉。下沿正好是"站在坡沿往下看"。
    ground: () => EDGE + 10,
    far:
      // 天空 + 石缝里的土底，一直铺到画布底，不然会从石头之间露出页面米色
      piece(tornRect(-120, 0, W + 240, EDGE + 40, seed + 1, 2, 40), ink('#DCEBF2'), { shadow: false }) +
      piece(tornRect(-120, EDGE, W + 240, H + 60, seed + 2, 2, 44), ink('#BFB5A4'), { shadow: false }),
    // 坡顶那条绿边：交代"我们正站在坡上往下看"
    mid:
      `<path d="${toPath([
        ...RIM,
        [W + 80, EDGE + 30],
        [-80, EDGE + 30],
      ])}" fill="${ink('#9BD07A')}"/>` +
      grassBlades(ink, seed + 9, EDGE + 26, 18, 70, '#6FA854', 0.85) +
      rocks.join(''),
    near: '',
  };
};

/**
 * 池塘边 —— 《一页故事》第 01 页的主场景，也是**整季的锚点**。
 *
 * 第 30 页要求「拉开，是第 01 页那块石头，同一机位、同一光线」。
 * 所以这张场景里有两样东西**不许动**：
 *
 *   ① `ROCK_X` —— 那块石头的横坐标。回扣的全部力气都在"观众认得出这是同一块石头"，
 *      挪一次位置就等于换了块石头。
 *   ② 晨光的方向（太阳在左）和暖调。第 30 页也是春天早上，光反过来就不是"回到原地"了。
 *
 * 要做别的池塘场景（黄昏 / 冬天），**新写一个**，别在这里加参数。
 */
const pond: Scene = (ink, seed) => {
  const WATER = GROUND - 420; // 水面线
  const BANK = GROUND - 150; // 近岸线：水和岸的交界。两者差 270px，水面才看得出是一片水
  const ROCK_X = W * 0.9; // ← 整季常量，见上方说明

  // 芦苇：只长在**近岸线**上，而且**让开画面中间**——中间是角色的地盘，
  // 早先撒满全幅，出来是一片插在天上的细杆，把对岸和天空全戳花了
  const reeds = (() => {
    const rr = rng(seed + 61);
    let out = '';
    for (const [from, to, count] of [
      [-0.06, 0.26, 5],
      [0.66, 1.06, 5],
    ] as [number, number, number][]) {
      for (let i = 0; i < count; i++) {
        const x = W * (from + ((to - from) * (i + 0.5)) / count) + (rr() - 0.5) * 46;
        const hh = 130 * (0.72 + rr() * 0.6);
        const bend = (rr() - 0.5) * 34;
        // 穗子要**够肥**：早先穗只比杆粗一点，远看是一排光秃秃的杆子，像插了几根天线
        out +=
          `<path d="${capsule(x, BANK + 10, x + bend, BANK + 10 - hh, 8)}" fill="${ink('#6F8A5E')}" opacity="0.9"/>` +
          `<path d="${capsule(x + bend * 0.62, BANK + 10 - hh * 0.6, x + bend, BANK + 8 - hh, 26)}" fill="${ink('#5E7A50')}" opacity="0.9"/>`;
      }
    }
    return out;
  })();

  return {
    far:
      // 天空分两段：上冷下暖。**晨光靠这条暖带表达**，不是靠给太阳加个大光晕——
      // 光晕在剪纸风里一眼假，横向色带才是这套语汇里"天刚亮"的写法
      piece(tornRect(-120, 0, W + 240, WATER * 0.56, seed + 1, 2, 40), ink('#CBDFEA'), { shadow: false }) +
      piece(tornRect(-120, WATER * 0.52, W + 240, WATER - WATER * 0.52 + 40, seed + 2, 2.2, 44), ink('#F5DEBE'), {
        shadow: false,
      }) +
      // 低太阳：压得很低（快贴到对岸），才是"早上"而不是"中午"
      `<circle cx="${n(W * 0.22)}" cy="${n(WATER - 250)}" r="104" fill="${ink('#F4B860')}" opacity="0.85"/>` +
      // 对岸的树丛：底边压到水面线以下，不然像绿云飘着
      piece(tornEllipse(W * 0.06, WATER - 40, 300, 200, seed + 4, 2.6, 30), ink('#9FB58C'), { shadow: false, opacity: 0.75 }) +
      piece(tornEllipse(W * 0.44, WATER - 14, 250, 132, seed + 5, 2.6, 30), ink('#8CA67C'), { shadow: false, opacity: 0.8 }) +
      piece(tornEllipse(W * 0.88, WATER - 50, 330, 210, seed + 6, 2.6, 30), ink('#7E9A70'), { shadow: false, opacity: 0.85 }),
    mid:
      // 水面：一路铺到画布底，岸再盖在它上面。**别只铺到岸线**——
      // 两块torn边缘对不齐，中间会裂出一条页面米色的缝
      piece(tornRect(-120, WATER, W + 240, H, seed + 7, 2.4, 44), ink('#A6C2CC'), { shadow: false }) +
      // 太阳在水里的倒影：三条断开的横线，正对太阳的 x。断开才像水在动
      [0, 1, 2]
        .map((i) => {
          const wy = WATER + 62 + i * 66;
          const half = 120 - i * 30;
          // 倒影压得很淡：水面的一点碎光，不是三根白棍。0.6 那档远看是漂着的木条
          return `<path d="${capsule(W * 0.22 - half, wy, W * 0.22 + half, wy, 6)}" fill="${ink('#F4E2C4')}" opacity="${
            0.34 - i * 0.1
          }"/>`;
        })
        .join('') +
      // 岸：土黄绿，从近岸线一直铺到画布底
      piece(tornRect(-120, BANK, W + 240, H, seed + 8, 2.2, 44), ink('#B7C29B'), { shadow: false }) +
      reeds +
      // ── 那块石头 ──
      // 灰褐一族，跟龟壳同色系：小龟趴在旁边时人和石头是一体的，
      // 「他一直在那儿」这个印象靠这个色关系立住。别改成对比色。
      // **石头要矮、要压在地平线上。** 第一版 ry=140、顶在 GROUND-100，
      // 顶边正好横穿龟壳中间，出来是"小龟站在石头上"——一只趴着的乌龟爬上大石头，
      // 一眼就假。压到顶边只比脚底高一点，才是"地上躺着一块石头，龟在旁边"。
      piece(tornEllipse(ROCK_X, GROUND + 70, 150, 115, seed + 9, 3, 30), ink('#8B7E6E'), { shadow: false }) +
      piece(tornEllipse(ROCK_X - 34, GROUND - 8, 78, 36, seed + 10, 2.8, 28), ink('#A2968A'), { shadow: false, opacity: 0.8 }),
    near: grassBlades(ink, seed + 11, H - 60, 14, 320, '#6E8657', 0.92),
  };
};

/**
 * 屋檐底下 —— 第 01 页镜 2「猫搬去了屋檐底下」，第 22/29 页大概率还要用。
 *
 * 只交代"有个顶罩着"，**不下雨**。漏雨是后面旁白讲出来的，画面提前把雨下了，
 * 「他以为暖和、结果会漏」这个落差就没了。
 */
const eaves: Scene = (ink, seed) => {
  const EAVE = 430; // 檐口在画面上的高度：再低就把角色压扁，再高就不像"罩着"

  /** 檐口斜线：左低右高，y 随 x 走。屋顶、瓦垄、瓦当三样都读这一份坐标 */
  const edge = (x: number) => EAVE - (x / W) * 70;

  // 瓦垄：屋顶上一道道竖棱。**没有它屋顶就是一块褐色板子**——
  // 第一版就是那样，远看像画面顶上糊了块胶布，完全不像屋顶
  let ridges = '';
  for (let i = 0; i <= 15; i++) {
    const x = -60 + (i / 15) * (W + 120);
    ridges += `<path d="${capsule(x, -20, x - 26, edge(x) - 14, 13)}" fill="${ink('#5C4838')}" opacity="0.75"/>`;
  }

  // 瓦当：檐口下沿一排半圆，屋檐的辨识度基本全在这一排。压在檐线上，只露下半个
  let tiles = '';
  for (let i = 0; i < 15; i++) {
    const x = -30 + (i / 14) * (W + 60);
    tiles += `<circle cx="${n(x)}" cy="${n(edge(x) + 6)}" r="30" fill="${ink('#6B5140')}"/>`;
  }

  return {
    far:
      // 檐外的天：灰蓝，比 pond 冷一档 —— 猫是为了躲外面才钻进来的。
      // 从画布顶铺到地面，屋顶和墙再盖上去，缝隙处不会露页面米色
      piece(tornRect(-120, 0, W + 240, GROUND - 100, seed + 1, 2, 40), ink('#BFCBD2'), { shadow: false }) +
      // 墙：檐下那面
      piece(tornRect(-120, EAVE + 30, W + 240, GROUND - EAVE - 70, seed + 2, 2, 40), ink('#D8CFC0'), { shadow: false }) +
      // 墙裙：下半截深一档。一条横线就把墙的高度交代清楚了，也压住大片空墙
      piece(tornRect(-120, GROUND - 470, W + 240, 400, seed + 3, 2, 36), ink('#C6BAA8'), { shadow: false }) +
      // 窗：给猫一个"盯着看"的落点，第 22 页《猫在窗边坐了一整天》直接能用
      piece(tornRect(W * 0.6, EAVE + 150, 310, 330, seed + 4, 1.8, 22), ink('#8FA5B2'), { dy: 6 }) +
      `<path d="${capsule(W * 0.6 + 155, EAVE + 150, W * 0.6 + 155, EAVE + 480, 9)}" fill="${ink('#D8CFC0')}"/>` +
      `<path d="${capsule(W * 0.6, EAVE + 315, W * 0.6 + 310, EAVE + 315, 9)}" fill="${ink('#D8CFC0')}"/>`,
    mid:
      // 屋顶本体
      `<path d="${toPath([
        [-120, -40],
        [W + 120, -40],
        [W + 120, edge(W + 120)],
        [-120, edge(-120)],
      ])}" fill="${ink('#4A3A2E')}"/>` +
      ridges +
      tiles +
      // 地：檐下的石板
      piece(tornRect(-120, GROUND - 110, W + 240, H, seed + 6, 2.2, 44), ink('#A79C8C'), { shadow: false }) +
      // 石板缝：交代这是砌出来的地不是土。要**看得见**，太淡等于没画
      [140, 380, 640].map((dy, i) =>
          `<path d="${capsule(-120, GROUND + dy, W + 120, GROUND + dy, 6)}" fill="${ink('#7D7364')}" opacity="${0.55 - i * 0.1}"/>`
        ).join(''),
    near: piece(tornRect(-140, H - 170, W + 280, 270, seed + 7, 2.4, 40), ink('#6A6152'), { shadow: false }),
  };
};


// ── 老马线的场景：外挂 horse/scenes.mjs ──────────────────────────────
//
// 那 10 个场景是**另一套画风**（手绘线条，`horse/rough.mjs`），跟这边的剪纸风
// 不是一回事，所以不重画、直接外挂。两套画风并存是有意的：
// 段子/《一页故事》是剪纸，老马是手绘线条，观众一眼能分出是哪条线。
//
// 三处要接：
//
//   ① **地平线不一样。** 这边 GROUND=1290，那边 1500。
//      靠 `Layers.ground` 钩子解决 —— 那个钩子本来就是为「地面不在默认高度」写的。
//      不接的话马会悬在半空，而且**不报错**（layout 只对没实现 ground() 的场景报警）。
//   ② **只放一层。** 那边一个场景是一整张扁的图，没有远中近三层。
//      全部塞进 mid：推镜时整张一起动，手绘线条风本来也不该做视差。
//   ③ **颜色过 ink()。** 那边的颜色是写死的十六进制，
//      不换的话定格去色那一下背景还是彩的，而角色已经灰了。
//
// 场景名直接沿用（office-desk / elevator …），跟这边现有的十个不撞。

const horseInner = (name: string) => {
  // 那边返回的是完整 <svg>…</svg>，这儿只要里面的内容
  const raw = horseScene(name, 1);
  return raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
};

/**
 * 老马场景的适配层。
 *
 * ⚠ **摆件（`dressing`）跟场景画在同一层**，因为它就该跟桌面同深度 ——
 * 单独提一层做视差的话，桌上的杯子会跟桌子分家。
 *
 * ⚠ **摆件要传 `skip`（稿件的 `object`）**，否则会把台词点名的那件东西摆进画面，
 * 那正是 SCRIPT_GUIDE §五 禁的「图解台词」。这儿拿不到稿件，所以由调用方
 * （`render.ts` 的 `sceneFor`）透传下来。
 */
const horseAdapter =
  (name: string, dress?: { seed: number; skip?: string; title?: string; sub?: string }): Scene =>
  (ink, seed) => ({
    far: '',
    // seed 不透传：那边的笔触抖动按 seed 重洗，**逐帧渲的时候每帧重洗就是满屏跳**。
    // 固定成 1，整条片子共用同一张背景（跟 horse/render.mjs 的 sequence() 同一个道理）
    //
    // ⚠ **三样东西的画序**：场景 → 摆件 → 牌匾。都在 mid 这一层，
    // 所以三样都在**角色之下** —— 牌匾规矩第一条：「角色挡住它时才有空间感，
    // 画在角色之上就变回贴纸了」。
    mid: (
      horseInner(name) +
      (dress ? dressing(name, dress.seed, { skip: dress.skip }) : '') +
      (dress?.title
        ? plaqueTitle({ text: dress.title, sub: dress.sub ?? '', scene: name, n: dress.seed })
        : '')
    ).replace(/#[0-9a-fA-F]{6}\b/g, (c) => ink(c)),
    near: '',
    ground: () => HORSE_GROUND,
  });

/**
 * 带摆件的老马场景。**摆件按天数号选**，所以同一个场景连发几条画面不一样 ——
 * 那是 horse_standup_plan §六之二「防同质化」里场景那一条的补充。
 */
export const horseSceneDressed = (
  name: string,
  seed: number,
  skip?: string,
  title?: string,
  sub?: string
): Scene => horseAdapter(name, { seed, skip, title, sub });

const HORSE_SCENES: Record<string, Scene> = Object.fromEntries(
  Object.keys(HORSE_SCENE_TABLE).map((k) => [k, horseAdapter(k)])
);

export const SCENES: Record<string, Scene> = {
  grass, room, office, street, abstract, shore, hillside, hillrocks, pond, eaves,
  ...HORSE_SCENES,
};

export const SCENE_NAMES = Object.keys(SCENES);

/**
 * **不做静默回退。**
 *
 * 早先这里是 `SCENES[name] ?? grass`，于是写了个还没做的场景名，片子照样能出，
 * 只是画面完全不对——乌龟段子第一版就这么渲成了"两只龟趴在草地上"，
 * 而且一路跑到出片都没有任何提示。宁可炸在这里，也别让错画面混过整条管线。
 */
export function getScene(name: string): Scene {
  const hit = SCENES[name];
  if (!hit) {
    throw new Error(
      `没有这个场景：${name}\n可用：${SCENE_NAMES.join(' / ')}\n` +
        `要新增场景：在 src/scenes/index.ts 里加一个返回 {far, mid, near} 三层的函数，注册进 SCENES。\n` +
        `加完先跑 npm run scene -- ${name} 单看空场，确认了再写台词。`
    );
  }
  return hit;
}

// ── 说书的静态画面：一期二十来张，不是逐帧动画 ──────────────────────────
//
// 用法：npx tsx src/shuoshu-scene.ts --ep E01
//
// 这是整条管线成立的前提：按逐帧渲染，12.5 分钟 = 22,500 帧 × 0.48s = **3 小时**。
// 静态画面把帧数从「时长决定」变成「画面切换次数决定」——20 张图约 20 秒渲完，
// 15 分钟和 2 分钟成本一样。
//
// **分工**：构图在代码里（下面那些 COMPOSITIONS），时间点和题字在数据里
// （`<期号目录>/scenes.json`）。改一句题字不用碰代码，加一种构图不用改数据。
//
// 构图的共同骨架 —— 每一张都是这个结构，靠主体和题字区分：
//
//     宣纸底
//     └ 远景（淡墨山影 / 雾）      留白最多的一层
//       └ 主体（这一幕的那个东西）  只占画面一角
//         └ 近景（枯枝 / 墨点）     压角，给纵深
//           └ 右侧竖排题字 + 朱红印
//
// 留白是主角。**主体占满画面就成了插画，不是水墨。**
//
// ⚠ **右边那一栏是禁区：x > 1680、y 560–980，不要放深墨的东西。**
//
// 题字从 (1740, 150) 往下竖排，朱印跟在题字末尾 —— 印的 y 是
// `150 + 字数 × 字号 × 1.18 + 30`，所以**题字越长，印越往下**，
// 一句 6 字的印在 y≈576，一句 11 字的印在 y≈906。整段都要空出来。
//
// E05 撞了三次才发现：灯市 / 满阶花 / 灯下 的屋顶伸到 x≈1750，
// 印章正好压在瓦上。**这不是渲染报错，是出片之后用眼睛才看得见的那类问题** ——
// 加新构图时右边留够，比事后一张张挑出来便宜。

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import {
  INK, INK_FONT, n, rng, path, brush, ridge, splatter, vtext, seal, sealDefs, paperBg, paperDefs, wetFilter, escapeXml,
} from './style/inkwash.js';
import { resolveEp } from './shuoshu-ep.js';

/** 横版。说书是十几分钟的长视频，竖版只能进 Shorts（上限 3 分钟），走不通 */
export const SW = 1920;
export const SH = 1080;

type Draw = (seed: number) => string;

// ── 母题 ──────────────────────────────────────────────────────────────

/** 远山。三层，越远越淡，中间留一条雾 */
function mountains(baseY: number, seed: number, layers = 3): string {
  let out = '';
  for (let i = 0; i < layers; i++) {
    const y = baseY + i * 46;
    const amp = 150 - i * 34;
    out += `<path d="${path(ridge(SW, y, amp, seed + i * 17))}" fill="${INK.wash}" opacity="${n(0.13 + i * 0.09)}" filter="url(#wetFar)"/>`;
  }
  return out;
}

/** 枯树。主干一笔，枝条递归分叉 */
function tree(x: number, footY: number, h: number, seed: number, alpha = 0.8): string {
  const r = rng(seed);
  let out = '';
  const branch = (x0: number, y0: number, ang: number, len: number, w: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    const mid: [number, number][] = [
      [x0, y0],
      [x0 + (x1 - x0) * 0.5 + (r() - 0.5) * len * 0.16, y0 + (y1 - y0) * 0.5],
      [x1, y1],
    ];
    out += `<path d="${brush(mid, w, w * 0.45)}" fill="${INK.ink}" opacity="${alpha}"/>`;
    if (depth <= 0 || len < 22) return;
    branch(x1, y1, ang - 0.42 - r() * 0.4, len * (0.6 + r() * 0.16), w * 0.55, depth - 1);
    branch(x1, y1, ang + 0.38 + r() * 0.42, len * (0.58 + r() * 0.18), w * 0.55, depth - 1);
  };
  branch(x, footY, -Math.PI / 2 + (r() - 0.5) * 0.2, h * 0.42, h * 0.055, 4);
  return out;
}

/** 屋宇。歇山顶的轮廓 + 一面墙。中式建筑认屋顶就够了 */
function house(cx: number, baseY: number, w: number, seed: number, o: { wall?: boolean } = {}): string {
  const h = w * 0.42;
  const eave = w * 0.58;
  const roof: [number, number][] = [
    [cx - eave, baseY - h],
    [cx - eave * 0.72, baseY - h * 1.06],
    [cx - w * 0.2, baseY - h * 1.5],
    [cx, baseY - h * 1.62],
    [cx + w * 0.2, baseY - h * 1.5],
    [cx + eave * 0.72, baseY - h * 1.06],
    [cx + eave, baseY - h],
    [cx + eave * 0.86, baseY - h * 0.9],
    [cx - eave * 0.86, baseY - h * 0.9],
  ];
  let out = `<path d="${path(roof)}" fill="${INK.ink}" opacity="0.86" filter="url(#wetMid)"/>`;
  if (o.wall !== false) {
    out += `<path d="${path([
      [cx - w * 0.4, baseY - h * 0.9],
      [cx + w * 0.4, baseY - h * 0.9],
      [cx + w * 0.4, baseY],
      [cx - w * 0.4, baseY],
    ])}" fill="${INK.wash}" opacity="0.5" filter="url(#wetMid)"/>`;
  }
  return out;
}

/** 窗。窗棂九宫格，broken 时右下角破一个口（《画皮》幕二的题眼） */
function windowFrame(x: number, y: number, w: number, h: number, seed: number, broken = false): string {
  const r = rng(seed);
  let out = `<path d="${path([[x, y], [x + w, y], [x + w, y + h], [x, y + h]])}" fill="${INK.paperDeep}" opacity="0.75"/>`;
  out += `<path d="${brush([[x, y], [x + w, y]], 9)}" fill="${INK.ink}" opacity="0.9"/>`;
  out += `<path d="${brush([[x, y + h], [x + w, y + h]], 9)}" fill="${INK.ink}" opacity="0.9"/>`;
  out += `<path d="${brush([[x, y], [x, y + h]], 9)}" fill="${INK.ink}" opacity="0.9"/>`;
  out += `<path d="${brush([[x + w, y], [x + w, y + h]], 9)}" fill="${INK.ink}" opacity="0.9"/>`;
  for (let i = 1; i < 3; i++) {
    out += `<path d="${brush([[x + (w / 3) * i, y], [x + (w / 3) * i, y + h]], 5)}" fill="${INK.ink}" opacity="0.72"/>`;
    out += `<path d="${brush([[x, y + (h / 3) * i], [x + w, y + (h / 3) * i]], 5)}" fill="${INK.ink}" opacity="0.72"/>`;
  }
  if (broken) {
    // 破口：一块不规则的黑，透出屋里的暗
    const bx = x + w * 0.66;
    const by = y + h * 0.6;
    const pts: [number, number][] = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const rr = w * (0.07 + r() * 0.06);
      pts.push([bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.9]);
    }
    out += `<path d="${path(pts)}" fill="${INK.ink}" opacity="0.95" filter="url(#wetNear)"/>`;
  }
  return out;
}

/** 门。ajar 时留一道缝，缝里是黑的 */
function door(cx: number, baseY: number, w: number, h: number, seed: number, ajar = false): string {
  const x = cx - w / 2;
  const y = baseY - h;
  let out = `<path d="${path([[x, y], [x + w, y], [x + w, baseY], [x, baseY]])}" fill="${INK.wash}" opacity="0.55" filter="url(#wetMid)"/>`;
  out += `<path d="${brush([[cx, y], [cx, baseY]], ajar ? 26 : 8)}" fill="${INK.ink}" opacity="${ajar ? 0.95 : 0.6}"/>`;
  out += `<path d="${brush([[x, y], [x + w, y]], 12)}" fill="${INK.ink}" opacity="0.85"/>`;
  return out;
}

/**
 * 人影。**不画脸。** 说书的画面是提示不是插图，
 * 一画五官就变成了"我替你想象"，听众自己的画面反而没了。
 *
 * **画的是长袍的外轮廓，一笔封闭，不是骨架拼装。**
 * 第一版拿 `brush()` 在「肩—腰—脚」三个点上拉宽笔触，出来是几块浮着的矩形，
 * 脑袋跟身子还分家。古装人影的辨识度全在**上窄下阔的袍子剪影**上，
 * 那个形状用一条闭合路径描出来就对了，拆成零件反而不像。
 */
function figure(
  x: number,
  footY: number,
  h: number,
  pose: '立' | '跪' | '伏' | '坐' | '走' | '执笔',
  seed: number,
  alpha = 0.88
): string {
  const r = rng(seed);
  const wob = (v: number) => v + (r() - 0.5) * h * 0.012; // 手抖，免得对称得像图标
  const headR = h * 0.072;

  /** 袍子：肩宽 sw、下摆 hw、从 topY 落到 botY */
  const robe = (topY: number, botY: number, sw: number, hw: number, lean = 0): string => {
    const mid = (topY + botY) / 2;
    const pts: [number, number][] = [
      [wob(x - sw + lean), wob(topY)],
      [wob(x - sw * 1.12 + lean * 0.5), wob(mid - (botY - topY) * 0.18)],
      [wob(x - hw * 0.82), wob(mid + (botY - topY) * 0.2)],
      [wob(x - hw), wob(botY)],
      [wob(x + hw * 0.92), wob(botY)],
      [wob(x + hw * 0.78), wob(mid + (botY - topY) * 0.2)],
      [wob(x + sw * 1.08 + lean * 0.5), wob(mid - (botY - topY) * 0.18)],
      [wob(x + sw + lean), wob(topY)],
      [wob(x + sw * 0.34 + lean), wob(topY - h * 0.035)], // 领口
      [wob(x - sw * 0.34 + lean), wob(topY - h * 0.035)],
    ];
    return `<path d="${path(pts)}" fill="${INK.ink}" opacity="${alpha}" filter="url(#wetNear)"/>`;
  };
  const head = (cx: number, cy: number, tilt = 0) =>
    `<ellipse cx="${n(cx + tilt)}" cy="${n(cy)}" rx="${n(headR)}" ry="${n(headR * 1.15)}" fill="${INK.ink}" opacity="${alpha}" filter="url(#wetNear)"/>` +
    // 脖子：不连的话脑袋是浮着的
    `<path d="${path([[cx + tilt - headR * 0.44, cy], [cx + tilt + headR * 0.44, cy], [cx + headR * 0.62, cy + headR * 1.6], [cx - headR * 0.62, cy + headR * 1.6]])}" fill="${INK.ink}" opacity="${alpha}"/>`;
  /** 袖子：从肩头甩出去的一笔，末端收细 */
  const sleeve = (x0: number, y0: number, x1: number, y1: number, w: number) =>
    `<path d="${brush(
      [
        [x0, y0],
        [(x0 + x1) / 2 + (r() - 0.5) * h * 0.03, (y0 + y1) / 2 + h * 0.02],
        [x1, y1],
      ],
      w,
      w * 0.34
    )}" fill="${INK.ink}" opacity="${alpha}"/>`;

  if (pose === '跪') {
    const top = footY - h * 0.66;
    return (
      robe(top, footY, h * 0.095, h * 0.175) +
      head(x, top - headR * 0.9, h * 0.02) +
      // 跪着的下摆摊在地上
      `<path d="${path([[x - h * 0.24, footY], [x + h * 0.22, footY], [x + h * 0.17, footY - h * 0.05], [x - h * 0.19, footY - h * 0.05]])}" fill="${INK.ink}" opacity="${alpha}"/>` +
      sleeve(x - h * 0.09, top + h * 0.06, x - h * 0.24, footY - h * 0.18, h * 0.07)
    );
  }
  if (pose === '伏') {
    // 趴着：一道低伏的墨 + 一个头，别画袍子
    const pts: [number, number][] = [
      [x - h * 0.34, footY],
      [x - h * 0.2, footY - h * 0.14],
      [x + h * 0.12, footY - h * 0.19],
      [x + h * 0.36, footY - h * 0.12],
      [x + h * 0.4, footY],
    ];
    return (
      `<path d="${path(pts)}" fill="${INK.ink}" opacity="${alpha}" filter="url(#wetNear)"/>` +
      `<ellipse cx="${n(x + h * 0.42)}" cy="${n(footY - h * 0.17)}" rx="${n(headR)}" ry="${n(headR * 0.95)}" fill="${INK.ink}" opacity="${alpha}"/>`
    );
  }
  if (pose === '坐' || pose === '执笔') {
    const top = footY - h * 0.74;
    let out = robe(top, footY - h * 0.14, h * 0.088, h * 0.145);
    out += head(x, top - headR * 0.9, -h * 0.01);
    // 盘坐的腿：横着的一块，把人压在榻上
    out += `<path d="${path([[x - h * 0.16, footY - h * 0.16], [x + h * 0.26, footY - h * 0.17], [x + h * 0.28, footY - h * 0.02], [x - h * 0.17, footY - h * 0.01]])}" fill="${INK.ink}" opacity="${alpha}" filter="url(#wetNear)"/>`;
    if (pose === '执笔') {
      // 伸出去描的那只手。《画皮》全片的题眼就在这一笔上
      out += sleeve(x + h * 0.08, top + h * 0.08, x + h * 0.42, footY - h * 0.32, h * 0.07);
      out += `<path d="${brush([[x + h * 0.44, footY - h * 0.3], [x + h * 0.56, footY - h * 0.22]], h * 0.014, h * 0.006)}" fill="${INK.ink}" opacity="${alpha}"/>`;
    }
    return out;
  }
  if (pose === '走') {
    const top = footY - h * 0.8;
    return (
      robe(top, footY - h * 0.04, h * 0.095, h * 0.19, h * 0.02) +
      head(x + h * 0.02, top - headR * 0.9, h * 0.015) +
      sleeve(x + h * 0.09, top + h * 0.07, x + h * 0.21, footY - h * 0.38, h * 0.075)
    );
  }
  const top = footY - h * 0.82;
  return (
    robe(top, footY, h * 0.1, h * 0.2) +
    head(x, top - headR * 0.9) +
    sleeve(x - h * 0.1, top + h * 0.07, x - h * 0.15, footY - h * 0.32, h * 0.075)
  );
}

/**
 * 摊开的人皮。**横着躺，不是立着。**
 *
 * 第一版竖着画，结果跟旁边的人影一个姿态，读出来就是"两个人站着"——
 * 恐怖点整个没了。人皮的可怕之处是**它是平的**：一个人形，摊在榻上，
 * 没有厚度、没有骨头，像一件脱下来的衣裳。所以头朝左、四肢摊开、
 * 边缘还要有点软塌塌的起伏。
 *
 * @param len 从头到脚的长度（横向）
 */
function skin(cx: number, cy: number, len: number, seed: number): string {
  const r = rng(seed);
  const w = len * 0.26; // 肩到肩
  const j = () => (r() - 0.5) * len * 0.02;
  // 从头顶起，顺时针：头 → 上臂 → 手 → 腰 → 腿 → 脚 …… 一圈回来
  const pts: [number, number][] = [
    [cx - len * 0.5 + j(), cy + j()],
    [cx - len * 0.42, cy - w * 0.26 + j()],
    [cx - len * 0.3, cy - w * 0.2 + j()],
    [cx - len * 0.24, cy - w * 0.52 + j()],
    [cx - len * 0.02, cy - w * 0.66 + j()],
    [cx + len * 0.06, cy - w * 0.5 + j()],
    [cx - len * 0.1, cy - w * 0.3 + j()],
    [cx + len * 0.18, cy - w * 0.26 + j()],
    [cx + len * 0.46, cy - w * 0.34 + j()],
    [cx + len * 0.5, cy - w * 0.18 + j()],
    [cx + len * 0.22, cy + j()],
    [cx + len * 0.5, cy + w * 0.2 + j()],
    [cx + len * 0.46, cy + w * 0.36 + j()],
    [cx + len * 0.18, cy + w * 0.28 + j()],
    [cx - len * 0.1, cy + w * 0.32 + j()],
    [cx + len * 0.06, cy + w * 0.52 + j()],
    [cx - len * 0.02, cy + w * 0.68 + j()],
    [cx - len * 0.24, cy + w * 0.54 + j()],
    [cx - len * 0.3, cy + w * 0.22 + j()],
    [cx - len * 0.42, cy + w * 0.28 + j()],
  ];
  return `<path d="${path(pts)}" fill="${INK.ink}" opacity="0.68" filter="url(#wetMid)"/>`;
}

/** 榻。一条横板加两条腿 */
function couch(cx: number, y: number, w: number): string {
  return (
    `<path d="${brush([[cx - w / 2, y], [cx + w / 2, y]], 16)}" fill="${INK.ink}" opacity="0.85"/>` +
    `<path d="${brush([[cx - w * 0.38, y], [cx - w * 0.4, y + 60]], 9)}" fill="${INK.ink}" opacity="0.75"/>` +
    `<path d="${brush([[cx + w * 0.38, y], [cx + w * 0.4, y + 60]], 9)}" fill="${INK.ink}" opacity="0.75"/>`
  );
}

/** 烟。一缕上升的淡墨 */
function smoke(x: number, baseY: number, h: number, seed: number): string {
  const r = rng(seed);
  let out = '';
  for (let k = 0; k < 3; k++) {
    const pts: [number, number][] = [];
    let px = x + (r() - 0.5) * 30;
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      px += (r() - 0.5) * 60;
      pts.push([px, baseY - h * t]);
    }
    out += `<path d="${brush(pts, 26 - k * 6, 4)}" fill="${INK.wash}" opacity="${n(0.3 - k * 0.07)}" filter="url(#wetFar)"/>`;
  }
  return out;
}

/** 月。一个圆，边上留一圈晕 */
function moon(cx: number, cy: number, r: number): string {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 1.5)}" fill="${INK.wash}" opacity="0.08" filter="url(#stainBlur)"/>
  <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${INK.ink}" stroke-width="3" opacity="0.35"/>`;
}

/** 剑光。一道纸色的白划过墨，压在最上层 */
function sword(x1: number, y1: number, x2: number, y2: number): string {
  return `<path d="${brush([[x1, y1], [(x1 + x2) / 2, (y1 + y2) / 2], [x2, y2]], 26, 2)}" fill="${INK.paper}" opacity="0.95"/>
  <path d="${brush([[x1, y1], [x2, y2]], 8, 1)}" fill="#fff" opacity="0.8"/>`;
}

/** 坟。一个土包加一块碑 */
function grave(cx: number, baseY: number, w: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push([cx - w / 2 + w * t, baseY - Math.sin(t * Math.PI) * w * 0.34]);
  }
  pts.push([cx + w / 2, baseY]);
  pts.push([cx - w / 2, baseY]);
  return (
    `<path d="${path(pts)}" fill="${INK.wash}" opacity="0.55" filter="url(#wetMid)"/>` +
    // 碑也要过湿边滤镜。不过的话是一个边缘锐利的矩形，在整张洇开的画里像贴上去的
    `<path d="${path([[cx - w * 0.07, baseY - w * 0.52], [cx + w * 0.075, baseY - w * 0.5], [cx + w * 0.07, baseY - w * 0.18], [cx - w * 0.065, baseY - w * 0.2]])}" fill="${INK.ink}" opacity="0.8" filter="url(#wetNear)"/>`
  );
}

/**
 * 井。**E04《促织》新增。**
 *
 * 井台一圈石栏 ＋ 井口那个黑洞 ＋ 一根垂下去的绳。
 *
 * **黑洞用浓墨，不留渐变** —— 这一张要的是「下面看不见」。
 * 绳子必须垂下去、不能盘在台上：盘着是没人用过，垂着是有人下去过。
 */
function well(cx: number, baseY: number, w: number, seed: number): string {
  const r = rng(seed);
  const wob = (v: number) => v + (r() - 0.5) * w * 0.02;
  const h = w * 0.42;
  const top = baseY - h;
  // 井台：上窄下宽的一圈石栏
  const body: [number, number][] = [
    [wob(cx - w * 0.42), wob(top)],
    [wob(cx + w * 0.42), wob(top)],
    [wob(cx + w * 0.5), wob(baseY)],
    [wob(cx - w * 0.5), wob(baseY)],
  ];
  return (
    `<path d="${path(body)}" fill="${INK.wash}" opacity="0.6" filter="url(#wetMid)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${n(w * 0.42)}" ry="${n(w * 0.12)}" fill="${INK.wash}" opacity="0.75" filter="url(#wetMid)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top + w * 0.01)}" rx="${n(w * 0.3)}" ry="${n(w * 0.085)}" fill="${INK.ink}" opacity="0.92" filter="url(#wetNear)"/>` +
    `<path d="${brush([[cx - w * 0.16, top - w * 0.02], [cx - w * 0.13, top + w * 0.06], [cx - w * 0.17, top + w * 0.16]], 5, 2)}" fill="${INK.ink}" opacity="0.8" filter="url(#wetNear)"/>`
  );
}

/**
 * 虫盆。**E04《促织》新增。**
 *
 * 一只浅口陶盆，盆里一粒墨点。**盆沿要画厚**，薄了在 1920 上看着像个碟子。
 * 虫只给一粒点 —— 画出腿和须就成了昆虫图鉴，这套水墨接不住。
 * empty 为真时不画那一粒：孩子出事之后那几张用的就是这个。
 */
function pot(cx: number, baseY: number, w: number, seed: number, empty = false): string {
  const r = rng(seed);
  const wob = (v: number) => v + (r() - 0.5) * w * 0.02;
  const h = w * 0.3;
  const top = baseY - h;
  const body: [number, number][] = [
    [wob(cx - w * 0.5), wob(top)],
    [wob(cx + w * 0.5), wob(top)],
    [wob(cx + w * 0.34), wob(baseY)],
    [wob(cx - w * 0.34), wob(baseY)],
  ];
  return (
    `<path d="${path(body)}" fill="${INK.wash}" opacity="0.62" filter="url(#wetMid)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${n(w * 0.5)}" ry="${n(w * 0.13)}" fill="${INK.wash}" opacity="0.5" filter="url(#wetMid)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${n(w * 0.4)}" ry="${n(w * 0.1)}" fill="${INK.paperDeep}" opacity="0.9" filter="url(#wetMid)"/>` +
    (empty
      ? ''
      : `<ellipse cx="${n(cx + w * 0.06)}" cy="${n(top + w * 0.01)}" rx="${n(w * 0.055)}" ry="${n(w * 0.028)}" fill="${INK.ink}" opacity="0.95" filter="url(#wetNear)"/>`)
  );
}

/**
 * 一枝花。**E05《婴宁》新增，这一期的主母题。**
 *
 * 婴宁全篇是「笑」和「花」两样东西撑起来的，笑在音轨上，花只能在画面上。
 * 画法上有一条要守住：**花瓣用淡墨的点，不用轮廓线。**
 * 描了轮廓就成了工笔花鸟，跟这套写意的山、屋、人不是一路，摆在一张纸上会打架。
 *
 * 一枝 = 一根主干 + 两根侧枝 + 四朵点花。再多就腻。
 */
function blossom(x: number, footY: number, h: number, seed: number, alpha = 0.8): string {
  const r = rng(seed);
  const tipX = x + (r() - 0.5) * h * 0.55;
  const tipY = footY - h;
  let out = `<path d="${brush(
    [
      [x, footY],
      [x + (r() - 0.5) * h * 0.22, footY - h * 0.45],
      [tipX, tipY],
    ],
    h * 0.022,
    h * 0.005
  )}" fill="${INK.ink}" opacity="${alpha}" filter="url(#wetNear)"/>`;

  /**
   * 一朵。**小、深、不匀。**
   *
   * 第一版是五个等大的淡墨圆排成正五边形，渲出来是卡通雏菊 —— 均匀、发白、比枝子还宽。
   * 水墨的梅点不是花的形状，是**比枝子略粗的一撮墨点**：大小各不相同，位置有偏，
   * 中间那点最重。规矩跟人影"不画脸"是同一条：给提示，不给图样。
   */
  const flower = (cx: number, cy: number, rr: number) => {
    let o = '';
    const k = 4 + Math.floor(r() * 2);
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + r() * 1.2;
      const d = rr * (0.7 + r() * 0.5);
      o += `<circle cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d)}" r="${n(rr * (0.38 + r() * 0.26))}" fill="${INK.ink}" opacity="${n(alpha * (0.4 + r() * 0.24))}"/>`;
    }
    return o + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rr * 0.3)}" fill="${INK.ink}" opacity="${n(alpha * 0.85)}"/>`;
  };

  // 侧枝三根，梢头各缀一撮；主干上再零星点几撮 —— 花要沿着枝走，不是挂在枝头当灯笼
  for (const t of [0.34, 0.58, 0.8]) {
    const bx = x + (tipX - x) * t;
    const by = footY - h * t;
    const dir = t === 0.58 ? -1 : 1;
    const ex = bx + dir * h * (0.16 + r() * 0.1);
    const ey = by - h * (0.1 + r() * 0.07);
    out += `<path d="${brush([[bx, by], [ex, ey]], h * 0.013, h * 0.004)}" fill="${INK.ink}" opacity="${n(alpha * 0.85)}"/>`;
    out += flower(ex, ey, h * 0.032);
    out += flower(bx + (r() - 0.5) * h * 0.05, by - h * 0.03, h * 0.026);
  }
  out += flower(tipX, tipY, h * 0.034);
  out += flower(tipX - h * 0.06, tipY + h * 0.07, h * 0.024);
  return out;
}

/**
 * 一段院墙。**E05 新增。** 婴宁那一笑是在墙头上出的事，墙必须画得出来。
 *
 * 跟 house() 的墙不是一回事：那一面是屋子的一部分，这一段是**隔断** ——
 * 墙里是她的院子，墙外是别人的世道，这一期的祸就出在她不知道有这条线。
 * 所以墙要横着长、墙脚要压出画外，墙头那道瓦是整段唯一的浓墨。
 *
 * **墙身只能是极淡的一层。** 第一版给了 0.46，渲出来是半张画的灰板 ——
 * 留白是这套水墨的主角（见文件头），一块实心矩形直接把它吃掉了。
 */
function wall(cx: number, baseY: number, w: number, h: number, seed: number): string {
  const r = rng(seed);
  const wob = (v: number) => v + (r() - 0.5) * h * 0.05;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const top = baseY - h;
  return (
    `<path d="${path([[x0, wob(top)], [x1, wob(top)], [x1, baseY], [x0, baseY]])}" fill="${INK.wash}" opacity="0.2" filter="url(#wetMid)"/>` +
    `<path d="${brush([[x0 - h * 0.1, top], [cx, top - h * 0.045], [x1 + h * 0.1, top]], h * 0.1, h * 0.045)}" fill="${INK.ink}" opacity="0.78" filter="url(#wetMid)"/>`
  );
}

/** 一块大石。**E05 新增。** 就是坟包去掉那块碑 —— 王子服在门外的石头上坐了一整天 */
function rock(cx: number, baseY: number, w: number, seed: number): string {
  const r = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    pts.push([cx - w / 2 + w * t, baseY - Math.sin(t * Math.PI) * w * (0.34 + (r() - 0.5) * 0.14)]);
  }
  pts.push([cx + w / 2, baseY]);
  pts.push([cx - w / 2, baseY]);
  return `<path d="${path(pts)}" fill="${INK.ink}" opacity="0.5" filter="url(#wetMid)"/>`;
}

/**
 * 灯笼。**E05 新增。** 上元节和拜堂各用一次，是这一期仅有的两处亮面。
 *
 * 第一版是"细线椭圆 + 一根垂穗"，渲出来是个放大镜。灯笼认得出来靠三样：
 * **上下两道横杠夹住的鼓肚子、肚子上的竖棱、以及一根从上面吊下来的绳。**
 * 灯身要填淡墨（是纸糊的，不是铁丝框），光晕压在最底下一层。
 */
function lantern(cx: number, cy: number, rr: number, seed: number): string {
  const r = rng(seed);
  const w = rr;
  const h = rr * 1.12;
  let out = `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rr * 2)}" ry="${n(rr * 2.1)}" fill="${INK.wash}" opacity="0.12" filter="url(#stainBlur)"/>`;
  // 吊绳：从画面上方垂下来，灯才是挂着的不是浮着的
  out += `<path d="${brush([[cx, cy - h - rr * 1.5], [cx + (r() - 0.5) * rr * 0.2, cy - h * 1.02]], 4, 3)}" fill="${INK.ink}" opacity="0.4"/>`;
  out += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w)}" ry="${n(h)}" fill="${INK.wash}" opacity="0.4" filter="url(#wetMid)"/>`;
  // 竖棱三道，两边的压扁 —— 鼓肚子是这么看出来的
  for (const f of [-0.62, 0, 0.62]) {
    out += `<path d="${brush([[cx + w * f * 0.86, cy - h * 0.82], [cx + w * f, cy], [cx + w * f * 0.86, cy + h * 0.82]], 3, 2)}" fill="${INK.ink}" opacity="0.3"/>`;
  }
  out += `<path d="${brush([[cx - w * 0.62, cy - h * 0.86], [cx + w * 0.62, cy - h * 0.86]], 9, 6)}" fill="${INK.ink}" opacity="0.78"/>`;
  out += `<path d="${brush([[cx - w * 0.62, cy + h * 0.86], [cx + w * 0.62, cy + h * 0.86]], 9, 6)}" fill="${INK.ink}" opacity="0.78"/>`;
  out += `<path d="${brush([[cx, cy + h * 0.9], [cx + (r() - 0.5) * rr * 0.3, cy + h * 1.5]], 5, 2)}" fill="${INK.ink}" opacity="0.5"/>`;
  return out;
}

/**
 * 一段立着的枯木。**E05 新增。**
 *
 * 顶上那个纸色的口子是这张图的全部：**木头是空的。**
 * 蝎子藏在里面，人把手伸了进去。不画蝎子 —— 画出来就成了昆虫图，
 * 而这一段的规矩是克制（见稿件头部那一行）。
 */
function stump(cx: number, baseY: number, h: number, seed: number): string {
  const r = rng(seed);
  const w = h * 0.28;
  const wob = (v: number) => v + (r() - 0.5) * w * 0.16;
  return (
    `<path d="${path([
      [wob(cx - w * 0.5), baseY - h],
      [wob(cx + w * 0.46), baseY - h * 1.02],
      [wob(cx + w * 0.54), baseY],
      [wob(cx - w * 0.48), baseY],
    ])}" fill="${INK.ink}" opacity="0.86" filter="url(#wetNear)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(baseY - h)}" rx="${n(w * 0.5)}" ry="${n(w * 0.17)}" fill="${INK.paperDeep}" opacity="0.92" filter="url(#wetNear)"/>`
  );
}
// ── 构图 ──────────────────────────────────────────────────────────────
//
// 一个构图 = 一句话能说清的画面。名字用中文，scenes.json 里直接写。

export const COMPOSITIONS: Record<string, Draw> = {
  画皮: (s) =>
    mountains(560, s, 2) +
    couch(940, 830, 560) +
    skin(940, 752, 380, s) +
    figure(660, 830, 300, '执笔', s + 3) +
    splatter(1180, 860, 150, 10, s + 9, 3),

  美人回首: (s) =>
    mountains(520, s, 2) +
    figure(820, 880, 330, '立', s + 1) +
    smoke(820, 880, 420, s + 5) +
    splatter(980, 700, 240, 10, s + 7, 3),

  晓行遇人: (s) =>
    mountains(500, s, 3) +
    tree(1420, 900, 520, s + 2, 0.55) +
    figure(560, 900, 300, '走', s + 4) +
    figure(770, 900, 268, '走', s + 6, 0.7),

  书房闭门: (s) => mountains(540, s, 2) + house(760, 900, 700, s + 1) + door(760, 900, 190, 300, s + 3),

  推门不开: (s) => door(820, 940, 420, 620, s, false) + splatter(1080, 700, 160, 9, s + 4, 4) + tree(300, 960, 420, s + 8, 0.4),

  窗破: (s) => windowFrame(620, 300, 620, 520, s, true) + tree(280, 980, 520, s + 5, 0.45),

  街遇道士: (s) =>
    mountains(520, s, 2) +
    house(1500, 880, 520, s + 2) +
    figure(640, 900, 290, '立', s + 4) +
    figure(830, 900, 275, '立', s + 6, 0.72),

  跪求: (s) => mountains(560, s, 2) + figure(720, 900, 300, '跪', s + 2) + figure(940, 900, 310, '立', s + 5, 0.75),

  夜半叩门: (s) =>
    moon(1560, 240, 90) +
    door(700, 950, 400, 600, s, true) +
    figure(1240, 950, 300, '立', s + 3, 0.55) +
    splatter(700, 500, 220, 12, s + 7, 3),

  掏心: (s) => splatter(820, 560, 380, 34, s, 9) + figure(720, 940, 300, '伏', s + 3) + door(1320, 940, 360, 560, s + 6, true),

  剑劈: (s) => skin(820, 660, 360, s) + sword(400, 260, 1180, 880) + splatter(820, 700, 280, 16, s + 4, 5),

  收烟: (s) => smoke(760, 880, 560, s) + figure(1140, 900, 300, '立', s + 3) + splatter(760, 500, 200, 10, s + 8, 3),

  街头乞人: (s) =>
    house(1560, 880, 480, s + 1) +
    figure(660, 900, 260, '伏', s + 3) +
    figure(900, 900, 290, '跪', s + 5, 0.8) +
    splatter(700, 880, 180, 18, s + 9, 5),

  哭尸: (s) => couch(820, 800, 700) + figure(820, 790, 250, '伏', s + 2) + figure(1120, 880, 290, '跪', s + 5, 0.8),

  心归: (s) => couch(820, 800, 700) + splatter(820, 720, 120, 10, s + 3, 6) + moon(1520, 260, 80) + smoke(820, 720, 300, s + 7),

  荒坟: (s) => mountains(540, s, 3) + grave(820, 900, 300) + tree(1400, 920, 480, s + 4, 0.5),

  空山: (s) => mountains(520, s, 3) + tree(1500, 940, 460, s + 3, 0.45) + moon(420, 240, 70),

  // ── E02《聂小倩》新增。E01 的构图一个没动 ────────────────────────────
  //
  // 能复用的都复用了（空山 / 荒坟 / 夜半叩门 / 跪求 / 书房闭门 直接拿来用），
  // 下面这些是 E01 没有的画面：一座塌了的寺、一只不离身的剑匣、
  // 一锭扔出去的金子、一道白光，以及最后那一大段日常。
  //
  // **日常那几张是这一期的重点**，不是过场。恐怖是壳，日常才是芯——
  // 画面上也得给它足够的张数，别让十七分钟的后三分之一只有一张图。

  兰若寺: (s) =>
    mountains(520, s, 3) +
    house(920, 900, 780, s + 2) +
    tree(1480, 950, 520, s + 5, 0.5) +
    tree(280, 960, 400, s + 8, 0.32),

  剑匣: (s) =>
    house(1440, 880, 480, s + 2) +
    door(660, 930, 250, 410, s, false) +
    figure(1050, 940, 290, '立', s + 5) +
    couch(1310, 948, 230),

  足心: (s) => couch(860, 820, 720) + figure(860, 806, 250, '伏', s + 2) + splatter(1170, 806, 90, 8, s + 6, 2),

  掷金: (s) =>
    door(640, 950, 400, 620, s, true) +
    figure(1040, 940, 300, '立', s + 4) +
    splatter(1430, 900, 130, 9, s + 8, 3),

  白杨: (s) =>
    mountains(540, s, 2) +
    tree(900, 950, 660, s + 3, 0.75) +
    splatter(960, 380, 120, 12, s + 7, 3) +
    moon(1500, 230, 78),

  挖骨: (s) =>
    mountains(560, s, 2) +
    tree(1220, 950, 540, s + 4, 0.5) +
    figure(760, 940, 300, '跪', s + 2) +
    splatter(980, 950, 170, 14, s + 8, 4),

  // 光要横穿整个画面。这一幕全篇只有三拍：光、声、静
  剑光: (s) => house(340, 890, 520, s + 2) + sword(430, 660, 1520, 300) + splatter(1240, 430, 260, 16, s + 5, 5),

  归葬: (s) => house(1400, 900, 520, s + 2) + grave(760, 920, 280) + tree(420, 950, 400, s + 6, 0.45),

  灶前: (s) => house(1340, 900, 560, s + 1) + figure(700, 920, 300, '坐', s + 4) + smoke(700, 900, 420, s + 7),

  守夜: (s) => moon(1540, 230, 85) + house(1160, 920, 620, s + 2) + figure(540, 930, 290, '坐', s + 5, 0.8),

  侍疾: (s) => couch(880, 820, 680) + figure(880, 806, 240, '伏', s + 2) + figure(1250, 900, 300, '跪', s + 5, 0.85),

  // ── E03《崂山道士》新增。**不动上面任何一张** ──
  //
  // 这一篇是纯喜剧，可画面这套水墨不会「搞笑」——也不该搞笑。
  // 笑点在声音那一层（老道士平着说、王七急），画面只负责**别拆台**：
  // 该冷的地方冷，该亮的地方亮，最后那一下老老实实画一个人躺在地上。
  //
  // 全篇的视觉支点是**那轮纸月**：它在幕三亮起来，是全片唯一的亮面；
  // 幕四幕五回到墙和地，一点亮都没有。落差是这么来的。

  /** 上山路。崂山在海边，石头多、路窄 —— 三层山加一株压角的树，人小 */
  崂山道: (s) =>
    mountains(470, s, 3) +
    tree(1500, 930, 480, s + 3, 0.5) +
    figure(560, 930, 240, '走', s + 6, 0.8),

  /** 道观。院子扫得一根草也没有，所以只留屋子，四周全空 */
  道观: (s) => mountains(540, s, 2) + house(1020, 900, 700, s + 2, { wall: true }),

  /** 拜师。一跪一立，中间隔开 —— 这一张要的是「他求，人家不接」 */
  拜师: (s) =>
    house(1420, 900, 520, s + 1) +
    figure(700, 920, 300, '跪', s + 4) +
    figure(980, 920, 310, '立', s + 7, 0.78),

  /** 递斧。两个人都站着，一个正一个侧；斧子不画，画了就成了道具图 */
  授斧: (s) =>
    house(1400, 900, 480, s + 2) +
    figure(760, 920, 300, '立', s + 5) +
    figure(1010, 920, 300, '立', s + 8, 0.72),

  /** 砍柴。人在山里，只剩一个走的轮廓；树压在两边，把他夹在中间 */
  采樵: (s) =>
    mountains(500, s, 3) +
    tree(320, 960, 520, s + 2, 0.6) +
    tree(1560, 960, 460, s + 5, 0.5) +
    figure(900, 950, 250, '走', s + 9, 0.85),

  /** 夜里想家。一盏月、一条榻、一个伏着的人。全篇最静的一张 */
  归意: (s) => moon(1560, 210, 78) + couch(820, 860, 620) + figure(820, 846, 230, '伏', s + 3, 0.8),

  /**
   * 剪纸为月 —— **全篇的高光，也是唯一的亮面**。
   * 月贴在墙上，所以画的是「屋里的一面墙 + 一个圆」，不是天上的月。
   * 人背对着坐，小；月大。这一张之后的所有画面都比它暗。
   */
  纸月: (s) =>
    house(300, 900, 560, s + 1, { wall: true }) +
    moon(1120, 420, 210) +
    figure(760, 940, 260, '坐', s + 6, 0.7) +
    figure(1480, 940, 260, '坐', s + 9, 0.6),

  /** 月中舞。人影落在月轮里，袖子拖出去一笔 */
  月中舞: (s) =>
    moon(1080, 440, 230) +
    figure(1080, 610, 300, '立', s + 4, 0.9) +
    splatter(1320, 700, 200, 8, s + 7, 3),

  /** 三人入月。走进去的那一下 —— 三个走的轮廓，越靠月越淡 */
  入月: (s) =>
    moon(1240, 430, 240) +
    figure(700, 930, 280, '走', s + 3, 0.85) +
    figure(900, 930, 270, '走', s + 6, 0.62) +
    figure(1090, 900, 250, '走', s + 9, 0.4),

  /** 月灭。同一面墙，月没了，只剩一个人坐着。跟「纸月」是一对，构图要对得上 */
  月灭: (s) =>
    house(300, 900, 560, s + 1, { wall: true }) +
    figure(1120, 940, 270, '坐', s + 5, 0.75) +
    smoke(1120, 920, 300, s + 8),

  /** 求诀。又一次跪求，但这回背景是空的 —— 上一次在观里，这一次只有墙 */
  求诀: (s) =>
    house(1500, 900, 440, s + 2, { wall: true }) +
    figure(820, 920, 300, '跪', s + 5) +
    figure(1100, 920, 310, '立', s + 8, 0.8),

  /** 穿墙。墙在中间，人已经在另一边 —— 一实一淡，看得出是同一个人 */
  穿墙: (s) =>
    house(960, 900, 760, s + 1, { wall: true }) +
    figure(640, 930, 290, '走', s + 4, 0.85) +
    figure(1320, 930, 290, '立', s + 7, 0.45),

  /**
   * 撞墙。**全篇的落点，也是最不能耍花样的一张。**
   * 一面墙、一个仰面躺着的人。不加星星不加眩晕线 ——
   * 那是漫画语法，这套水墨一用就散，而且笑点本来在声音那一层。
   */
  撞墙: (s) =>
    house(700, 900, 820, s + 1, { wall: true }) +
    figure(1180, 950, 230, '伏', s + 5) +
    splatter(1180, 860, 160, 8, s + 8, 3),

  /** 妻笑。一躺一立。她不用画表情，站在那儿看着就够了 */
  妻笑: (s) =>
    house(560, 900, 620, s + 2, { wall: true }) +
    figure(1080, 950, 220, '伏', s + 4, 0.8) +
    figure(1400, 930, 300, '立', s + 7),

  // ── E04《促织》新增。**不动上面任何一张** ──
  //
  // 这一篇跟前三篇不一样：没有鬼，没有法术，画面里最吓人的东西是一口井。
  // 所以这一批构图刻意都很空 —— 人小、物件少、大片留白。
  // **一路往下沉靠的是「越来越空」**，不是靠加东西。
  //
  // 三个视觉支点：**盆**（幕二亮起来，幕三空掉）· **井**（幕三唯一的黑）·
  // **草**（幕二找了一天，收束回到同一片草）。
  // **收束那张跟幕二那张是同一个构图、同一个姿势** —— 说破句说完，画面回到
  // 他趴在草里的那一天。首尾扣在画面上，不在话上。

  /** 衙门。门大、人小，两边各站一个 —— 这一张要的是「进去了就由不得你」 */
  衙门: (s) =>
    house(960, 900, 900, s + 1, { wall: true }) +
    door(960, 900, 260, 380, s + 3) +
    figure(1320, 920, 230, '立', s + 6, 0.7),

  /** 杖下。**这一张只画一个人趴着**，打的人不入画 —— 谁打的不重要，规矩打的 */
  杖下: (s) =>
    figure(880, 900, 300, '伏', s + 2) +
    splatter(1010, 880, 130, 9, s + 6, 3) +
    mountains(620, s, 2),

  /** 空院。卖光了以后的院子：屋还在，树只剩一株，地上什么都没有 */
  空院: (s) =>
    mountains(560, s, 2) +
    house(1300, 900, 620, s + 2) +
    tree(520, 940, 380, s + 5, 0.4),

  /** 草里。趴着找虫。人压得很低，跟草一个高度 —— 找了一整天就是这个姿势 */
  草里: (s) =>
    mountains(500, s, 3) +
    tree(1560, 950, 420, s + 4, 0.4) +
    figure(700, 930, 210, '伏', s + 7, 0.8) +
    grave(1180, 930, 200),

  /** 问巫。一跪一香。**巫不入画** —— 她在故事里也没露过正脸 */
  问巫: (s) =>
    house(1360, 900, 560, s + 1) +
    figure(760, 920, 300, '跪', s + 4) +
    smoke(1080, 880, 420, s + 8),

  /** 佛阁。殿在远处，假山在近处 —— 画上那张纸就是这么排的 */
  佛阁: (s) =>
    mountains(520, s, 2) +
    house(1180, 860, 760, s + 2, { wall: true }) +
    grave(560, 940, 260) +
    tree(300, 960, 400, s + 6, 0.45),

  /** 得虫。夜里那盆。**唯一一张有月亮的** —— 全篇的亮面只给这一处 */
  得虫: (s) => moon(1520, 250, 80) + pot(880, 860, 420, s + 2) + figure(1240, 930, 240, '坐', s + 5, 0.72),

  /** 空盆。同一只盆，那一粒点没了。跟「得虫」并排看才有意思 */
  空盆: (s) => pot(880, 860, 420, s + 2, true) + mountains(600, s, 2),

  /** 井。全篇唯一的黑。**井口的洞比什么都深** */
  井: (s) => mountains(560, s, 2) + well(900, 900, 460, s + 3) + tree(1560, 940, 380, s + 7, 0.35),

  /** 井边坐着。人抱着孩子坐在井台边上，天蒙蒙亮 */
  井边: (s) => well(1280, 900, 400, s + 3) + figure(640, 920, 300, '坐', s + 6) + mountains(600, s, 2),

  /** 病榻。孩子躺着，大人守着。跟「侍疾」同一个意思，但这一张两个人都在 */
  守病: (s) =>
    couch(880, 830, 700) +
    figure(880, 816, 230, '伏', s + 2) +
    figure(1290, 910, 290, '坐', s + 5, 0.8) +
    figure(520, 920, 280, '坐', s + 9, 0.72),

  /** 斗盆。两粒点，一大一小。**小的那粒在下面** —— 位置就是全部的戏 */
  斗盆: (s) =>
    pot(940, 850, 520, s + 2) +
    splatter(1010, 826, 60, 4, s + 5, 2) +
    figure(1500, 930, 250, '立', s + 8, 0.62),

  /** 上献。一层一层往上：门越来越大，人越来越小 */
  上献: (s) =>
    house(1080, 880, 1000, s + 1, { wall: true }) +
    door(1080, 880, 300, 420, s + 3) +
    figure(430, 940, 190, '走', s + 7, 0.6),

  // ── E05《婴宁》新增。**上面的一张都没动** ─────────────────────────────
  //
  // 前四期的画面骨架是「山 / 屋 / 人」，这一期多两样：**花，和墙。**
  // 两样都不是装饰，是情节本身 —— 婴宁爱花成癖，而她那一笑出事，出在墙头上。
  //
  // 亮面只给两处：上元的灯，和拜堂的灯。婚后一路到收束，一点亮都没有。
  // 这跟 E03 那轮纸月是同一个手法 —— 落差靠"后面没有了"做出来，不靠"前面多亮"。

  /** 上元灯市。人要小、要多、要挤 —— 她是从一堆人里被看见的 */
  灯市: (s) =>
    house(1400, 905, 440, s + 1) +
    house(280, 912, 420, s + 4) +
    lantern(700, 296, 46, s + 2) +
    lantern(972, 232, 56, s + 5) +
    lantern(1236, 318, 42, s + 8) +
    figure(760, 952, 244, '走', s + 6, 0.86) +
    figure(872, 958, 228, '走', s + 9, 0.62) +
    figure(1010, 950, 236, '走', s + 12, 0.74) +
    figure(1118, 960, 214, '走', s + 15, 0.46),

  /** 拈梅。全篇的第一眼。**人和花之间要留出空**，那段空白就是他没敢走过去的距离 */
  拈梅: (s) =>
    mountains(620, s, 2) +
    lantern(520, 268, 44, s + 9) +
    figure(1210, 910, 300, '立', s + 3) +
    blossom(1000, 880, 300, s + 6),

  /** 落花。花掉在地上，人已经走远。**人不要朝着花** —— 她没有回头 */
  落花: (s) =>
    mountains(640, s, 2) +
    blossom(700, 960, 170, s + 3, 0.5) +
    splatter(720, 950, 130, 9, s + 6, 2) +
    figure(1460, 935, 235, '走', s + 9, 0.38),

  /** 枕花。他病在榻上，那枝花压在枕头底下。榻边这一枝是画给听众看的，不是他能看见的 */
  枕花: (s) =>
    couch(880, 820, 700) +
    figure(880, 806, 240, '伏', s + 2) +
    blossom(1320, 836, 150, s + 6, 0.45),

  /** 花村。谷底那十几户。**花要漫过屋顶的高度**，村子才像是长在花里的 */
  花村: (s) =>
    mountains(470, s, 3) +
    house(1120, 900, 600, s + 2, { wall: true }) +
    blossom(700, 935, 270, s + 5) +
    blossom(1540, 945, 215, s + 8, 0.6) +
    blossom(430, 955, 195, s + 11, 0.42),

  /** 柳门。门朝北开，门前一排柳 —— 原文交代得极细，画面上只取"柳垂到地"这一笔 */
  柳门: (s) =>
    wall(1060, 1090, 1000, 400, s + 1) +
    door(1080, 1080, 250, 330, s + 3) +
    tree(540, 945, 430, s + 6, 0.38) +
    blossom(1400, 690, 185, s + 9, 0.62),

  /** 石上等。他在门外那块石头上从早坐到日头偏西。**人和墙分在两边**，中间是他不敢过去的那道线 */
  石上等: (s) =>
    wall(1170, 1090, 900, 400, s + 1) +
    rock(540, 955, 310, s + 4) +
    figure(548, 890, 250, '坐', s + 7, 0.85) +
    blossom(1480, 688, 170, s + 10, 0.55),

  /** 花院。豆棚花架满庭。这一期唯一"什么事也没发生"的一张，给足留白 */
  花院: (s) =>
    wall(1080, 1090, 1060, 380, s + 1) +
    house(400, 905, 440, s + 3) +
    blossom(770, 945, 250, s + 6) +
    blossom(1010, 955, 205, s + 9, 0.68) +
    blossom(1420, 948, 225, s + 12, 0.52),

  /** 墙头。**这一期的题眼。** 她站在墙上笑，墙外的人抬头看见了。人只给 250px —— 站得高，但小 */
  墙头: (s) =>
    wall(760, 1090, 1780, 380, s + 1) +
    blossom(600, 716, 215, s + 4, 0.66) +
    blossom(1330, 706, 200, s + 7, 0.56) +
    figure(960, 706, 250, '立', s + 10),

  /** 拜堂。全篇第二处、也是最后一处亮面。两个人都站着 —— 那礼行到一半就散了 */
  拜堂: (s) =>
    house(960, 890, 880, s + 1, { wall: true }) +
    lantern(560, 300, 52, s + 3) +
    lantern(1370, 300, 52, s + 6) +
    figure(806, 960, 275, '立', s + 8) +
    figure(1122, 958, 262, '立', s + 11, 0.76),

  /** 满阶花。台阶墙根全是花。**五枝，一枝比一枝淡** —— 数量本身就是"成癖"两个字 */
  满阶花: (s) =>
    house(1330, 900, 470, s + 1) +
    blossom(360, 946, 262, s + 4) +
    blossom(452, 968, 190, s + 7, 0.62) +
    blossom(604, 952, 224, s + 10, 0.8) +
    blossom(690, 972, 158, s + 13, 0.5) +
    blossom(838, 944, 268, s + 16, 0.68) +
    blossom(936, 966, 182, s + 19, 0.45) +
    blossom(1078, 956, 206, s + 22, 0.56) +
    blossom(1186, 974, 146, s + 25, 0.36),

  /** 枯木。月下，墙根立着一段空心的木头。**不画蝎子**，也不画人 */
  枯木: (s) =>
    moon(1530, 240, 76) +
    wall(740, 1090, 1720, 380, s + 1) +
    stump(690, 950, 245, s + 5) +
    blossom(1280, 706, 178, s + 8, 0.44),

  /** 空墙。同一堵墙，墙头上没有人了。跟「墙头」并排看才有意思 */
  空墙: (s) =>
    wall(760, 1090, 1780, 380, s + 1) +
    blossom(640, 726, 198, s + 5, 0.4) +
    splatter(1120, 880, 230, 12, s + 9, 3),

  /** 灯下。夜里两个人坐着，她哭了。灯挪到画面深处 —— 这一张的亮是余光，不是光源 */
  灯下: (s) =>
    lantern(1300, 350, 58, s + 2) +
    house(1380, 908, 440, s + 4) +
    figure(700, 935, 280, '坐', s + 6) +
    figure(982, 932, 268, '坐', s + 9, 0.72),

  /** 抱子。最后一张。**花要退到最淡** —— 这个家里现在笑的是那个孩子 */
  抱子: (s) =>
    house(1330, 898, 460, s + 2) +
    figure(716, 935, 288, '坐', s + 5) +
    splatter(786, 838, 66, 6, s + 9, 2) +
    blossom(1080, 950, 196, s + 12, 0.42),
};

export const COMPOSITION_NAMES = Object.keys(COMPOSITIONS);

// ── 一张画 ────────────────────────────────────────────────────────────

export interface SceneSpec {
  /** 从第几段开始用这张图。时长由 manifest 的时间轴自动算 */
  no: number;
  /** 构图名 */
  comp: string;
  /** 右侧竖排题字。**只写一句**，这是画面里唯一的信息 */
  title: string;
  /** 左下角的幕名，不写就沿用上一张 */
  act?: string;
  seed?: number;
}

/**
 * 左下角的幕名。**只有「幕X」才显示。**
 *
 * 「冷开场」「引入」「收束」是**写稿的结构标签，不是章节名**——
 * 打在成片上等于把脚手架露给观众看。而「幕二 · 疑」是故事内部的段落，
 * 观众看见它知道自己走到哪儿了。
 */
function actLabel(act: string): string {
  if (!/^幕/.test(act)) return '';
  return `<text x="72" y="${SH - 60}" font-family="${INK_FONT}" font-size="30" fill="${INK.ink}" opacity="0.45">${escapeXml(act)}</text>`;
}

export function sceneSvg(spec: SceneSpec, act: string, sealText: string): string {
  const draw = COMPOSITIONS[spec.comp];
  if (!draw) throw new Error(`没有这个构图：${spec.comp}\n可用：${COMPOSITION_NAMES.join(' / ')}`);
  const seed = spec.seed ?? spec.no * 37 + 11;

  const titleSize = spec.title.length > 12 ? 46 : 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">
<defs>
  ${paperDefs()}
  ${sealDefs()}
  ${wetFilter('wetFar', seed + 1, 26, 0.02, 2.2)}
  ${wetFilter('wetMid', seed + 2, 13, 0.03, 1.1)}
  ${wetFilter('wetNear', seed + 3, 7, 0.05, 0.6)}
</defs>
${paperBg(SW, SH, seed)}
${draw(seed)}
<g>
  ${vtext(1740, 150, spec.title, titleSize)}
  ${seal(1740 - 34, 150 + spec.title.length * titleSize * 1.18 + 30, 68, sealText)}
</g>
${actLabel(act)}
</svg>`;
}

function main() {
  const { dir } = resolveEp(process.argv.slice(2));
  const specPath = `${dir}/scenes.json`;
  if (!existsSync(specPath))
    throw new Error(`没有 ${specPath}\n先写一份：[{ "no": 1, "comp": "画皮", "title": "…", "act": "冷开场" }, …]\n可用构图：${COMPOSITION_NAMES.join(' / ')}`);

  const doc = JSON.parse(readFileSync(specPath, 'utf8')) as { seal?: string; scenes: SceneSpec[] };
  const outDir = `${dir}/scenes`;
  // **先清空。** 改版之后场景数会变（E01 v1 是 26 张，v2 是 41 张），
  // 旧文件留在目录里会被出片那一步一起数进去，而且按文件名排序还会插在中间——
  // 表现是画面对不上声音，但没有任何报错。
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let act = '';
  const t0 = Date.now();
  doc.scenes.forEach((s, i) => {
    act = s.act ?? act;
    const svg = sceneSvg(s, act, doc.seal ?? '聊斋');
    const png = new Resvg(svg, {
      fitTo: { mode: 'original' },
      font: { loadSystemFonts: true, defaultFontFamily: INK_FONT.split(',')[0].trim() },
    })
      .render()
      .asPng();
    const name = `${String(i + 1).padStart(2, '0')}-${s.comp}.png`;
    writeFileSync(`${outDir}/${name}`, png);
    console.log(`  ${name.padEnd(22)} 第${String(s.no).padStart(3)}段起　${s.title}`);
  });
  console.log(`\n${doc.scenes.length} 张 → ${outDir}/　（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
}

if (process.argv[1]?.includes('shuoshu-scene')) main();

/**
 * 首帧物件特写库 —— 老马线出场档 ③「先出声 · 物件」专用。
 *
 *   import { OBJECTS, drawObject, hasObject } from "./objects.mjs";
 *
 * 规格出处：`老马_首帧规范_v1.md` §三。这儿只重复会被代码违反的那几条，
 * 其余去读那份。
 *
 * ── 它跟 scenes.mjs 不是一回事 ──
 *
 * `scenes.mjs` 画的是**他在哪**：一整个空间，家具按人高比例摆，
 * 角色站进去要合身。那套的取景基准是 `GROUND=1500` 和参考人高 `U=1120`。
 *
 * 这儿画的是**一样东西**，画面里只有它：
 *
 * - **不要透视、不要环境、不要背景纹理、不要人。** 一眼认不出就是失败
 * - 占画面高度 **55–70%**，视觉中心落在 **y = 0.42H**
 * - 主描边 `#1B1E1B`，线宽 **6–8px**（1080 宽下）—— 比场景那套（3–4px）粗一倍，
 *   因为它要在 120px 的缩略图上还认得出
 * - 背景纸白 `#EDEEE8` 纯色，不画在这儿（合成层给）
 *
 * ── 为什么不复用场景里那个物件 ──
 *
 * 试过把 hospital 的叫号屏抠出来放大。**放大之后线宽跟着放大，抖动幅度也跟着放大** ——
 * rough.mjs 的手绘抖是按绝对像素给的，一放大就从「手绘」变成「画歪了」。
 * 特写要重画一份，参数按特写的尺度给。
 *
 * ── 加一个新物件 ──
 *
 * 1. 在 `OBJECTS` 里加一个函数，画在 `box()` 给的框里（它已经按 55–70% 算好了）
 * 2. 跑 `npm run frame -- <稿件>` 看渲出来什么样
 * 3. **必过缩略图测试**：`npm run frame -- <稿件> --thumb` 出 120px 版，眯眼看
 *    物件还认得出、数字还看得见。大屏上好看不算数
 *
 * ⚠ **物件名就是稿件里 `object` 那个词**（首帧规范 §一：`frame_subject` 必须等于
 * `object`）。加物件之前先确认那个词是**画得出来的东西** ——
 * 「系统」「群」这类抽象物件画不了特写，那种稿子走出场档 ② 就好。
 */
import { stroke, shape, rectPts, ellipsePts } from "./rough.mjs";

export const W = 1080, H = 1920;

/** 主描边。比场景那套的 `#3B322B` 更黑一档 —— 缩略图上要立得住 */
const INK = "#1B1E1B";
/** 物件内部的浅面 */
const LIGHT = "#FBF8F1";
/** 屏幕那类深色面 */
const DARK = "#22201D";
/** 屏上发光的字 */
const AMBER = "#F0B72E";
/** 主描边线宽。规范 §三：6–8px */
const LW = 7;

/**
 * 物件的外接框。
 *
 * ── ⚠ 规范 §三 那三个数同时满足不了，这儿是怎么让的 ──
 *
 * 规范给了三个锚：**物件占高 55–70%**、**视觉中心 y = 0.42H**、**文字基线 y = 0.72H**。
 * 一算就撞：取中间值 62%（=1190px）、中心 806，物件下沿落在 **1401**；
 * 而 148px 的字墨迹顶边在 `1382 − 148×0.86 ≈ 1255`。**物件压在字上 146px。**
 *
 * 竖长的物件（门）撞得最狠；扁的（叫号屏）因为宽度先顶到边距，高度自然就矮了，撞不上。
 * 所以这不是「门画大了」，是**规范里那三个数只对扁物件成立**。
 *
 * 让法：**保住文字，压物件** —— 文字是首帧规范的核心（§四 的验收就两条，
 * 一条是物件认得出、一条是数字看得见），而物件大一点小一点不影响认出来。
 *
 *   可用带 = [顶部安全区 200, 字墨迹顶边 1255 − 留白 40] = [200, 1215]，高 1015
 *   1015 / 1920 = **0.53** —— 比规范的下限 55% 矮两个点
 *
 * **两个点是量出来的差，不是随手让的。** 要真守住 55%，字就得往下挪到 0.75H 以上，
 * 那会顶进底部 420px 的安全区（规范 §三 自己定的）。这一档的取舍就在这儿。
 *
 * ⚠ **每个物件都从这儿取框，别各画各的。** 一条一条手调的话，
 * 系列里每期物件的大小和高低都不一样 —— 那是「每期各画了一张图」，不是一个系列。
 */
function box(aspect = 1) {
  // 文字那一侧的硬约束（跟 subtitle.ts 的 openFrameSvg 对齐，改一处记得改另一处）
  const TEXT_BASE = H * 0.72;
  const TEXT_INK_TOP = TEXT_BASE - 148 * 0.86;
  const TOP_SAFE = 200;
  const GAP = 40;

  const bandTop = TOP_SAFE;
  const bandBot = TEXT_INK_TOP - GAP;
  const maxH = bandBot - bandTop;
  const maxW = W * 0.78;

  // 先按规范的 62% 试，再让宽度和可用带各砍一刀（保住比例）
  let h = Math.min(H * 0.62, maxH);
  let w = h * aspect;
  if (w > maxW) { w = maxW; h = w / aspect; }

  // 中心优先 0.42H；顶不下就往上挪，挪到贴着安全区为止
  let cy = H * 0.42;
  if (cy + h / 2 > bandBot) cy = bandBot - h / 2;
  if (cy - h / 2 < bandTop) cy = bandTop + h / 2;

  return { x: (W - w) / 2, y: cy - h / 2, w, h, cx: W / 2, cy };
}

/* ─────────────── 物件 ─────────────── */

/**
 * 叫号屏（008 / 医院候诊）。
 *
 * 画的是**屏本身**，不画墙、不画支架 —— 一块深色的板，上面两行字。
 * 屏上那两行照抄 hospital 场景里的（A047 / 前面还有 23 位）：
 * **同一样东西在特写和场景里必须写同一个数**，不然观众会以为是两块屏。
 */
function callBoard(s = 1) {
  const b = box(1.55);
  let o = "";
  o += shape(rectPts(b.x, b.y, b.w, b.h), { fill: DARK, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3.4 });
  o += `<text x="${b.cx}" y="${b.y + b.h * 0.44}" font-family="Noto Sans CJK SC Black, sans-serif" font-size="${(b.h * 0.30).toFixed(0)}" fill="${AMBER}" text-anchor="middle">A047</text>`;
  o += `<text x="${b.cx}" y="${b.y + b.h * 0.72}" font-family="Noto Sans CJK SC, sans-serif" font-size="${(b.h * 0.15).toFixed(0)}" fill="#9A9184" text-anchor="middle">前面还有 23 位</text>`;
  return o;
}

/**
 * 小门（008 的物件）。
 *
 * 一扇关着的窄门：门框、门板、两条门芯线、一个把手。
 * **不画墙、不画走廊、不画门缝里的光** —— 那些都是环境，规范 §三 禁了。
 *
 * ⚠ 它是「关着的」。开着的门是一个洞，缩略图上认不出是门。
 */
function smallDoor(s = 2) {
  const b = box(0.52);
  const fx = b.x - b.w * 0.09, fw = b.w * 1.18;
  let o = "";
  // 门框
  o += stroke(rectPts(fx, b.y, fw, b.h), { color: INK, w: LW, passes: 2, amp: 3.2, close: true, seed: s });
  // 门板
  o += shape(rectPts(b.x, b.y + b.h * 0.02, b.w, b.h * 0.98), {
    fill: LIGHT, hatchGap: 0, seed: s + 3, w: LW, line: INK, amp: 3,
  });
  // 两条门芯线
  for (const [t, h] of [[0.07, 0.34], [0.47, 0.44]]) {
    o += stroke(rectPts(b.x + b.w * 0.16, b.y + b.h * t, b.w * 0.68, b.h * h), {
      color: INK, w: LW * 0.62, passes: 1, amp: 2.6, close: true, seed: s + 10 + t * 100,
    });
  }
  // 把手
  o += stroke(ellipsePts(b.x + b.w * 0.86, b.y + b.h * 0.5, b.w * 0.045, b.w * 0.045), {
    color: INK, w: LW * 0.8, passes: 2, amp: 1.6, close: true, seed: s + 20,
  });
  return o;
}

/**
 * 系统（007 / 报销审批流）。
 *
 * ── 「系统」不是抽象物件，前提是你画的是它的**界面** ──
 *
 * 这一条差点被判成「画不了特写」。**「系统」这个词是抽象的，但 007 讲的那个系统
 * 有一个非常具体的样子：一张审批流的单子，七个节点排成一列，一个一个等人点。**
 * 画那张单子就行 —— 观众不用认出「这是系统」，认出「这是一串要人挨个点的东西」就够了。
 *
 * ⚠ 判据仍旧是规范 §四：**120px 缩略图上认得出吗？** 七行小方块在缩略图上
 * 读作「一串待办」，成立。要是画成一台电脑或一个云图标，那就真的抽象了 —— 别那么画。
 *
 * ⚠ **七个节点不是随手取的数**，是 007 台词里那个数（「系统里有七个节点」）。
 * 画面上数得出七个，跟耳朵里听到的对得上。改台词的数要连这儿一起改。
 */
function approvalFlow(s = 3) {
  const b = box(0.70);
  const N = 7;
  let o = "";
  // 单子本体
  o += shape(rectPts(b.x, b.y, b.w, b.h), { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3.2 });
  // 顶上一条抬头栏（跟正文之间一道横线）—— 没有它，七行方块读作清单，不读作"一张单子"
  const headY = b.y + b.h * 0.13;
  o += stroke([[b.x + b.w * 0.08, headY], [b.x + b.w * 0.92, headY]], {
    color: INK, w: LW * 0.7, passes: 2, amp: 2.4, seed: s + 1,
  });
  o += stroke([[b.x + b.w * 0.1, b.y + b.h * 0.075], [b.x + b.w * 0.52, b.y + b.h * 0.075]], {
    color: INK, w: LW * 0.9, passes: 2, amp: 2.2, seed: s + 2,
  });
  // 七个节点：一个方框 ＋ 一条横线
  const top = b.y + b.h * 0.21;
  const step = (b.h * 0.72) / N;
  const bs = step * 0.52;
  for (let i = 0; i < N; i++) {
    const y = top + i * step;
    o += stroke(rectPts(b.x + b.w * 0.11, y, bs, bs), {
      color: INK, w: LW * 0.75, passes: 2, amp: 2, close: true, seed: s + 10 + i,
    });
    o += stroke([[b.x + b.w * 0.11 + bs * 1.7, y + bs * 0.62], [b.x + b.w * (i % 2 ? 0.74 : 0.86), y + bs * 0.62]], {
      color: INK, w: LW * 0.6, passes: 1, amp: 2.2, seed: s + 30 + i, op: 0.8,
    });
  }
  return o;
}

/**
 * 便签。
 *
 * 一张卷了角的方纸，上面三条手写横线。**不画笔、不画桌面、不画贴在哪儿** ——
 * 那些都是环境，规范 §三 禁了；而且一贴到别的东西上，缩略图里就分不清主体是哪个。
 *
 * ⚠ **卷角是这个物件的识别点。** 一个纯方块在 120px 上读作「一张卡片／一块屏」，
 * 缺一个角、再补一折之后才读作便签。这一档的验收就是缩略图，不是大图。
 *
 * ⚠ **横线只画三条，而且不写字。** 首帧那行字归文字层，画在物件上会跟它打架；
 * 而且写了字就得跟台词里的数对上，改台词要连这儿一起改 ——
 * 留白的便签任何一条稿子都能用。
 *
 * （2026-08-23 为一条已经撤掉的稿子画的。**物件本身跟专辑无关，留着。**）
 */
function stickyNote(s = 4) {
  const b = box(1.02);
  // 右下角缺一块 —— 卷角是从这块缺口里翻出来的
  const cut = b.w * 0.2;
  const body = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h - cut],
    [b.x + b.w - cut, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  let o = "";
  o += shape(body, { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3.2 });
  // 翻起来的那一折：从缺口的两个端点折回去
  o += stroke(
    [[b.x + b.w - cut, b.y + b.h], [b.x + b.w - cut * 0.92, b.y + b.h - cut * 0.92], [b.x + b.w, b.y + b.h - cut]],
    { color: INK, w: LW * 0.8, passes: 2, amp: 2.6, seed: s + 5 }
  );
  // 三条手写横线。长短不齐 —— 一样长读作横格纸，不读作写过字
  const lens = [0.72, 0.78, 0.5];
  lens.forEach((len, i) => {
    const y = b.y + b.h * (0.3 + i * 0.17);
    o += stroke([[b.x + b.w * 0.14, y], [b.x + b.w * (0.14 + len), y]], {
      color: INK, w: LW * 0.55, passes: 1, amp: 2.4, seed: s + 10 + i, op: 0.85,
    });
  });
  return o;
}

/**
 * 瓶盖（1861）。**俯视**，不是侧视。
 *
 * 侧视的瓶盖是个小圆柱，120px 下跟杯子、跟药瓶盖分不开；
 * 俯视那一圈**齿**才是它唯一的识别点 —— 而那圈齿正好是台词里的东西
 * （「手心印出一圈齿」）。
 *
 * ⚠ 齿要画够多（20 个）。画到十个以下读作齿轮，不读作瓶盖。
 */
function bottleCap(s = 5) {
  const b = box(1);
  const R = Math.min(b.w, b.h) / 2;
  let o = "";
  // 齿：外圈一圈短辐条，先画，让盖面盖住内端
  const N = 20;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const [c, si] = [Math.cos(a), Math.sin(a)];
    o += stroke([[b.cx + c * R * 0.82, b.cy + si * R * 0.82], [b.cx + c * R, b.cy + si * R]], {
      color: INK, w: LW * 0.8, passes: 1, amp: 1.6, seed: s + i,
    });
  }
  o += shape(ellipsePts(b.cx, b.cy, R * 0.87, R * 0.87), {
    fill: LIGHT, hatchGap: 0, seed: s + 40, w: LW, line: INK, amp: 3,
  });
  // 盖顶的浅压印圈
  o += stroke(ellipsePts(b.cx, b.cy, R * 0.58, R * 0.58), {
    color: INK, w: LW * 0.55, passes: 1, amp: 2.4, close: true, seed: s + 60, op: 0.75,
  });
  return o;
}

/**
 * 遥控器（1863）。
 *
 * 识别点是**上圆下格**：顶上一个大圆键，底下两列小方键。
 * 只画一堆方块的话读作计算器；那个大圆键是遥控器的标志。
 */
function remote(s = 6) {
  const b = box(0.34);
  let o = "";
  o += shape(rectPts(b.x, b.y, b.w, b.h), { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3 });
  // 顶上的大圆键
  const r = b.w * 0.24;
  o += stroke(ellipsePts(b.cx, b.y + b.h * 0.13, r, r), {
    color: INK, w: LW * 0.85, passes: 2, amp: 2.2, close: true, seed: s + 3,
  });
  // 两列小方键
  const bw = b.w * 0.26;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 2; col++) {
      const x = b.x + b.w * 0.2 + col * b.w * 0.34;
      const y = b.y + b.h * 0.3 + row * b.h * 0.13;
      o += stroke(rectPts(x, y, bw, b.h * 0.075), {
        color: INK, w: LW * 0.6, passes: 1, amp: 1.8, close: true, seed: s + 10 + row * 2 + col,
      });
    }
  }
  return o;
}

/**
 * 手机（1866 / 1871）。**一件画法两条稿子共用** —— 那正是「复现物件」要的效果。
 *
 * 识别点是**深色屏 ＋ 底部那一道横条**。只画一个圆角矩形会读作卡片；
 * 屏幕压深、底下留一道 home 指示条，才立刻读作手机。
 *
 * ⚠ **屏上不写字、不画电量。** 1866 讲的是剩百分之三，1871 讲的是视频通话 ——
 * 画死任何一个，另一条就用不了这件物件了。
 */
function phone(s = 7) {
  const b = box(0.48);
  let o = "";
  o += shape(rectPts(b.x, b.y, b.w, b.h), { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3 });
  // 屏
  const m = b.w * 0.075;
  o += shape(rectPts(b.x + m, b.y + b.h * 0.06, b.w - m * 2, b.h * 0.82), {
    fill: DARK, hatchGap: 0, seed: s + 2, w: LW * 0.7, line: INK, amp: 2.6,
  });
  // 听筒
  o += stroke([[b.cx - b.w * 0.12, b.y + b.h * 0.035], [b.cx + b.w * 0.12, b.y + b.h * 0.035]], {
    color: INK, w: LW * 0.6, passes: 1, amp: 1.4, seed: s + 5,
  });
  // 底部指示条
  o += stroke([[b.cx - b.w * 0.16, b.y + b.h * 0.935], [b.cx + b.w * 0.16, b.y + b.h * 0.935]], {
    color: INK, w: LW * 0.8, passes: 2, amp: 1.6, seed: s + 6,
  });
  return o;
}

/**
 * 笔记本（1868）。**纸本子，不是笔记本电脑。**
 *
 * 台词是「夹着笔记本跟出去」「回工位翻笔记」—— 那是本子。
 *
 * ⚠ **跟 `便签` 必须一眼分得开**，两件都是「一张纸」。
 * 分法：便签靠**卷角**，本子靠**左侧线圈**。线圈那一列是这件物件的全部识别点，
 * 少了它 120px 下两件长得一模一样。
 */
function notebook(s = 8) {
  const b = box(0.76);
  let o = "";
  o += shape(rectPts(b.x, b.y, b.w, b.h), { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3.2 });
  // 左侧线圈
  const n = 9;
  for (let i = 0; i < n; i++) {
    const y = b.y + b.h * (0.08 + (i * 0.84) / (n - 1));
    o += stroke(ellipsePts(b.x + b.w * 0.075, y, b.w * 0.05, b.h * 0.022), {
      color: INK, w: LW * 0.7, passes: 2, amp: 1.6, close: true, seed: s + 10 + i,
    });
  }
  // 竖分隔线（装订边）
  o += stroke([[b.x + b.w * 0.16, b.y + b.h * 0.05], [b.x + b.w * 0.16, b.y + b.h * 0.95]], {
    color: INK, w: LW * 0.5, passes: 1, amp: 2, seed: s + 30, op: 0.7,
  });
  // 三条手写横线，长短不齐
  [0.66, 0.72, 0.44].forEach((len, i) => {
    const y = b.y + b.h * (0.32 + i * 0.17);
    o += stroke([[b.x + b.w * 0.24, y], [b.x + b.w * (0.24 + len), y]], {
      color: INK, w: LW * 0.5, passes: 1, amp: 2.2, seed: s + 40 + i, op: 0.85,
    });
  });
  return o;
}

/**
 * 杯子（1874）。
 *
 * 识别点是**把手**。没有把手的杯子在 120px 下就是个梯形，跟纸盒、跟笔筒分不开。
 *
 * ⚠ **不画热气、不画水位。** 1874 的落点是「杯子是空的」——
 * 画上水位就把落点提前说了（首帧不能剧透）。
 */
function mug(s = 9) {
  const b = box(0.92);
  const bw = b.w * 0.72;
  const bx = b.x + b.w * 0.05;
  let o = "";
  // 把手先画，让杯身盖住内端
  o += stroke(ellipsePts(bx + bw, b.y + b.h * 0.52, b.w * 0.19, b.h * 0.17), {
    color: INK, w: LW * 1.1, passes: 2, amp: 2.4, close: true, seed: s + 3,
  });
  // 杯身：上宽下窄一点
  const body = [
    [bx, b.y + b.h * 0.08],
    [bx + bw, b.y + b.h * 0.08],
    [bx + bw * 0.92, b.y + b.h * 0.96],
    [bx + bw * 0.08, b.y + b.h * 0.96],
  ];
  o += shape(body, { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3.2 });
  // 杯口
  o += stroke(ellipsePts(bx + bw / 2, b.y + b.h * 0.08, bw / 2, b.h * 0.055), {
    color: INK, w: LW * 0.75, passes: 2, amp: 2.2, close: true, seed: s + 20,
  });
  return o;
}

/**
 * 瓶子（1861）。**整瓶带盖，不是只有盖。**
 *
 * 第一版只画了俯视的瓶盖 —— 那是把 `body_anchor`（手心被齿印出一圈）当成了物件。
 * 物件是**他拧不开的那瓶水**，盖只是它身上最要紧的那一截。
 *
 * 构图：瓶身占大半，**盖画得比例偏大**并且带齿 —— 首帧要一眼看出「问题在盖上」。
 * 齿只画在盖的侧面轮廓上（一排小豁口），不画俯视那圈：侧视里看不见整圈。
 */
function bottle(s = 10) {
  const b = box(0.42);
  const capH = b.h * 0.17;
  const neckH = b.h * 0.08;
  const bw = b.w;
  let o = "";
  // 瓶身：肩部收一点
  const body = [
    [b.x + bw * 0.06, b.y + capH + neckH],
    [b.x + bw * 0.94, b.y + capH + neckH],
    [b.x + bw * 0.9, b.y + b.h],
    [b.x + bw * 0.1, b.y + b.h],
  ];
  o += shape(body, { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 3 });
  // 瓶身两道压纹（矿泉水瓶的腰线），顺带把「这是瓶水」坐实
  for (const f of [0.55, 0.68]) {
    o += stroke([[b.x + bw * 0.12, b.y + b.h * f], [b.x + bw * 0.88, b.y + b.h * f]], {
      color: INK, w: LW * 0.55, passes: 1, amp: 2, seed: s + 20 + f * 10, op: 0.7,
    });
  }
  // 瓶颈
  o += shape(rectPts(b.x + bw * 0.34, b.y + capH, bw * 0.32, neckH + 6), {
    fill: LIGHT, hatchGap: 0, seed: s + 4, w: LW * 0.85, line: INK, amp: 2.2,
  });
  // 盖：比例画大，带齿
  const cx0 = b.x + bw * 0.29, cw = bw * 0.42;
  o += shape(rectPts(cx0, b.y, cw, capH), { fill: LIGHT, hatchGap: 0, seed: s + 6, w: LW, line: INK, amp: 2.4 });
  const N = 7;
  for (let i = 1; i < N; i++) {
    const x = cx0 + (cw * i) / N;
    o += stroke([[x, b.y + capH * 0.18], [x, b.y + capH * 0.86]], {
      color: INK, w: LW * 0.6, passes: 1, amp: 1.4, seed: s + 30 + i, op: 0.85,
    });
  }
  return o;
}

export const OBJECTS = {
  叫号屏: callBoard,
  小门: smallDoor,
  系统: approvalFlow,
  便签: stickyNote,
  瓶盖: bottleCap,
  瓶子: bottle,
  瓶: bottle,
  遥控器: remote,
  手机: phone,
  笔记本: notebook,
  杯子: mug,
};

export const hasObject = (name) => Object.prototype.hasOwnProperty.call(OBJECTS, name);

/**
 * 出一个物件的特写（只有物件，不含背景和文字 —— 那两样归合成层）。
 *
 * ⚠ **名字不在库里就抛，不回退。** 静默回退到某个默认物件的话，
 * 出来的片子首帧是另一样东西，而这一档的全部意义就是首帧
 * —— 那种错要等成片才看得见。
 */
export function drawObject(name, seed = 1) {
  if (!hasObject(name)) {
    throw new Error(
      `没有物件「${name}」的特写画法。horse/objects.mjs 里现有：${Object.keys(OBJECTS).join(" / ")}\n` +
        `加一个，或者这条稿子改走出场档 ②（voice-first，场景直出）。` +
        `抽象物件（系统、群）画不了特写，只能走 ②。`
    );
  }
  return OBJECTS[name](seed);
}

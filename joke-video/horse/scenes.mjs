/**
 * 场景库 —— 和马同一套画风（rough.mjs）
 *
 *   import { scene, SCENES, PLACES } from "./scenes.mjs";
 *
 * ── 尺度系统（这是整个库的地基，别改）──────────────────
 * 画布 1080×1920 竖版，地平线固定 GROUND=1500，参考人高 U=1120px。
 * 所有家具都用 u(f) / up(f) 按真人比例摆：f 是"相对人高的倍数"。
 * 例如桌面高 0.75 米 ÷ 1.75 米 ≈ 0.43，就写 up(0.43)。
 *
 * 这样马（渲染高度正好 U）站进任何场景，家具高度都是对的：
 * 桌面到腰、沙发靠背到胯、门框过头顶。上一版就是缺这套换算，
 * 桌子只到马的膝盖。
 *
 * ── 站位 ────────────────────────────────────────────
 * 每个场景在 SCENES 里声明 stand，指明画面哪块是留给角色的空区。
 * 配合 PLACES 里的预设直接用，不用一张张试位置。
 */
import { stroke, hatch, shape, poly, jitter, rectPts, ellipsePts, sample } from "./rough.mjs";

export const W = 1080, H = 1920;
export const GROUND = 1500;          // 地平线
export const U = 1120;               // 参考人高（马的渲染高度）

const u = (f) => f * U;              // 按人高取长度
const up = (f) => GROUND - f * U;    // 距地 f 个人高处的 y 坐标

const PAPER = "#F1ECE0";
const INK = "#3B322B";
const GRAY = "#6E6459";
const LIGHT = "#FBF8F1";
const DARK = "#2B2622";
const AMBER = "#F0B72E";

const head = (bg = PAPER) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="${bg}"/>`;

const ground = (s = 1) =>
  stroke([[-20, GROUND - 6], [W / 2, GROUND + 10], [W + 20, GROUND - 4]],
    { color: GRAY, w: 3.4, passes: 2, amp: 4, seed: s, op: 0.55 });

/** 墙裙线：给空墙一点层次，位置在人的肩高附近 */
const wainscot = (s) =>
  stroke([[-20, up(0.95)], [W / 2, up(0.95) + 10], [W + 20, up(0.95) - 6]],
    { color: GRAY, w: 2.6, passes: 2, amp: 3.5, seed: s, op: 0.3 });

/* ─────────────── 工位 ─────────────── */

function officeDesk(s = 1) {
  let o = head();
  o += wainscot(s);
  // 窗：窗台 0.5 人高，窗顶 1.10 —— 放在右侧，左边留给角色
  //
  // **窗顶原来是 1.25，也就是 y=100 —— 顶到画幅上边去了。** 而马的头顶在 380，
  // 左上角是一片空墙。同一条上边界，右边满得溢出画外、左边空 260px，
  // 看着就是「上面挤、下面空」。压到 1.10（y≈268）之后右上角让出来，
  // 两边的留白对得上，画面才是平的。
  //
  // 压窗**不动地平线**。GROUND=1500 让脚正好落在平台底部 20% 遮挡带
  // （y>1536）上方 36px —— 整体下移就是把脚埋进文案条里。
  const win = [[600, up(1.10)], [1010, up(1.13)], [1016, up(0.5)], [606, up(0.47)]];
  o += shape(win, { fill: LIGHT, hatchGap: 34, hatchAngle: 52, hatchOp: 0.22, seed: s + 1, w: 4.2 });
  o += stroke([[806, up(1.11)], [810, up(0.48)]], { color: INK, w: 3.2, passes: 2, amp: 2.6, seed: s + 2 });
  o += stroke([[602, up(0.87)], [1013, up(0.89)]], { color: INK, w: 3.2, passes: 2, amp: 2.6, seed: s + 3 });
  // 桌：桌面高 0.43，深度做出一点透视
  const top = [[520, up(0.43)], [1070, up(0.40)], [1070, up(0.34)], [520, up(0.37)]];
  o += shape(top, { fill: LIGHT, hatchGap: 20, hatchAngle: 44, hatchOp: 0.3, seed: s + 4, w: 3.8 });
  o += stroke([[576, up(0.36)], [568, GROUND]], { color: INK, w: 4, passes: 2, amp: 2.8, seed: s + 5 });
  o += stroke([[1040, up(0.33)], [1050, GROUND - 10]], { color: INK, w: 4, passes: 2, amp: 2.8, seed: s + 6 });
  // 显示器：底 0.43 顶 0.72
  o += shape([[660, up(0.72)], [900, up(0.70)], [906, up(0.44)], [666, up(0.45)]],
    { fill: LIGHT, hatchGap: 22, hatchAngle: 62, hatchOp: 0.28, seed: s + 7, w: 3.8 });
  o += stroke([[783, up(0.44)], [783, up(0.43)]], { color: INK, w: 6, passes: 1, amp: 1, seed: s + 8 });
  // 纸堆
  for (let i = 0; i < 3; i++)
    o += shape(rectPts(940, up(0.44) - i * 13, 110, 20), { fill: LIGHT, hatchGap: 0, seed: s + 10 + i, w: 2.6 });
  o += ground(s);
  return o + "</svg>";
}

function meetingRoom(s = 2) {
  let o = head();
  o += wainscot(s);
  // 白板：底 0.55 顶 1.35，靠右
  const wb = [[430, up(1.26)], [1030, up(1.24)], [1034, up(0.55)], [434, up(0.57)]];
  o += shape(wb, { fill: LIGHT, hatchGap: 0, seed: s + 1, w: 4.4 });
  for (let i = 0; i < 4; i++)
    o += stroke([[480, up(1.12) + i * 88], [700 + i * 40, up(1.08) + i * 90], [990, up(1.14) + i * 86]],
      { color: GRAY, w: 3.4, passes: 1, amp: 7, seed: s + 20 + i, op: 0.42 });
  // 长桌：桌面 0.43，横贯画面下缘
  const t = [[-40, up(0.43)], [1120, up(0.39)], [1120, up(0.28)], [-40, up(0.32)]];
  o += shape(t, { fill: LIGHT, hatchGap: 17, hatchAngle: 40, hatchOp: 0.3, seed: s + 5, w: 4 });
  o += ground(s);
  return o + "</svg>";
}

/* ─────────────── 一个人住 ─────────────── */

function rentalLiving(s = 3) {
  let o = head();
  o += wainscot(s);
  // 沙发：座高 0.24，靠背顶 0.5 —— 靠右，左边留人
  const L = 470, R = 1060;
  const sofa = sample([
    [[L, up(0.24)], [L - 8, up(0.42)], [L + 30, up(0.5)], [L + 90, up(0.5)]],
    [[L + 90, up(0.5)], [700, up(0.52)], [900, up(0.52)], [R - 40, up(0.5)]],
    [[R - 40, up(0.5)], [R, up(0.5)], [R + 16, up(0.42)], [R + 10, up(0.24)]],
    [[R + 10, up(0.24)], [R + 14, up(0.12)], [R + 6, up(0.03)], [R - 4, GROUND]],
    [[R - 4, GROUND], [850, GROUND + 8], [640, GROUND + 6], [L + 16, GROUND - 4]],
    [[L + 16, GROUND - 4], [L + 6, up(0.05)], [L + 2, up(0.14)], [L, up(0.24)]],
  ], 12);
  o += shape(sofa, { fill: LIGHT, hatchGap: 20, hatchAngle: 58, hatchOp: 0.28, seed: s + 1, w: 4 });
  o += stroke([[L + 14, up(0.235)], [760, up(0.25)], [R - 6, up(0.235)]],
    { color: INK, w: 3, passes: 2, amp: 3, seed: s + 2, op: 0.7 });
  // 落地灯：灯罩底 1.15
  o += stroke([[330, GROUND], [336, up(1.15)]], { color: INK, w: 3.8, passes: 2, amp: 3, seed: s + 3 });
  o += shape([[252, up(1.15)], [420, up(1.16)], [396, up(1.33)], [278, up(1.32)]],
    { fill: LIGHT, hatchGap: 18, hatchAngle: 70, hatchOp: 0.26, seed: s + 4, w: 3.6 });
  // 茶几：0.2
  o += shape(rectPts(560, up(0.2), 320, 34), { fill: LIGHT, hatchGap: 16, hatchOp: 0.3, seed: s + 5, w: 3.4 });
  o += ground(s);
  return o + "</svg>";
}

function kitchenTable(s = 4) {
  let o = head();
  o += wainscot(s);
  // 餐桌：0.43，横贯下缘
  const t = [[-30, up(0.43)], [1110, up(0.40)], [1110, up(0.30)], [-30, up(0.33)]];
  o += shape(t, { fill: LIGHT, hatchGap: 16, hatchAngle: 42, hatchOp: 0.3, seed: s + 1, w: 4 });
  // 外卖盒：高 0.13，摆右侧
  o += shape([[640, up(0.56)], [810, up(0.55)], [818, up(0.42)], [648, up(0.43)]],
    { fill: LIGHT, hatchGap: 22, hatchAngle: 66, hatchOp: 0.28, seed: s + 2, w: 3.6 });
  o += shape([[850, up(0.52)], [990, up(0.51)], [996, up(0.42)], [844, up(0.43)]],
    { fill: LIGHT, hatchGap: 24, hatchAngle: 58, hatchOp: 0.26, seed: s + 3, w: 3.4 });
  o += stroke([[880, up(0.60)], [960, up(0.53)]], { color: INK, w: 5, passes: 2, amp: 2, seed: s + 4 });
  o += ground(s);
  return o + "</svg>";
}

function bedroom(s = 5) {
  let o = head();
  o += wainscot(s);
  // 床：床面 0.29，靠右
  o += shape([[430, up(0.29)], [1080, up(0.26)], [1080, up(0.06)], [440, up(0.09)]],
    { fill: LIGHT, hatchGap: 18, hatchAngle: 46, hatchOp: 0.3, seed: s + 1, w: 4 });
  // 枕头
  o += shape([[470, up(0.40)], [700, up(0.39)], [710, up(0.28)], [478, up(0.29)]],
    { fill: LIGHT, hatchGap: 26, hatchAngle: 64, hatchOp: 0.24, seed: s + 2, w: 3.4 });
  // 床头柜 0.34 + 闹钟
  o += shape(rectPts(300, up(0.34), 160, u(0.34)), { fill: LIGHT, hatchGap: 20, hatchOp: 0.28, seed: s + 3, w: 3.6 });
  o += shape(ellipsePts(380, up(0.42), 52, 50), { fill: LIGHT, hatchGap: 0, seed: s + 4, w: 3.4 });
  o += stroke([[380, up(0.42)], [380, up(0.455)]], { color: INK, w: 3.2, passes: 2, amp: 1.6, seed: s + 5 });
  o += stroke([[380, up(0.42)], [408, up(0.408)]], { color: INK, w: 3.2, passes: 2, amp: 1.6, seed: s + 6 });
  o += ground(s);
  return o + "</svg>";
}

/* ─────────────── 众目睽睽 ─────────────── */

function elevator(s = 6) {
  let o = head("#EDE8DC");
  // 轿厢壁：门框过头顶（1.25 人高）
  o += hatch([[0, 0], [130, 0], [118, H], [0, H]], { angle: 70, gap: 24, color: GRAY, w: 1.4, op: 0.26, seed: s + 3 });
  o += hatch([[950, 0], [W, 0], [W, H], [962, H]], { angle: 70, gap: 24, color: GRAY, w: 1.4, op: 0.26, seed: s + 4 });
  o += stroke([[130, 0], [118, H]], { color: INK, w: 4.2, passes: 2, amp: 3, seed: s + 1 });
  o += stroke([[950, 0], [962, H]], { color: INK, w: 4.2, passes: 2, amp: 3, seed: s + 2 });
  // 楼层屏：1.26 人高（屏顶 y≈89，数字在 120–190）。
  //
  // ⚠ **不要往下压。** 试过压到 1.16（屏顶 201），理由是「平台顶部那条 UI
  // 大约盖到 130」—— 结果撞上了收尾卡：钩子字幕画在 y=250，
  // 一压下来两块正好叠在一起，而且钩子是藏青、屏是深色，字直接看不见了。
  //
  // 原位置本来不撞。而那个「被顶部 UI 盖住」的担心也是虚的：
  // **数字本身在 120–190，UI 盖到的是空框的上沿**，数字看得见。
  // 这块屏是《看哪儿》落点指的东西（「不会变快的数字」），它必须清楚，
  // 但清楚的办法不是挪它，是别让别的东西挪到它头上。
  o += shape(rectPts(410, up(1.26), 260, 130), { fill: DARK, hatchGap: 0, seed: s + 5, w: 4.2 });
  o += `<text x="540" y="${up(1.26) + 96}" font-family="Noto Sans CJK SC Black, sans-serif" font-size="92" fill="${AMBER}" text-anchor="middle">12</text>`;
  // 按钮板：中心 0.7 人高，靠右壁
  o += shape(rectPts(820, up(0.92), 110, u(0.45)), { fill: LIGHT, hatchGap: 0, seed: s + 6, w: 3.2 });
  for (let i = 0; i < 8; i++)
    o += stroke(ellipsePts(875, up(0.88) + i * 54, 19, 19),
      { color: INK, w: 2.6, passes: 1, amp: 1.4, close: true, seed: s + 30 + i, op: 0.7 });
  o += ground(s);
  return o + "</svg>";
}

function subway(s = 7) {
  let o = head("#ECE7DB");
  // 车窗：窗台 0.65，窗顶 1.25
  for (let i = 0; i < 2; i++) {
    const x = 60 + i * 520;
    o += shape([[x, up(1.25)], [x + 440, up(1.25)], [x + 440, up(0.65)], [x, up(0.65)]],
      { fill: "#DCD6C8", hatchGap: 36, hatchAngle: 56, hatchOp: 0.3, seed: s + i, w: 4.2 });
  }
  // 吊环：环底 0.95 人高（伸手够得着）
  for (let i = 0; i < 4; i++) {
    const x = 170 + i * 250;
    o += stroke([[x, 0], [x + 6, up(1.32)]], { color: INK, w: 3.6, passes: 2, amp: 2.4, seed: s + 10 + i });
    o += stroke(ellipsePts(x + 6, up(1.22), 36, 46),
      { color: INK, w: 3.8, passes: 2, amp: 2.4, close: true, seed: s + 20 + i });
  }
  // 座椅：座高 0.26
  o += shape([[-30, up(0.26)], [1110, up(0.23)], [1110, up(0.10)], [-30, up(0.13)]],
    { fill: LIGHT, hatchGap: 19, hatchAngle: 44, hatchOp: 0.3, seed: s + 5, w: 4 });
  o += ground(s);
  return o + "</svg>";
}

function hospital(s = 8) {
  let o = head();
  o += wainscot(s);
  // 叫号屏：1.26 人高，靠右（屏顶 y≈89，屏底 y≈241）
  //
  // ⚠ **屏底必须停在 y≈250 以上，这个高度是量出来的、不是随手定的。**
  // 收尾卡的钩子字幕画死在 y=250（render.ts 的 hookStrip 调用），字号 52、居中，
  // 「老马的第 1854 天」实测横跨 x 324–756、墨迹 y 268–313。
  // 原来这块屏是 470×230（y 89–319），跟那行字**正好叠在一起** ——
  // 而且屏是 DARK、钩子是藏青，字直接看不见。
  // 电梯那块屏顶上写过同一条教训（「场景里靠上的元素跟收尾卡是同一片地」），
  // 那次是渲出来才发现的；这次是 008 用这个场景之前先量的。
  //
  // 压的是高度不是位置：屏必须留在头顶那片空墙上，往下挪就撞脸，往右挪就没地方排字。
  // 230 → 152，两行字跟着缩一档（70→64 / 40→34），上下留白 36 / 14。
  o += shape(rectPts(560, up(1.26), 470, 152), { fill: DARK, hatchGap: 0, seed: s + 1, w: 4.2 });
  o += `<text x="795" y="${up(1.26) + 82}" font-family="Noto Sans CJK SC Black, sans-serif" font-size="64" fill="${AMBER}" text-anchor="middle">A047</text>`;
  o += `<text x="795" y="${up(1.26) + 130}" font-family="Noto Sans CJK SC, sans-serif" font-size="34" fill="#9A9184" text-anchor="middle">前面还有 23 位</text>`;
  // 排椅：座高 0.26，靠背 0.5
  for (let i = 0; i < 3; i++) {
    const x = 420 + i * 230;
    o += shape(rectPts(x, up(0.50), 200, u(0.24)), { fill: LIGHT, hatchGap: 20, hatchOp: 0.26, seed: s + 10 + i, w: 3.4 });
    o += shape(rectPts(x, up(0.26), 200, 30), { fill: LIGHT, hatchGap: 16, hatchOp: 0.3, seed: s + 20 + i, w: 3.4 });
    o += stroke([[x + 20, up(0.22)], [x + 16, GROUND]], { color: INK, w: 3.2, passes: 2, amp: 2.2, seed: s + 30 + i });
    o += stroke([[x + 180, up(0.22)], [x + 184, GROUND]], { color: INK, w: 3.2, passes: 2, amp: 2.2, seed: s + 40 + i });
  }
  o += ground(s);
  return o + "</svg>";
}

/* ─────────────── 回家 ─────────────── */

function homeLiving(s = 9) {
  let o = head("#F2EDDF");
  o += wainscot(s);
  // 挂历：1.35 人高
  o += shape(rectPts(120, up(1.26), 230, 330), { fill: LIGHT, hatchGap: 0, seed: s + 1, w: 3.6 });
  o += stroke([[132, up(1.26) + 110], [340, up(1.26) + 104]], { color: INK, w: 2.8, passes: 1, amp: 2, seed: s + 2, op: 0.6 });
  for (let r = 0; r < 4; r++)
    o += stroke([[140, up(1.26) + 150 + r * 42], [332, up(1.26) + 146 + r * 42]],
      { color: GRAY, w: 2.2, passes: 1, amp: 2.6, seed: s + 10 + r, op: 0.4 });
  // 老沙发：靠右
  const L = 480, R = 1070;
  const sofa = sample([
    [[L, up(0.24)], [L - 8, up(0.42)], [L + 30, up(0.5)], [L + 90, up(0.5)]],
    [[L + 90, up(0.5)], [720, up(0.52)], [900, up(0.52)], [R - 40, up(0.5)]],
    [[R - 40, up(0.5)], [R, up(0.5)], [R + 16, up(0.42)], [R + 10, up(0.24)]],
    [[R + 10, up(0.24)], [R + 14, up(0.12)], [R + 6, up(0.03)], [R - 4, GROUND]],
    [[R - 4, GROUND], [860, GROUND + 8], [660, GROUND + 6], [L + 16, GROUND - 4]],
    [[L + 16, GROUND - 4], [L + 6, up(0.05)], [L + 2, up(0.14)], [L, up(0.24)]],
  ], 12);
  o += shape(sofa, { fill: LIGHT, hatchGap: 17, hatchAngle: 54, hatchOp: 0.28, seed: s + 3, w: 4 });
  // 碎花（老家沙发的灵魂）
  for (let i = 0; i < 15; i++) {
    const x = L + 60 + (i % 5) * 110, y = up(0.42) + ((i / 5) | 0) * 96;
    o += stroke(ellipsePts(x, y, 13, 13), { color: GRAY, w: 2.2, passes: 1, amp: 1.6, close: true, seed: s + 40 + i, op: 0.42 });
  }
  o += ground(s);
  return o + "</svg>";
}

function streetNight(s = 10) {
  let o = head("#E6E1D4");
  // 楼群：最矮的也有 1.6 个人高
  let x = -20, i = 0;
  while (x < W + 40) {
    const w = 120 + ((i * 53) % 150);
    const h = u(0.95) + ((i * 91) % Math.round(u(0.95)));
    o += shape(rectPts(x, GROUND - h, w, h),
      { fill: "#DAD4C5", hatchGap: 28, hatchAngle: 64, hatchOp: 0.24, seed: s + i, w: 3 });
    for (let k = 0; k < 6; k++) {
      if ((i * 7 + k * 13) % 4) continue;
      o += `<rect x="${x + 20 + (k % 2) * 46}" y="${GROUND - h + 50 + k * 74}" width="30" height="40" fill="${AMBER}" opacity="0.72"/>`;
    }
    x += w + 22; i++;
  }
  // 路灯：灯头 2.2 人高
  o += stroke([[880, GROUND], [870, up(1.28)]], { color: INK, w: 4.4, passes: 2, amp: 3, seed: s + 30 });
  o += stroke([[870, up(1.28)], [760, up(1.25)]], { color: INK, w: 4.4, passes: 2, amp: 2.6, seed: s + 31 });
  o += stroke(ellipsePts(756, up(1.22), 38, 24), { color: INK, w: 3.4, passes: 2, amp: 2, close: true, seed: s + 32 });
  o += ground(s);
  return o + "</svg>";
}

/* ─────────────── 导出 ─────────────── */

/** 站位预设：y 已经对齐 GROUND，height 已经对齐 U。别自己改这两个数 */
const yG = GROUND / H;
const hU = U / H;
export const PLACES = {
  左侧:     { anchor: "bottom", x: 0.27, y: yG, height: hU },
  中央:     { anchor: "bottom", x: 0.50, y: yG, height: hU },
  右侧:     { anchor: "bottom", x: 0.73, y: yG, height: hU, flip: true },
  近景半身: { anchor: "bottom", x: 0.50, y: yG + 0.30, height: hU * 1.85 },
  远景:     { anchor: "bottom", x: 0.60, y: yG, height: hU * 0.58 },
};

export const SCENES = {
  "office-desk":   { fn: officeDesk,    column: "工位",     stand: "左侧", label: "工位（窗+显示器+桌，右侧占满）" },
  "meeting-room":  { fn: meetingRoom,   column: "工位",     stand: "左侧", label: "会议室（白板+长桌）" },
  "rental-living": { fn: rentalLiving,  column: "一个人住", stand: "左侧", label: "出租屋客厅（沙发+落地灯）" },
  "kitchen-table": { fn: kitchenTable,  column: "一个人住", stand: "左侧", label: "餐桌（外卖盒）" },
  "bedroom":       { fn: bedroom,       column: "一个人住", stand: "左侧", label: "卧室（床+床头柜闹钟）" },
  "elevator":      { fn: elevator,      column: "众目睽睽", stand: "中央", label: "电梯内（楼层屏+按钮板）" },
  "subway":        { fn: subway,        column: "众目睽睽", stand: "中央", label: "地铁车厢（吊环+车窗）" },
  "hospital":      { fn: hospital,      column: "众目睽睽", stand: "左侧", label: "候诊区（叫号屏+排椅）" },
  "home-living":   { fn: homeLiving,    column: "回家",     stand: "中央", label: "老家客厅（挂历+碎花沙发）" },
  "street-night":  { fn: streetNight,   column: "回家",     stand: "中央", label: "夜晚街道（楼群+路灯）" },
};

export function scene(name, seed) {
  const e = SCENES[name];
  if (!e) throw new Error(`没有这个场景：${name}。可用：${Object.keys(SCENES).join(", ")}`);
  return e.fn(seed ?? 1);
}

/** 场景自带的推荐站位 */
export const placeFor = (name) => PLACES[SCENES[name].stand];

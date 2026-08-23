/**
 * 标题牌匾
 *
 *   import { plaque } from "./plaque.mjs";
 *   svg += plaque({ text:"备注没用", sub:"随便两字搞定", ...PLAQUE_AT["office-desk"] });
 *
 * 把标题做成场景里的**物件**，不是浮在画面上的 UI。
 *
 * 三条规矩：
 *   一、画在场景之上、角色之下 —— 角色挡住它时才有空间感
 *   二、轻微倾斜 1–3 度。摆正了就变回 UI 了
 *   三、位置随场景走，不固定。每个场景在 PLAQUE_AT 里声明自己的空白位
 */
import { stroke, hatch, poly, jitter, rectPts, ellipsePts, sample } from "./rough.mjs";

const LINE = "#3B322B";
const WOOD = "#D8BE93";
const WOOD_SHADE = "#A98A5C";
const PAPER = "#FAF4E6";
const TAPE = "#E8DFC4";
const INK = "#2B2622";
const FONT = "ZCOOL KuaiLe, Noto Sans CJK SC Black, sans-serif";
const FONT_SUB = "Noto Sans CJK SC, sans-serif";

const isHalf = (ch) => /[\x00-\xff]/.test(ch);
const units = (s) => [...s].reduce((n, c) => n + (isHalf(c) ? 0.55 : 1), 0);

/**
 * @param style  wood 挂绳木牌 | tape 胶带贴纸 | pin 图钉便签
 * @param x,y    锚点（画布比例）。y 是牌匾中心
 * @param rot    倾斜角，别超过 ±4
 * @param scale  整体缩放
 */
export function plaque({
  text, sub = "", style = "wood",
  x = 0.24, y = 0.16, rot = -2, scale = 1,
  W = 1080, H = 1920, seed = 7,
}) {
  const fs = 62 * scale;
  const w = Math.max(units(text) * fs + 78 * scale, 260 * scale);
  const h = (sub ? 164 : 118) * scale;
  const cx = W * x, cy = H * y;
  const box = rectPts(-w / 2, -h / 2, w, h);

  let o = `<g id="plaque" transform="translate(${cx.toFixed(0)},${cy.toFixed(0)}) rotate(${rot})">`;

  if (style === "wood") {
    // 两根挂绳，从牌匾顶角斜上去
    for (const sx of [-1, 1]) {
      o += stroke([[sx * w * 0.34, -h / 2], [sx * w * 0.18, -h / 2 - 76], [0, -h / 2 - 132]],
        { color: LINE, w: 4, passes: 2, amp: 3, seed: seed + (sx > 0 ? 1 : 2) });
    }
    o += `<path d="${poly(jitter(box, 3, seed), true)}" fill="${WOOD}"/>`;
    o += hatch(box, { angle: 8, gap: 16, color: WOOD_SHADE, w: 1.6, op: 0.3, seed: seed + 3 });
    o += stroke(box, { color: LINE, w: 5, passes: 2, amp: 3.2, close: true, seed: seed + 4 });
    // 上下两道横木
    for (const sy of [-1, 1]) {
      o += stroke([[-w / 2 + 14, (sy * h) / 2 - sy * 22], [w / 2 - 14, (sy * h) / 2 - sy * 20]],
        { color: WOOD_SHADE, w: 4, passes: 1, amp: 2.4, seed: seed + 5 + sy, op: 0.6 });
    }
  } else if (style === "tape") {
    o += `<path d="${poly(jitter(box, 3, seed), true)}" fill="${PAPER}"/>`;
    o += stroke(box, { color: LINE, w: 4.5, passes: 2, amp: 3, close: true, seed: seed + 4 });
    // 四角胶带
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const t = rectPts(sx * (w / 2) - 44, sy * (h / 2) - 26, 88, 52);
      o += `<path d="${poly(jitter(t, 2, seed + 10 + sx * sy), true)}" fill="${TAPE}" opacity="0.9" transform="rotate(${sx * sy * 28} ${sx * (w / 2)} ${sy * (h / 2)})"/>`;
      o += stroke(t, { color: LINE, w: 2.6, passes: 1, amp: 2, close: true, seed: seed + 20, op: 0.55 });
    }
  } else {
    o += `<path d="${poly(jitter(box, 3, seed), true)}" fill="${PAPER}"/>`;
    o += stroke(box, { color: LINE, w: 4.5, passes: 2, amp: 3, close: true, seed: seed + 4 });
    o += `<circle cx="0" cy="${-h / 2 + 6}" r="14" fill="#C4502C" stroke="${LINE}" stroke-width="3.5"/>`;
  }

  const ty = sub ? -8 * scale : 14 * scale;
  o += `<text x="0" y="${ty}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${INK}" letter-spacing="2">${text}</text>`;
  if (sub) {
    o += stroke([[-w * 0.3, 24 * scale], [w * 0.3, 26 * scale]], { color: LINE, w: 2.6, passes: 1, amp: 2, seed: seed + 30, op: 0.45 });
    o += `<text x="0" y="${72 * scale}" font-family="${FONT_SUB}" font-size="${38 * scale}" text-anchor="middle" fill="${INK}" opacity="0.8">${sub}</text>`;
  }
  return o + `</g>`;
}

/**
 * 每个场景的空白位。y 是牌匾中心，按画布比例。
 *
 * **两条硬约束：**
 * 一、避开角色 —— 角色站左，牌匾就去右上。和封面标题同一条规则。
 * 二、y 不超过 0.13（约 250px）—— 再往下牌匾底边会压到角色头顶。
 */
export const PLAQUE_AT = {
  "office-desk":   { x: 0.70, y: 0.085, rot: -2.4, style: "wood" },
  "meeting-room":  { x: 0.68, y: 0.205, rot: 2.0,  style: "tape" },  // 贴在白板上
  "rental-living": { x: 0.70, y: 0.105, rot: -1.6, style: "wood" },
  "kitchen-table": { x: 0.70, y: 0.105, rot: 2.4,  style: "tape" },
  "bedroom":       { x: 0.70, y: 0.100, rot: -2.0, style: "pin"  },
  "elevator":      { x: 0.79, y: 0.230, rot: -1.4, style: "tape" },
  "subway":        { x: 0.78, y: 0.130, rot: 1.6,  style: "wood" },
  "hospital":      { x: 0.26, y: 0.100, rot: -2.2, style: "pin"  },
  "home-living":   { x: 0.68, y: 0.105, rot: 2.2,  style: "wood" },
  "street-night":  { x: 0.28, y: 0.095, rot: -2.6, style: "wood" },
};

export const plaqueFor = (scene) => PLAQUE_AT[scene] ?? PLAQUE_AT["office-desk"];


/* ═══════════════ 标题载体 ═══════════════
 * 标题可以长在场景里任何能显示字的东西上。
 * 优先**征用场景里已有的物件**（显示器、楼层屏、叫号屏、挂历），
 * 而不是新增一块牌子 —— 征用的那种连"这是额外元素"的感觉都没有。
 */

const LED_BG = "#2B2622", LED_ON = "#F0B72E";
const SCREEN_BG = "#3A3E42", SCREEN_ON = "#EDE7D6";
const STICKY = "#F2D96B";

/**
 * @param type screen 显示器 | led 点阵屏 | sticky 便签 | deskSign 桌上立牌 | mug 杯身
 */
export function titleOn(type, { text, sub = "", x, y, w, h, rot = 0, seed = 9, W = 1080, H = 1920 }) {
  const cx = W * x, cy = H * y;
  const bw = w * W, bh = h * H;
  const box = rectPts(-bw / 2, -bh / 2, bw, bh);
  const fit = (n, pad) => Math.min((bw - pad) / Math.max(units(text), 1), (bh - pad) * n);
  let o = `<g id="title-carrier" transform="translate(${cx.toFixed(0)},${cy.toFixed(0)}) rotate(${rot})">`;

  if (type === "screen") {
    o += `<path d="${poly(jitter(box, 2.6, seed), true)}" fill="${SCREEN_BG}"/>`;
    o += stroke(box, { color: LINE, w: 5, passes: 2, amp: 3, close: true, seed: seed + 1 });
    const fs = fit(0.52, 60);
    o += `<text x="0" y="${sub ? -6 : fs * 0.34}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${SCREEN_ON}">${text}</text>`;
    if (sub) o += `<text x="0" y="${fs * 0.86}" font-family="${FONT_SUB}" font-size="${fs * 0.46}" text-anchor="middle" fill="#9AA0A4">${sub}</text>`;
  } else if (type === "led") {
    o += `<path d="${poly(jitter(box, 2, seed), true)}" fill="${LED_BG}"/>`;
    o += stroke(box, { color: LINE, w: 5, passes: 2, amp: 2.6, close: true, seed: seed + 1 });
    const fs = fit(0.6, 48);
    o += `<text x="0" y="${sub ? -4 : fs * 0.34}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${LED_ON}" letter-spacing="3">${text}</text>`;
    if (sub) o += `<text x="0" y="${fs * 0.9}" font-family="${FONT_SUB}" font-size="${fs * 0.44}" text-anchor="middle" fill="#9A9184">${sub}</text>`;
  } else if (type === "sticky") {
    o += `<path d="${poly(jitter(box, 3, seed), true)}" fill="${STICKY}"/>`;
    o += stroke(box, { color: LINE, w: 3.6, passes: 2, amp: 2.8, close: true, seed: seed + 1 });
    o += stroke([[-bw * 0.3, -bh / 2 + 6], [bw * 0.3, -bh / 2 + 10]], { color: "#D8BE93", w: 8, passes: 1, amp: 2, seed: seed + 2, op: 0.7 });
    const fs = fit(0.5, 44);
    o += `<text x="0" y="${sub ? 0 : fs * 0.34}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${INK}">${text}</text>`;
    if (sub) o += `<text x="0" y="${fs * 0.88}" font-family="${FONT_SUB}" font-size="${fs * 0.46}" text-anchor="middle" fill="${INK}" opacity="0.75">${sub}</text>`;
  } else if (type === "deskSign") {
    // 桌上立牌：正面 + 一条斜的支撑边
    o += `<path d="${poly(jitter(box, 2.6, seed), true)}" fill="${PAPER}"/>`;
    o += stroke(box, { color: LINE, w: 4.4, passes: 2, amp: 3, close: true, seed: seed + 1 });
    o += stroke([[-bw / 2, bh / 2], [-bw / 2 + 26, bh / 2 + 22], [bw / 2 - 26, bh / 2 + 22], [bw / 2, bh / 2]],
      { color: LINE, w: 4, passes: 2, amp: 2.6, seed: seed + 2 });
    const fs = fit(0.5, 46);
    o += `<text x="0" y="${sub ? -2 : fs * 0.34}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${INK}">${text}</text>`;
    if (sub) o += `<text x="0" y="${fs * 0.88}" font-family="${FONT_SUB}" font-size="${fs * 0.46}" text-anchor="middle" fill="${INK}" opacity="0.75">${sub}</text>`;
  } else if (type === "mug") {
    // 杯身：字随柱面收窄，两侧压扁
    const fs = fit(0.5, 26);
    o += `<text x="0" y="${fs * 0.34}" font-family="${FONT}" font-size="${fs}" text-anchor="middle" fill="${INK}" transform="scale(0.88,1)">${text}</text>`;
  }
  return o + `</g>`;
}

/**
 * 每个场景可用的载体位。**每个场景给两到三个**，
 * 不同集换着用，同一场景的画面就不会重复。
 * x/y 是中心、w/h 是尺寸，都按画布比例。
 */
export const SLOTS = {
  "office-desk": [
    { type: "screen",   x: 0.725, y: 0.443, w: 0.228, h: 0.163, rot: -0.6 },
    { type: "sticky",   x: 0.565, y: 0.392, w: 0.112, h: 0.062, rot: -6 },
    { type: "wall",     x: 0.70,  y: 0.085, rot: -2.4, style: "wood" },
  ],
  "meeting-room": [
    { type: "sticky",   x: 0.70,  y: 0.230, w: 0.130, h: 0.072, rot: 5 },
    { type: "wall",     x: 0.68,  y: 0.205, rot: 2.0, style: "tape" },
  ],
  "elevator": [
    { type: "led",      x: 0.50,  y: 0.098, w: 0.242, h: 0.068, rot: 0 },
    { type: "sticky",   x: 0.79,  y: 0.230, w: 0.126, h: 0.070, rot: -5 },
  ],
  "hospital": [
    { type: "led",      x: 0.735, y: 0.108, w: 0.436, h: 0.120, rot: 0 },
    { type: "wall",     x: 0.26,  y: 0.100, rot: -2.2, style: "pin" },
  ],
  "home-living": [
    { type: "sticky",   x: 0.218, y: 0.135, w: 0.196, h: 0.100, rot: -3 },
    { type: "wall",     x: 0.68,  y: 0.105, rot: 2.2, style: "wood" },
  ],
  "kitchen-table": [
    { type: "deskSign", x: 0.72,  y: 0.360, w: 0.190, h: 0.088, rot: -2 },
    { type: "wall",     x: 0.70,  y: 0.105, rot: 2.4, style: "tape" },
  ],
  "rental-living": [{ type: "wall", x: 0.70, y: 0.105, rot: -1.6, style: "wood" }],
  "bedroom":       [{ type: "wall", x: 0.70, y: 0.100, rot: -2.0, style: "pin" }],
  "subway":        [{ type: "wall", x: 0.78, y: 0.130, rot: 1.6,  style: "wood" }],
  "street-night":  [{ type: "wall", x: 0.28, y: 0.095, rot: -2.6, style: "wood" }],
};

/** 取某场景的第 n 个载体；n 可以直接用集数，自动轮换 */
export function slotFor(scene, n = 0) {
  const list = SLOTS[scene] ?? SLOTS["office-desk"];
  return list[n % list.length];
}

/** 统一入口：wall 走牌匾，其余走载体 */
export function title({ text, sub, scene: sc, n = 0, ...over }) {
  const slot = { ...slotFor(sc, n), ...over };
  return slot.type === "wall"
    ? plaque({ text, sub, ...slot })
    : titleOn(slot.type, { text, sub, ...slot });
}

/* ═══════════════ 老马线：只用字幕带以上的载体位 ═══════════════
 *
 * ⚠ **这个仓库的字幕排在角色旁边那一列**（x≥509、y≈620–860），
 * 而 `SLOTS` 里有些载体位就落在那一带：office-desk 的 `screen`（y 0.443）和
 * `sticky`（y 0.392）都在字幕底下。按集数轮到它们的时候，牌匾整个被字幕盖住，
 * 而且**不报错** —— 渲出来只看见字幕缝里露出一角黄。
 *
 * 所以老马线走这个，不走 `slotFor`：**只挑 y < 0.30 的位**。
 * 代价是 office-desk 只剩木牌一个位（不轮换了），变化交给摆件那一层。
 *
 * ⚠ 别把阈值往下放。0.30 = 576px，字幕带上沿在 620 左右，中间那 44px 是给
 * 牌匾自身高度留的余量（木牌 118–164px，中心在 0.085 时底边约 245）。
 */
export function slotAboveSubtitle(scene, n = 0) {
  const list = (SLOTS[scene] ?? SLOTS["office-desk"]).filter((s) => (s.y ?? 1) < 0.3);
  const slot = list.length ? list[n % list.length] : { type: "wall", ...plaqueFor(scene) };
  // ⚠ **挂绳木牌的绳结要留在画布里。** 绳子从牌顶往上 132px 收成一个结，
  // 牌高 118（无副标题）；中心定在 0.085 时结落在 y≈−28，**被上沿切掉**，
  // 看着不像「挂在画外」，像画漏了。中心压到 0.105 以下就完整了。
  if (slot.type === "wall" && (slot.style ?? "wood") === "wood" && slot.y < 0.105) {
    return { ...slot, y: 0.105 };
  }
  return slot;
}

/** 老马线的统一入口。跟 `title()` 一样，只是换了选位规则 */
export function titleAbove({ text, sub, scene: sc, n = 0, ...over }) {
  const slot = { ...slotAboveSubtitle(sc, n), ...over };
  return slot.type === "wall" ? plaque({ text, sub, ...slot }) : titleOn(slot.type, { text, sub, ...slot });
}

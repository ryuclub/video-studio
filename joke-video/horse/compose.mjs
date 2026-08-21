/**
 * 把马叠到任意场景图上
 *
 *   import { compose } from "./compose.mjs";
 *   import { pose } from "./horse-pose.mjs";
 *
 *   const horse = pose(readFileSync("horse_only.svg","utf8"), { mouth:"A", turn:-10 });
 *   writeFileSync("shot.svg", compose({
 *     width: 1080, height: 1920,
 *     background: "scenes/office.png",   // png/jpg/svg 都行，会内嵌成 base64
 *     horse,
 *     place: { anchor:"bottom", x: 0.42, y: 0.92, height: 0.55, flip:false },
 *   }));
 *
 * place 说明（全部用画布比例，不用像素，换分辨率不用重算）：
 *   anchor  马的对齐点：bottom(脚底) | center | top
 *   x, y    对齐点在画布上的位置，0~1
 *   height  马占画布高度的比例
 *   flip    左右翻转（让马朝另一边）
 */
import { readFileSync } from "node:fs";
import { place as placeMark } from "./marks.mjs";

function embed(p) {
  if (!p) return null;
  if (/^(https?:|data:)/.test(p)) return p;
  const ext = p.split(".").pop().toLowerCase();
  const mime =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "webp" ? "image/webp"
    : ext === "svg" ? "image/svg+xml"
    : "image/png";
  return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
}

/** 从马的 SVG 里抠出 viewBox、style 和内容 */
function parseHorse(svg) {
  const vb = svg.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/);
  if (!vb) throw new Error("马的 SVG 没有 viewBox");
  const [vx, vy, vw, vh] = vb.slice(1).map(Number);
  const style = (svg.match(/<style[^>]*>[\s\S]*?<\/style>/) || [""])[0];
  const body = svg
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>/, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/, "");
  return { vx, vy, vw, vh, style, body };
}

export function compose({
  width = 1080,
  height = 1920,
  background = null,
  backgroundFit = "cover",
  horse,
  place = {},
  foreground = null,
  /**
   * 漫符。`[{ name:"惊", spot:"右上", size:0.3, seed:3, pop:1, tilt:-6 }]`
   *
   * **画在马之上、前景之下** —— 它是"从马身上冒出来的"，不是贴在整幅画面上的。
   * 位置由 marks.mjs 的 place() 按马框算，所以换站位、换分辨率都不用重调。
   */
  marks = [],
}) {
  const { anchor = "bottom", x = 0.5, y = 0.95, height: hRatio = 0.6, flip = false } = place;
  const h = parseHorse(horse);

  const s = (height * hRatio) / h.vh;          // 缩放系数
  const drawW = h.vw * s;
  const drawH = h.vh * s;
  const px = width * x - drawW / 2;            // 左上角
  const py =
    anchor === "bottom" ? height * y - drawH
    : anchor === "center" ? height * y - drawH / 2
    : height * y;

  // 先把 viewBox 原点挪到 0，再缩放定位；翻转时绕自身中线镜像
  const flipT = flip ? `translate(${drawW},0) scale(-1,1) ` : "";
  const t = `translate(${px.toFixed(2)},${py.toFixed(2)}) ${flipT}scale(${s.toFixed(5)}) translate(${-h.vx},${-h.vy})`;

  const bg = embed(background);
  const fg = embed(foreground);
  const fit = backgroundFit === "contain" ? "xMidYMid meet" : "xMidYMid slice";

  // 马框（画布像素）。漫符按它定位，见 marks.mjs 的 place()
  const box = { x: px, y: py, w: drawW, h: drawH };
  const marked = marks.map((m) => placeMark(m.name, m.spot ?? "右上", box, m)).join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    h.style,
    bg
      ? `<image xlink:href="${bg}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${fit}"/>`
      : "",
    `<g transform="${t}">${h.body}</g>`,
    marked,
    fg
      ? `<image xlink:href="${fg}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${fit}"/>`
      : "",
    `</svg>`,
  ].join("\n");
}

/** 常用站位预设 */
export const PLACES = {
  中央全身:   { anchor: "bottom", x: 0.50, y: 0.92, height: 0.62 },
  左侧三分:   { anchor: "bottom", x: 0.30, y: 0.92, height: 0.58 },
  右侧三分:   { anchor: "bottom", x: 0.70, y: 0.92, height: 0.58, flip: true },
  近景半身:   { anchor: "bottom", x: 0.50, y: 1.28, height: 1.15 },
  远景小人:   { anchor: "bottom", x: 0.62, y: 0.80, height: 0.34 },
};

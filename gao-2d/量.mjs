/**
 * 高总素材对位测量 —— **入库前跑这个，结果写进素材册**
 *
 * 复用 `shi-2d/素材.mjs` 的 `load()`（它专治「导出格式一变就静默变黑剪影」那个坑）。
 * 量法照抄 `shi-2d/asset-scan.mjs`：**逐个图元单独渲一遍量包围盒，不是猜的**。
 * 这儿用 resvg 的 `pixels` 拿 alpha，省掉那份手写 PNG 解码。
 *
 * ⚠ **不按整体墨高对位。** 抬单手那几张手举过头，墨高里含着手 ——
 * 按墨高缩放，一换姿势人就矮一截。量两样稳的：
 *   ① 脸的包围盒（上半部面积最大的肤色块）—— 同一个角色不同姿势里脸大小不变
 *   ② 脚底（墨迹最低点）
 *
 *   node gao-2d/量.mjs              量默认目录
 *   node gao-2d/量.mjs <目录>       量别的
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { load } from '../shi-2d/素材.mjs';

const DIR = process.argv[2] || 'E:/ryu/高总/SVG';

/** 肤色判据：偏红、R>G>B、但不到饱和的橙 —— 头发和夹克都落在外面 */
const 肤 = (c) => {
  if (!/^#[0-9a-fA-F]{6}$/.test(c || '')) return false;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return r > 150 && g > 100 && b > 80 && r > g && g > b && r - b > 25 && r - b < 140;
};

export function 量(file) {
  const { viewBox: [W, H], shapes } = load(file);
  // 按原坐标系 1:1 渲，量出来的数就是 viewBox 里的数
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${W} ${H}">`;
  const bb = (xml) => {
    const img = new Resvg(`${head}${xml}</svg>`, { font: { loadSystemFonts: false }, background: 'rgba(0,0,0,0)' }).render();
    const px = img.pixels;
    const w = img.width;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let i = 3, p = 0; i < px.length; i += 4, p++) {
      if (px[i] < 40) continue;
      const x = p % w, y = (p / w) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };

  const boxes = shapes.map((s, i) => ({ i: i + 1, fill: s.fill, box: bb(s.xml) })).filter((b) => b.box);
  const 底 = Math.max(...boxes.map((b) => b.box.y1));
  const 顶 = Math.min(...boxes.map((b) => b.box.y0));
  const 左 = Math.min(...boxes.map((b) => b.box.x0));
  const 右 = Math.max(...boxes.map((b) => b.box.x1));
  // 「在画布上 45%」是为了排掉举起来的手（也是肤色）。
  // ⚠ **头部单图（`头部.svg`）整张就是脸**，落在 45% 以下，这一档会一个都捞不着 ——
  //   然后 `.box` 读到 undefined 直接抛。所以捞不着就去掉 y 限制重来一次：
  //   头部单图里没有手，「最大的那块肤色」必然是脸。
  const 肤块 = boxes.filter((b) => 肤(b.fill));
  const 按面积 = (a, b) => b.box.w * b.box.h - a.box.w * a.box.h;
  const 脸 = [...肤块.filter((b) => b.box.y1 < H * 0.45)].sort(按面积)[0]
          || [...肤块].sort(按面积)[0];
  return { W, H, n: shapes.length, 顶, 底, 左, 右, 脸, boxes };
}

const 自跑 = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('gao-2d/量.mjs');
if (自跑) {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
    const m = 量(path.join(DIR, f));
    const b = m.脸 && m.脸.box;
    console.log(
      f.padEnd(24) +
        ` ${String(Math.round(m.W)).padStart(4)}x${String(Math.round(m.H)).padStart(4)}` +
        `  墨 y ${String(m.顶).padStart(4)}-${String(m.底).padStart(4)} 高 ${String(m.底 - m.顶).padStart(4)}` +
        (b
          ? `  脸 ${String(b.w).padStart(3)}x${String(b.h).padStart(3)} 心(${Math.round((b.x0 + b.x1) / 2)},${Math.round((b.y0 + b.y1) / 2)})`
          : '  脸 x 没认出来')
    );
  }
}

/**
 * 五官定位 —— **眨眼／转眼珠／口型全靠它**
 *
 *   node gao-2d/五官.mjs            量全部，打印
 *   import { 认五官 } from './五官.mjs'
 *
 * ── 为什么不用邻近聚类 ──
 *
 * 第一版拿「盒子挨着就并一簇」做，**右眼那簇把镜框和头发并进来了**（40x30，
 * 左眼才 27x21）。高总戴眼镜，镜框是一条独立 path，紧贴眼睛外沿 ——
 * 邻近法分不开「挨着」和「是同一个东西」。
 *
 * 改成**眼白打种**：先按颜色捞出眼白（近白、低饱和、脸的上 60%、
 * 面积在脸的 0.4%–10% 之间），横向并簇（间距 ≤ 脸宽 15%），
 * 一簇就是一只眼；再把**完全落在这只眼盒子里**的图元收进来 ——
 * 虹膜、瞳孔、高光、下眼睑影都在里头，镜框在外头，因为镜框比眼盒子大。
 *
 * ⚠ 「完全落在里头」是硬条件，不是「重叠」。镜框跟眼盒子重叠得厉害，
 *   按重叠收就又把它收进来了。
 *
 * ── 做法是「抠掉原件原地重画」，不是「盖一层」──
 *
 * 盖一层要配肤色、还要斗 z 序（镜框 path 下标 118，眼睛 141–160，
 * 眼睛画在镜框**上面**，盖眼睛会连镜框一起盖掉）。
 * 抠掉就没这些事：底下就是脸的肤色，镜框是另一条 path，原地不动。
 */
import fs from 'node:fs';
import { 量 } from './量.mjs';

const rgb = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : null);
const 近白 = (c) => { const p = rgb(c); return p && Math.min(...p) > 215 && Math.max(...p) - Math.min(...p) < 30; };
const 心 = (b) => ({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 });

export function 认五官(file, m = 量(file)) {
  if (!m.脸) return null;
  const F = m.脸.box, A = F.w * F.h, cx = (F.x0 + F.x1) / 2;

  // ① 眼白打种
  const 种 = m.boxes
    .filter((b) => 近白(b.fill)
      && b.box.x0 >= F.x0 - 6 && b.box.x1 <= F.x1 + 6 && b.box.y0 >= F.y0 - 8
      && 心(b.box).cy < F.y0 + F.h * 0.6
      && b.box.w * b.box.h > A * 0.004 && b.box.w * b.box.h < A * 0.10)
    .sort((a, b) => a.box.x0 - b.box.x0);

  // ② 横向并簇：一簇一只眼。间距 15% 脸宽 —— 眼白被虹膜劈成两半时缝只有几像素，
  //    两眼之间的缝有 30% 脸宽，这个阈值把两种缝分得开。
  const 缝 = F.w * 0.15;
  const 簇 = [];
  for (const s of 种) {
    const last = 簇[簇.length - 1];
    if (last && s.box.x0 - last.x1 <= 缝) {
      last.x0 = Math.min(last.x0, s.box.x0); last.x1 = Math.max(last.x1, s.box.x1);
      last.y0 = Math.min(last.y0, s.box.y0); last.y1 = Math.max(last.y1, s.box.y1);
      last.白.push(s.i);
    } else 簇.push({ x0: s.box.x0, y0: s.box.y0, x1: s.box.x1, y1: s.box.y1, 白: [s.i] });
  }

  // ③ 收全眼。两档：
  //   a) 完全落在眼盒子（外扩 2px）里 —— 虹膜／瞳孔／高光／下眼睑影
  //   b) **杏仁外框** —— 它比眼白大一圈，装不进盒子。判据是
  //      「盖住自己一半以上、且不超过眼盒子 1.3 倍」。实测这两个数把它和镜框分得很开：
  //      外框 #140 盖 76%、1.04×1.19；镜框 #118 盖 33%、1.40×1.47。
  //      ⚠ 只按「重叠」收会把镜框一起抠掉；只按「完全包含」收会漏掉外框 ——
  //        第一版就是漏了，抠完眼睛脸上**留着两坨黑**，而且不报错。
  const 眼 = 簇.map((e) => {
    const box = { x0: e.x0 - 2, y0: e.y0 - 2, x1: e.x1 + 2, y1: e.y1 + 2 };
    const ew = e.x1 - e.x0 + 1, eh = e.y1 - e.y0 + 1;
    const ids = m.boxes
      .filter((b) => {
        const B = b.box;
        if (B.x0 >= box.x0 && B.x1 <= box.x1 && B.y0 >= box.y0 && B.y1 <= box.y1) return true;
        const ox = Math.min(B.x1, e.x1) - Math.max(B.x0, e.x0) + 1;
        const oy = Math.min(B.y1, e.y1) - Math.max(B.y0, e.y0) + 1;
        if (ox <= 0 || oy <= 0) return false;
        return (ox * oy) / (B.w * B.h) >= 0.5 && B.w <= ew * 1.3 && B.h <= eh * 1.3;
      })
      .map((b) => b.i);
    // 外框把眼的实际范围撑大了一圈，盒子跟着长 —— 重画要照撑过的范围来
    for (const b of m.boxes) if (ids.includes(b.i)) {
      e.x0 = Math.min(e.x0, b.box.x0); e.x1 = Math.max(e.x1, b.box.x1);
      e.y0 = Math.min(e.y0, b.box.y0); e.y1 = Math.max(e.y1, b.box.y1);
    }
    // 瞳：眼盒子里最暗且够大的那条
    const 瞳 = m.boxes
      .filter((b) => ids.includes(b.i) && rgb(b.fill) && Math.max(...rgb(b.fill)) < 90)
      .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
    return {
      x0: e.x0, y0: e.y0, x1: e.x1, y1: e.y1, w: e.x1 - e.x0 + 1, h: e.y1 - e.y0 + 1,
      cx: +((e.x0 + e.x1) / 2).toFixed(1), cy: +((e.y0 + e.y1) / 2).toFixed(1),
      侧: (e.x0 + e.x1) / 2 < cx ? '左' : '右',
      ids, 瞳: 瞳 ? { i: 瞳.i, ...瞳.box } : null,
    };
  });

  // ④ 嘴：脸下半、贴近中线、扁而宽的那一横。**不含下唇影**（它另成一条，更靠下更窄）
  const 嘴候选 = m.boxes.filter((b) => {
    const c = 心(b.box);
    return c.cy > F.y0 + F.h * 0.55 && c.cy < F.y1 + F.h * 0.15
      && b.box.w > F.w * 0.05 && b.box.h < F.h * 0.22 && b.box.w > b.box.h * 2.5
      && Math.abs(c.cx - cx) < F.w * 0.30;
  });
  let 嘴 = null;
  if (嘴候选.length) {
    const 主 = 嘴候选.filter((b) => b.box.w > F.w * 0.12).sort((a, b) => b.box.w - a.box.w)[0];
    if (主) {
    const 同行 = 嘴候选.filter((b) => Math.abs(心(b.box).cy - 心(主.box).cy) <= Math.max(3, F.h * 0.04));
    const x0 = Math.min(...同行.map((b) => b.box.x0)), x1 = Math.max(...同行.map((b) => b.box.x1));
    const y0 = Math.min(...同行.map((b) => b.box.y0)), y1 = Math.max(...同行.map((b) => b.box.y1));
    嘴 = { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, cx: +((x0 + x1) / 2).toFixed(1), cy: +((y0 + y1) / 2).toFixed(1), ids: 同行.map((b) => b.i) };
    }
  }

  // boxes 一并带出去 —— `画.mjs` 要按下标取包围盒分角色，不然得再量一遍（每张 ~200 次渲染）
  return { 脸: { ...F, cx, fill: m.脸.fill }, 眼, 嘴, boxes: m.boxes };
}

const 自跑 = process.argv[1] && process.argv[1].split(String.fromCharCode(92)).join('/').endsWith('gao-2d/五官.mjs');
if (自跑) {
  for (const f of fs.readdirSync('gao-2d/素材库/svg')) {
    const r = 认五官(`gao-2d/素材库/svg/${f}`);
    const e = r.眼.map((x) => `${x.侧}(${x.x0}-${x.x1},${x.y0}-${x.y1}) ${x.ids.length}条 瞳#${x.瞳 ? x.瞳.i : '?'}`).join('  ');
    console.log(`${f.padEnd(22)} 眼 ${r.眼.length}  ${e.padEnd(58)}  嘴 ${r.嘴 ? `(${r.嘴.x0}-${r.嘴.x1},${r.嘴.y0}) ${r.嘴.w}x${r.嘴.h} ${r.嘴.ids.length}条` : 'x'}`);
  }
}

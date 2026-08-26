// ── 景／前景素材的闸 ──────────────────────────────────────────────────
//
// 用法：npm run scenery:check
//
// **为什么需要这道闸。** `assets/scenery/` 收的是会动的图层（柳条、飘叶……），
// 而它们的动画写在 SVG 里的 SMIL 标签上，**resvg 一个都不认**：
// 2026-08-26 实测，把柳条那张的 200 个 `<animateTransform>` 全删掉再渲，
// PNG 字节数一模一样。也就是说 —— 直接扔进管线会得到一张**不动的图，
// 而且不报错**。跟「可变字体的加粗静默失效」是同一类坑，判据也一样：
// **看输出，不看有没有报错。**
//
// 这里查三件事：
//   ① 烘完还剩不剩 `<animate>`　—— 剩了就是有种写法没认出来，那一枝是死的
//   ② 烘出来的 svg 还能不能渲　—— 剪枝剪错了会把标签数搞乱
//   ③ 不同时刻渲出来一不一样　—— 全一样就是压根没动
// 顺手量一下末梢摆幅（px），因为**幅度是内容判据**：治愈档要 6–10px，
// 素材原来是按什么幅度调的得心里有数。

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { bake, bakeCheck, dropFalling } from './svg-smil.js';

const DIR = 'assets/scenery';
const OUT = 'out/景素材';
const 采样 = [0, 1.7, 3.4, 5.1];

if (!existsSync(DIR)) { console.log(`没有 ${DIR}/，跳过`); process.exit(0); }
mkdirSync(OUT, { recursive: true });

let bad = 0;
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
  const raw = readFileSync(`${DIR}/${f}`, 'utf8');
  const 名 = f.replace(/\.svg$/, '');
  const [, vw, vh] = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(raw)?.map(Number) ?? [0, 0, 0];
  const 动 = (raw.match(/<animate/g) ?? []).length;
  const 色 = [...new Set(raw.match(/#[0-9A-Fa-f]{6}/g) ?? [])];
  console.log(`\n── ${f}　${vw}×${vh}　动画 ${动} 条　${色.join(' ')}`);

  if (!动) { console.log('   静态素材，只查渲得出来'); }

  const W = Math.min(Math.round(vw || 600), 800);
  const px = (s: string) => new Resvg(s, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false } }).render();

  const 剩 = bakeCheck(bake(raw, 0));
  if (剩) { console.log(`   ✗ 烘完还剩 ${剩} 个 <animate> —— 有写法没认出来，那几枝是死的`); bad++; }

  const 帧: Buffer[] = [];
  for (const t of 采样) {
    try { 帧.push(px(bake(raw, t)).asPng()); }
    catch (e) { console.log(`   ✗ t=${t}s 渲不出来：${(e as Error).message}`); bad++; break; }
  }
  if (帧.length < 采样.length) continue;
  writeFileSync(`${OUT}/${名}-t0.png`, 帧[0]);
  writeFileSync(`${OUT}/${名}-t${采样[2]}.png`, 帧[2]);

  if (动 && 帧.every((b) => b.equals(帧[0]))) {
    console.log('   ✗ 四个时刻渲出来一模一样 —— 压根没动'); bad++;
  } else if (动) {
    // 摆幅：扫四条线，量最右缘在一个周期里跑了多远
    const src = dropFalling(raw);
    const H = px(bake(src, 0)).height;
    const 线 = [0.2, 0.4, 0.6, 0.8].map((r) => Math.round(H * r));
    const 轨: Record<number, number[]> = {};
    for (let i = 0; i < 24; i++) {
      const p = px(bake(src, (i / 24) * 7)).pixels;
      for (const y of 线) {
        (轨[y] ??= []);
        for (let x = W - 1; x >= 0; x--) if (p[(y * W + x) * 4 + 3] > 40) { 轨[y].push(x); break; }
      }
    }
    const 报 = 线.map((y) => {
      const v = 轨[y] ?? [];
      return v.length ? `y${y}:${Math.max(...v) - Math.min(...v)}px` : `y${y}:—`;
    });
    console.log(`   ✓ 会动。末梢摆幅（画布 ${W}px 宽）　${报.join('　')}`);
    console.log(`     去掉飘叶后残留 <animate>：${bakeCheck(bake(dropFalling(raw), 0))}`);
  } else {
    console.log('   ✓ 渲得出来');
  }
}

console.log(`\n→ ${OUT}/`);
console.log(bad ? `\n✗ ${bad} 处不合格` : '\n✓ 全过');
process.exit(bad ? 1 : 0);

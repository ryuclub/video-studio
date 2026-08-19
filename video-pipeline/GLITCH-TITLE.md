# 故障标题（glitchTitle）：参照 vs 本项目实现

给你对比用。上面是 `../fx-kit/effects.js` 的原版（DOM/CSS + WAAPI，无头浏览器逐帧截图），
下面是 `video-pipeline/src/layers/scenes.ts` 的实现（逐帧生成 SVG 字符串 → ffmpeg 光栅化）。

两边不可能同构 —— 一边是让浏览器插值 CSS 属性，一边是每一帧自己把所有几何量算出来。
所以下面列的是**逐个参数的等价关系**，以及**五处刻意的偏差**（都是实测逼出来的，不是没看懂原版）。

---

## 一、fx-kit 原版

```js

/**
 * 10. glitchTitle —— RGB 错位 + 切片抖动。危机/崩盘题材的冷开场,别连用。
 * 注意 .fx-glitch 加在内层 span 上:直接加在 .fx-text 上会用 position:relative
 * 覆盖它的绝对定位,标题会掉到画面左上角。
 */
export function glitchTitle(node, p = {}) {
  const at = R(p.at, 0), dur = R(p.dur, 900);
  const label = R(p.text, node.textContent || '');
  const rand = rng(R(p.seed, 7));
  const slices = R(p.slices, 4);      // 24fps 下 3~4 最清楚,再多单帧分不出层次
  // 错位幅度默认随字号缩放。固定 px 的话,文字变长、字号被 clamp 压小之后,
  // 同一个 amp 在大字上是轻微错位,在小字上会糊成一团。
  const fs = parseFloat(getComputedStyle(node).fontSize) || 76;
  const amp = R(p.amp, Math.max(6, Math.round(fs * 0.18)));
  node.textContent = '';
  const inner = el('span', 'fx-glitch');
  inner.append(document.createTextNode(label));
  const r = el('span', 'g-copy g-r', label);
  const c = el('span', 'g-copy g-c', label);
  inner.append(r, c);
  node.appendChild(inner);
  const frames = (sign) => {
    const out = [];
    for (let i = 0; i < slices; i++) {
      const top = Math.round(rand() * 68), h = 14 + Math.round(rand() * 26);
      out.push({
        offset: i / slices,
        transform: `translateX(${(sign * (rand() * amp - amp * 0.2)).toFixed(1)}px)`,
        clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`,
      });
    }
    out.push({ offset: 1, transform: 'translateX(0)', clipPath: 'inset(0 0 0 0)' });
    return out;
  };
  return {
    anims: [
      A(r, frames(1), { at, dur, ease: `steps(${slices}, end)` }),
      A(c, frames(-1), { at, dur, ease: `steps(${slices}, end)` }),
      A(inner, [{ opacity: 0 }, { opacity: 1 }], { at, dur: 100, ease: EASE.linear }),
    ],
  };
}

/* ═══════════════════════════════════════════════════════════
   三、数据(稿件里出现硬数据时触发,这类是本套的核心价值)
```

配套样式与预览台里的摆法（`effects.css` / `demo.html`）：

```css
/* effects.css —— 跟这个特效有关的全部样式 */
.fx-glitch { position: relative; display: inline-block; }
.fx-glitch > .g-copy {
  position: absolute;
  inset: 0;
  pointer-events: none;
  will-change: transform, clip-path;
}
.fx-glitch > .g-r { color: var(--fx-accent); mix-blend-mode: screen; }
.fx-glitch > .g-c { color: var(--fx-data); mix-blend-mode: screen; }

/* demo.html 里这个特效的摆法 */
/* Object.assign(t.style, { textAlign: 'center', bottom: 'auto', top: '40%',
                            fontSize: 'clamp(30px, 6vw, 84px)' });
   fx.glitchTitle(t, { at: 300, text: '第三章 · 失控', dur: 1000, amp: 14 });  */

/* 配色变量 */
/* --fx-paper: #F5F3EE;   --fx-accent: #E5484D;
   --fx-data:  #4FB8A8;   --fx-dim:    #8A94A2;  */
```

## 二、本项目实现

```ts
// ── glitchTitle（10 故障标题）───────────────────────────────

/**
 * 故障标题**不跟 THEME 走**，四个颜色全部用 fx-kit 的原值。
 *
 * 这是明确定下的例外（2026-08-17）：RGB 错位的观感就绑在「正红 + 蓝绿」这一对上，
 * 换成本项目的橙红（#e0603a）+ 蓝（#4a9eba），两路的色相差不够大，
 * 分离感就散了 —— 看着像重影，不像信号坏了。
 *
 * **别顺手把它改回 THEME。** 别的场景一律跟 THEME，只有这一个例外。
 */
const GLITCH = {
  /** fx-kit --fx-paper */
  paper: '#F5F3EE',
  /** fx-kit --fx-accent */
  red: '#E5484D',
  /** fx-kit --fx-data */
  cyan: '#4FB8A8',
  /** fx-kit --fx-dim */
  dim: '#8A94A2',
};

/**
 * RGB 错位 + 切片抖动。**全片最多 1–2 次，连用立刻廉价。**
 *
 * fx-kit 用 CSS 的 steps() 缓动做切片跳变，这里换算成「按进度取第几个切片状态」：
 * 30fps 下 slices 取 3–4、amp 不低于 10，单帧才分得出层次。
 * 抖动量全部出自 rng(seed)，重渲结果完全一致 —— 不要改成 Math.random()。
 */
function glitchTitle(scene: SceneSpec, c: Ctx): FrameFn {
  const text = scene.text ?? scene.title ?? '';
  const slices = Math.max(2, Math.min(6, scene.slices ?? 4));
  const amp = scene.amp ?? 14;
  const rand = rng(scene.seed ?? 7);
  // 章节标题是要砸场的，字号按「整串占内容区 62% 宽」反推，再用高度封顶。
  // fx-kit 预览台那边是 text-align:center + clamp(30px, 6vw, 84px)，
  // 相对画布约占半幅宽 —— 按内容区宽度除以字数来算会小一大截，那是正文的算法
  const fsize = Math.max(
    11,
    Math.min(
      Math.floor(((c.box.x1 - c.box.x0) * 0.62) / Math.max(1, text.length)),
      Math.floor((c.box.y1 - c.box.y0) * 0.6),
      fz(c, 200),
    ),
  );

  // 两个副本各走各的随机序列 —— fx-kit 是 frames(1) / frames(-1) 调了两次，
  // 共用一组带的话红蓝会齐步走，看着像整块在抖，不像信号坏了
  // amp 是**相对 84px 基准字号**的像素错位量（fx-kit 的 clamp 上限就是 84px，
  // 默认 14 是配着它调的）。字号放到 200px 还用 14px 的错位，边缘细得看不见，
  // 所以按字号等比放大
  const ampScale = fsize / 84;
  const vertical = Math.max(0, Math.min(1, scene.vertical ?? 0.5));
  // 错位量下限：fx-kit 的公式 rand()*amp - amp*0.2 会取到 0 附近，
  // 那一格就等于没错位。四个切片里死掉一个，红色那一路就基本看不见了 ——
  // 保留原分布，只把绝对值不足字号 5% 的顶到 5%
  const floor = fsize * 0.05;
  const bands = (sign: number) =>
    Array.from({ length: slices }, () => {
      const raw = (rand() * amp - amp * 0.2) * ampScale;
      // 方向由 sign 定死（红往右、青往左），只取幅度。
      // fx-kit 的公式是 sign * (rand()*amp - amp*0.2)，rand() < 0.2 时会变号 ——
      // 那一格两路朝同一边错开，窄的那条被宽的整格套住，红色就整格看不见了。
      // RGB 分离本来就该是左右分开的，这里按分离来。
      const dx = sign * Math.max(floor, Math.abs(raw));
      // 垂直分量：fx-kit 只有 translateX，横笔画横着错开露不出面 ——
      // 「三十三」这种全横笔画的标题，彩色面积只有「泡沫破裂」的五分之一，
      // 读出来就是零散色块而不是彩色鬼影。加一个反向的竖直位移就跟字形解耦了。
      // 要完全照搬 fx-kit 就把 vertical 写成 0。
      const dy = -sign * Math.abs(dx) * vertical;
      return { dx, dy, top: rand() * 0.68, h: 0.14 + rand() * 0.26 };
    });
  const red = bands(1);
  const cyan = bands(-1);

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const dur = durationOf(t, i, total);
    // 抖动是**绝对 1 秒**的事，不是铺满整个镜头时长。
    // 铺满的话 4 个切片状态每个要停 0.8 秒，看着是一帧帧的错位图，不是「信号坏了一下」
    const glitchSec = Math.min(scene.dur ?? 1.0, dur);
    const gp = clamp01(t / glitchSec);
    // 居中，且略高于正中（参照是 top:40%）—— 下面要留给副标题
    const y = c.H * 0.48;
    const x = (c.box.x0 + c.box.x1) / 2;
    const done = gp >= 1;

    const copy = (b: { dx: number; dy: number; top: number; h: number }[], color: string, id: string) => {
      if (done) return '';
      const st = b[Math.min(slices - 1, Math.floor(gp * slices))]!;
      // 切片带必须落在**字形高度**内。fx-kit 的 inset(top% …) 是相对行盒的，
      // 行盒里字形占了大半；照抄成「基线 −0.9 起、跨 1.4 倍字号」会让 top 偏大的带
      // 整条掉到基线以下 —— 中日文那里没有笔画，那一格就是空的
      const inkTop = y - fsize * 0.92;
      const inkH = fsize * 0.95;
      const bandY = inkTop + st.top * inkH;
      const bandH = st.h * inkH;
      return `<clipPath id="${id}"><rect x="0" y="${bandY.toFixed(1)}" width="${c.W}" height="${bandH.toFixed(1)}"/></clipPath>
<g clip-path="url(#${id})" style="mix-blend-mode:screen"><text x="${(x + st.dx).toFixed(1)}" y="${(y + st.dy).toFixed(1)}" fill="${color}" font-family="${THEME.font}" font-size="${fsize}" font-weight="900" text-anchor="middle">${escapeXml(text)}</text></g>`;
    };

    // 两件事凑齐才对：
    //  1) 副本画在正文**下面** —— 白字压住中间，只有错开的那一截露出红/青；
    //  2) 副本用 **screen 混合**（跟 fx-kit 的 .g-copy 同款）—— 红青两路的切片带
    //     会撞在一起，不混合的话后画的那路把前一路整格盖掉，红色就整格消失。
    //     实测 librsvg/sharp 认这个属性。
    // 原注：fx-kit 那边靠 mix-blend-mode: screen，
    // 白字压在彩色副本上仍是白的，只有错开的那一截露出红/青。
    // 画在上面的话切片带里的字会被整块染成红青，白字被吃掉 —— 那是另一个效果了。
    const main = `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${GLITCH.paper}" font-family="${THEME.font}" font-size="${fsize}" font-weight="900" text-anchor="middle" opacity="${clamp01(t / 0.1).toFixed(3)}">${escapeXml(text)}</text>`;
    const sub = scene.subtitle
      ? `<text x="${x.toFixed(1)}" y="${(y + fsize * 0.62).toFixed(1)}" fill="${GLITCH.dim}" font-family="${THEME.font}" font-size="${fz(c, 36)}" text-anchor="middle" opacity="${easeOut(stagger(p, 0.45, 0.3)).toFixed(3)}">${escapeXml(scene.subtitle)}</text>`
      : '';
    return shell(c, `${copy(red, GLITCH.red, 'gr')}${copy(cyan, GLITCH.cyan, 'gc')}${main}${sub}`);
  };
}
```

## 三、参数等价表

| fx-kit | 本项目 | 说明 |
|---|---|---|
| `slices` 默认 4 | `slices` 默认 4，校验 2–6 | 一样 |
| `amp` 默认 14（px） | `amp` 默认 14，**按 fsize/84 等比放大** | 原值是配 84px 字号调的；这边字号 200px，不放大看不见 |
| `seed` 默认 7 | 同 | xorshift32 逐位照搬，同 seed 同结果 |
| `dur` 默认 900–1000ms | `dur` 默认 1.0 秒，校验 ≤1.4 | 一样。**不跟镜头时长绑定** |
| `ease: steps(slices, end)` | `Math.floor(gp * slices)` 取第几个状态 | 等价：把进度量化成 slices 档 |
| `clipPath: inset(top% 0 bottom% 0)` | `<clipPath><rect>` 横带 | **坐标系不同**，见偏差 ① |
| `translateX(±…)` | `x + st.dx` | 见偏差 ② ③ ⑤ |
| `.g-r`/`.g-c` 的 `mix-blend-mode: screen` | `style="mix-blend-mode:screen"` | 实测 librsvg/sharp 认这个属性 |
| `inner` opacity 0→1 / 100ms | `clamp01(t / 0.1)` | 一样，绝对 100ms |
| `--fx-accent` `--fx-data` `--fx-paper` `--fx-dim` | `GLITCH` 常量，四个色原样照搬 | 这个场景**不跟**本项目的 THEME |
| demo.html 的 `textAlign:center` / `top:40%` / `clamp(30px,6vw,84px)` | 居中、`y = 0.48H`、字号按「整串占内容区 62% 宽」反推 | 对齐的是**相对画布的占比**，不是像素值 |

## 四、五处刻意的偏差

1. **切片带的坐标系。** 原版 `inset(top% …)` 的百分比相对**行盒**，而行盒里字形占了大半。
   照抄成「基线 −0.9 起、跨 1.4 倍字号」会让 `top` 偏大的带整条掉到基线以下 ——
   中日文那里没有笔画，那一格就是空白。改成在**字形高度**（基线上方 0.92 倍字号）内取带。

2. **错位量下限。** 原公式 `rand()*amp - amp*0.2` 会取到 0 附近，那一格等于没错位。
   保留原分布，只把绝对值不足字号 5% 的顶到 5%。

3. **两路方向定死（红右、青左）。** 原公式带符号，`rand() < 0.2` 时两路朝同一边错开，
   窄的那条被宽的整格套住，红色整格消失。

4. **副本画在正文下面。** 原版是绝对定位盖在正文上、靠 screen 混合保住白字；
   SVG 这边画在正文下面等价。screen 混合仍然保留 —— 它在这里解决的是「两路切片带重叠」。

5. **新增垂直分量 `vertical`（默认 0.5，写 `0` 就是完全照搬原版）。**
   这是唯一一处功能性增补。原版只有 `translateX`，**横笔画横着错开露不出面**。
   实测同一套参数下不同标题的彩色面积（4 个切片合计，1920×1080）：

   | 标题 | 只横向（原版） | 加垂直 | 倍数 |
   |---|---|---|---|
   | 三十三 | 3599 | 6943 | ×1.9 |
   | 二十三天 | 4830 | 9562 | ×2.0 |
   | 一月一日 | 5391 | 7905 | ×1.5 |
   | 失控的二十三天 | 8241 | 11138 | ×1.4 |
   | 第三章 · 失控 | 5912 | 8025 | ×1.4 |
   | 泡沫破裂 | 17440 | 20403 | ×1.2 |

   横向差 5 倍（3599 ↔ 17440），加垂直后收敛到 3 倍。也就是说：
   **原版的观感强依赖标题字形，加了垂直分量才跟字形解耦。**

## 五、关于「红色不如青色明显」

不是画少了 —— 量过，红色的面积反而**比青色大**（seed=7 / 「失控的二十三天」：红 4970px、青 3271px，
换 4 个 seed 都是红多）。是亮度差：

| | 色值 | 感知亮度（0.299R+0.587G+0.114B） |
|---|---|---|
| 红 | `#E5484D` | 120 |
| 青 | `#4FB8A8` | 151 |

近黑底上青色天然更跳，这是 fx-kit 这对配色自带的特性。你要求颜色锁死原值，所以没动 ——
真要红更抢眼，只能调色（比如把红提到 `#FF5A5F`），说一声我就改。

## 六、自己跑一遍

```bash
cd video-pipeline
node dist/build.js render <storyboard.json> --no-assemble --force
```

storyboard 里放一个镜头即可：

```jsonc
{ "id":"g1", "start":0, "duration":3.2, "tier":"B", "pseudo":"render",
  "scene":{ "kind":"glitchTitle", "text":"第三章 · 失控",
            "slices":4, "amp":14, "seed":7, "vertical":0.5 } }
```

- `"vertical": 0` → 纯横向位移，跟原版逐帧对比用
- **改了 `scenes.ts` 一定要带 `--force`** —— 缓存键只认 storyboard 内容和素材文件，不认渲染代码

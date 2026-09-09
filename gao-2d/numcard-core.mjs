/**
 * 高总英语频道 · A 层字卡渲染核心
 *
 *   import { buildCard, W, H } from './numcard-core.mjs'
 *   node gao-2d/numcard-core.mjs        出一张样卡表 projects/高总/_图/字卡样表.png
 *
 * 出片方案 §6.1 里 A 层（数字卡 / 文字卡）占 35%，是四层里最重的一层。
 * 方案 §7.5 把这个文件列成「已有资产」，但**交接过来的目录里没有它** ——
 * `build.mjs` 第一行就 `import { buildCard } from './numcard-core.mjs'`，
 * 缺了它整条管线连 `--check` 都跑不起来（import 阶段就炸）。这份是补的。
 *
 * ── 三条设计约束（方案 §2 视觉识别）──
 *
 *   1. **全片只有一种颜色是活的**：强调红 `#ff4757`。其余只有黑、白、灰。
 *      蓝 `#3742fa` 是频道标识色，卡面上**不用** —— 一上就变成两种活色。
 *   2. **粗黑边 + 块状硬阴影**，不用圆角、不用渐变、不用发光。
 *   3. 数字走等宽，标题走无衬线粗体。
 *
 * ── 为什么高光块是通栏的 ──
 *
 * 想给某一行字加红底，就得知道那行字有多宽。SVG 里量不到文字宽度
 * （resvg 不回传排版结果，`textLength` 又会把字挤变形），按字数估宽在
 * 粗体比例字体上误差能到 15% —— 红块要么裁掉词尾，要么拖出一截。
 * 所以**红底一律通栏**（左右各留 `PAD`），不跟着字宽走。
 * 这不是将就：块状硬边本来就是这套视觉的语言，通栏比包字更像印刷品。
 */
import fs from 'node:fs';
import path from 'node:path';

export const W = 1080, H = 1920;

const INK = '#111111';       // 边框 / 暗底
const PAPER = '#ffffff';
const ACCENT = '#ff4757';    // 全片唯一的活色
const DIM = '#8a8a8a';
const PAD = 90;              // 卡面左右安全边

/**
 * 字体：**点名到具体字族，并且在缺字体的时候出声**。
 *
 * ⚠ resvg 找不到字族时**静默回退**，渲出来只是「字怎么变细了」，不报错。
 * 方案 §7.5 写着「渲染机上必须装等宽字体」，但没有任何东西去查它 ——
 * 所以这儿把「装没装」变成一行能看见的提醒，`自检.mjs` 会把它收进第 8 项。
 *
 * 仓库自带的两个字体是中文的（得意黑、站酷快乐体），英文卡面用不上；
 * 这条线的两个字族（Archivo / JetBrains Mono）现在**都得靠系统装**。
 */
const FONT_TITLE = "Archivo, 'Archivo Black', 'Segoe UI', Arial, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'JetBrains Mono NL', Consolas, 'Courier New', monospace";

/** 系统里装没装方案点名的那两个字族。装了返回空数组。 */
export function 缺字体() {
  /* 仓库自带的 fonts/ 排第一 —— 装没装系统字体不再是前提（2026-09-09） */
  const dirs = [path.resolve('fonts'),
                process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : '/usr/share/fonts',
                process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts') : '/usr/local/share/fonts'];
  let 名 = '';
  for (const d of dirs) { try { 名 += fs.readdirSync(d).join('|').toLowerCase(); } catch { /* 目录不在就算没装 */ } }
  const 缺 = [];
  if (!/archivo/.test(名)) 缺.push('Archivo（标题与字幕）');
  if (!/jetbrains/.test(名)) 缺.push('JetBrains Mono（数字）');
  return 缺;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** easeOutCubic —— 卡面动画一律「冲进来再刹住」，不要弹跳 */
const ease = (t) => 1 - Math.pow(1 - clamp(t), 3);
/** 分段取时间：整条动画 t∈[0,1]，某一层从 a 到 b 才动 */
const seg = (t, a, b) => ease((clamp(t) - a) / (b - a));

const 底 = (theme) => (theme === 'light' ? PAPER : INK);
const 字 = (theme) => (theme === 'light' ? INK : PAPER);

/** 块状硬阴影的框：先落一块纯黑，再压主体，不用 filter */
function 硬框(x, y, w, h, fill, stroke, off = 14) {
  return `<rect x="${x + off}" y="${y + off}" width="${w}" height="${h}" fill="#000000"/>`
       + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="6"/>`;
}

function text(s, x, y, { size, fill, font = FONT_TITLE, anchor = 'middle', weight = 700, spacing = 0, opacity = 1 }) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${font}" font-size="${size}"`
       + ` font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}"`
       + (opacity < 1 ? ` opacity="${opacity.toFixed(3)}"` : '') + `>${esc(s)}</text>`;
}

/* ── 三种卡 ───────────────────────────────────────────────────────────── */

/** 数字卡：一个砸屏幕的数字 ＋ 一行标签。方案 §4.2 的 T4（Number Cold Open）主力 */
function 卡_bignum(c, t, theme) {
  const fg = 字(theme), a = c.accent || ACCENT;
  const v = `${c.prefix || ''}${c.value}${c.suffix || ''}`;
  const 大 = v.length <= 3 ? 460 : v.length <= 5 ? 340 : 240;
  const 进 = seg(t, 0, 0.55), 尺 = seg(t, 0.25, 1);
  const cy = 880;
  return [
    // 数字：从下面 60px 冲上来
    `<g transform="translate(0 ${((1 - 进) * 60).toFixed(1)})" opacity="${进.toFixed(3)}">`,
    text(v, W / 2, cy, { size: 大, fill: fg, font: FONT_MONO, spacing: -8 }),
    `</g>`,
    // 红尺：从中间往两边拉开，宽度就是动画
    `<rect x="${(W / 2 - (W - PAD * 2) / 2 * 尺).toFixed(1)}" y="${cy + 70}" width="${((W - PAD * 2) * 尺).toFixed(1)}" height="18" fill="${a}"/>`,
    c.label ? text(String(c.label).toUpperCase(), W / 2, cy + 240, { size: 108, fill: a, spacing: 6, opacity: seg(t, 0.4, 1) }) : '',
    c.note ? text(c.note, W / 2, cy + 360, { size: 46, fill: DIM, weight: 500, opacity: seg(t, 0.6, 1) }) : '',
  ].join('');
}

/** 对比卡：同一件事的两个数，上暗下红。方案 §4.2 的 T2 / T5 用 */
function 卡_versus(c, t, theme) {
  const fg = 字(theme), a = c.accent || ACCENT;
  const bw = W - PAD * 2, bh = 380, x = PAD;
  const y1 = 460, y2 = y1 + bh + 150;
  const 上 = seg(t, 0, 0.4), 下 = seg(t, 0.45, 0.9);
  const 块 = (y, label, value, 底色, 字色, k) => k <= 0 ? '' : `<g opacity="${k.toFixed(3)}" transform="translate(${((1 - k) * 50).toFixed(1)} 0)">`
    + 硬框(x, y, bw, bh, 底色, 字色 === INK ? INK : fg)
    + text(String(label).toUpperCase(), x + 46, y + 104, { size: 54, fill: 字色 === INK ? '#444444' : DIM, anchor: 'start', spacing: 4 })
    + text(String(value), x + 46, y + 300, { size: 210, fill: 字色, font: FONT_MONO, anchor: 'start', spacing: -4 })
    + `</g>`;
  return [
    块(y1, c.oldLabel, c.oldValue, 底(theme), fg, 上),
    // 箭头：两块之间，跟着下面那块一起出
    `<g opacity="${下.toFixed(3)}"><path d="M ${W / 2} ${y1 + bh + 30} L ${W / 2} ${y1 + bh + 110} M ${W / 2 - 34} ${y1 + bh + 74} L ${W / 2} ${y1 + bh + 118} L ${W / 2 + 34} ${y1 + bh + 74}" stroke="${a}" stroke-width="12" fill="none"/></g>`,
    块(y2, c.newLabel, c.newValue, a, INK, 下),
    c.kicker ? text(String(c.kicker).toUpperCase(), W / 2, y2 + bh + 190, { size: 96, fill: fg, spacing: 4, opacity: seg(t, 0.75, 1) }) : '',
  ].join('');
}

/**
 * 文字卡：几行短句，其中一行压红底。方案 §4.1 的落点句用。
 * `highlight` 是**第几行**（从 1 数），不是下标 —— 工作表里写的是「第二行红底」。
 */
/**
 * statement 卡的字号：**行数和最长行宽两个约束取小的**。
 *
 * ⚠ 原先只按行数定（≤2 行就 148），**完全没管一行有多长** —— 而 resvg 不会
 * 换行也不会报错，超出画面的字直接被裁掉。2026-09-09 实测：
 * `is on a pathway to collapse.` 28 字符 × 148 × 0.58 ≈ 2321px，
 * 而可用宽度只有 900px（W − PAD×2）—— **超了 2.6 倍**，看片子才发现。
 * 连 `Three times.` 都溢出了一点，只是不明显。
 *
 * 0.58 是 Archivo Bold 大小写混排的平均字宽比（em），再留 5% 余量。
 * 导出是为了让 `自检.mjs` 用**同一份公式**判「这句话对 statement 卡是不是太长」——
 * 两处各算一套迟早会飘。
 */
export function statement字号(lines, 比例 = 0.95) {
  const 最长 = Math.max(...lines.map((l) => l.length));
  const 按行数 = lines.length <= 2 ? 148 : lines.length === 3 ? 124 : 100;
  const 按宽度 = Math.floor(((W - PAD * 2) * 比例) / (最长 * 0.58));
  return { size: Math.min(按行数, 按宽度), 按行数, 按宽度, 最长 };
}

function 卡_statement(c, t, theme) {
  const fg = 字(theme), a = c.accent || ACCENT;
  const lines = String(c.lines).split('\n');
  const { size } = statement字号(lines);
  const lh = size * 1.42;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
  return lines.map((ln, i) => {
    const y = y0 + i * lh;
    const k = seg(t, i * 0.18, i * 0.18 + 0.5);
    if (k <= 0) return '';
    const hot = c.highlight === i + 1;
    // 红底通栏，宽度就是动画（左边钉住，往右扫）
    const band = hot ? `<rect x="${PAD - 30}" y="${y - size * 0.82}" width="${((W - PAD * 2 + 60) * k).toFixed(1)}" height="${(size * 1.16).toFixed(0)}" fill="${a}"/>` : '';
    return band + text(ln, W / 2, y, { size, fill: hot ? INK : fg, opacity: hot ? 1 : k, spacing: 1 });
  }).join('');
}

const 卡表 = { bignum: 卡_bignum, versus: 卡_versus, statement: 卡_statement };

/**
 * 数据条（lower third）—— 叠在主讲人身上的一条数字，**不占层**。
 *
 * ⚠ 它不是第四种「层」。方案 §7.3 的 A/B 互斥是**从数据结构上**保证的
 * （`layer` 是单值字段，不是并列的 layerA/layerB），这条纪律不动。
 * 数据条跟 `credit` 角标、`box` 红框同类 —— 方案原话「它们是字段不占层」。
 * 所以它写在块的 `lower` 字段里，不参与配比，也不改变那一块的 `layer`。
 *
 * **纵向位置 920–1120 是算出来的，不是拍脑袋**：
 *   · 往下要让开字幕 —— MarginV 520 是**底边**，三行往上长到距底 730（y≈1190）
 *   · 再往下是角标（底边距底 320）和 Shorts 底部 UI（约 250）
 *   · 往上要让开角色的脸 —— B 层帧序列里头部在上三分之一
 * 中间剩下的窗口就是这 200px，四样东西各占各的，谁也不压谁。
 */
/**
 * 强调字幕（punch）—— **A 层字卡的替代品**。
 *
 * 2026-09-09 拆掉 A 层的理由：字卡显示的就是台词，而字幕本来也在显示台词，
 * 于是「独占一整块画面」成了纯损失。方案 §6.1 的四层是按「这一秒画面来自哪一层」
 * 划的，A 层被当成一种**画面来源** —— 可它的内容是字，字不是画面，是叠在画面上的信息。
 * 把文字当画面用，是设计上的错位。
 *
 * punch 就是把 statement 卡的视觉（大字 ＋ 红底扫开）搬到叠加层上：画面继续走，字压在上面。
 *
 * ⚠ **每一行都要有底**：叠在角色或文档上，纯文字会糊。highlight 那行用红底，
 *   其余用半透明黑条 —— 底条宽度按各自行长算，不通栏，才不像一块补丁。
 * ⚠ 纵向 500–900：往下要让开数据条（920–1120），往上让开角色的脸。
 */
/** punch 的纵向可用窗口：MS 衣领 850 到字幕区 1260，中心 1020 —— 上下各 205px */
const PUNCH窗 = 410;

/**
 * 按词折成 n 行，尽量均匀，**不断词**。
 * 目标是每行字符数接近，这样最长那行不会拖累字号（字号由最长行决定）。
 */
function 均分(词, n) {
  const 目标 = 词.join(' ').length / n;
  const lines = [];
  let cur = [];
  for (const w of 词) {
    if (cur.length && [...cur, w].join(' ').length > 目标 * 1.15 && lines.length < n - 1) {
      lines.push(cur.join(' ')); cur = [w];
    } else cur.push(w);
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

/**
 * punch 自动折行：**字号由最长那行决定**，所以行数不是越少越好 ——
 * 一行 53 字符只能给到 47px，折成三行反而能到 74px。
 *
 * 从 1 行试到 3 行，取字号最大且总高塞得进 `PUNCH窗` 的那个。
 * 3 行是上限：4 行 × 89px 总高 504，会撞下面的字幕区。
 *
 * ⚠ **手写 `\n` 优先** —— 作者想在哪断就在哪断（`Three times.\nOne hole.`
 * 那种断句是内容的一部分，不能让算法改）。没写 `\n` 才自动折。
 */
export function punch折行(s, 最多行 = 3, 窗 = PUNCH窗, 比例 = 0.86) {
  if (String(s).includes('\n')) return String(s).split('\n');
  const 词 = String(s).trim().split(/\s+/);
  let 最好 = null;
  for (let n = 1; n <= Math.min(最多行, 词.length); n++) {
    const lines = 均分(词, n);
    const { size } = statement字号(lines, 比例);
    if (lines.length * size * 1.42 > 窗) continue;
    if (!最好 || size > 最好.size) 最好 = { lines, size };
  }
  return 最好 ? 最好.lines : [String(s)];
}

/** outro 的窗口比 punch 宽：整块压暗之后不用避开脸，居中 y960 上下各 260 */
const OUTRO窗 = 520;

/**
 * 收尾卡（outro）—— **只给最后一句引导问题**（方案 §8.1）。
 *
 * 为什么不直接复用 punch：前七句是陈述，最后这句是**把球扔给观众**，性质不同；
 * 而且落点（第 7 块）刚用过 punch，紧接着再来一个，强调就被稀释了 ——
 * 一条片三次 punch 就不叫强调。
 *
 * 跟 punch 的区别：
 *   位置  胸口 y1020（要避开脸）  →  **画面居中 y960**
 *   底    每行一条底条            →  **全屏压暗 0.35**，角色还在但退到后面
 *   字号  受胸口窗口限制 ~66      →  **不受限，三行能到 ~122**
 *   动画  红底从左扫开            →  **逐行淡入**，慢一档
 *
 * ⚠ 压暗**不是遮罩**：0.35 的黑，角色仍然看得见。这是收束不是「为了显示字
 *   牺牲画面」—— 区别在于它只发生在最后两秒，而且画面没有中断。
 * ⚠ 最后一行用强调色，其余白字。只给这一点频道色 —— 再多就成了第二个 punch。
 */
function outro段(o, t) {
  const lines = punch折行(o.lines, 3, OUTRO窗, 0.95);
  const { size } = statement字号(lines, 0.95);
  const lh = size * 1.42;
  const y0 = 960 - ((lines.length - 1) * lh) / 2;
  const a = o.accent || ACCENT;
  const 暗 = seg(t, 0, 0.45);
  return `<rect width="${W}" height="${H}" fill="${INK}" opacity="${(0.35 * 暗).toFixed(3)}"/>`
    + lines.map((ln, i) => {
      /* 逐行淡入，末行落在 t≈0.96 —— 收尾块通常只有两秒，排太满会来不及 */
      const k = seg(t, 0.2 + i * 0.18, 0.6 + i * 0.18);
      if (k <= 0) return '';
      const 末 = i === lines.length - 1;
      return text(ln, W / 2, y0 + i * lh, { size, fill: 末 ? a : PAPER, opacity: k, spacing: 1 });
    }).join('');
}

function punch段(p, t) {
  const lines = punch折行(p.lines);
  const { size } = statement字号(lines, 0.86);
  const lh = size * 1.42;
  const a = p.accent || ACCENT;
  /* 纵向中心 1020：MS 景别下巴到 y≈800，衣领 850 —— punch 落在胸口才不压脸。
     ⚠ **MCU 特写不能配 punch**：那个景别脸占到 y1150，字必然盖住眼睛（实测过）。
     再往下就撞字幕区（MarginV 520 是底边，两行到 1260 起）—— 可用窗口就这么宽。 */
  const y0 = 1020 - ((lines.length - 1) * lh) / 2;
  return lines.map((ln, i) => {
    const y = y0 + i * lh;
    const k = seg(t, i * 0.16, i * 0.16 + 0.5);
    if (k <= 0) return '';
    const hot = p.highlight === i + 1;
    const bw = Math.min(W - PAD, ln.length * size * 0.58 + 48);
    const bx = (W - bw) / 2;
    const by = y - size * 0.82, bh = size * 1.16;
    // 红底那行的宽度就是动画（左边钉住往右扫）；黑衬直接淡入，不抢戏
    const band = hot
      ? `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(bw * k).toFixed(1)}" height="${bh.toFixed(0)}" fill="${a}"/>`
      : `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(0)}" fill="${INK}" opacity="${(0.72 * k).toFixed(3)}"/>`;
    return band + text(ln, W / 2, y, { size, fill: hot ? INK : PAPER, opacity: hot ? 1 : k, spacing: 1 });
  }).join('');
}

/**
 * 文档标注 —— 档案画面上的红笔痕迹。
 *
 * 原先只有 `box` 一种，而且是 ffmpeg 的 `drawbox` 滤镜画的，除了矩形什么都画不了。
 * 改成 SVG → PNG → overlay 之后，箭头、下划线、页边感叹号都能画，而且**能有动画**
 * （drawbox 只能 `enable` 硬闪一下）。
 *
 * ⚠ **不做手绘涂鸦的笔触**。方案 §2 的视觉是「粗黑边 ＋ 块状硬阴影，不用圆角」——
 * 「有人在审这份文件」的感觉靠**位置和时机**（画在关键处、跟着台词出现），
 * 不靠假装是手写。硬朗的几何形状才是这套视觉的语言。
 *
 * 五种：
 *   box       框住一段（原来的 box 等价于 [{型:'box',...}]）
 *   underline 下划线，从左往右扫出来
 *   arrow     箭头，指向某处；`朝` 是箭头**指的方向**
 *   bang      页边感叹号，钉在左边距
 *   circle    椭圆圈，圈住一个词
 */
export function buildMarks(marks, t = 1) {
  const a = ACCENT, W2 = 4;
  const 画 = (m, i) => {
    const k = seg(t, 0.1 + i * 0.12, 0.5 + i * 0.12);   // 一个接一个出现
    if (k <= 0) return '';
    const c = m.color || a;
    switch (m.型) {
      case 'underline':
        return `<rect x="${m.x}" y="${m.y}" width="${(m.w * k).toFixed(1)}" height="${m.h ?? 6}" fill="${c}"/>`;
      case 'arrow': {
        const 长 = (m.长 ?? 160) * k, 头 = 26;
        const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[m.朝 ?? 'right'];
        const x2 = m.x + dir[0] * 长, y2 = m.y + dir[1] * 长;
        const 翼 = dir[0] ? `M ${x2 - dir[0] * 头} ${y2 - 头} L ${x2} ${y2} L ${x2 - dir[0] * 头} ${y2 + 头}`
                          : `M ${x2 - 头} ${y2 - dir[1] * 头} L ${x2} ${y2} L ${x2 + 头} ${y2 - dir[1] * 头}`;
        return `<path d="M ${m.x} ${m.y} L ${x2} ${y2} ${翼}" stroke="${c}" stroke-width="${W2 + 2}" fill="none"/>`;
      }
      case 'bang':
        return `<g opacity="${k.toFixed(3)}">`
          + `<rect x="${m.x}" y="${m.y}" width="12" height="${(m.h ?? 54) - 22}" fill="${c}"/>`
          + `<rect x="${m.x}" y="${m.y + (m.h ?? 54) - 12}" width="12" height="12" fill="${c}"/></g>`;
      case 'circle':
        return `<ellipse cx="${m.x}" cy="${m.y}" rx="${(m.rx ?? 90) * k}" ry="${(m.ry ?? 40) * k}"`
          + ` stroke="${c}" stroke-width="${W2}" fill="none"/>`;
      default:   // box
        return `<rect x="${m.x}" y="${m.y}" width="${(m.w * k).toFixed(1)}" height="${m.h}"`
          + ` stroke="${c}" stroke-width="${W2}" fill="none"/>`;
    }
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + (marks || []).map(画).join('') + `</svg>`;
}

/**
 * 叠加层：`punch` 强调字幕 ＋ `lower` 数据条，画在**同一张**透明 SVG 上。
 *
 * 合成一张是为了让 `build.mjs` 只挂一个 overlay 输入 —— C / DOC 那条链上
 * 已经有 credit 角标了，再多一个输入 filter_complex 就绕不清了。
 */
export function buildOverlay({ punch, lower, outro }, t = 1) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + (outro ? outro段(outro, t) : '')
    + (punch ? punch段(punch, t) : '')
    + (lower ? lower段(lower, t) : '')
    + `</svg>`;
}

function lower段(lower, t) {
  const a = lower.accent || ACCENT;
  const v = `${lower.prefix || ''}${lower.value}${lower.suffix || ''}`;
  const x0 = PAD, y0 = 920, bw = W - PAD * 2, bh = 200;
  const 扫 = seg(t, 0, 0.5);          // 底板从左往右扫开，跟 statement 卡的红底同一个动作
  const 进 = seg(t, 0.3, 1);
  const 数大 = v.length <= 6 ? 104 : v.length <= 9 ? 84 : 68;
  return `<rect x="${x0}" y="${y0}" width="${(bw * 扫).toFixed(1)}" height="${bh}" fill="${INK}" opacity="0.92"/>`
    + `<rect x="${x0}" y="${y0}" width="${(14 * 扫).toFixed(1)}" height="${bh}" fill="${a}"/>`
    + (进 > 0 ? text(v, x0 + 52, y0 + 100, { size: 数大, fill: PAPER, font: FONT_MONO, anchor: 'start', spacing: -2, opacity: 进 }) : '')
    + (进 > 0 && lower.label
        ? text(String(lower.label).toUpperCase(), x0 + 52, y0 + 166, { size: 44, fill: a, anchor: 'start', spacing: 5, opacity: 进 })
        : '')
    ;
}

/**
 * 出一张卡的 SVG。
 * @param {object} card  时间表里的 `card` 字段
 * @param {number} t     动画进度 0..1（1 = 停住的终帧）
 */
export function buildCard(card, t = 1, opts = {}) {
  const f = 卡表[card.type];
  if (!f) throw new Error(`不认识的卡型：${card.type}（有 ${Object.keys(卡表).join(' / ')}）`);
  const theme = card.theme || 'dark';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="${底(theme)}"/>`
    + f(card, t, theme)
    + (opts.frame === false ? '' : `<rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="none" stroke="${theme === 'light' ? INK : '#2a2a2a'}" stroke-width="6"/>`)
    + `</svg>`;
}

export const 卡型 = Object.keys(卡表);

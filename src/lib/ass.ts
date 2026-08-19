import type { Script, ScriptLine, Timeline, RenderProfile } from '../types.js';
import { CONFIG } from '../config.js';

/* ---------- 颜色：ASS 用 &HAABBGGRR，注意是 BGR 不是 RGB ---------- */
const WHITE = '&H00FFFFFF';
const BLACK = '&H00000000';
const RED = '&H002222EE'; // 稍微收一点的正红
const YELLOW = '&H0000E0FF';

/* ---------- 基准尺寸，按 1920x1080 标定 ---------- */
const BASE = {
  sub: 54, // 底部常规解说
  chipDate: 62, // 角标日期
  chipLabel: 66, // 角标标签
  emph: 72, // 强调段常规行
  emphKey: 92, // 强调段落点行
  hook: 120, // 开场标题卡
};

/* ---------- 开场标题卡 ---------- */

/**
 * 标题卡停留多久。
 *
 * 短视频的前三秒决定划不划走，所以这张卡要盖住整个开场：从第 0 帧起，
 * 一直压到第一句话说开为止。2.6 秒是「够读完两行大字」和「别耽误正片」
 * 之间的平衡点 —— 它跟开场白口重叠，不额外占片长。
 */
const HOOK_MS = 2600;

/** 标题卡左右各留多少（占画幅宽度的比例） */
const HOOK_MARGIN_RATIO = 0.055;

/** 标题卡的行距系数（相对字号）。比堆叠组紧，大字本来就占地方 */
const HOOK_GAP = 1.34;

/**
 * 角标最短停留时长。
 *
 * 角标的停留时间本来由 pauseAfterMs 决定，但那个值同时也是音轨上的静音长度 ——
 * 想让角标多留一会儿就得拉长片头的空白，不划算。角标不配音，纯粹是块贴片，
 * 显示时间跟音轨脱钩即可：让它压着下一句一起走，读得完就行。
 * 带具体数字的角标（「访日客2108万人 同比 -2.0%」）1.2 秒是读不完的。
 */
const CHIP_MIN_MS = 2000;

/**
 * 从标题里拆出关键词，一句一行。
 *
 * 标题本来就是按语义断好的（「访日客五年首降，经营管理签证还稳吗」），
 * 逗号顿号就是天然的分行点，不需要分词。最后一行当落点，给重色。
 *
 * 兜底两条：单段超长的就按宽度硬折；总行数封顶 3 行 —— 再多字号会被压到
 * 跟正文一样大，标题卡就白做了。
 */
function titleKeywords(title: string): string[] {
  const parts = title
    .split(/[，,、。．.！!？?；;：:\s|｜]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // 一行最多这么多个「字宽」，超了硬折，否则缩字会缩到没气势
  const MAX_UNITS = 12;
  const lines = parts.flatMap((seg) =>
    estimateWidth(seg, 1) > MAX_UNITS ? wrapToWidth(seg, 1, MAX_UNITS) : [seg],
  );
  return lines.slice(0, 3);
}

/**
 * 由标题算出版式编号。
 *
 * 用哈希而不是 Math.random()：管线的其余部分全是确定性的 —— 同一份
 * script.json 重跑必须逐帧一致，横版竖版也必须是同一个版式。
 * 哈希既拿到了「每条选题自动换个样子」，又没把可复现性丢掉。
 */
function hashOf(s: string): number {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 堆叠行的行距系数（相对字号） */
const LINE_GAP = 1.62;

/** sub 的左右边距（按 1080p 横版标定，随 sub 自己的字号系数缩放） */
const SUB_MARGIN = 60;

/**
 * sub 的字号系数。
 *
 * 竖版不跟 profile 的 1.45 —— 1080 宽的画面上 54×1.45=78px，一行只放得下
 * 12 个字，超过 12 字的句子两头直接被切出画。sub 是给人跟读的，字号让位于
 * 完整性；emph/chip 那种短行才需要 1.45 的冲击力。
 */
function subScale(p: RenderProfile): number {
  return p.orientation === 'portrait' ? 1.15 : p.fontScale;
}

/** sub 最多折几行。再多就压住画面主体，也超出了一句话该有的停留时间 */
function subMaxLines(p: RenderProfile): number {
  return p.orientation === 'portrait' ? 3 : 2;
}

/** 可以在其后断行的标点。断在标点后面，读起来才有句读 */
const BREAK_AFTER = '，、；：。！？,;:!?）」』】〉》';

function ms2ass(ms: number): string {
  const cs = Math.round(ms / 10);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/**
 * 稿件里的换行有两种写法：字面量的 \n（两个字符）和真正的换行符 ——
 * 取决于写稿时 JSON 里写的是 "\\n" 还是 "\n"，两种模型都会产出。
 * 真换行符直接落进 ASS 会把一个 Dialogue 撕成两行，整条字幕就废了，
 * 所以在进 ASS 之前一律归一成 \N。
 */
function toAssBreaks(text: string): string {
  return text.replace(/\\n/g, '\\N').replace(/\r?\n/g, '\\N');
}

/**
 * 估算一段文字的像素宽度。
 * CJK 按 1.0 个字号算，ASCII/数字按 0.55 算 —— 用来给角标的红竖线定位、
 * 给 sub 折行，误差几像素不影响观感。
 */
function estimateWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.55;
  }
  return units * fontSize;
}

/**
 * 按可用宽度把一句话折成若干行。
 *
 * WrapStyle 是 2（只认 \N，不自动折行）—— 保留这个设置是因为堆叠组和角标
 * 都靠精确的单行布局定位，交给 libass 自动折会打乱它们。所以 sub 的折行
 * 在这里自己算完，插好 \N 再交出去。
 *
 * 断点优先找标点：一行填到放不下时，往回看这一行的后半段有没有逗号句号，
 * 有就断在它后面。只在后 45% 里找，往前找太多会让上一行空掉半屏。
 * 标点本身允许略微出界（CJK 排版的标点悬挂），否则会被甩到下一行行首。
 */
function wrapToWidth(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur: string[] = [];
  let curW = 0;

  for (const ch of text) {
    const w = estimateWidth(ch, fontSize);
    const isPunct = BREAK_AFTER.includes(ch);

    if (curW + w > maxWidth && cur.length > 0 && !isPunct) {
      let cut = -1;
      for (let k = cur.length - 1; k >= Math.floor(cur.length * 0.55); k--) {
        if (BREAK_AFTER.includes(cur[k])) {
          cut = k + 1;
          break;
        }
      }
      if (cut > 0 && cut < cur.length) {
        lines.push(cur.slice(0, cut).join(''));
        cur = cur.slice(cut);
        curW = estimateWidth(cur.join(''), fontSize);
      } else {
        lines.push(cur.join(''));
        cur = [];
        curW = 0;
      }
    }

    cur.push(ch);
    curW += w;
  }

  if (cur.length > 0) lines.push(cur.join(''));
  return lines;
}

/**
 * 把一条 sub 排成「折好行的文本 + 实际字号」。
 *
 * 正常情况下字号就是基准值，折行解决问题。只有极端长句（折满还是超行数）
 * 才缩字保命，最多缩到 78% —— 再小就看不清了，那种句子该回去改稿。
 */
function layoutSub(text: string, p: RenderProfile): { text: string; fontSize: number } {
  const k = subScale(p);
  const base = BASE.sub * k;
  const maxWidth = p.width - Math.round(SUB_MARGIN * k) * 2;
  const maxLines = subMaxLines(p);
  // 稿件里显式写的换行是硬断点，各段分别折
  const segments = toAssBreaks(text).split('\\N');

  let size = base;
  let lines = segments.flatMap((seg) => wrapToWidth(seg, size, maxWidth));
  while (lines.length > maxLines && size > base * 0.78) {
    size *= 0.94;
    lines = segments.flatMap((seg) => wrapToWidth(seg, size, maxWidth));
  }

  return { text: lines.join('\\N'), fontSize: Math.round(size) };
}

/** 画一个实心矩形。绘图坐标以 \pos 为原点，配 \an7 就是矩形的左上角 */
function rect(
  endMs: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: string,
  layer: number,
  fade: string,
): string {
  const [W, H] = [Math.round(w), Math.round(h)];
  return dialogue(
    'Hook',
    0,
    endMs,
    `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\c${color}\\1a${alpha}\\bord0\\shad0${fade}}` +
      `m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}{\\p0}`,
    layer,
  );
}

interface HookCtx {
  keys: string[];
  p: RenderProfile;
  /** 实际字号（已按画幅压过） */
  fs: number;
  /** 行进距离 */
  gap: number;
  /** profile 缩放，用来定线宽这类装饰尺寸 */
  k: number;
  endMs: number;
  fade: string;
}

function hookText(c: HookCtx, tags: string, text: string): string {
  return dialogue('Hook', 0, c.endMs, `{${tags}\\fs${c.fs}${c.fade}}${text}`, 2);
}

/* ---------- 版式一：居中堆叠，末行红底反白 ---------- */
function hookCentered(c: HookCtx): string[] {
  const cx = Math.round(c.p.width / 2);
  const y0 = Math.round(c.p.height / 2 - (c.keys.length * c.gap) / 2);
  const ev: string[] = [];

  c.keys.forEach((t, i) => {
    const y = y0 + Math.round(i * c.gap);
    if (i === c.keys.length - 1) {
      const w = estimateWidth(t, c.fs) + c.fs * 0.52;
      ev.push(rect(c.endMs, cx - w / 2, y - c.fs * 0.13, w, c.fs * 1.26, RED, '&H12&', 1, c.fade));
    }
    ev.push(hookText(c, `\\an8\\pos(${cx},${y})\\c${WHITE}\\3c${BLACK}`, t));
  });
  return ev;
}

/* ---------- 版式二：左对齐，整块左侧一条红竖线 ---------- */
function hookLeftBar(c: HookCtx): string[] {
  const x = Math.round(c.p.width * 0.11);
  const totalH = c.keys.length * c.gap;
  const y0 = Math.round(c.p.height / 2 - totalH / 2);
  const barW = Math.max(6, Math.round(11 * c.k));
  const ev = [
    rect(c.endMs, x - 32 * c.k - barW, y0, barW, totalH * 0.94, RED, '&H00&', 1, c.fade),
  ];

  c.keys.forEach((t, i) => {
    const isKey = i === c.keys.length - 1;
    const color = isKey ? `\\c${RED}\\3c${YELLOW}` : `\\c${WHITE}\\3c${BLACK}`;
    ev.push(hookText(c, `\\an7\\pos(${x},${y0 + Math.round(i * c.gap)})${color}`, t));
  });
  return ev;
}

/* ---------- 版式三：上下分置，中间一道红横线 ---------- */
function hookSplit(c: HookCtx): string[] {
  const cx = Math.round(c.p.width / 2);
  const head = c.keys.slice(0, -1);
  const tail = c.keys[c.keys.length - 1];
  const ruleY = Math.round(c.p.height * 0.5);
  const ruleW = Math.round(c.p.width * 0.24);
  const ruleH = Math.max(5, Math.round(9 * c.k));
  const clear = Math.round(c.p.height * 0.045);

  const ev = [
    rect(c.endMs, cx - ruleW / 2, ruleY - ruleH / 2, ruleW, ruleH, RED, '&H00&', 1, c.fade),
  ];
  // 上半：贴着横线往上排，所以从末尾倒着算 y
  head.forEach((t, i) => {
    const y = ruleY - clear - (head.length - i) * c.gap;
    ev.push(hookText(c, `\\an8\\pos(${cx},${Math.round(y)})\\c${WHITE}\\3c${BLACK}`, t));
  });
  ev.push(hookText(c, `\\an8\\pos(${cx},${ruleY + clear})\\c${RED}\\3c${YELLOW}`, tail));
  return ev;
}

/* ---------- 版式四：整块压在下三分之一，末行红色下划线 ---------- */
function hookBottom(c: HookCtx): string[] {
  const x = Math.round(c.p.width * 0.11);
  const y0 = Math.round(c.p.height * 0.78 - c.keys.length * c.gap);
  const ev: string[] = [];

  c.keys.forEach((t, i) => {
    ev.push(hookText(c, `\\an7\\pos(${x},${y0 + Math.round(i * c.gap)})\\c${WHITE}\\3c${BLACK}`, t));
  });

  const last = c.keys[c.keys.length - 1];
  const lastY = y0 + (c.keys.length - 1) * c.gap;
  ev.push(
    rect(
      c.endMs,
      x,
      lastY + c.fs * 1.16,
      estimateWidth(last, c.fs),
      Math.max(6, Math.round(11 * c.k)),
      RED,
      '&H00&',
      1,
      c.fade,
    ),
  );
  return ev;
}

const HOOK_LAYOUTS = [hookCentered, hookLeftBar, hookSplit, hookBottom];

/**
 * 开场标题卡：把标题的关键词做成盖在第一个镜头上的大字。
 *
 * 原来的开场是左中位的时空角标，信息是对的（「2026年8月上半年 / 访日客数」），
 * 但它交代的是背景不是钩子 —— 观众在前三秒要看到的是这条片子讲什么。
 * 所以标题卡在前，角标顺延到它淡出之后。
 *
 * 版式由标题哈希在四套里挑，见 hashOf 的注释。
 */
function renderHook(
  title: string,
  p: RenderProfile,
  endMs: number,
  pinned?: number,
): string[] {
  const keys = titleKeywords(title);
  if (keys.length === 0) return [];

  const maxWidth = p.width * (1 - 2 * HOOK_MARGIN_RATIO);
  const widest = Math.max(...keys.map((t) => estimateWidth(t, 1)));
  // 字号由最长那一行定：先按基准放大，放不下就压到刚好进画
  const fs = Math.floor(Math.min(BASE.hook * p.fontScale, maxWidth / widest));
  // 淡入必须是 0：各平台默认拿第一帧当封面图，而且观众按下播放看到的就是第 0 帧。
  // 有淡入的话第一帧是半透明的、封面抓出来是糊的，标题卡等于白做。只留淡出。
  const fade = '\\fad(0,300)';
  const ctx: HookCtx = { keys, p, fs, gap: fs * HOOK_GAP, k: p.fontScale, endMs, fade };

  // 压暗整帧。不压的话白字撞上明亮的空镜（机场、涩谷的霓虹）就糊了，
  // 描边再粗也救不回来 —— 这是标题卡跟正文字幕最大的区别。
  //
  // 这个 &H30& 是拿实拍帧标出来的，不是按 (255-a)/255 算的：libass 实际压出来
  // 只有名义值的六成左右，名义 55% 上画只剩 37%。要调就照着改完重渲一帧量亮度，
  // 别按公式推。当前值 = 无字区域压暗 55%。
  const scrim = rect(endMs, 0, 0, p.width, p.height, BLACK, '&H30&', 0, fade);
  const pick = pinned === undefined ? hashOf(title) : pinned;
  // -1 = 只留蒙版。封面用 video-pipeline 的故障标题叠上去时走这条：
  // 蒙版仍然要画（叠上去的白字同样需要压暗的底），但标题字由那边出
  if (pick < 0) return [scrim];
  const layout = HOOK_LAYOUTS[Math.abs(Math.trunc(pick)) % HOOK_LAYOUTS.length];
  return [scrim, ...layout(ctx)];
}

function styleHeader(p: RenderProfile): string {
  const k = p.fontScale;
  const f = CONFIG.fontName;
  const mk = (
    name: string,
    size: number,
    primary: string,
    outline: string,
    outlineW: number,
    align: number,
    marginV: number,
    /** 该样式自己的字号系数，缺省跟 profile 走 */
    scale: number = k,
    marginH: number = SUB_MARGIN,
  ) =>
    `Style: ${name},${f},${Math.round(size * scale)},${primary},&H000000FF,${outline},${BLACK},` +
    `-1,0,0,0,100,100,0,0,1,${(outlineW * scale).toFixed(1)},0,${align},` +
    `${Math.round(marginH)},${Math.round(marginH)},${Math.round(marginV * scale)},1`;

  const sk = subScale(p);

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${p.width}`,
    `PlayResY: ${p.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
      'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, ' +
      'Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 边距要跟 layoutSub 的可用宽度算法用同一个系数，否则折出来的行还是会出画
    mk('Sub', BASE.sub, WHITE, BLACK, 3.0, 2, 72, sk, SUB_MARGIN * sk),
    mk('Chip', BASE.chipLabel, WHITE, BLACK, 3.4, 4, 0),
    mk('Emph', BASE.emph, WHITE, BLACK, 4.0, 8, 0),
    // 标题卡的字号逐条用 \fs 覆盖（要按画幅压），这里只定字体、描边和粗细
    mk('Hook', BASE.hook, WHITE, BLACK, 4.6, 5, 0),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

function dialogue(style: string, startMs: number, endMs: number, text: string, layer = 0): string {
  return `Dialogue: ${layer},${ms2ass(startMs)},${ms2ass(endMs)},${style},,0,0,0,,${text}`;
}

/* ---------- 角标：日期块 + 红竖线 + 标签，三个 event ---------- */
function renderChip(
  line: ScriptLine,
  startMs: number,
  endMs: number,
  p: RenderProfile,
): string[] {
  const k = p.fontScale;
  const [rawLeft, rawRight] = line.text.split('|').map((s) => s.trim());
  const left = toAssBreaks(rawLeft ?? line.text);
  const right = toAssBreaks(rawRight ?? '');

  const x = Math.round(p.width * 0.07);
  const y = Math.round(p.height * 0.52);
  const fade = '\\fad(260,220)';

  const leftLines = left.split('\\N');
  const rightLines = right.split('\\N');
  const barW = Math.max(4, Math.round(5 * k));

  /*
   * 先量整块有多宽，超出画面就等比缩小。
   *
   * 角标的内容是稿件写的，一旦从「访日客数」这种类目名换成「访日客2108万人」
   * 这种真数字，竖版立刻就顶出画了 —— 跟 sub 当初的溢出是同一类问题，
   * 只是 chip 是 \pos 定位的，libass 连截断都不会，直接画到画布外面去。
   */
  const measure = (f: number) => {
    const dW = Math.max(...leftLines.map((s) => estimateWidth(s, BASE.chipDate * k * f)));
    if (!right) return dW;
    const lW = Math.max(...rightLines.map((s) => estimateWidth(s, BASE.chipLabel * k * f)));
    return dW + (34 + 30) * k * f + barW + lW;
  };
  const avail = p.width - x * 2;
  const fit = measure(1) > avail ? avail / measure(1) : 1;

  const dateSize = BASE.chipDate * k * fit;
  const labelSize = BASE.chipLabel * k * fit;

  const events: string[] = [];

  // 日期块：\an4 = 左中对齐，多行时整块垂直居中于 y
  events.push(
    dialogue(
      'Chip',
      startMs,
      endMs,
      `{\\an4\\pos(${x},${y})\\fs${Math.round(dateSize)}${fade}}${left}`,
    ),
  );

  if (right) {
    // 最长那一行决定竖线的 x 位置
    const widest = Math.max(...leftLines.map((s) => estimateWidth(s, dateSize)));
    const barX = Math.round(x + widest + 34 * k * fit);
    // 竖线要盖住行数多的那一侧，否则两行的标签会比线还高
    const rows = Math.max(leftLines.length, rightLines.length);
    const barH = Math.round(labelSize * (1.9 + (rows - 1) * 1.2));

    // \p1 绘图模式画一个红色矩形，\an7 让坐标落在左上角
    events.push(
      dialogue(
        'Chip',
        startMs,
        endMs,
        `{\\an7\\pos(${barX},${y - Math.round(barH / 2)})\\p1\\c${RED}\\bord0\\shad0${fade}}` +
          `m 0 0 l ${barW} 0 l ${barW} ${barH} l 0 ${barH}{\\p0}`,
        1,
      ),
    );

    events.push(
      dialogue(
        'Chip',
        startMs,
        endMs,
        `{\\an4\\pos(${barX + barW + Math.round(30 * k * fit)},${y})` +
          `\\fs${Math.round(labelSize)}${fade}}${right}`,
      ),
    );
  }

  return events;
}

/* ---------- 堆叠组：每行一个独立 event，逐行淡入，整组同时消失 ---------- */
interface StackMember {
  line: ScriptLine;
  startMs: number;
}

function renderStack(members: StackMember[], groupEndMs: number, p: RenderProfile): string[] {
  const k = p.fontScale;
  const cx = Math.round(p.width / 2);
  const sizes = members.map((m) => (m.line.style === 'emphKey' ? BASE.emphKey : BASE.emph) * k);

  // 整组垂直居中：先算总高，再定第一行的顶端
  const totalH = sizes.reduce((sum, s) => sum + s * LINE_GAP, 0);
  let y = Math.round(p.height / 2 - totalH / 2);

  const events: string[] = [];
  members.forEach((m, i) => {
    const fs = sizes[i];
    const isKey = m.line.style === 'emphKey';
    const color = isKey ? `\\c${RED}\\3c${YELLOW}` : `\\c${WHITE}\\3c${BLACK}`;
    events.push(
      dialogue(
        'Emph',
        m.startMs,
        groupEndMs,
        `{\\an8\\pos(${cx},${y})\\fs${Math.round(fs)}${color}\\fad(220,260)}` +
          toAssBreaks(m.line.text),
      ),
    );
    y += Math.round(fs * LINE_GAP);
  });

  return events;
}

/**
 * 生成 ASS 文件内容。
 *
 * 时间轴规则：
 *  - 普通行：起止时间 = 自己那句配音的起止（末尾补 120ms 视觉余量）
 *  - 堆叠组：第 i 行从自己的配音起点淡入，所有行统一在该组最后一行配音结束后消失
 */
export function buildAss(script: Script, timeline: Timeline, p: RenderProfile): string {
  const events: string[] = [];
  const lines = script.lines;

  // 开场标题卡压在最前面，其余元素都要给它让路
  const hook = renderHook(script.title, p, HOOK_MS, script.hookLayout);
  events.push(...hook);
  const hookEnd = hook.length > 0 ? HOOK_MS : 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = timeline.lines[i];

    if (line.stack !== undefined) {
      // 收集同一个 stack 组的所有连续行
      const group: StackMember[] = [];
      const gid = line.stack;
      let j = i;
      while (j < lines.length && lines[j].stack === gid) {
        group.push({ line: lines[j], startMs: timeline.lines[j].startMs });
        j++;
      }
      const groupEnd = timeline.lines[j - 1].endMs + 380;
      events.push(...renderStack(group, groupEnd, p));
      i = j;
      continue;
    }

    const start = t.startMs;
    const end = t.endMs + 120;

    if (line.style === 'chip') {
      // 角标跟标题卡都占画面中部，撞在一起就是一团糊。
      // 角标不配音，整块后移到卡片淡出之后即可，时长不变，不影响时间轴。
      let [s, e] = [start, end];
      if (s < hookEnd) {
        s = hookEnd + 140;
        e = s + (end - start);
      }
      e = Math.max(e, s + CHIP_MIN_MS);
      events.push(...renderChip(line, s, e, p));
    } else {
      const lay = layoutSub(line.text, p);
      events.push(dialogue('Sub', start, end, `{\\fs${lay.fontSize}\\fad(160,140)}${lay.text}`));
    }
    i++;
  }

  return `${styleHeader(p)}\n${events.join('\n')}\n`;
}

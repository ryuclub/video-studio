// ── 单帧渲染：状态 → SVG ──────────────────────────────────────────────

import { W, H, GROUND, SLOT, SNAKE, SNAKE_DY, WIDE, FPS } from './config.js';
import { P, makeInk } from './style/palette.js';
import { getScene } from './scenes/index.js';
import { PROPS } from './props/index.js';
import { serpentine } from './rigs/serpentine.js';
import { human, speedOf } from './rigs/human.js';
import { turtle } from './rigs/turtle.js';
import { mouse } from './rigs/mouse.js';
import { cat } from './rigs/cat.js';
import { still } from './rigs/still.js';
import type { CharState } from './rigs/state.js';
import { dialogueStrip, hookStrip, seriesCard, sideText } from './subtitle.js';
import { breathe, blinking, clamp, easeOut, lerp, shake, smoothstep, talkBob, track, type Key } from './anim.js';
import { getPace } from './pace.js';
import { segAt, speakingAt, subtitleAt, estimateDur, partAt, partSpans } from './beats/typeA.js';
import { subtitleText, lineText, type Timeline } from './types.js';
import { mouthFrom } from './audio/align.js';
import { horse as horseRig, horseBox } from './rigs/horse.js';
import { place as placeMark, speechBurst } from '../horse/marks.mjs';

export interface VoiceTrack {
  env: Float32Array; // 逐帧包络
  dur: number;
}

export interface RenderCtx {
  tl: Timeline;
  voices: Map<number, VoiceTrack>;
  /**
   * 无视分镜，强制这些角色都在场。封面用——封面要把主角配角都摆出来，
   * 而正片那一刻可能是个单人镜。
   */
  forceStage?: string[];
}

/**
 * 镜头关键帧：跟随说话者，反转句推近。
 *
 * 必须走关键帧插值，不能按当前时刻直接算目标值。早先那版是「有人说话就
 * zoom 1.14，没人说话就回 1.0」，于是每句话首尾各产生一次硬切——14 秒的片子
 * ffmpeg 能检出 5 次场景切变，看起来就是一顿一顿的。
 *
 * 两句之间的停顿**不要**把镜头拉回原位：保持上一句的构图，直到下一句起范儿
 * 才开始挪。镜头一旦回弹，观众会以为换镜头了。
 */
/**
 * 短于这个的停顿不算「在想」，眼睛就定着。
 *
 * 句与句之间的停顿是 0.30–0.67 秒，**0.3 秒里转一圈是抽搐不是思考**。
 * 定在 0.35：比它短的（换气那种）不动，长的才转。
 */
/**
 * ── 老马的眼动：扫视 ＋ 固视 ─────────────────────────────────────────
 *
 * 人的眼球是**瞬间跳到一点、钉住不动、再瞬间跳走**。匀速运动在生理上
 * 不存在 —— 上一版让眼珠按停顿进度画一个圆，圆是匀速的，所以还是漂移，
 * 只是漂得规整了些。看着像游魂不像人，而且**一次停顿就转满一圈，动得太多**。
 *
 * 现在整条轨在这儿排好（rig 只看得到当前时刻，排不了），一串固视点，
 * 每两点之间用 2 帧跳过去。跳只占 0.066 秒，眼睛在**绝大部分时间是不动的**，
 * 只是每隔一两秒换个地方 —— 这才是「他在想」的样子。
 *
 * 用量按 beat 分（见 老马出片方案 §五 表情）：
 *   点了表情的句子   整句定住，一次都不跳（表演压过待机动作）
 *   落点句           正视 (0,0) 钉住，连微动都压掉
 *   其余句子         每 1.6 秒左右一次中扫视，**一句话最多 2 次**
 *   停顿             一次，往中间收一点（但不回正中，正中留给落点）
 */

/** 扫视时长：2 帧。**不要插值成缓动** —— 缓动就是漂移，漂移就不像眼睛 */
const SACCADE = 2 / FPS;
/** 落点前的归零提前量：跳到正中之后要有一小段钉住，落点才有「面对」的意思 */
const ZERO_LEAD = 0.45;
/** 扭头时视线提前多少动。同时动像被人掰过去的，先动才像「他决定看那边」 */
const GAZE_LEAD = 0.12;
/** 短于这个的换气不排眼动，也不排眨眼 —— 0.2 秒里做完一个动作是抽搐 */
const MIN_PAUSE = 0.35;
/** 连续多久没眨眼就必须补一次。超过这个观众就开始读出「静图配音」 */
const MAX_NO_BLINK = 6;
/** 眨眼 5 帧 ≈ 0.167 秒 */
const BLINK_DUR = 5 / FPS;

interface Fix {
  t: number;
  x: number;
  y: number;
  /** 钉死：连 ±0.8px 的微动都不要（只有落点句用） */
  pin?: boolean;
}

/** 各 beat 的起手视线。老马的底色是「累到平静」，所以**偏下偏侧，不往上看** */
const BEAT_HOME: Record<string, { x: number; y: number }> = {
  setup: { x: -6, y: 4 },
  reply: { x: -8, y: 6 },
  punch: { x: 0, y: 0 },
};

/** 定死的伪随机：同一条片子每次出都一样，不然重出一版眼神就变了 */
function rnd(seed: number): number {
  return ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1;
}

/**
 * 一次中扫视的落点。
 *
 * 方向的语义：向上＝回想，向下＝无奈，向侧＝转移注意。老马是「累到平静」，
 * 所以**向下和向侧为主，向上少用** —— 配比约 向下 55 / 向上 30 / 平移 15。
 * 幅度 14–20px（中扫视），±24 那一档留给转折那一次。
 */
function saccadeTo(seed: number): { x: number; y: number } {
  const r = rnd(seed);
  const amp = 14 + rnd(seed + 7.1) * 6;
  const dir = rnd(seed + 3.3) < 0.5 ? -1 : 1;
  if (r < 0.55) return { x: dir * amp * 0.55, y: 6 + rnd(seed + 1.7) * 9 }; // 向下
  if (r < 0.85) return { x: dir * amp * 0.6, y: -(5 + rnd(seed + 2.9) * 7) }; // 向上
  return { x: dir * amp, y: 2 }; // 平移
}

const gazeCache = new WeakMap<Timeline, { fixes: Fix[]; blinks: number[] }>();

/** 说话中的这些时刻可以塞眨眼：句间停顿的头上，和 say 小句之间的换气 */
export function eyeTrack(tl: Timeline): { fixes: Fix[]; blinks: number[] } {
  const hit = gazeCache.get(tl);
  if (hit) return hit;

  const intro = tl.cfg.intro ?? 2;
  const lines = tl.segments
    .filter((s) => s.kind === 'line' && s.line)
    .map((s) => {
      const dur = s.line!.dur ?? estimateDur(lineText(s.line!));
      return { seg: s, line: s.line!, a: s.start, b: s.start + dur };
    });

  const fixes: Fix[] = [{ t: 0, x: -6, y: 4 }];
  const blinks: number[] = [];
  const punchAt = lines.find((l) => l.line.beat === 'punch')?.a ?? Infinity;

  lines.forEach((L, i) => {
    const home = BEAT_HOME[L.line.beat ?? 'setup'] ?? BEAT_HOME.setup;
    // **表情也可能点在小句上**（say[].look）。只看 line.look 会漏掉一整类句子 ——
    // 那正是拆过屏的句子，也就是转折句和落点句
    const named = !!L.line.look || !!L.line.say?.some((c) => c.look);
    /**
     * 视线比头先动。
     *
     * ⚠ 这里原来写的是 `L.line.look ? GAZE_LEAD : 0` —— **提前量挂在表情上，
     * 不是挂在扭头上**，于是表情一移到 say[] 里，整条规则就静悄悄失效了
     * （稿 5 的转折句就是这么漏掉的：扭了头，视线跟头同时动）。
     * 提前量的依据只有一个：这一句扭不扭头。
     */
    const lead = L.line.turn ? GAZE_LEAD : 0;
    const isPunch = L.line.beat === 'punch';

    if (isPunch) {
      // 落点句：**不扫视**。前面那一跳已经归零，这儿只是钉住
      fixes.push({ t: L.a, x: 0, y: 0, pin: true });
    } else if (named) {
      // 点了表情：整句定住。rig 里 look 会压过 gaze，这儿只把偏移清掉，
      // 免得表情之外再叠一层位移把眼珠顶出眼白
      fixes.push({ t: L.a - lead, x: 0, y: 0 });
    } else {
      fixes.push({ t: L.a, ...home });
      // 一句话最多 2 次。扫视太频繁读作「心虚、慌张」，跟人设正相反
      const span = L.b - L.a;
      const n = Math.min(2, Math.floor(span / 1.6));
      for (let k = 1; k <= n; k++) {
        const at = L.a + (span * k) / (n + 1);
        const d = saccadeTo(i * 31 + k * 7);
        fixes.push({ t: at, x: home.x + d.x, y: home.y + d.y });
      }
    }

    // 这一句和下一句之间的停顿
    const next = lines[i + 1];
    if (!next) return;
    const gap = next.a - L.b;
    if (gap < MIN_PAUSE) return;
    const at = L.b + 0.08;
    blinks.push(at); // **扫视和眨眼同帧**：人换注视点时经常顺带眨一下
    if (next.line.beat === 'punch') {
      // 落点前的归零**必须是一次扫视，不能滑回来** —— 滑回中间没有决断感
      fixes.push({ t: Math.max(at, next.a - ZERO_LEAD), x: 0, y: 0, pin: true });
    } else {
      // 说话时视线偏离，停顿里往回收一点 —— **但不回到正中，正中留给落点**
      const last = fixes[fixes.length - 1];
      fixes.push({ t: at, x: last.x * 0.35, y: last.y * 0.35 + 3 });
    }
  });

  // ── 补眨眼：连续 6 秒不眨，观众就读出「静图配音」 ──
  // 候选是 say 小句之间的换气（那儿本来就在换气，最自然）
  const breaths: number[] = [];
  for (const L of lines) {
    const parts = partSpans(L.line, L.a, L.b - L.a);
    for (let k = 1; k < parts.length; k++) breaths.push(parts[k].a - 0.05);
  }
  blinks.sort((a, b) => a - b);
  const out: number[] = [];
  let last = intro - 1;
  const all = [...blinks, ...breaths].sort((a, b) => a - b);
  for (const b of all) {
    if (b >= punchAt) break; // **落点句不眨**
    if (b - last < 1.2) continue;
    // 停顿处优先；换气点在「已经隔了一阵子」时补上 ——
    // 等到超过 6 秒才兜底的话，补出来的那一下会落在句子中间，不自然
    if (b - last > 3.5 || blinks.includes(b)) {
      out.push(b);
      last = b;
    }
  }
  // 兜底：还是有超过 6 秒的空档就硬塞
  for (let k = 0; k < out.length - 1; k++) {
    if (out[k + 1] - out[k] > MAX_NO_BLINK) out.splice(k + 1, 0, out[k] + MAX_NO_BLINK * 0.8);
  }

  const res = { fixes: fixes.sort((a, b) => a.t - b.t), blinks: out };
  gazeCache.set(tl, res);
  return res;
}

/** 这一刻眼珠在哪。两帧跳到位，其余时间钉住（外加 ±0.8px 微动，防止钉死） */
export function gazeAt(tl: Timeline, t: number): { x: number; y: number } {
  const { fixes } = eyeTrack(tl);
  let i = 0;
  while (i + 1 < fixes.length && fixes[i + 1].t <= t) i++;
  const cur = fixes[i];
  const prev = i > 0 ? fixes[i - 1] : cur;
  const k = clamp((t - cur.t) / SACCADE);
  const x = lerp(prev.x, cur.x, k);
  const y = lerp(prev.y, cur.y, k);
  if (cur.pin || k < 1) return { x, y };
  // 微动：固视期间眼球也不是死的，±0.8px 就够，多了又成漂移
  return { x: x + Math.sin(t * 2.7) * 0.8, y: y + Math.cos(t * 3.4) * 0.6 };
}

/** 这一刻在不在眨眼 */
export function blinkingAt(tl: Timeline, t: number): boolean {
  return eyeTrack(tl).blinks.some((b) => t >= b && t < b + BLINK_DUR);
}

const camCache = new WeakMap<Timeline, { zoom: Key[]; tx: Key[]; ty: Key[] }>();

function cameraKeys(tl: Timeline) {
  const hit = camCache.get(tl);
  if (hit) return hit;

  const zoom: Key[] = [];
  const tx: Key[] = [];
  const ty: Key[] = [];
  // track() 要求时间单调递增，挤在一起的关键帧往后让 1ms
  const at = (arr: Key[], t: number, v: number) => {
    const last = arr[arr.length - 1];
    arr.push([last && t <= last[0] ? last[0] + 0.001 : t, v]);
  };
  const push3 = (t: number, v: { zoom: number; tx: number; ty: number }) => {
    at(zoom, t, v.zoom);
    at(tx, t, v.tx);
    at(ty, t, v.ty);
  };

  // 开场：轻微缓推，落到中景
  const intro = tl.cfg.intro ?? 2;
  const neutral = { zoom: 1.06, tx: 0, ty: 0 };
  push3(0, neutral);
  let prev = { zoom: 1.0, tx: 0, ty: 0 };
  push3(intro, prev);

  // static：开场缓推之后就停住，后面的跟随/推近一概不排。
  // **不是把幅度调小**——调小还是在动，而「几乎不动」的意思是不动。
  if (tl.cfg.camera === 'static') {
    push3(tl.duration, prev);
    const out = { zoom, tx, ty };
    camCache.set(tl, out);
    return out;
  }

  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    const isPunch = s.line.beat === 'punch';
    const ch = tl.cfg.characters.find((c) => c.id === s.line!.who);
    const anchors = ch?.rig === 'serpentine' ? SNAKE : ch?.rig === 'turtle' ? WIDE : SLOT;
    const target = ch?.side === 'left' ? anchors.left : anchors.right;
    // 单人镜头：角色本来就在画面中央，镜头不用再左右摇，只做推近。
    //
    // 但**每个角色的单人镜要给不同景别**。两个镜构图一模一样时，切换看着不像
    // 「切镜头」，像角色原地瞬移——场景没变，只有主体换了。按角色错开
    // zoom 和高度，切换才读得出是两个机位。
    const onStage = s.line.stage ?? tl.cfg.characters.map((c) => c.id);
    const solo = onStage.length === 1;
    const soloIdx = solo ? tl.cfg.characters.findIndex((c) => c.id === s.line!.who) : 0;

    let v: { zoom: number; tx: number; ty: number };
    if (solo) {
      v = { zoom: isPunch ? 1.34 : 1.1 + soloIdx * 0.12, tx: 0, ty: isPunch ? 120 : 40 + soloIdx * 55 };
    } else {
      // 多人同框：构图要**容纳所有在场角色**，不能再按说话者一边偏。
      // 笑点句照样推近的话，站边上那个会被挤出画外——
      // 「最终两人在一个画面里」这种收尾，推近必须让位给完整构图。
      // 只算角色，**道具不参与构图中点**。
      // 早先没过滤，stage 里的 egg2 查不到角色就回退成 SLOT.right(752)，
      // 把镜头往右拽了 70px——换个片子道具一变镜头就会莫名平移。
      const xs = onStage
        .map((id) => tl.cfg.characters.find((x) => x.id === id))
        .filter((cc): cc is NonNullable<typeof cc> => !!cc && cc.rig !== 'none')
        .map((cc) => {
          const a = cc.rig === 'serpentine' ? SNAKE : cc.rig === 'turtle' ? WIDE : SLOT;
          return cc.x ?? (cc.side === 'left' ? a.left : a.right);
        });
      if (!xs.length) xs.push(W / 2);
      const mid = xs.reduce((p, q) => p + q, 0) / xs.length;
      const wideShot = onStage.length > 1 && tl.cfg.characters.length > 1;
      // ty 是**往下推**画面的。角色只有 300 上下高、站在 y=1290 的地面上，
      // ty 取正值时头顶落在画幅 54% 处——上面一大半全是空天，很难看。
      // 取负值把画面往上提，地平线压到 60%，角色才落在视觉重心上。
      //
      // 提多少有硬上限：再往上就把场景底边拽进画幅、露出黑边。
      // 极限是 960*(1-zoom)/0.3（见 toScreen 的 y 式），所以这里按 zoom 反算，
      // 不写死数值——以后改 zoom 不会连带穿帮。
      const z = isPunch ? (wideShot ? 1.06 : 1.34) : wideShot ? 1.06 : 1.14;
      const lift = (960 * (1 - z)) / 0.3; // 画面能上提的极限（负数）
      v = {
        zoom: z,
        // 全员同框时不横摇：摇会把可视窗口推偏，最边上的角色会被切掉，
        // 而站位检查按舞台坐标算，看不出来。摇是单人镜追主体才需要的。
        tx: wideShot ? 0 : (W / 2 - mid) * (isPunch ? 0.78 : 0.5),
        ty: wideShot ? lift : isPunch ? 120 : 60,
      };
    }
    // 反转句推得快，抖包袱要有劲；平常句子慢慢挪过去
    const ease = isPunch ? 0.34 : 0.55;
    push3(Math.max(0, s.start - ease * 0.7), prev); // 保持上一句构图到这一刻
    push3(s.start + ease * 0.3, v); // 台词起来的时候刚好落位
    prev = v;
  }

  const keys = { zoom, tx, ty };
  camCache.set(tl, keys);
  return keys;
}

function camera(ctx: RenderCtx, t: number) {
  const { tl } = ctx;
  const tt = Math.min(t, tl.freezeStart - 0.05); // 定格后镜头保持笑点时的构图
  const k = cameraKeys(tl);
  return { zoom: track(k.zoom, tt), tx: track(k.tx, tt), ty: track(k.ty, tt) };
}

/**
 * 这一刻画面里该有谁。
 *
 * 单人镜头交替（镜头1 只有小龟、镜头2 只有龟妈妈）靠 line.stage 表达。
 * 开场沿用第一句的名单，定格/留白沿用笑点句的——不然画面会在切换时空一下。
 */
export function stageAt(tl: Timeline, t: number): string[] {
  const all = tl.cfg.characters.map((c) => c.id);
  const lines = tl.segments.filter((s) => s.kind === 'line' && s.line);
  if (!lines.length) return all;

  const seg = tl.segments.find((s) => t >= s.start && t < s.end);
  if (seg?.kind === 'line' && seg.line) return seg.line.stage ?? all;

  // 不在任何台词段里：开场空镜、**句间空白**、定格、留白。
  //
  // 句间空白必须归给**下一镜**。早先这里退到 segments[last]（hold 段），
  // 于是所有空白都返回笑点句的名单——开场到第一句之间、每两句之间，
  // 都会闪一下笑点那个角色。表现就是"莫名其妙闪出一个人再消失"。
  const next = lines.find((s) => s.start > t);
  if (next) return next.line!.stage ?? all;

  // 最后了（定格 / 留白）：保持笑点那一镜
  const punch = lines.find((s) => s.line!.beat === 'punch') ?? lines[lines.length - 1];
  return punch.line!.stage ?? all;
}

/** 这一刻用哪个场景。规则跟 stageAt 一致，不然人和背景会错拍 */
export function sceneAt(tl: Timeline, t: number): string {
  const lines = tl.segments.filter((s) => s.kind === 'line' && s.line);
  const seg = tl.segments.find((s) => t >= s.start && t < s.end);
  if (seg?.kind === 'line' && seg.line) return seg.line.scene ?? tl.cfg.scene;
  const next = lines.find((s) => s.start > t);
  if (next) return next.line!.scene ?? tl.cfg.scene;
  const last = lines[lines.length - 1];
  return last?.line?.scene ?? tl.cfg.scene;
}

function charStateFor(
  ctx: RenderCtx,
  cfgIndex: number,
  t: number,
  frame: number
): CharState {
  const { tl } = ctx;
  const c = tl.cfg.characters[cfgIndex];
  const isLeft = c.side === 'left';
  const snake = c.rig === 'serpentine' || c.rig === 'turtle';
  // 乌龟身体宽，用人物那套更开的站位；长条动物才用 SNAKE 的窄站位 + y 错开
  const wide = c.rig === 'serpentine';
  const anchors = wide ? SNAKE : c.rig === 'turtle' ? WIDE : SLOT;
  const baseX = c.x ?? (isLeft ? anchors.left : anchors.right);
  const facing: 1 | -1 = isLeft ? 1 : -1;

  const intro = tl.cfg.intro ?? 2;
  const frozen = t >= tl.freezeStart;
  const at = frozen ? tl.freezeStart - 0.001 : t; // 定格：所有相位停住

  // 落脚点用**场景自己的地面线**，不是常量 GROUND。
  // 斜坡场景里两者能差 150px，表现就是"人没站在地上"。
  const slotY = sceneGroundAt(tl, at, baseX) + (wide ? (isLeft ? SNAKE_DY.left : SNAKE_DY.right) : 0);

  // 这一刻在不在画面里。单人镜头时把角色摆到中央，别还窝在左右机位上
  const onStage = ctx.forceStage ?? stageAt(tl, at);
  const visible = onStage.includes(c.id);
  const solo = onStage.length === 1;

  // 入场：从画外滑入
  const inK = easeOut(clamp(at / (intro * 0.75)));
  let offX = (isLeft ? -520 : 520) * (1 - inK);
  let walking = 0;

  // 爬入：从画面某一侧慢慢爬进来，边爬边说。
  //
  // 起点必须是**这一镜开始的那一刻**（上一句 segment 结束），不能用「台词前 0.4s」。
  // 用后者时，stage 已经把角色放进画面、爬入却还没启动，中间那几帧角色会以
  // 正常站位整只出现再瞬移到画外——表现就是"快闪一下"。
  //
  // 缓动用**线性**，不用 easeOut。easeOut 起步快收尾慢，乌龟应该是匀速挪，
  // 一上来窜一下就不像乌龟了。
  const enterSeg = tl.segments.find((sg) => sg.kind === 'line' && sg.line?.who === c.id && sg.line.enter);
  if (enterSeg?.line?.enter) {
    const segs = tl.segments;
    const idx = segs.indexOf(enterSeg);
    const shotStart = idx > 0 ? segs[idx - 1].end : 0; // 这一镜从上一段结束就开始了
    if (at >= shotStart) {
      const dist = enterSeg.line.enterFrom ?? 700; // 刚好挪出画外，别起得太远显得在冲刺
      const from = enterSeg.line.enter === 'left' ? -dist : dist;
      // 整镜的时长都用来爬（含台词后的留白），爬完正好定格
      const span = Math.max(0.8, enterSeg.end - shotStart);
      const k2 = clamp((at - shotStart) / span);
      offX = from * (1 - k2);
      walking = k2 < 1 ? 1 : 0;
    }
  }

  const speaking = speakingAt(tl, at);
  const isSpeaker = speaking?.line.who === c.id;
  const punch = subtitleAt(tl, at)?.line.beat === 'punch';
  const punchSpeaker = tl.cfg.lines.find((l) => l.beat === 'punch')?.who;
  const isReactor = punchSpeaker !== c.id;

  // 口型：有配音用真包络，没有就用合成节奏
  let env = 0;
  if (isSpeaker && speaking) {
    const v = ctx.voices.get(speaking.index);
    if (v) {
      const f = Math.floor(speaking.local * FPS);
      env = v.env[Math.min(v.env.length - 1, Math.max(0, f))] ?? 0;
    } else {
      env = 0.45 + 0.45 * Math.abs(Math.sin(speaking.local * 7.4));
    }
  }

  // 上一帧的口型：只为判「是不是从闭直接跳到大张」，见下面的 mouthShape
  let prevEnv = 0;
  if (isSpeaker && speaking) {
    const v = ctx.voices.get(speaking.index);
    if (v) {
      const f = Math.floor(speaking.local * FPS) - 1;
      prevEnv = v.env[Math.min(v.env.length - 1, Math.max(0, f))] ?? 0;
    } else prevEnv = env;
  }
  const prevMouth = mouthFrom(prevEnv);

  const speed = c.rig === 'human' ? speedOf(c.proportion) : 1;

  // 反转之后：接梗的那个角色瞳孔放大 + 眉毛上扬 + 后仰 + 抖一下
  const reactT = tl.punchEnd - 0.15;
  const reacting = isReactor && at >= reactT;
  const sh = shake(at, reactT, 0.3, 3.0);

  // 说话中不眨眼：眨眼刚好压在笑点那一帧上会很别扭
  const eyes: CharState['eyes'] = reacting
    ? 'wide'
    : !isSpeaker && blinking(at * speed, cfgIndex + 1)
    ? 'closed'
    : 'normal';

  const brows: CharState['brows'] = reacting
    ? 'up'
    : isSpeaker && speaking?.line.beat === 'reply'
    ? 'down'
    : 'normal';

  // 反转句的说话者：伸出舌头（带豁口，这是本段子的梗）
  const showTongue = !isReactor && (punch || frozen);
  let tongue = showTongue ? smoothstep(tl.punchStart, tl.punchStart + 0.5, at) : 0;

  // 乌龟：同一个字段当"脖子伸出程度"用。
  // 默认缩着头（远看就是块礁石），第一次开口前 0.5s 才缓缓抬起来——
  // 「远处一块灰色的石头缓缓抬起头，是龟妈妈」这个梗全靠这一下。
  if (c.rig === 'turtle') {
    if (c.neck !== undefined) {
      tongue = c.neck;
    } else if (c.neckEmerge) {
      const firstLine = tl.segments.find((sg) => sg.kind === 'line' && sg.line?.who === c.id);
      tongue = firstLine ? smoothstep(firstLine.start - 0.5, firstLine.start + 0.35, at) : 1;
    } else {
      tongue = 1; // 默认头伸着
    }
  }

  const gesture: CharState['gesture'] = reacting
    ? 'facepalm'
    : isSpeaker && speaking?.line.beat === 'reply'
    ? 'shrug'
    : isSpeaker && speaking?.line.beat === 'punch'
    ? 'point'
    : 'down';

  return {
    id: c.id,
    x: (solo && !c.keepX ? W / 2 : baseX) + offX,
    y: slotY,
    scale: c.scale ?? (snake ? 1 : 1.25),
    facing,
    mouth: isSpeaker ? mouthFrom(env) : 0,
    /**
     * 闭 ↔ 大张之间垫一帧 E。
     *
     * 三态直接从一条细线跳到一个圆块，切换那一下会「啵」地弹出来。
     * 中间垫一帧就顺了 —— 只垫一帧，多了嘴就糊成一团。
     *
     * **按上一帧的包络判，不存状态**：渲染是多进程逐帧并行的，
     * 帧与帧之间没有共享内存，存状态在这儿一定是错的。
     */
    mouthShape: isSpeaker && Math.abs(mouthFrom(env) - prevMouth) === 2 ? 'E' : null,
    eyes,
    brows,
    bob: talkBob(at * speed, isSpeaker ? env : 0, 1.5 * speed) + (reacting ? -6 * smoothstep(reactT, reactT + 0.2, at) : 0),
    breath: breathe(at * speed, 2.4 / speed, 0.015 * (c.proportion === 'child' ? 1.5 : 1)),
    lean: reacting ? -7 * smoothstep(reactT, reactT + 0.25, at) : 0,
    shakeX: sh.x,
    shakeY: sh.y,
    opacity: visible ? 1 : 0,
    t: at,
    color: c.color ?? (isLeft ? P.secondary : P.primary),
    accent: P.light,
    tongue,
    tongueNick: showTongue,
    length: c.length,
    speech: isSpeaker ? env : 0,
    art: c.art,
    variant: c.variant,
    walking,
    gesture,
    proportion: c.proportion,
    hair: c.hair,
    props: c.props,
  };
}

/** 出封面时要接管镜头、关掉字幕、并在最上层贴东西 */
export interface FrameOverride {
  cam?: { zoom: number; tx: number; ty: number };
  /** 覆盖去色程度。封面必须传 0——灰帧在信息流里不跳眼 */
  desat?: number;
  hideSubtitle?: boolean;
  hideHook?: boolean;
  /** 追加到最上层的 SVG */
  overlay?: string;
}

/** 把舞台坐标换算成画面坐标（跟 layer(k=1) 的变换一致），封面贴符号要用 */
/** 某一刻、某个 x 上的地面高度。场景没实现 ground 就是平地 GROUND。 */
export function sceneGroundAt(tl: Timeline, t: number, x: number): number {
  const name = sceneAt(tl, Math.min(t, tl.freezeStart - 0.001));
  const layers = getScene(name)((c) => c, 41);
  return layers.ground ? layers.ground(x) : GROUND;
}

export function toScreen(cam: { zoom: number; tx: number; ty: number }, px: number, py: number) {
  return {
    x: cam.tx + cam.zoom * px + (W / 2) * (1 - cam.zoom),
    y: cam.ty * 0.3 + cam.zoom * py + (H / 2) * (1 - cam.zoom),
  };
}

export function renderFrame(ctx: RenderCtx, frame: number, ov: FrameOverride = {}): string {
  const { tl } = ctx;
  const t = frame / FPS;

  // 定格：整帧去色（不用 SVG 滤镜，直接换色，快很多）
  // 定格去色只属于 A 类。**B 类不去色**——beats/typeB.ts 开头就写明了：
  // 去色骤停是抖包袱的收尾手法，叙述型片子最后一帧突然变灰会把人吓醒，
  // 而收尾金句恰恰落在那一帧上。这条一直只写在注释里、没落到渲染，
  // 《小老鼠做蛋糕》和本片的片尾都灰了一次才发现。
  const freezeDesat = tl.cfg.type === 'B' ? 0 : 0.85;
  const desat = ov.desat ?? smoothstep(tl.freezeStart, tl.freezeStart + 0.18, t) * freezeDesat;
  const ink = makeInk(desat);

  const cam = ov.cam ?? camera(ctx, t);
  // 逐镜换场景：跟 stageAt 同一套归属规则（句间空白归下一镜），
  // 两者不一致的话会出现"人已经换镜了但背景还是上一个"
  const scene = getScene(sceneAt(tl, Math.min(t, tl.freezeStart - 0.001)))(ink, 41);

  const layer = (content: string, k: number) =>
    `<g transform="translate(${(cam.tx * k).toFixed(2)},${(cam.ty * k * 0.3).toFixed(2)}) scale(${(1 + (cam.zoom - 1) * k).toFixed(4)}) translate(${(
      (W / 2) * (1 / (1 + (cam.zoom - 1) * k) - 1)
    ).toFixed(2)},${((H / 2) * (1 / (1 + (cam.zoom - 1) * k) - 1)).toFixed(2)})">${content}</g>`;

  // 道具：跟角色同一个 stage 名单，画在角色之后（当前景）
  // ⚠ **不能只看 segAt 的返回值。** 句与句之间有 0.1 秒的空隙，那几帧不落在任何段里，
  // 而 segAt 找不到就**回退成最后一段**（也就是 hold）—— 于是每个句间空隙都被当成收尾卡，
  // 汗珠在正片里一闪一闪。实测出现在 1.25 / 5.00 / 8.50 秒，正好是三个空隙。
  // 所以两件事都要自己判：① 当前时刻是不是真在这一段里 ② 收尾按时间判，不按 kind 判。
  const seg = segAt(tl, t);
  const inSeg = t >= seg.start && t < seg.end;
  const inEnd = t >= tl.freezeStart;
  /** 这一刻在演的那一句（空隙里是 null）。眼神、漫符都从它来 */
  const curLine = inSeg ? (seg.line ?? null) : null;

  /**
   * 眼珠这一刻在哪，以及在不在眨眼。整条轨在 eyeTrack() 里排好（见文件上方）——
   * rig 只看得到当前时刻，排不了「什么时候该跳」。
   */
  const gaze = gazeAt(tl, t);
  const blink = blinkingAt(tl, t);
  /**
   * 闭目：稿子点名的那一次「受不了」。
   *
   * **跟眨眼是两回事** —— 超过 0.5 秒的闭眼读作忍耐/认命，是很重的情绪，
   * 全片最多一次。所以它由稿子指定，不由待机动作撞出来。
   */
  /**
   * 张着嘴、不出声：他想说什么，说不出来。
   *
   * 口型平时由配音包络驱动（没声音就闭着），**这是唯一一处手动把嘴掰开的地方**。
   * 二十多秒里观众已经学会「嘴在动＝有话」，这一下嘴动了没声音，那个空是响的。
   */
  const gaping = tl.segments.some((sg) => {
    const om = sg.line?.openMouth;
    if (!om || sg.kind !== 'line') return false;
    const a2 = sg.start + (sg.line!.dur ?? estimateDur(lineText(sg.line!)));
    return t >= a2 + 0.1 && t < a2 + 0.1 + om;
  });

  const closing = tl.segments.some((sg) => {
    const cl = sg.line?.closeEyes;
    if (!cl || sg.kind !== 'line') return false;
    const a = sg.start + (sg.line!.dur ?? estimateDur(lineText(sg.line!)));
    return t >= a + 0.06 && t < a + 0.06 + cl;
  });

  /**
   * 这一刻**正在被念出来**的那一句（不含 padAfter）。表情按它给。
   *
   * **不能用 curLine** —— 段的 end 是含 padAfter 的，按它给表情的话，
   * 他说完了表情还挂着，一直挂到下一句起头；而那段正是「他在想」的时候，
   * 眼珠该转圈的。表情和思考不能同时占着眼睛。
   */
  const spokenLine = speakingAt(tl, t)?.line ?? null;

  const onStage = ctx.forceStage ?? stageAt(tl, Math.min(t, tl.freezeStart - 0.001));
  const props = (tl.cfg.props ?? [])
    .filter((p) => onStage.includes(p.id))
    .map((p, i) => {
      const draw = PROPS[p.kind];
      if (!draw) return '';
      const sc = p.scale ?? 1;
      const sx = sc * (p.flip ? -1 : 1);
      const px = p.x ?? W / 2;
      // 道具的 y 是**相对地面的偏移**（默认 0 = 贴地，负数 = 架在半空/摞在别的道具上），
      // 不是绝对坐标。写绝对坐标的话换个斜坡场景就全飘起来了。
      const py = sceneGroundAt(tl, Math.min(t, tl.freezeStart - 0.001), px) + (p.dy ?? 0);
      return `<g transform="translate(${px.toFixed(1)},${py.toFixed(1)}) scale(${sx.toFixed(3)},${sc.toFixed(3)})">${draw(ink, 500 + i * 13)}</g>`;
    })
    .join('');

  const chars = tl.cfg.characters
    .map((c, i) => {
      const s = charStateFor(ctx, i, t, frame);
      if (c.rig === 'none') return '';
      // 定格表情：最后一句说完之后锁住的脸（张嘴 / 瞪眼）。
      // **必须在这儿覆盖**，charStateFor 里 mouth 是从配音包络算的，
      // 而定格时包络已经是 0，脸会自动闭上。
      // 稿子点名的眼神（不屑/斜视…）。**只给说这句话的那个角色**
      // 稿子点名的眼神。**小句可以自己点**（say[].look）—— 一个表情挂满
      // 一整句话就太久了，拆过屏的句子里几个小句本来就不是一个意思。
      if (spokenLine && spokenLine.who === c.id) {
        const sp2 = speakingAt(tl, t)!;
        const sg2 = tl.segments.find((x) => x.kind === 'line' && x.lineIndex === sp2.index);
        const d2 = spokenLine.dur ?? estimateDur(lineText(spokenLine));
        const pk = sg2 ? partAt(spokenLine, sg2.start, d2, t, { env: ctx.voices.get(sp2.index)?.env, fps: FPS, pace: getPace(tl.cfg.pace, 'banter') }).look : undefined;
        const lk = pk !== undefined ? pk : spokenLine.look;
        if (lk) s.look = lk;
      }
      if (c.rig === 'horse') {
        // 排好的扫视轨
        s.gaze = gaze;
        // 闭眼压过一切表情：闭着的时候没有眼珠可看，look 不起作用
        if ((blink || closing) && t < tl.freezeStart) {
          s.eyes = 'closed';
          s.look = undefined;
        }
        // 张嘴无声。**放在闭眼之后** —— 两件事同时来是「张着嘴睡着了」，
        // 而这一下要的是他睁着眼、张着嘴、什么都说不出来
        if (gaping && t < tl.freezeStart) {
          s.mouth = 2;
          s.mouthShape = null;
          s.eyes = 'normal';
        }
        // 扭头：只在点了 turn 的那一句，渐入渐出。硬切像抽搐。
        //
        // ⚠ **要遍历所有点了 turn 的句子，不能 `find` 一条。** 规范允许一条片子扭两次
        // （SCRIPT_GUIDE §四 / types.ts 的 `turn`）；早先这儿是 `find`，取到第一条之后
        // 就拿它的窗口去套整条时间轴 —— **第二次扭头一动都不动，而且不报错**。
        // 已出的七条各只有一次，所以一直没露。
        //
        // 各句的窗口互不重叠（每条只覆盖自己那一句 ±0.5s），取绝对值最大的那个即可：
        // 真要有两句挨得极近，也是「后一句压过前一句」，不会两个角度相加。
        for (const tu of tl.segments) {
          if (tu.kind !== 'line' || !tu.line?.turn || tu.line.who !== c.id) continue;
          const d = tu.line.dur ?? estimateDur(lineText(tu.line));
          const k = smoothstep(tu.start - 0.05, tu.start + 0.45, t) * (1 - smoothstep(tu.start + d - 0.2, tu.start + d + 0.5, t));
          const v = tu.line.turn * k;
          if (Math.abs(v) > Math.abs(s.turn ?? 0)) s.turn = v;
        }
      }
      if (tl.cfg.endPose && t >= tl.freezeStart) {
        if (tl.cfg.endPose.mouth !== undefined) s.mouth = tl.cfg.endPose.mouth;
        if (tl.cfg.endPose.eyes) s.eyes = tl.cfg.endPose.eyes;
      } // 旁白：只有声音，不出画面
      const sd = 100 + i * 37;
      return c.rig === 'human'
        ? human(s, ink, sd)
        : c.rig === 'turtle'
        ? turtle(s, ink, sd)
        : c.rig === 'mouse'
        ? mouse(s, ink, sd)
        : c.rig === 'cat'
        ? cat(s, ink, sd)
        : c.rig === 'still'
        ? still(s, ink, sd)
        : c.rig === 'horse'
        ? horseRig(s, ink, sd)
        : serpentine(s, ink, sd);
    })
    .join('');

  // ── 漫符 ──────────────────────────────────────────────────────────
  //
  // 挂在角色框上（`horseBox()` 是唯一出处），换站位、换缩放都不用重调。
  // 两个来源：这一句自己的 `line.marks`，和收尾卡那一段的 `cfg.endMark`。
  //
  // **落点定格那一段不出符号** —— 那一拍要的是「什么都不发生」。
  // 判据是 seg.kind：`freeze` 是落点定格，`hold` 才是收尾卡。
  const markChar = tl.cfg.characters.find((c) => c.rig === 'horse');
  let marks = '';
  if (markChar) {
    const mi = tl.cfg.characters.indexOf(markChar);
    const box = horseBox(charStateFor(ctx, mi, t, frame));
    const list = inEnd && tl.cfg.endMark ? [tl.cfg.endMark] : (curLine?.marks ?? []);
    marks = list
      .map((m) =>
        placeMark(m.name, m.spot ?? '右上', box, {
          size: m.size ?? 0.42,
          seed: m.seed ?? 5,
          tilt: m.tilt ?? 0,
        })
      )
      .join('');

    // 说话放射：**只在真正出声的那一段挂着**。
    //
    // 判据用 speakingAt 而不是 segAt：段的 end 是**含 padAfter 的**
    // （`end: end + padAfter`），按段判的话他早说完了、符号还在跳。
    // speakingAt 只认 [start, start + dur)，也就是配音波形真正在响的区间 ——
    // 句与句之间那 0.45 秒（padAfter 0.35 ＋ padBefore 0.1）符号就消失，
    // 那正好是「他停下来了」。
    //
    // **不往下细到配音包络。** 包络能把一句话内部的换气（say 的 gap，0.22–0.3 秒）
    // 也抠出来，但那 0.2 秒的一开一关在 30fps 下就是闪一下 ——
    // 而且句子内部换口气本来就还算「在说话」。
    //
    // **不能全程常亮。** 挂满 29 秒它就退化成一张装饰贴纸，而且落点那一下
    // 再没有额外的强调余地了。按 beat 分档：铺垫段关掉、转折弱给、落点给足 ——
    // 留白是为了让落点有东西可以亮。
    const sp = speakingAt(tl, t);
    if (sp && tl.cfg.speechBurst) {
      const by = tl.cfg.speechBurst.byBeat;
      const k = by ? by[sp.line.beat ?? 'setup'] ?? 1 : 1;
      if (k > 0) marks += speechBurst(t, box, { ...tl.cfg.speechBurst, size: (tl.cfg.speechBurst.size ?? 0.34) * k });
    }
  }

  // 字幕
  const sub = ov.hideSubtitle ? null : subtitleAt(tl, Math.min(t, tl.freezeStart - 0.001));
  let subtitle = '';
  if (sub && t < tl.freezeStart && tl.cfg.subtitleStyle === 'side') {
    // 侧边：排在角色的另一侧。角色框由 rig 给，列宽吃满剩下的地方再留边
    const ch = tl.cfg.characters.find((c) => c.id === sub.line.who);
    const box =
      ch && ch.rig === 'horse' ? horseBox(charStateFor(ctx, tl.cfg.characters.indexOf(ch), t, frame)) : null;
    const GAP = 44;
    const EDGE = 56;
    // 角色偏左就把字排右边，反之亦然
    const onRight = !box || box.x + box.w / 2 < W / 2;
    const colX = onRight ? (box ? box.x + box.w + GAP : W / 2) : EDGE;
    const colW = onRight ? W - EDGE - colX : (box ? box.x - GAP : W / 2) - EDGE;
    /**
     * **逐屏出，不整段预铺。**
     *
     * 原来是整句一次性打出来。铺垫句无所谓，转折句和落点句致命 ——
     * 观众三秒读完，后面几秒在听复述，**笑点在被听到之前就消费掉了**。
     * 首片 17–24 秒三行一次铺满，就是这个毛病。
     *
     * 现在跟着 say 的小句走：他念到哪一句，屏上就是哪一句。
     * 边界靠配音包络吸附到真正的静音处（见 partSpans），不是按字数瞎摊。
     */
    const seg2 = tl.segments.find((sg) => sg.kind === 'line' && sg.lineIndex === sub.index);
    const dur2 = sub.line.dur ?? estimateDur(lineText(sub.line));
    const part = seg2
      ? partAt(sub.line, seg2.start, dur2, t, { env: ctx.voices.get(sub.index)?.env, fps: FPS, pace: getPace(tl.cfg.pace, 'banter') })
      : { a: 0, b: 0, text: lineText(sub.line) };
    const shown = subtitleText({ ...sub.line, text: part.text, say: undefined });
    subtitle = sideText(shown, {
      colX,
      colW: Math.max(240, colW),
      // 竖直中心落在头和肩之间：字跟脸平齐才像「他在说」，落到脚边像旁白
      cy: box ? box.y + box.h * 0.34 : H * 0.42,
      ink,
      fontSize: 48,
      // 高亮只在**包含它的那一屏**上给，别的屏原样出
      highlight: sub.line.highlight && shown.includes(sub.line.highlight) ? sub.line.highlight : undefined,
    });
  } else if (sub && t < tl.freezeStart) {
    subtitle = dialogueStrip(
      subtitleText(sub.line),
      H - 300,
      ink,
      900 + sub.index * 7,
      sub.prog,
      sub.line.highlight,
      sub.line.annotation,
      tl.cfg.type === 'B' ? 46 : 64
    );
  }
  // 结尾钩子
  let hook = '';
  // 钩子跟定格**同时**出现：画面一冻、一去色，字就上来。
  // 早先是等到定格快结束才出（freezeStart + freeze - 0.3），
  // 中间那一两秒是纯灰画面没有信息，白占时长。
  if (!ov.hideHook && tl.cfg.hook && t >= tl.freezeStart) {
    const prog = clamp((t - tl.freezeStart) / 0.35);
    // 钩子是 CTA，不跟着定格去色，让它在灰调画面里跳出来
    // 侧边字幕那条线全程无衬底，收尾卡也不挂色块 —— 它正好落在定格去色那一帧上，
    // 全屏都灰了就它一块藏青，是整片里唯一一处「装饰」
    hook = hookStrip(tl.cfg.hook, 250, makeInk(0), 777, prog, tl.cfg.subtitleStyle === 'side');
  }

  // 片头卡：只在 intro 那段空镜上。放在字幕之后画，**不跟着推镜走**——
  // 它是贴在画面上的一层，不是场景里的东西，跟着镜头飘会露馅
  let card = '';
  const sr = tl.cfg.series;
  if (sr && t < (tl.cfg.intro ?? 2)) {
    card = seriesCard(sr.name, `第 ${String(sr.no).padStart(2, '0')} ${sr.unit ?? '页'}`, ink, 555, t / (tl.cfg.intro ?? 2));
  }

  /**
   * 片尾黑场。**画在最外面**，字幕、钩子、片头卡一起吞掉 ——
   * 黑场的意思是「片子关上了」，留一行字在黑里飘就不是关上，是没关严。
   *
   * 不做去色那样的换色，直接盖一层黑 —— 去色是「颜色抽走」，黑场是「灯灭了」，
   * 两回事，而且这一条片子两个都要：先褪色，再灭灯。
   */
  const fo = tl.cfg.fadeOut ?? 0;
  const black = fo > 0 ? clamp((t - (tl.duration - fo)) / fo) : 0;
  const veil = black > 0 ? `<rect width="${W}" height="${H}" fill="#000" opacity="${black.toFixed(3)}"/>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${ink(P.paper)}"/>
${layer(scene.far, 0.35)}
${layer(scene.mid, 0.7)}
${layer(chars + props + marks, 1.0)}
${layer(scene.near, 1.35)}
${subtitle}
${card}
${hook}
${ov.overlay ?? ''}
${veil}
</svg>`;
}

/** 只出一张静帧，用来快速看画面（不渲染整片） */
export function stillAt(ctx: RenderCtx, seconds: number): string {
  return renderFrame(ctx, Math.round(seconds * FPS));
}

export { estimateDur, segAt };

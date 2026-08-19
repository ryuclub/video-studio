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
import { dialogueStrip, hookStrip, seriesCard } from './subtitle.js';
import { breathe, blinking, clamp, easeOut, lerp, shake, smoothstep, talkBob, track, type Key } from './anim.js';
import { segAt, speakingAt, subtitleAt, estimateDur } from './beats/typeA.js';
import { subtitleText, type Timeline } from './types.js';
import { mouthFrom } from './audio/align.js';

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
    x: (solo ? W / 2 : baseX) + offX,
    y: slotY,
    scale: c.scale ?? (snake ? 1 : 1.25),
    facing,
    mouth: isSpeaker ? mouthFrom(env) : 0,
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
      if (c.rig === 'none') return ''; // 旁白：只有声音，不出画面
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
        : serpentine(s, ink, sd);
    })
    .join('');

  // 字幕
  const sub = ov.hideSubtitle ? null : subtitleAt(tl, Math.min(t, tl.freezeStart - 0.001));
  let subtitle = '';
  if (sub && t < tl.freezeStart) {
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
    hook = hookStrip(tl.cfg.hook, 250, makeInk(0), 777, prog);
  }

  // 片头卡：只在 intro 那段空镜上。放在字幕之后画，**不跟着推镜走**——
  // 它是贴在画面上的一层，不是场景里的东西，跟着镜头飘会露馅
  let card = '';
  const sr = tl.cfg.series;
  if (sr && t < (tl.cfg.intro ?? 2)) {
    card = seriesCard(sr.name, `第 ${String(sr.no).padStart(2, '0')} ${sr.unit ?? '页'}`, ink, 555, t / (tl.cfg.intro ?? 2));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${ink(P.paper)}"/>
${layer(scene.far, 0.35)}
${layer(scene.mid, 0.7)}
${layer(chars + props, 1.0)}
${layer(scene.near, 1.35)}
${subtitle}
${card}
${hook}
${ov.overlay ?? ''}
</svg>`;
}

/** 只出一张静帧，用来快速看画面（不渲染整片） */
export function stillAt(ctx: RenderCtx, seconds: number): string {
  return renderFrame(ctx, Math.round(seconds * FPS));
}

export { estimateDur, segAt };

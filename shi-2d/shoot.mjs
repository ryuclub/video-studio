/**
 * 石总 2D 口播 · 出帧
 *
 * 骨架的装配和驱动在 `shi-2d/rig.mjs` —— 2026-09-05 从美术那边搬进仓库了，
 * 因为他们换了 Illustrator 的导出设置，`make/build-rig.mjs` 读新素材出来是一片黑剪影。
 *
 * 动作和表情**都在素材库里**，不在代码里：
 *   shi-2d/素材库/动作.json     底座呼吸、走、站定、示意、手势拍、眼神微动
 *   shi-2d/素材库/表情.json     一个表情 = 眼珠＋眉＋眼睑＋嘴
 *   shi-2d/素材库/替身.json     稿子点名的动作素材还没有时，用哪一张顶上
 * 这份只做三件事：按配音包络和动作表把两个库**排到时间轴上**、过平滑、栅格化。
 *
 * ## 三条已经踩实的规矩
 *
 * 1. **抬手是「拍」，不是「段」。** 抬一下 1.12 秒就收回垂手，一句最多两拍。
 *    举着不放会显得僵，也会把注意力从字幕上拽走。数值在 `动作.json` 的「手势拍」。
 * 2. **口型要拿声音驱动，不能按拍子轮播。** 骨架自带的那套 SEQ 不看声音，
 *    静音时嘴照样在动。这儿按包络的逐帧响度分档挑（见 `LADDER`），低于 0.11 直接闭嘴。
 * 3. **所有值都过一层一阶低通。** 直接换姿势／换表情会「啪」地跳一下。
 *    低通要**逐帧推**，所以 `--probe` 抽帧时前面每一帧照算，只是不落盘。
 *
 * 用法：node shi-2d/shoot.mjs <项目目录> [--probe N]
 * 读 vo/manifest.json + envelope.json + 动作表.json，写 frames/f%05d.png
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { patch, face, EXPR } from './face.mjs';
import { buildFrame, makeBlinker } from './rig.mjs';
import { POSE, renderPose, 能说话, 会走, CANVAS as POSE_CANVAS } from './pose.mjs';
import { 换衬衫, 解析色, 配色表 } from './衬衫.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const DIR = process.argv[2];
if (!DIR) { console.error('要给项目目录'); process.exit(1); }

const LIB = JSON.parse(fs.readFileSync(
  new URL('./素材库/动作.json', import.meta.url), 'utf8'));

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'vo/manifest.json'), 'utf8'));
const env = JSON.parse(fs.readFileSync(path.join(DIR, 'envelope.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(DIR, '动作表.json'), 'utf8'));
const 替身 = JSON.parse(fs.readFileSync(
  new URL('./素材库/替身.json', import.meta.url), 'utf8'));

const FPS = env.fps, N = env.frames, SEGS = manifest.segments;

/**
 * 动作名落到素材上。两个库都认：骨架动作（`动作.json`）和定格姿势（`姿势.json`）。
 * 认不出来的先查替身表，再认不出来就**当场停**。
 *
 * ⚠ **这儿原来是 `LIB.动作[actName] || LIB.动作['站定']`** —— 名字写错、
 * 或者稿子照方案点了一个还没有素材的动作（「斜靠」「扶帽檐」），出来是个站着不动的
 * 骨架，**不报错、帧数照对、片子照合**，你只会觉得这一镜怎么这么木。
 * 一千四百多张帧渲完再发现，是这条线上最贵的一种返工。
 */
const 用了替身 = new Map();
function 认动作(name, i) {
  if (LIB.动作[name] || POSE[name]) return name;
  const s = !name?.startsWith('_') && 替身[name];
  if (s && (LIB.动作[s.用] || POSE[s.用])) { 用了替身.set(name, s); return s.用; }
  console.error(`\n第 ${i + 1} 句的动作「${name}」两个库里都没有，替身表里也没有。`);
  console.error(`  骨架动作：${Object.keys(LIB.动作).filter((k) => !k.startsWith('_')).join(' ')}`);
  console.error(`  定格姿势：${Object.keys(POSE).join(' ')}`);
  console.error(`  替身：${Object.keys(替身).filter((k) => !k.startsWith('_')).join(' ')}`);
  console.error('  素材到了就把 素材库/替身.json 里那一条删掉，稿子改成真名。');
  process.exit(1);
}

// 动作表以「逐句」为准，一句一行，读得出来谁配了什么
const ACT = plan.逐句.map((x, i) => 认动作(x.动作, i));
const EXP = plan.逐句.map((x, i) => {
  // 表情也一样是静默的：`EXPR[名字] || EXPR['中性']`，写错了脸就是平的
  if (EXPR[x.表情]) return x.表情;
  console.error(`\n第 ${i + 1} 句的表情「${x.表情}」库里没有。有的是：${Object.keys(EXPR).join(' ')}`);
  process.exit(1);
});
/**
 * 这一句把那条臂转多少度（只有单手插兜那一族有臂）。不写就是原画那个角度。
 *
 * **这是「换个姿势」，不是「做个动作」** —— 一整句都是这个角度，不会摆回来。
 * 臂是一整块、肘弯不了，所以摆幅再大也只是整条胳膊划弧；真要一拍还是用骨架的「示意」。
 * 超出 `姿势.json` 里那张的 `臂.可转` 会当场停（renderPose 里拦）。
 */
const ARM = plan.逐句.map((x, i) => {
  const a = x.臂 ?? 0;
  if (a && !POSE[ACT[i]]?.臂) {
    console.error(`\n第 ${i + 1} 句写了「臂: ${a}」，但「${ACT[i]}」没有臂 —— ` +
      `有臂的只有：${Object.keys(POSE).filter((n) => POSE[n].臂).join(' ')}`);
    process.exit(1);
  }
  return a;
});
/**
 * 这一期穿什么颜色的衬衫。不写就是原画那件粉的。
 * **一期一个颜色**（见 素材库/衬衫.json），换色是渲染时按色值替换，不是另存一份素材。
 */
const 衬衫 = plan.衬衫 ? 解析色(plan.衬衫) : null;
console.log(衬衫 ? `衬衫　${衬衫.名}　${衬衫.色}` : '衬衫　粉（原画那件，动作表里没写「衬衫」）');

/**
 * **每期换一个颜色。** 扫一眼同级的别期用过什么，撞了提醒一声。
 * ⚠ 只提醒，不拦 —— 撞色不是错，是「你可能忘了换」。真要重复用是允许的，
 * 拦下来只会逼人加一个 `--force` 之类的开关，那才是坏事。
 */
try {
  const 树 = path.dirname(path.resolve(DIR));
  const 用过 = fs.readdirSync(树, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_')
      && path.resolve(树, d.name) !== path.resolve(DIR))
    .map((d) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(树, d.name, '动作表.json'), 'utf8'));
        return [d.name, p.衬衫 || '粉'];
      } catch { return null; }
    })
    .filter(Boolean);
  const 我 = plan.衬衫 || '粉';
  const 撞 = 用过.filter(([, c]) => c === 我).map(([n]) => n);
  if (撞.length) console.log(`⚠ 衬衫「${我}」跟这几期撞了：${撞.join('　')}　—— 每期换一个颜色`);
  const 没用过 = Object.keys(配色表).filter((n) => n !== 我 && !用过.some(([, c]) => c === n));
  if (没用过.length) console.log(`　 还没用过的：${没用过.join('　')}`);
} catch { /* 成品树不在标准位置就算了，这只是个提醒 */ }

for (const [名, s] of 用了替身)                      // 注释里的 ** 是给页面看的，命令行上剥掉
  console.log(`替身　${名} → ${s.用}　差在：${s.差在.replace(/\*\*/g, '')}${s.等 ? `　等：${s.等}` : ''}`);

/* ---------- 画布 ---------- */
// 竖屏 1080×1920。精灵画布 1080×1600，合片时 overlay 到 y=380 —— **画布 y ＋380 ＝ 成片 y**。
// **画布尺寸跟 pose.mjs 共用一份** —— 骨架帧和定格姿势帧是同一串，尺寸不一致 ffmpeg 直接报错
//
// ⚠ **scale 和 feetY 是跟字幕带绑死的两个数。**（2026-09-05 按频道方案 §1.1 重定）
// 字幕带从 y235~390 挪到 **y300~560** 之后，原来的构图（全身头顶成片 419、脚底 1646）
// 会被字幕压脸。§1.1 给的角色可视区是**成片 y600~1560**，换算到画布是 y220~1180：
//   scale  1.30 → 1.04    骨架身高 922.5×1.04 = 960（＝1560−600）
//   feetY  1250 → 1180    脚底落在成片 1560
// 定格姿势那边是同一件事的另一半，在 `素材库/姿势.json` 的 `_机位` 里 ——
// **动一个必须回去核另一个**，两边对不上，切镜头时人会突然长高或者矮一截。
const CANVAS = { w: POSE_CANVAS.w, h: POSE_CANVAS.h, scale: 1.2488, feetY: 1372 };
const CX_HOME = 540;

/* ---------- 口型 ---------- */
// 响度分档挑口型。同一档里轮着换，不然嘴的形状一动不动只是大小在变
const LADDER = [
  { min: 0.72, keys: ['A', 'O', 'A'] },
  { min: 0.48, keys: ['O', 'E', 'A'] },
  { min: 0.28, keys: ['E', 'U', 'I'] },
  { min: 0.11, keys: ['I', 'M', 'E'] },
];
const viseme = (v, i) => {
  for (const r of LADDER) if (v >= r.min) return r.keys[i % r.keys.length];
  return 'rest';
};

/* ---------- 振子 ---------- */

/** 素材库里的 {基, 幅, 频, 相, 声} 求值。频写 "步" 的用走路相位 */
function osc(o, t, v, stepPh) {
  const base = o.基 ?? 0, amp = o.幅 ?? 0, ph = o.相 ?? 0;
  const w = o.频 === '步' ? stepPh * Math.PI * 2 : (o.频 ?? 0) * t + ph;
  return base + amp * Math.sin(w) + (o.声 ?? 0) * v;
}
const addOsc = (into, joints, t, v, stepPh) => {
  for (const [k, o] of Object.entries(joints || {})) into[k] = (into[k] ?? 0) + osc(o, t, v, stepPh);
};

/* ---------- 手势拍 ---------- */

const B = LIB.手势拍;
const BEAT_LEN = B.起秒 + B.停秒 + B.收秒;

/** 排拍：哪一句在第几秒抬哪只手。左右轮着来 */
function scheduleBeats() {
  const out = [];
  let hand = 'L', last = -99;
  SEGS.forEach((s, i) => {
    const act = ACT[i];
    if (!LIB.动作[act]?.打拍) return;
    const D = s.duration;
    const spots = D >= B.给两拍的最短句长秒 ? [B.第一拍位置, B.第二拍位置] : [B.第一拍位置];
    for (const f of spots.slice(0, B.每句最多)) {
      const t0 = s.start + D * f;
      if (t0 + BEAT_LEN > s.end - 0.15) continue;      // 拍不能骑到下一句上
      if (t0 - last < B.两拍最短间隔秒) continue;
      // 强度跟这一拍那段声音的平均响度走
      const a = frameRange(t0, t0 + BEAT_LEN);
      out.push({ t0, hand, gain: B.强度跟声音走.底 + B.强度跟声音走.跟随 * a });
      last = t0;
      hand = hand === 'L' ? 'R' : 'L';
    }
  });
  return out;
}
function frameRange(a, b) {
  const i0 = Math.max(0, Math.round(a * FPS)), i1 = Math.min(N - 1, Math.round(b * FPS));
  let s = 0, n = 0;
  for (let i = i0; i <= i1; i++) { s += env.values[i] ?? 0; n++; }
  return n ? s / n : 0;
}
/** 一拍的包络：起（缓入）→ 停 → 收（缓出） */
function beatWeight(dt) {
  if (dt < 0 || dt > BEAT_LEN) return 0;
  if (dt < B.起秒) { const k = dt / B.起秒; return k * k * (3 - 2 * k); }
  if (dt < B.起秒 + B.停秒) return 1;
  const k = 1 - (dt - B.起秒 - B.停秒) / B.收秒;
  return k * k * (3 - 2 * k);
}

/* ---------- 眼神微动 ---------- */

/** 不说话时眼珠隔几秒瞟一下再回来。一直盯着镜头是最假的一处 */
function makeGazeDrift(seed = 11) {
  const G = LIB.眼神微动;
  let s = seed >>> 0, next = 1.8, at = -9, dx = 0, dy = 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return (t) => {
    if (t > next) {
      at = t;
      next = t + G.间隔秒[0] + rnd() * (G.间隔秒[1] - G.间隔秒[0]);
      dx = (rnd() * 2 - 1) * G.幅度[0];
      dy = (rnd() * 2 - 1) * G.幅度[1];
    }
    const d = t - at;
    if (d < 0 || d > G.持续秒) return [0, 0];
    const k = Math.sin((d / G.持续秒) * Math.PI);     // 出去再回来
    return [dx * k, dy * k];
  };
}

/* ---------- 逐帧 ---------- */

const segAt = (t) => {
  for (let i = 0; i < SEGS.length; i++) if (t < SEGS[i].end) return i;
  return SEGS.length - 1;
};

const blink = makeBlinker(7);
const drift = makeGazeDrift(11);
const beats = scheduleBeats();

const EASE = 0.22;          // 关节：约 0.15 秒摆到位
const EASE_F = 0.13;        // 表情：慢一点，约 0.3 秒 —— 换表情比换姿势更该「渐变」
const J = { y: 0, headRot: 0, nod: 0, featY: 0, armR: 0, armL: 0, elbowR: 0, elbowL: 0, cx: CX_HOME };
const F = { gx: 0, gy: 0, bl: 0, br: 0, lid: 0, mk: 0, mt: 0, on: 0 };
let inited = false;

// --probe N：只抽 N 张均匀分布的帧，先肉眼看构图和动作，别直接全渲
const probeN = process.argv.includes('--probe')
  ? Number(process.argv[process.argv.indexOf('--probe') + 1]) : 0;
const outDir = path.join(DIR, probeN ? 'frames-probe' : 'frames');
fs.mkdirSync(outDir, { recursive: true });
const wanted = probeN
  ? new Set(Array.from({ length: probeN }, (_, i) => Math.round((i + 0.5) * N / probeN)))
  : null;

// 走路的行进：从画面偏左走到中轴
// 骨架的「走」和会走的定格姿势（插兜走路）**共用同一条行进曲线** ——
// 这样开场无论用哪一套，入画的节奏、收脚的时机都是一样的
const walkSegs = ACT.map((a, i) => (a === '走' || 会走(a) ? i : -1)).filter((i) => i >= 0);
const walkEnd = walkSegs.length ? SEGS[walkSegs[walkSegs.length - 1]].end : 0;
const travel = { from: plan.入画起点 ?? 300, to: CX_HOME, t0: 0.2, t1: Math.max(1, walkEnd - 1.0) };

let stepPh = 0;
const t0ms = Date.now();

for (let f = 0; f < N; f++) {
  const t = f / FPS;
  const v = env.values[f] ?? 0;
  const seg = segAt(t);
  const actName = ACT[seg] || '站定';
  const act = LIB.动作[actName] || LIB.动作['站定'];   // 定格姿势没有骨架动作，底座照跑（低通不断，切回骨架时手是接得上的）

  // 走到位就收脚 —— 不踩着话尾急刹
  const walking = act.腿 === '循环' && t < travel.t1 + (act.收脚提前秒 ?? 0.65);
  if (walking) stepPh = (stepPh + 1 / FPS / (act.步长秒 || 1)) % 1;

  /* 关节目标 = 底座 + 说话叠加 + 动作 + 手势拍 */
  const tg = {};
  addOsc(tg, LIB.底座.关节, t, v, stepPh);
  if (v > LIB.说话叠加.起说阈) {
    const g = 0.4 + 0.6 * v;
    for (const [k, o] of Object.entries(LIB.说话叠加.关节)) {
      tg[k] = (tg[k] ?? 0) + osc(o, t, v, stepPh) * (k === 'nod' ? g : 1);
    }
  }
  if (walking) {
    addOsc(tg, act.关节, t, v, stepPh);
    tg.leg = ['A', 'stand', 'B', 'stand'][Math.floor(stepPh * 4) % 4];
    tg.y = tg.leg === 'stand' ? -4 : 0;
  } else {
    addOsc(tg, (LIB.动作[actName]?.腿 === '循环' ? LIB.动作['站定'] : act).关节, t, v, stepPh);
    tg.leg = 'stand';
  }
  for (const b of beats) {
    const w = beatWeight(t - b.t0);
    if (!w) continue;
    const jit = B.抬到峰值时的抖动;
    const wob = w * (jit.幅 ?? 0) * Math.sin(t * (jit.频 ?? 0));
    const g = w * b.gain;
    if (b.hand === 'L') { tg.armL = (tg.armL ?? 0) - B.肩 * g - wob; tg.elbowL = (tg.elbowL ?? 0) - B.肘 * g; }
    else { tg.armR = (tg.armR ?? 0) + B.肩 * g + wob; tg.elbowR = (tg.elbowR ?? 0) + B.肘 * g; }
  }
  const k = Math.max(0, Math.min(1, (t - travel.t0) / (travel.t1 - travel.t0)));
  tg.cx = walkSegs.includes(seg) ? travel.from + (travel.to - travel.from) * (k * k * (3 - 2 * k)) : CX_HOME;
  // 底座那条 x 是**重心左右转移** —— 站着说话时人是活的靠这个，不是靠手在那儿摆
  tg.cx += tg.x ?? 0;

  /* 表情目标 */
  const e = EXPR[EXP[seg]] || EXPR['中性'];
  const [dx, dy] = v > 0.2 ? [0, 0] : drift(t);      // 说到起劲的时候不瞟眼
  const ftg = {
    gx: e.gaze[0] + dx, gy: e.gaze[1] + dy,
    bl: e.brow[0], br: e.brow[1], lid: e.lid,
    mk: e.mouth ? e.mouth[0] : 0, mt: e.mouth ? e.mouth[1] : 0,
    on: e.mouth ? 1 : 0,
  };

  if (!inited) { Object.assign(J, tg); Object.assign(F, ftg); inited = true; }
  for (const key of Object.keys(J)) J[key] += ((tg[key] ?? 0) - J[key]) * EASE;
  for (const key of Object.keys(F)) F[key] += ((ftg[key] ?? 0) - F[key]) * EASE_F;

  const bl = blink(t);
  const pose = {
    y: J.y, headRot: J.headRot, nod: J.nod, featY: J.featY,
    armR: J.armR, armL: J.armL, elbowR: J.elbowR, elbowL: J.elbowL,
    leg: tg.leg,
    blink: 0.001,                                   // 眼睑交给表情层统一管，见下
    mouth: viseme(v, Math.floor(t / 0.105)),
  };
  // 眨眼和表情的眼睑是同一组，取大的那个
  const lid = Math.max(bl, F.lid);
  const svg = face(patch(buildFrame(pose)), {
    gaze: [F.gx, F.gy], brow: [F.bl, F.br], lid,
    mouth: F.on > 0.35 ? [F.mk, F.mt] : null,
  });

  if (wanted && !wanted.has(f)) continue;   // 低通要逐帧推，所以前面照算，只是不落盘

  // 这一句配的是**定格姿势**（美术单独画的整张图）而不是骨架动作 —— 直接换镜头。
  // 口型和眨眼能驱动（补丁盖住原画的嘴眼再画），**关节动不了** —— 手的姿势是画死的，
  // 所以一张姿势最多占一两句，占久了人就僵在那儿。
  // 切镜头**尽量踩在换背景那一句上**：同景别硬切姿势会像跳帧，跟着换景才读成剪辑。
  if (POSE[actName]) {
    const 全身 = POSE[actName].机位 === '全身';
    // **只喂真正的眨眼，不要把表情的眼睑掺进来。**
    // 表情的眼睑是骨架的概念（半睁＝疲惫／怒目），定格姿势的脸是画死的、
    // 自带表情了；再叠一层「盖住上眼睑」只会让人一直半睁着眼。
    // 这一句里推进到哪儿了 —— 拿来做缓推，定格图放四五秒不推会「冻住」
    const 进度 = Math.max(0, Math.min(1, (t - SEGS[seg].start) / SEGS[seg].duration));

    // 会走的姿势（目前只有 插兜走路）：两相对倒 ＋ 身体上下颠。
    // ⚠ **只有两相，没有中间的过渡相** —— 骨架那套是三张腿姿轮换，这个只能左右对倒，
    // 靠身体的颠来补那口气。所以步长别给太快，1 秒一个完整周期（两步）差不多。
    let 腿 = null, 相 = 0, 走dx = 0, 走dy = 0;
    if (会走(actName) && walkSegs.includes(seg)) {
      const P = POSE[actName];
      // 两套走法共用同样三个数（步长秒／颠幅／收脚提前秒）：
      //   `腿` = 换腿（整片自带一相 ＋ 另一相单独一张，插兜走路那套）
      //   `相` = **整片轮换**（三张同源导出的整片，插兜侧走那套）
      const L = P.腿 || P.相;
      // 行进用**跟骨架同一条曲线**（travel），不是每句各走各的 ——
      // 每句自己 smoothstep 的话，句尾减速、下句又加速，走起来一顿一顿
      走dx = travel.from + (travel.to - travel.from) * (k * k * (3 - 2 * k)) - CX_HOME;
      // 走到位就收脚。**站着不动的时候腿要停在整片自带的那一相**，
      // 那一相本来就是「一脚略前」的姿态，当站姿看也说得过去
      if (t < travel.t1 + (L.收脚提前秒 ?? 0.35)) {
        const ph = (t % (L.步长秒 || 1)) / (L.步长秒 || 1);
        if (P.相) {
          // 三张整片乒乓着轮（1→2→3→2），顺序写在库里的 `序` 里 ——
          // 三张画的是「落地／过渡／大跨」，来回走一趟正好是一个完整步循环
          const 序 = P.相.序 || P.相.张.map((_, i) => i);
          相 = 序[Math.min(序.length - 1, Math.floor(ph * 序.length))];
        } else {
          腿 = ph < 0.5 ? null : '右';
        }
        // ⚠ **换相那套颠幅默认是 0** —— 三张的身子在竖直方向完全不动，
        // 走路的起伏本来就画在腿里了，再叠一层会变成人在跳
        走dy = -(L.颠幅 ?? (P.相 ? 0 : 6)) * Math.abs(Math.sin(ph * Math.PI * 2));
      }
    }
    let svg = renderPose(actName, {
      t, blink: bl, zoom: 1 + 0.035 * 进度, 腿, 相, 臂角: ARM[seg], dx: 走dx, dy: 走dy,
      mouth: 能说话(actName) ? viseme(v, Math.floor(t / 0.105)) : null,
      // 定格姿势也吃表情，但**只有眉毛和嘴角这两根杠杆** ——
      // 眼珠和眼睑动不了（脸是画死的），所以表情表里的那两项在这儿自动失效
      expr: { brow: [F.bl, F.br], mouth: F.on > 0.35 ? [F.mk, F.mt] : null },
    });
    if (全身) {
      // 全身机位要跟骨架共用同一条地平线，影子也得有，不然切过去人突然浮起来
      svg = svg.replace(/(<svg[^>]*>)/,
        `$1<defs><radialGradient id="shp"><stop offset="0" stop-color="#000" stop-opacity="0.5"/>` +
        `<stop offset="0.55" stop-color="#000" stop-opacity="0.22"/>` +
        `<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
        // ⚠ 影子要跟着 走dx 一起挪 —— 写死 540 的话人走出去了影子还钉在中间
        `<ellipse cx="${(540 + 走dx).toFixed(1)}" cy="${CANVAS.feetY - 6}" rx="150" ry="26" fill="url(#shp)"/>`);
    }
    fs.writeFileSync(path.join(outDir, `f${String(f).padStart(5, '0')}.png`),
      new Resvg(换衬衫(svg, 衬衫?.色), { font: { loadSystemFonts: false } }).render().asPng());
    if (f % 150 === 0) process.stdout.write(`\r${f}/${N}`);
    continue;
  }

  const tx = J.cx - 222 * CANVAS.scale;
  const ty = CANVAS.feetY - 922 * CANVAS.scale;
  // 脚下一块接地阴影。没有它人像是贴上去的浮在背景前面。
  // 用径向渐变做，**别用 feGaussianBlur** —— resvg 的滤镜支持不全，糊不糊要看运气
  const shadow =
    `<defs><radialGradient id="sh"><stop offset="0" stop-color="#000" stop-opacity="0.5"/>` +
    `<stop offset="0.55" stop-color="#000" stop-opacity="0.22"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
    `<ellipse cx="${J.cx.toFixed(1)}" cy="${CANVAS.feetY - 6}" rx="150" ry="26" fill="url(#sh)"/>`;
  const wrapped = svg
    .replace(
      /<svg([^>]*)viewBox="[^"]*"([^>]*)>/,
      `<svg$1width="${CANVAS.w}" height="${CANVAS.h}" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}"$2>` +
      shadow +
      `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${CANVAS.scale})">`,
    )
    .replace(/<\/svg>\s*$/, '</g></svg>');

  fs.writeFileSync(path.join(outDir, `f${String(f).padStart(5, '0')}.png`),
    new Resvg(换衬衫(wrapped, 衬衫?.色), { font: { loadSystemFonts: false } }).render().asPng());

  if (f % 150 === 0) process.stdout.write(`\r${f}/${N}`);
}

console.log(`\r${N}/${N}  ${((Date.now() - t0ms) / 1000).toFixed(1)}s  -> ${outDir}`);
console.log(`手势拍 ${beats.length} 次：` +
  beats.map((b) => `${b.t0.toFixed(1)}s${b.hand}`).join('  '));

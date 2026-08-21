// ── 出片前体检：把"能跑但结果不对"的情况拦在最前面 ────────────────────
//
// 这条管线最贵的失败模式不是报错，是**静默出错画面**——场景名写错会回退、
// 角色音色撞车不影响渲染、punch 多标一个也照样出片。等看到成片才发现，
// 前面配音、对齐、渲染 400 多帧全白跑。所以 voice / build / preview 起手都先跑这个。

import { SCENE_NAMES } from './scenes/index.js';
import { CASTS, DELIVERIES } from './cast.js';
import { PROP_KINDS } from './props/index.js';
import { lineText, type JokeCfg } from './types.js';
import { check as layoutCheck } from './layout.js';
import { hasRubberband } from './audio/morph.js';

export interface Issue {
  level: 'error' | 'warn';
  msg: string;
}

const RIGS = ['serpentine', 'human', 'turtle', 'mouse', 'cat', 'none', 'still', 'horse'];

export function preflight(cfg: JokeCfg): Issue[] {
  const out: Issue[] = [];
  const err = (msg: string) => out.push({ level: 'error', msg });
  const warn = (msg: string) => out.push({ level: 'warn', msg });

  // ── 环境能力：换机器最容易栽的一条 ──
  //
  // rubberband 是 ffmpeg 的**编译期可选**滤镜，很多发行版没带（Windows 的
  // gyan.dev full build 带，别的构建不一定）。没有它，morph 会退化成单级重采样：
  // **pitch 和 formant 锁死，formant 被直接忽略**。
  //
  // 这不是"音质差一点"，是**换了个人在说话**——靠 formant 立起来的音色全废：
  // 女童（pitch 1.14 / formant 1.16，就是靠 formant 抬得比 pitch 多才像小女孩）、
  // 精灵（1.5 / 1.38）、童声（1.18 / 1.14）、反派（0.84 / 0.9）。
  //
  // 而 morph 只是把 degraded 返回出来、没人接，于是整件事**静默发生**。
  // 换机器（比如 Windows → Mac）后配音听着"怪但说不上哪怪"，多半就是这个。
  if (cfg.characters.some((c) => c.cast) && !hasRubberband()) {
    err('ffmpeg 没有 rubberband 滤镜，变声会退化：formant 被忽略，音色跟调好的不是一个人');
    err('  验证：ffmpeg -hide_banner -filters | grep rubberband —— 换一个带 librubberband 的构建再出片');
  }


  // ── 场景与角色资产：这一环最容易漏，漏了就是整片画面不对 ──
  if (!SCENE_NAMES.includes(cfg.scene)) {
    err(`场景 \`${cfg.scene}\` 还没做。可用：${SCENE_NAMES.join(' / ')}`);
  }
  for (const c of cfg.characters) {
    if (!RIGS.includes(c.rig)) err(`角色 ${c.id} 的骨架 \`${c.rig}\` 还没做。可用：${RIGS.join(' / ')}`);
    if (c.cast && !CASTS[c.cast] && !(c.cast.includes('-') && c.cast.endsWith('Neural'))) {
      err(`角色 ${c.id} 的音色 \`${c.cast}\` 不存在。跑 npm run cast 看有哪些`);
    }
    if (!c.cast) warn(`角色 ${c.id} 没指定 cast，会用默认的「青年女」`);
  }

  for (const pr of cfg.props ?? []) {
    if (!PROP_KINDS.includes(pr.kind))
      err(`道具 ${pr.id} 的画法 \`${pr.kind}\` 不存在。可用：${PROP_KINDS.join(' / ')}`);
  }

  // ── 音色撞车：对话类最致命的错，观众分不清谁在说话 ──
  const byCast = new Map<string, string[]>();
  for (const c of cfg.characters) {
    if (c.rig === 'none') continue; // 旁白不参与撞车检查
    const k = c.cast ?? '青年女';
    byCast.set(k, [...(byCast.get(k) ?? []), c.id]);
  }
  for (const [k, ids] of byCast) {
    if (ids.length < 2) continue;
    const msg = `${ids.join(' / ')} 都用了「${k}」`;
    // A 类是纯对话，观众只能靠声音分辨谁在说 → 撞车是硬错误。
    // B 类有旁白交代「一只小老鼠说」「另一只小老鼠说」，同族角色共用一个音色
    // 反而更自然（它们本来就是一个集体）→ 只提醒。
    if (cfg.type === 'A') err(`音色撞车：${msg}，观众分不清谁在说话`);
    else warn(`${msg}（B 类有旁白交代说话人，同族角色共用音色通常没问题）`);
  }

  // ── 节拍 ──
  // B 类是旁白叙述，没有笑点锚点，不检查 punch
  if (cfg.type === 'A') {
    const punches = cfg.lines.filter((l) => l.beat === 'punch');
    if (punches.length === 0) err('没有 punch 句。整条时间轴、BGM 骤停点、定格点都是从它推出来的');
    if (punches.length > 1) err(`有 ${punches.length} 句 punch，只能有一句`);
  }

  // ── 台词 ──
  cfg.lines.forEach((l, i) => {
    if (!cfg.characters.some((c) => c.id === l.who)) err(`第 ${i + 1} 句的 who=\`${l.who}\` 不在角色表里`);
    if (!lineText(l).trim()) err(`第 ${i + 1} 句没有台词（text 和 say 都是空的）`);
    const d = l.delivery;
    if (typeof d === 'string' && !DELIVERIES[d]) err(`第 ${i + 1} 句的念法 \`${d}\` 不存在`);
    l.say?.forEach((s, k) => {
      if (typeof s.delivery === 'string' && !DELIVERIES[s.delivery])
        err(`第 ${i + 1} 句第 ${k + 1} 小句的念法 \`${s.delivery}\` 不存在`);
    });
    if (l.highlight && !lineText(l).includes(l.highlight))
      warn(`第 ${i + 1} 句的 highlight「${l.highlight}」不在台词里，不会高亮`);
  });

  // ── 片头卡 ──
  // 卡是叠在 intro 上的，intro 太短就是"闪一下"。淡入 0.28 + 淡出 0.22 之外
  // 还得留住至少 1.5s 给人读完两行字
  if (cfg.series && (cfg.intro ?? 2) < 2.6) {
    warn(`有片头卡但 intro 只有 ${cfg.intro ?? 2}s，卡片一闪而过。系列规定 3 秒，写 "intro": 3`);
  }

  // ── 节奏 ──
  const tail = (cfg.freeze ?? 2) + (cfg.hold ?? 4);
  const spoken = cfg.lines.reduce((s, l) => s + (l.dur ?? 0), 0);
  if (spoken > 0) {
    const total = (cfg.intro ?? 2) + spoken + tail;
    if (tail / total > 0.35)
      warn(`定格后留白占全片 ${((tail / total) * 100).toFixed(0)}%，竖版短视频这段太长会掉完播率，考虑砍 hold`);
  }

  return out;
}

/** 打印体检结果。有 error 就返回 false，调用方应该停下 */
export function report(cfg: JokeCfg, where: string): boolean {
  const issues = preflight(cfg);
  // 站位是**量出来的**（单独光栅化每个角色/道具，取非透明像素包围盒），
  // 不是按 length/scale 估的——老鼠锚点就不在正中，估必错。
  // 撞车一律算 error：观众一眼能看见的东西被别的东西挡住，片子就是废的。
  for (const i of layoutCheck(cfg))
    issues.push({ level: i.level ?? 'error', msg: `站位：${i.line >= 0 ? `第${i.line}句 ` : ''}${i.msg}（跑 npm run layout -- <稿件> --fix 自动推开）` });
  if (!issues.length) return true;
  const errs = issues.filter((i) => i.level === 'error');
  console.log(`\n── ${where} 前体检 ──`);
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.msg}`);
  if (errs.length) {
    console.log(`\n${errs.length} 个问题必须先改，否则出来的片子是错的。\n`);
    return false;
  }
  console.log('');
  return true;
}

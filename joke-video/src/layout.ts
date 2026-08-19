// ── 站位：量出来，不是估出来 ────────────────────────────────────────
//
// 「老鼠和鸡蛋重叠了」「锅没在地上」这类问题反复出现，根子是**没有真实数据**：
// 配置里写 x=545、scale=0.62，谁也不知道画出来到底多宽、锚点在哪。
// 靠渲一张图、肉眼看、再挪几十像素——改一轮错一轮。
//
// 这里把两件事变成可计算的：
//
//   ① 每个角色/道具**实际占多宽** —— 单独光栅化一遍，量非透明像素的包围盒。
//      老鼠实测 [-138,+99]：**锚点不在正中**（原稿朝右，尾巴甩在左边），
//      按"半宽 = length/2"估必错。
//   ② 每一镜的 stage 名单摆下来**有没有撞车、有没有出画框**。
//
// solve() 再把撞车的自动推开。这样"重叠"就不再是一个需要人眼发现的问题。

import { Resvg } from '@resvg/resvg-js';
import { W, H, GROUND } from './config.js';
import { PROPS } from './props/index.js';
import { getScene } from './scenes/index.js';
import { human } from './rigs/human.js';
import { turtle } from './rigs/turtle.js';
import { mouse } from './rigs/mouse.js';
import { cat } from './rigs/cat.js';
import { still } from './rigs/still.js';
import { serpentine } from './rigs/serpentine.js';
import type { CharState } from './rigs/state.js';
import type { JokeCfg } from './types.js';

/** 相对锚点（脚底中心）的包围盒 */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const RIGS: Record<string, (s: CharState, ink: (c: string) => string, seed: number) => string> = {
  human,
  turtle,
  mouse,
  cat,
  still,
  serpentine,
};

const AX = W / 2;
const AY = GROUND;
const id = (c: string) => c;

/**
 * 左右安全边：舞台是 0..1080，但**推镜之后可视窗口更窄**。
 * zoom 1.06 时两边各少 540*0.06/1.06 ≈ 31px，留 45 有富余。
 *
 * 早先检查按舞台边界判，报告说"没出画框"，图上鼠甲的半个身子已经被切了。
 */
export const SAFE_X = 45;

/**
 * 头顶安全线（舞台坐标）。低于这个高度的东西会被画幅上边切掉。
 *
 * 由 toScreen 反算：zoom 1.06、ty 取上提极限 −192 时，
 * 屏幕 y=0 对应舞台 y ≈ 109。留到 120 有富余。
 *
 * 早先只查左右，hillrocks 那一镜老鼠的头被切掉一截，检查照样报"没问题"。
 */
export const SAFE_Y = 120;

/**
 * 单独渲一遍，量非透明像素的包围盒。
 *
 * 为什么不从 svg 几何直接算：rig 里有 path、rotate、mask、gradient，
 * 自己解析迟早算漏一块。光栅化一次几十毫秒，换的是**不会错**。
 */
function bbox(inner: string): Box {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  const img = new Resvg(svg, { background: 'rgba(0,0,0,0)' }).render();
  const { width, height } = img;
  const px = img.pixels;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0) return { left: 0, right: 0, top: 0, bottom: 0 };
  const sx = W / width;
  const sy = H / height;
  return { left: x0 * sx - AX, right: x1 * sx - AX, top: y0 * sy - AY, bottom: y1 * sy - AY };
}

const neutral = (over: Partial<CharState>): CharState =>
  ({
    x: AX,
    y: AY,
    facing: 1,
    t: 0,
    bob: 0,
    breath: 1,
    lean: 0,
    blink: 0,
    mouth: 0,
    brow: 0,
    opacity: 1,
    shakeX: 0,
    shakeY: 0,
    walking: 0,
    speech: 0,
    ...over,
  }) as CharState;

/** 量出这条片子里每个角色和道具的包围盒 */
export function measure(cfg: JokeCfg): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const c of cfg.characters) {
    const fn = RIGS[c.rig];
    if (!fn) continue; // rig:none 的旁白不出画面
    out.set(c.id, bbox(fn(neutral({ length: c.length, art: c.art } as Partial<CharState>), id, 100)));
  }
  for (const p of cfg.props ?? []) {
    const draw = PROPS[p.kind];
    if (!draw) continue;
    const sc = p.scale ?? 1;
    out.set(p.id, bbox(`<g transform="translate(${AX},${AY}) scale(${sc})">${draw(id, 500)}</g>`));
  }
  return out;
}

/** 配置里这个 id 的横坐标 */
function xOf(cfg: JokeCfg, key: string): number | null {
  const c = cfg.characters.find((c) => c.id === key);
  if (c) return c.x ?? null;
  const p = (cfg.props ?? []).find((p) => p.id === key);
  return p ? (p.x ?? W / 2) : null;
}

/**
 * 这个东西站在哪条地面上。
 * 场景实现了 ground() 就用它，否则回退到平地 GROUND。
 */
function groundY(cfg: JokeCfg, key: string, x: number): number {
  const line = cfg.lines.find((l) => (l.stage ?? []).includes(key));
  const g = getScene(line?.scene ?? cfg.scene)(id, 41).ground;
  const dy = (cfg.props ?? []).find((p) => p.id === key)?.dy ?? 0;
  return (g ? g(x) : GROUND) + dy;
}

/** 每一镜的 stage 名单（去重），带上第一次出现的句号 */
export function stages(cfg: JokeCfg): { key: string; ids: string[]; line: number }[] {
  const seen = new Set<string>();
  const out: { key: string; ids: string[]; line: number }[] = [];
  cfg.lines.forEach((l, i) => {
    const ids = (l.stage ?? cfg.characters.map((c) => c.id)).filter(
      (s) => cfg.characters.some((c) => c.id === s && c.rig !== 'none') || (cfg.props ?? []).some((p) => p.id === s)
    );
    const key = ids.join(',');
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ key, ids, line: i });
  });
  return out;
}

export interface LayoutIssue {
  line: number;
  msg: string;
  /** 默认 error。warn 是机器判断不了、需要人对一眼那类。 */
  level?: 'error' | 'warn';
}

/**
 * 查三件事：撞车、出画框、没站在地上。
 *
 * 「摞在别的道具上」是合法重叠（锅摞炉子），靠 PropCfg.stack 声明，检查时跳过。
 */
export function check(cfg: JokeCfg, boxes = measure(cfg)): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const stackOf = new Map<string, string>();
  for (const p of cfg.props ?? []) if (p.stack) stackOf.set(p.id, p.stack);

  for (const { ids, line } of stages(cfg)) {
    const items = ids
      .map((k) => {
        const b = boxes.get(k);
        const x = xOf(cfg, k);
        return b && x !== null ? { id: k, l: x + b.left, r: x + b.right } : null;
      })
      .filter((v): v is { id: string; l: number; r: number } => !!v)
      .sort((a, b) => a.l - b.l);

    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1];
      const b = items[i];
      if (stackOf.get(a.id) === b.id || stackOf.get(b.id) === a.id) continue;
      if (b.l < a.r) issues.push({ line, msg: `${a.id} 与 ${b.id} 重叠 ${Math.round(a.r - b.l)}px` });
    }
    // 纵向：站得太高会顶出画幅上边
    for (const k of ids) {
      const b = boxes.get(k);
      const xx = xOf(cfg, k);
      if (!b || xx === null) continue;
      const top = groundY(cfg, k, xx) + b.top;
      if (top < SAFE_Y) issues.push({ line, msg: `${k} 顶出画幅上边 ${Math.round(SAFE_Y - top)}px` });
    }

    const first = items[0];
    const last = items[items.length - 1];
    // 同样按裁切后的可视窗口判，别用舞台边界——舞台上没出框，图上照样被切掉
    const SAFE = SAFE_X;
    if (first && first.l < SAFE) issues.push({ line, msg: `${first.id} 出左画框 ${Math.round(SAFE - first.l)}px` });
    if (last && last.r > W - SAFE) issues.push({ line, msg: `${last.id} 出右画框 ${Math.round(last.r - (W - SAFE))}px` });
  }

  // 站不站在地上：现在角色和道具都按场景地面落脚，所以只可能错在
  // 道具的 dy 上（写成了绝对坐标那种旧值）
  for (const p of cfg.props ?? []) {
    const dy = p.dy ?? 0;
    if (Math.abs(dy) > 400) issues.push({ line: -1, msg: `道具 ${p.id} 的 dy=${dy} 太大，dy 是**相对地面**的偏移，不是绝对坐标` });
  }

  // 这条片子用到的每个场景，地面在哪。
  //
  // 没实现 ground() 的场景，角色一律站在平地 GROUND=1290 上。
  // 平地场景（grass/room）本来就该这样；但 hillside 是斜坡、hillrocks 是往下看，
  // 用回退值就会**悬在半空**——mouse-cake 的老鼠就这么飘在石头堆中间过。
  // 机器判断不了"这个场景的地板画在哪"，所以只报出来让人对一眼。
  const used = new Set<string>([cfg.scene, ...cfg.lines.map((l) => l.scene).filter((s): s is string => !!s)]);
  for (const name of used) {
    if (!getScene(name)(id, 41).ground)
      issues.push({ line: -1, level: 'warn', msg: `场景 ${name} 没实现 ground()，角色会站在平地 y=${GROUND} —— 确认这个场景的地板确实画在那个高度` });
  }
  return issues;
}

/**
 * 把撞车的推开。
 *
 * 松弛法：每一镜从左到右扫，重叠了就把两边各推一半；一个 id 在多镜里出现时
 * 取各镜要求的平均。反复几十轮基本收敛。收敛不了说明这一镜**东西太多了**
 * ——1080 宽横排放不下，那是内容问题，得从 stage 里撤东西，不是挪位置能救的。
 */
export function solve(
  cfg: JokeCfg,
  opts: { gap?: number; margin?: number; rounds?: number } = {}
): { x: Map<string, number>; rest: LayoutIssue[] } {
  const gap = opts.gap ?? 26;
  // 比 SAFE_X 再多留 3px：求解器最后会把 x 取整，正好卡在边界上会被判超 1px。
  const margin = opts.margin ?? SAFE_X + 3;
  const rounds = opts.rounds ?? 400;
  const boxes = measure(cfg);
  const stackOf = new Map<string, string>();
  for (const p of cfg.props ?? []) if (p.stack) stackOf.set(p.id, p.stack);

  const x = new Map<string, number>();
  for (const [k] of boxes) {
    const v = xOf(cfg, k);
    if (v !== null) x.set(k, v);
  }

  const st = stages(cfg);
  for (let round = 0; round < rounds; round++) {
    const push = new Map<string, { sum: number; n: number }>();
    const bump = (k: string, d: number) => {
      const e = push.get(k) ?? { sum: 0, n: 0 };
      e.sum += d;
      e.n++;
      push.set(k, e);
    };

    for (const { ids } of st) {
      const items = ids
        .filter((k) => boxes.has(k) && x.has(k))
        .map((k) => ({ id: k, b: boxes.get(k)!, x: x.get(k)! }))
        .sort((a, b) => a.x + a.b.left - (b.x + b.b.left));

      for (let i = 1; i < items.length; i++) {
        const a = items[i - 1];
        const b = items[i];
        if (stackOf.get(a.id) === b.id || stackOf.get(b.id) === a.id) continue;
        const over = a.x + a.b.right + gap - (b.x + b.b.left);
        if (over > 0) {
          bump(a.id, -over / 2);
          bump(b.id, over / 2);
        }
      }
      const f = items[0];
      const l = items[items.length - 1];
      if (f && f.x + f.b.left < margin) bump(f.id, margin - (f.x + f.b.left));
      if (l && l.x + l.b.right > W - margin) bump(l.id, W - margin - (l.x + l.b.right));
    }

    if (!push.size) break;
    for (const [k, e] of push) x.set(k, x.get(k)! + e.sum / e.n);
  }

  // 摞着的道具跟底座对齐
  for (const [top, base] of stackOf) if (x.has(base)) x.set(top, x.get(base)!);
  for (const [k, v] of x) x.set(k, Math.round(v));

  const applied: JokeCfg = {
    ...cfg,
    characters: cfg.characters.map((c) => (x.has(c.id) ? { ...c, x: x.get(c.id)! } : c)),
    props: (cfg.props ?? []).map((p) => (x.has(p.id) ? { ...p, x: x.get(p.id)! } : p)),
  };
  return { x, rest: check(applied, boxes) };
}

/** 打印报告，给 CLI 用 */
export function report(cfg: JokeCfg): number {
  const boxes = measure(cfg);
  console.log('实测包围盒（相对锚点=脚底中心）');
  console.log('  id          左    右    宽     顶');
  for (const [k, b] of boxes)
    console.log(
      `  ${k.padEnd(10)}${String(Math.round(b.left)).padStart(5)}${String(Math.round(b.right)).padStart(6)}` +
        `${String(Math.round(b.right - b.left)).padStart(6)}${String(Math.round(b.top)).padStart(7)}`
    );

  const g = getScene(cfg.scene)(id, 41).ground;
  console.log(`\n场景 ${cfg.scene} 的地面：${g ? `斜坡 ${Math.round(g(0))} → ${Math.round(g(W))}` : `平地 ${GROUND}`}`);

  console.log('\n每一镜的占位');
  for (const { ids, line } of stages(cfg)) {
    const items = ids
      .map((k) => {
        const b = boxes.get(k);
        const xx = xOf(cfg, k);
        return b && xx !== null ? `${k}[${Math.round(xx + b.left)},${Math.round(xx + b.right)}]` : null;
      })
      .filter(Boolean);
    console.log(`  第${String(line).padStart(2)}句  ${items.join(' ')}`);
  }

  const issues = check(cfg, boxes);
  if (!issues.length) {
    console.log('\n没有重叠、没有出画框。');
    return 0;
  }
  console.log(`\n${issues.length} 处问题：`);
  for (const i of issues) console.log(`  ${i.line >= 0 ? `第${i.line}句` : '配置'}  ${i.msg}`);
  return issues.length;
}

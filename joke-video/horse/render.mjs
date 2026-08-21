#!/usr/bin/env node
/**
 * 老马 · 分镜渲染入口
 *
 *   node render.mjs --list                 列出全部场景
 *   node render.mjs --demo                 每个场景各出一张，用来挑图
 *   node render.mjs shots.json             按分镜表批量出图
 *
 * shots.json 格式：
 * {
 *   "outDir": "out",
 *   "shots": [
 *     { "id": "s01", "scene": "office-desk", "seed": 3,
 *       "pose": { "eyeX": -14, "mouth": "A", "turn": -10 } },
 *     { "id": "s02", "scene": "elevator", "place": "近景半身",
 *       "pose": { "eyeX": 18 } }
 *   ]
 * }
 *
 * 字段都可省：place 不写就用场景自带的推荐站位，seed 不写默认 1，
 * pose 不写就是中性表情。
 *
 * 产出的是 SVG。转 PNG 交给你现有的渲染环节，再进 ffmpeg：
 *   ffmpeg -framerate 24 -i out/f%03d.png -c:v libx264 -pix_fmt yuv420p out.mp4
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scene, SCENES, PLACES, placeFor, W, H, GROUND, U } from "./scenes.mjs";
import { compose } from "./compose.mjs";
import { pose, lipsync, idleEyes } from "./horse-pose.mjs";
import { mark, MARKS, MARK_NAMES } from "./marks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HORSE = join(HERE, "horse_only.svg");

if (!existsSync(HORSE)) {
  console.error(`找不到 ${HORSE} —— 角色文件要和脚本放在同一目录`);
  process.exit(1);
}
const RAW = readFileSync(HORSE, "utf8");

/** 一张图 = 场景 + 摆好姿势的马 */
export function shot({ scene: name, seed = 1, place, pose: p = {}, bg = null, marks = [] }) {
  const background = bg ?? scene(name, seed);
  return compose({
    width: W, height: H,
    background: `data:image/svg+xml;base64,${Buffer.from(background).toString("base64")}`,
    horse: pose(RAW, p),
    place: place ? PLACES[place] : placeFor(name),
    marks,
  });
}

/** 一条片子的连续帧：口型 + 眼神游移自动铺满 */
export function sequence({ scene: name, seed = 1, place, syllables = [], fps = 24, turn = 0 }) {
  const mouths = lipsync(syllables, fps);
  const bg = scene(name, seed);          // 背景只生成一次，全帧复用
  return mouths.map((m, i) =>
    shot({
      scene: name, seed, place, bg,
      pose: { ...idleEyes(i, fps, seed), mouth: m, turn: turn * Math.sin(i / (fps * 0.8)) },
    })
  );
}

/* ─────────────── CLI ─────────────── */

const args = process.argv.slice(2);

if (args[0] === "--list") {
  const byCol = {};
  for (const [k, v] of Object.entries(SCENES)) (byCol[v.column] ??= []).push([k, v.label, v.stand]);
  console.log(`画布 ${W}×${H}　地平线 ${GROUND}　参考人高 ${U}\n`);
  for (const [col, rows] of Object.entries(byCol)) {
    console.log(`【${col}】`);
    for (const [k, label, stand] of rows) console.log(`  ${k.padEnd(15)} ${label}　站位:${stand}`);
    console.log();
  }
  console.log(`站位预设：${Object.keys(PLACES).join(" / ")}`);
  process.exit(0);
}

if (args[0] === "--marks") {
  // 符号一览：一张纸上摆全部漫符，缩到 320 也得认得出（跟封面 motif 同一条规矩）
  const cols = 5;
  const cell = 200;
  const rows = Math.ceil(MARK_NAMES.length / cols);
  const w = cols * cell;
  const h = rows * cell + 60;
  const body = MARK_NAMES.map((name, i) => {
    const cx = (i % cols) * cell + cell / 2;
    const cy = Math.floor(i / cols) * cell + cell / 2 + 20;
    return (
      mark(name, { size: 118, seed: i * 7 + 3, x: cx, y: cy }) +
      `<text x="${cx}" y="${cy + 76}" text-anchor="middle" font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif" ` +
      `font-size="22" fill="#6E6459">${name}　${MARKS[name].label.split(" · ")[1] ?? ""}</text>`
    );
  }).join("\n");
  writeFileSync(
    join(HERE, "marks.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#F1ECE0"/>${body}</svg>`
  );
  console.log(`${MARK_NAMES.length} 个漫符 -> marks.svg`);
  console.log(`用法：shots.json 里给某一镜加 "marks": [{ "name": "惊", "spot": "右上" }]`);
  console.log(`**一条 30 秒的片子最多 3 个，同一个不重复**（见 marks.mjs 顶上的用量规矩）`);
  process.exit(0);
}

if (args[0] === "--demo") {
  const outDir = join(HERE, "demo");
  mkdirSync(outDir, { recursive: true });
  for (const name of Object.keys(SCENES)) {
    writeFileSync(join(outDir, `${name}.svg`), shot({ scene: name, seed: 3, pose: { eyeX: -14, eyeY: 4 } }));
  }
  console.log(`每个场景一张，共 ${Object.keys(SCENES).length} 张 -> demo/`);
  process.exit(0);
}

if (!args[0]) {
  console.log("用法：node render.mjs --list | --demo | --marks | shots.json");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(args[0], "utf8"));
const outDir = join(HERE, spec.outDir ?? "out");
mkdirSync(outDir, { recursive: true });
let n = 0;
for (const s of spec.shots) {
  const id = s.id ?? `shot${String(++n).padStart(2, "0")}`;
  writeFileSync(join(outDir, `${id}.svg`), shot(s));
}
console.log(`${spec.shots.length} 张 -> ${outDir}/`);

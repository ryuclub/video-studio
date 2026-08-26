// ── 静态角色：直接用原稿 svg，不做骨架 ──────────────────────────────
//
// **旁白叙述型（B 类）的关键解锁。** 单一旁白讲故事时没人对口型，
// 角色只要能站在画面里、会呼吸、会随镜头轻微起伏就够了——
// 不需要为每个形象都写一套三态嘴 + 三态眼 + 四肢循环。
//
// 所以：素材库里**任何一张原稿，扔进来就能用**。
//   { "rig": "still", "art": "rabbit-white" }
//
// 代价：不能说话（没有口型）、不能眨眼。对话类（A 类）别用这个，
// 那边角色要开口，静态形象一眼假。

import { existsSync, readFileSync } from 'node:fs';
import { n } from '../style/papercut.js';
import { inkPaths } from '../svg-ink.js';
import type { CharState } from './state.js';

/** 原稿解析结果缓存：同一张图在 400 多帧里会被读很多次 */
const cache = new Map<string, { vx: number; vy: number; vw: number; vh: number; inner: string } | null>();

function load(art: string) {
  if (cache.has(art)) return cache.get(art)!;
  const file = art.includes('/') ? art : `assets/characters/${art}.svg`;
  if (!existsSync(file)) {
    cache.set(art, null);
    return null;
  }
  const raw = readFileSync(file, 'utf8');
  const vb = raw.match(/viewBox="([\d.\s-]+)"/);
  // **viewBox 前两个数不是 0 就得减掉**，见 roster.ts 里同一处的注释。
  const [vx, vy, vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1024, 1024];
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  const v = { vx, vy, vw, vh, inner };
  cache.set(art, v);
  return v;
}

export function still(s: CharState, ink: (c: string) => string, seed: number): string {
  const art = load(s.art ?? '');
  if (!art) return '';

  // 上色规则跟素材库共用一份（svg-ink.ts）—— 两边各写一份，已经漂过一次：
  // 预览只换 fill、正片 fill 和 stroke 都换。同一张原稿在两处长得不一样，
  // 素材库就不再是预览了。
  // gradient / mask 的 id 要带 seed，同一帧里两个同款角色才不会互相覆盖定义。
  const inked = inkPaths(art.inner, ink)
    .replace(/id="([^"]+)"/g, (_m, id) => `id="${id}_${seed}"`)
    .replace(/url\(#([^)]+)\)/g, (_m, id) => `url(#${id}_${seed})`);

  // 静态原稿没有嘴，说话时只能靠**轻微点头**表示"这句是我在说"。
  // 幅度压到 2 度出头——再大就成摇头晃脑了，跟"形象要一致、不要快闪"相冲。
  const nod = Math.sin(s.t * 7.2) * 2.3 * (s.speech ?? 0);

  const targetW = s.length ?? 420;
  const scale = targetW / art.vw;
  const mirror = s.facing === -1 ? -1 : 1;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY + s.bob * 0.6)}) ` +
    `scale(${n(scale * mirror)},${n(scale * s.breath)}) rotate(${n(-s.lean * 0.4 + nod)}) ` +
    `translate(${n(-art.vw / 2)},${n(-art.vh)}) translate(${n(-art.vx)},${n(-art.vy)})">` +
    inked +
    `</g>`
  );
}

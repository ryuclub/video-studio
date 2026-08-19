// ── 选角表护栏：改一个角色，别把别人改了 ──────────────────────────────
//
// 用法：
//   npm run cast:check            比对基线，动了谁就报出来（改动未确认时退出码 1）
//   npm run cast:check -- --update  确认这次改动，把基线更新到当前
//
// **不合成、不联网、不碰音频**，只对配置算指纹，一秒跑完。
//
// ── 为什么需要它 ──
//
// 选角表是**跨类型共享的基础库**：段子视频和说书都从这里取音色。而共享的
// 不只是这张表，还有底下的 TONE 预设：
//
//   TONE.aged      老爷爷 · 老太太 · 沙哑老头 · 说书的老道
//   TONE.raspy     沙哑老头 · 说书的乞丐
//   TONE.bright    童声 · 童声奶 · 女童 · 精灵 · 说书的艳鬼
//   TONE.broadcast 旁白
//
// 所以「把老道调沉一点」如果顺手改了 `TONE.aged`，**老太太会跟着变**，
// 而老太太在 jokes/ 里是活的——下次出片才会发现，那时候早忘了是这一改动的。
// DELIVERIES（叙缓/叙平/叙快…）同理，mouse-cake 的旁白挂着它们。
//
// ── 规矩 ──
//
//   ① 调一个角色，只改**它自己那一块**
//   ② 共享预设（TONE / DELIVERIES）**只读**。要不一样的音染就
//      **新增**一个预设，或者像「厉鬼」那样把滤镜链内联到角色自己身上
//   ③ 改完跑这个检查。它报出来的每一行都该是你**打算**改的那个角色，
//      多出来一行就是漏网的连带影响
//
// 指纹里连 TONE / DELIVERIES 的定义一起算，所以改了共享预设，
// 所有引用它的角色都会一起亮 —— 这正是要抓的那件事。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { CASTS, DELIVERIES } from './cast.js';
import { TONE } from './audio/morph.js';

const BASELINE = 'src/cast-baseline.json';

/** 稳定序列化：键排序，免得字段顺序一动指纹就变 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (o[k] !== undefined) acc[k] = canon(o[k]);
        return acc;
      }, {});
  }
  return v;
}

const fp = (v: unknown) => createHash('sha1').update(JSON.stringify(canon(v))).digest('hex').slice(0, 10);

/** 当前所有指纹。角色一条，共享预设各一条 */
export function fingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, c] of Object.entries(CASTS)) out[`cast:${name}`] = fp(c);
  for (const [name, d] of Object.entries(DELIVERIES)) out[`delivery:${name}`] = fp(d);
  for (const [name, t] of Object.entries(TONE)) out[`tone:${name}`] = fp(t);
  return out;
}

/** 哪些角色引用了这个共享预设 —— 报连带影响时要点名 */
function usersOfTone(tone: string): string[] {
  const src = readFileSync('src/cast.ts', 'utf8');
  const out: string[] = [];
  for (const block of src.split(/\n  (?=[一-龥A-Za-z]+: \{)/)) {
    const m = /^([一-龥A-Za-z]+): \{/.exec(block);
    if (!m) continue;
    // 只看真正的引用，注释里提到的不算
    const code = block.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (new RegExp(`TONE\\.${tone}\\b`).test(code)) out.push(m[1]);
  }
  return out;
}

function main() {
  const now = fingerprints();
  const update = process.argv.includes('--update');

  if (!existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
    console.log(`基线不存在，按当前状态建了一份：${BASELINE}`);
    console.log(`  ${Object.keys(now).length} 条（角色 ${Object.keys(CASTS).length} / 念法 ${Object.keys(DELIVERIES).length} / 音染 ${Object.keys(TONE).length}）`);
    return;
  }

  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, string>;
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const k of Object.keys(now)) {
    if (!(k in base)) added.push(k);
    else if (base[k] !== now[k]) changed.push(k);
  }
  for (const k of Object.keys(base)) if (!(k in now)) removed.push(k);

  if (!changed.length && !added.length && !removed.length) {
    console.log(`选角表跟基线一致（${Object.keys(now).length} 条）`);
    return;
  }

  if (added.length) {
    console.log(`\n新增 ${added.length} 条 —— 新增是安全的，不影响任何现存角色：`);
    for (const k of added) console.log(`  + ${k}`);
  }
  if (removed.length) {
    console.log(`\n删掉 ${removed.length} 条 —— 确认没有稿子还在引用：`);
    for (const k of removed) console.log(`  − ${k}`);
  }
  if (changed.length) {
    console.log(`\n改了 ${changed.length} 条：`);
    for (const k of changed) {
      console.log(`  ~ ${k}`);
      // 共享预设被改 = 连带影响，把受牵连的角色点出来
      const t = /^tone:(.+)$/.exec(k);
      if (t) {
        const users = usersOfTone(t[1]);
        console.log(`      ⚠ 这是共享音染，牵连 ${users.length} 个角色：${users.join(' / ')}`);
        console.log(`        只想改其中一个的话，把滤镜链内联到那个角色自己身上（「厉鬼」是现成的例子）`);
      }
      if (/^delivery:/.test(k)) {
        console.log(`      ⚠ 这是共享念法，jokes/ 的稿子直接按名字引用它，改了会串台`);
        console.log(`        只想给某一类用不同的数值的话，**新增**一档（如「说缓」），别改现有的`);
      }
    }
  }

  console.log(`\n上面每一行都该是你**打算**改的。多出来的就是连带影响。`);
  console.log(`确认无误：npm run cast:check -- --update`);

  if (update) {
    writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n');
    console.log(`\n已更新基线 ${BASELINE}`);
    return;
  }
  process.exitCode = 1;
}

main();

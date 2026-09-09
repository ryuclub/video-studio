#!/usr/bin/env node
/* ===========================================================================
   gao-2d/封面.mjs — 从成片里抽一帧当封面（Shorts 竖版）

   用法（cwd 一律是仓库根）：
     node gao-2d/封面.mjs                  全部有成片的稿件
     node gao-2d/封面.mjs nature_security  只出一条

   产物（跟成片同目录，**不进 git**，一条命令全回来）：
     projects/高总/<slug>/<slug>_cover.png      1080×1920，上传用
     projects/高总/<slug>/<slug>_cover_1x1.png  中心 1080×1080，**校验用**

   ── 为什么要多出一张 1x1 ──

   《YouTube 封面规范》§十一：Shorts 的首页卡片是**裁过的**，
   关键信息必须收进正中间的 1080×1080（y ∈ [420, 1500]），上下各 420px 是牺牲区。
   而这条线的画面里，页眉标题在 y≈300、来源角标在 y≈1570 —— **两样都在牺牲区**。
   机器判断不了「关键信息」是哪块，所以出一张裁好的让人眼看一遍。

   ── 选帧时间写在时间表里 ──

   `封面: { at: 2.6 }`（秒）。不写就取**第一个 DOC 块的 start + 2.5** ——
   标注是 1 秒画完的，2.5 秒时红框已经停稳。
   写进时间表而不是命令行参数，是为了可复现：换了素材重跑一条命令就回来。
   =========================================================================== */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const 根目录 = 'projects/高总';
const 只 = process.argv.slice(2).find((a) => !a.startsWith('--'));

const sh = (c, a) => {
  const r = spawnSync(c, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.error) throw new Error(`跑不起来 ${c}：${r.error.message}`);
  const code = r.status > 0x7fffffff ? r.status - 0x100000000 : r.status;
  if (code !== 0) throw new Error(`${c} 退出码 ${code}\n${r.stderr}`);
  return r;
};

const 稿件根 = 'gao-2d/稿件';
const slugs = 只 ? [只] : fs.readdirSync(稿件根).filter((d) =>
  fs.existsSync(path.join(稿件根, d, '时间表.mjs')));

let 出了 = 0;
for (const slug of slugs) {
  const 表 = path.join(稿件根, slug, '时间表.mjs');
  if (!fs.existsSync(表)) { console.error(`没有这条稿件：${slug}`); continue; }
  const cfg = (await import(pathToFileURL(path.resolve(表)).href)).default;
  const mp4 = path.join(根目录, slug, `${slug}.mp4`);
  if (!fs.existsSync(mp4)) { console.log(`${slug.padEnd(16)} 还没出片，跳过`); continue; }

  /* 选帧：时间表写了就用，没写就找第一个 DOC 块 */
  const doc = (cfg.timeline || []).find((s) => s.layer === 'DOC');
  const at = cfg.封面?.at ?? (doc ? +(doc.start + 2.5).toFixed(2) : 1);
  const 来自 = cfg.封面?.at != null ? '时间表指定' : doc ? `第 ${doc.id} 块 DOC + 2.5s` : '开头';

  const 全 = path.join(根目录, slug, `${slug}_cover.png`);
  const 方 = path.join(根目录, slug, `${slug}_cover_1x1.png`);
  sh('ffmpeg', ['-y', '-v', 'error', '-ss', String(at), '-i', mp4, '-frames:v', '1', 全]);
  /* 中心 1080×1080：y 从 420 起，正是规范 §十一 说的保留区 */
  sh('ffmpeg', ['-y', '-v', 'error', '-i', 全, '-vf', 'crop=1080:1080:0:420', 方]);

  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(`${slug.padEnd(16)} @${String(at).padStart(6)}s  ${来自.padEnd(18)}`
    + `  ${kb(全)}KB ＋ ${kb(方)}KB`);
  出了++;
}

if (出了) {
  console.log(`\n→ ${根目录}/<slug>/<slug>_cover.png　（1080×1920，上传用）`);
  console.log(`→ ${根目录}/<slug>/<slug>_cover_1x1.png　（中心裁切，**拿眼睛看一遍**：`);
  console.log('   页眉标题在 y≈300、来源角标在 y≈1570，这两样在 Shorts 首页卡片上会被裁掉，');
  console.log('   关键信息必须落在这张 1x1 里 —— 见《YouTube 封面规范》§十一）');
}

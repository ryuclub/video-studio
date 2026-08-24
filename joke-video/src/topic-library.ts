// ── 稿件库：每条线还有哪些选题没做 ───────────────────────────────────
//
// 醒木不响那张 index.html 的「稿件库」一栏从这儿取数。
//
// ── 为什么要单独一个文件 ──
//
// `xingmu-index.ts` 读的是**交付包**（做完的），这份读的是**选题文档**（还没做的）。
// 两头的数据源、解析方式、失效方式都不一样：
// 那边的东西不见了是「片子丢了」，这边的东西不见了是「文档改了版式」。
// 混在一个文件里，一个坏了另一个也会跟着看不出来。
//
// ── 一条原则：**只读，不存** ──
//
// 选题表的唯一出处是各条线自己的那份文档，这儿一个字都不复制。
// 文档改了标题、加了一期，重跑一次页面就跟上；
// **反过来，页面上看到的东西改不了文档** —— 要加选题去改那份 md。
//
// ⚠ **解析的是人写的 markdown，不是数据文件。** 所以每个解析器都要求
// 至少抓到一条，抓不到就报出来（`problems`）—— 版式被改过的时候，
// 「这一架是空的」和「这条线真没选题了」在页面上长得一模一样，
// 而前者是解析器坏了。**空着不报，就是又一个报成功的失败。**

import { readFileSync, existsSync } from 'node:fs';

/** 稿件库里的一条选题 */
export interface Topic {
  /** 期号 / 序号，如 `3` `L7` `E01` */
  no: string;
  /** 篇名 / 标题 / 书名。**同时是「做没做过」的匹配键** */
  name: string;
  /** 副标题 */
  sub?: string;
  /** 这一期的话题：说破句 / 道理落点 / 治愈点 —— 各线叫法不同，都是「讲什么」 */
  note?: string;
  /** 出处（原典、机制、作者年份） */
  src?: string;
  /** 这一条在文档里属于哪一组 */
  group?: string;
}

/** 一条线的一架选题 */
export interface Shelf {
  line: string;
  /** 这一架叫什么 */
  title: string;
  /** 出处文档，相对仓库根 */
  doc: string;
  /** 这一架的话题那一列是什么口径 */
  topicName: string;
  note?: string;
  items: Topic[];
}

const ROOT = '..';
const read = (rel: string) => (existsSync(`${ROOT}/${rel}`) ? readFileSync(`${ROOT}/${rel}`, 'utf8') : '');

/**
 * markdown 表格 → 每行的单元格。
 *
 * @param after 从哪个标题之后开始找。**必须给** —— 一份文档里好几张表，
 *   不锚定标题就会抓到别的那张，而且抓到了也不会报错。
 */
function mdTable(md: string, after: RegExp): string[][] {
  const lines = md.split('\n');
  let i = lines.findIndex((l) => after.test(l));
  if (i < 0) return [];
  const rows: string[][] = [];
  let started = false;
  for (i++; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) {
      if (started) break; // 表格结束
      if (/^#{2,3} /.test(l)) break; // 还没开始就撞上下一个标题 —— 这一节没有表
      continue;
    }
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c.replace(/:/g, '')))) {
      started = true; // 分隔行，下一行起是数据
      continue;
    }
    if (started) rows.push(cells);
  }
  return rows;
}

/** 去掉 markdown 的强调记号，页面上不需要 */
const plain = (s?: string) => (s ?? '').replace(/\*\*/g, '').replace(/`/g, '').trim();

// ── 说书（聊斋）：17 张选题卡 ────────────────────────────────────────
//
// 卡片长这样：`## 第 1 期《画皮》｜卷一`，底下是 说破 / 定位 / 分幕。
// 话题取**说破句** —— 那是「先定说破句，再挑故事」那条规矩的产物，
// 也就是这一期到底讲什么。没有说破的老卡片退回「定位」。
function liaozhai(): Shelf {
  const md = read('shuoshu/liaozhai-17-cards.md');
  const items: Topic[] = [];
  for (const m of md.matchAll(/^## 第 (\d+) 期《(.+?)》(?:｜(.+))?$/gm)) {
    const body = md.slice(m.index! + m[0].length).split(/^## /m)[0];
    const pick = (k: string) => new RegExp(`\\*\\*${k}\\*\\*[^：]*：(.+)`).exec(body)?.[1];
    items.push({
      no: m[1],
      name: m[2],
      src: m[3],
      note: plain(pick('说破') ?? pick('定位') ?? ''),
    });
  }
  return {
    line: '说书',
    title: '聊斋 17 期选题卡',
    doc: 'shuoshu/liaozhai-17-cards.md',
    topicName: '说破句',
    note: '一期一卡。**说破句先于扩写定下来** —— 顺序反了，想出来的一定是能印在日历上的通用话。',
    items,
  };
}

// ── 小故事大道理（禅佛典）：24 期标题表 ──────────────────────────────
//
// ⚠ **不读 `禅佛典向_旁白书目_选题稿件.md` 的 §五 首月 12 期。**
// 那一份开篇就写着「本文替换前一版的 §二书目重心、§三结构、§五排期」——
// 心经、信心铭那批抽象文本不再单独成期，降级成了每期收束处的那一句引文。
// 把那张作废的排期列出来，等于给人一堆做不了的选题。
function chan(): Shelf {
  const md = read('zhiyu/禅佛典向_小故事大道理_书目与稿件.md');
  const items = mdTable(md, /^## 四、24 期标题表/).map((c) => ({
    no: c[0],
    name: plain(c[1]),
    sub: plain(c[2]),
    src: plain(c[3]),
    note: plain(c[4]),
  }));
  return {
    line: '小故事大道理',
    title: '24 期标题表',
    doc: 'zhiyu/禅佛典向_小故事大道理_书目与稿件.md',
    topicName: '道理落点（只一条）',
    note: '**一期只给一条道理。** 收束那句经文是固定仪式，也是这条线的识别点。',
    items,
  };
}

// ── 心理洞察：清单体 24 期 ＋ 题库 ───────────────────────────────────
//
// 两架分开：**9.4 那 24 期是排好的**（标题定了、取向定了），
// §四 题库是**还没立项的**（文档原话：「标了机制和出处的可以直接立项；
// 没标的是句子先成立、还没找到能撑住它的文本」）。
// 合成一架的话，「明天就能写」和「还差一个文本」会混在一起。
function xinliList(): Shelf {
  const md = read('zhiyu/心理洞察向_书目与稿件.md');
  const items = mdTable(md, /^### 9\.4 24 期标题/).map((c) => ({
    no: c[0],
    name: plain(c[1]),
    note: plain(c[2]),
  }));
  return {
    line: '心理洞察',
    title: '清单体 24 期（已排标题）',
    doc: 'zhiyu/心理洞察向_书目与稿件.md',
    topicName: '取向',
    note: '⚠ **这条线不进档期**（稿子写不好，加档囤稿都解决不了）。已出的两期是现象型，不在这张表上。',
    items,
  };
}

function xinliBank(): Shelf {
  const md = read('zhiyu/心理洞察向_书目与稿件.md');
  const items: Topic[] = [];
  // 题库按模子分组，每组一张表。
  //
  // ⚠ **这一节要先掐到下一个 `###` 为止。** 直接 `split('### 题库')[1]` 拿到的是
  // 「题库到文档末尾」—— 最后一个 `####` 分组会一路吞掉后面 §9.4 那张 24 期表
  // 和别的表，题库凭空多出五十条。**不报错，就是数字不对**，
  // 而「题库有多少条」正是这一栏要回答的问题。
  const sec = (md.split(/^### 题库/m)[1] ?? '').split(/^### /m)[0];
  for (const g of sec.split(/^#### /m).slice(1)) {
    const group = plain(g.split('\n')[0]);
    for (const c of mdTable(`#### ${g}`, /^#### /)) {
      items.push({ no: '', name: plain(c[0]), note: plain(c[1]), src: plain(c[2]), group });
    }
  }
  return {
    line: '心理洞察',
    title: '题库（还没立项）',
    doc: 'zhiyu/心理洞察向_书目与稿件.md',
    topicName: '机制',
    note: '**标了机制和出处的可以直接立项**；机制写 `—` 的是句子先成立、还没找到能撑住它的文本。',
    items,
  };
}

// ── 治愈系：书目 20 本 ───────────────────────────────────────────────
//
// 这条线的单位是**一本书**不是一期：一本可能出上下两期（方丈记），
// 也可能一期一题连载十几期（陶庵梦忆 127 则 → 约 14 期）。
// 所以这一架列的是「还有哪些书可以做」，不是「还有哪些期」。
function zhiyu(): Shelf {
  const md = read('zhiyu/治愈系旁白书目_选题稿件.md');
  const items: Topic[] = [];
  let group = '';
  for (const line of md.split('\n')) {
    const g = /^## ([一二三四五六七八九十]+、.+)$/.exec(line);
    if (g) group = plain(g[1]);
    const m = /^### (\d+)\. 《(.+?)》(.*)$/.exec(line);
    if (m) items.push({ no: m[1], name: m[2], src: plain(m[3]), group });
  }
  // 治愈点 / 画面可承载度那两条挂在书名底下的列表里
  for (const it of items) {
    const body = md.split(new RegExp(`^### ${it.no}\\. 《${it.name}》`, 'm'))[1]?.split(/^### /m)[0] ?? '';
    it.note = plain(/\*\*治愈点\*\*：(.+)/.exec(body)?.[1] ?? '');
    const load = /\*\*画面可承载度\*\*：([★☆]+)/.exec(body)?.[1];
    if (load) it.sub = `画面 ${load}`;
  }
  return {
    line: '治愈',
    title: '旁白书目 20 本',
    doc: 'zhiyu/治愈系旁白书目_选题稿件.md',
    topicName: '治愈点',
    note: '**单位是一本书，不是一期**（陶庵梦忆一本约 14 期）。制作顺序 2026-08-21 起中国类优先，理由在文档开头。',
    items,
  };
}

/**
 * 全部选题架。**空的那一架会被报出来** —— 见文件头那段：
 * 解析的是人写的 markdown，版式一改就抓不到，而抓不到跟「真没选题了」长得一样。
 */
export function shelves(): { shelves: Shelf[]; problems: string[] } {
  const all = [liaozhai(), chan(), xinliList(), xinliBank(), zhiyu()];
  const problems = all
    .filter((s) => !s.items.length)
    .map((s) => `稿件库「${s.line} · ${s.title}」一条都没解析出来 —— 多半是 ${s.doc} 的版式改了`);
  return { shelves: all, problems };
}

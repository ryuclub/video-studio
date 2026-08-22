// ── 线路表：三条线的差别全在这一份里 ──────────────────────────────────
//
// 治愈（旁白书）、心理洞察（现象型）和禅佛典（小故事大道理）
// **跑的是同一条管线**（`zhiyu-*.ts`），靠 `--line` 分流。
// 这份是「它们有什么不一样」的**唯一出处**。
//
// 第三条线（禅佛典，2026-08-21）加进来的时候，这张表兑现了它的承诺：
// 除了「实现」那一类（新镜位画在 `zhiyu-scene.ts`、新体检写成
// `chan-check.ts`、封面 series 与 motif 注册进 `xinli-cover.ts`），
// **值那一层只往这儿加了一项** —— 没有再去六个文件里各改一处。
//
// ── 为什么要有这张表 ──
//
// 加第二条线的时候，差异是这么散出去的：
//
//   `zhiyu-episode.ts`   `if (LINE === '心理')`  ← 线路名字面量
//   `zhiyu-publish.ts`   `LINE === '心理' ? … : …`  ← 又一个
//   `zhiyu-episode.ts`   `const CAST = '夜读'`
//   `zhiyu-listen.ts`    `const CAST = '夜读'`   ← 同一个值抄了两份
//   `zhiyu-check.ts`     `const CPM = 226`
//   `xinli-check.ts`     `const CPM = 258`      ← 同一个概念散在两处
//
// 抄两份的下场这个仓库写过很多遍了（`zhiyu-audio.ts` 顶上那句
// 「不要各抄一份，一旦分叉，试听件和成片就不是一个声音了」）。
// **加第三条线的时候，应该是往这张表里加一项，而不是再去六个文件里各改一处。**
//
// ── 什么能进这张表，什么不能 ──
//
// 能进的是**值**：目录、音色、语速、缺省床音、色板、产物名。
//
// 不能进的是**实现**：镜位怎么画（SVG 函数，住在 `zhiyu-scene.ts`）、
// 封面什么版式（两套骨架，不是同一版式换值）、体检查哪些规则
// （`xinli-check.ts` 里那些语义判断）。
// 这些只能**按名字注册** —— 表里放一个键，实现方自己拿键去取。
// 硬把它们塞成参数会做出一个「什么都能配、什么都配不对」的东西。

import { OUT_ZHIYU, OUT_XINLI, OUT_CHAN } from './paths.js';

/** 片内画面的色板。字段含义见 `zhiyu-scene.ts` 的 BASE */
export interface Palette {
  paper: string;
  paperEdge: string;
  frame: string;
  muntin: string;
  skyTop: string;
  skyBottom: string;
  far: string;
  ridge: string;
  ground: string;
  subject: string;
  ink: string;
  inkDim: string;
  seal: string;
  sealInk: string;
  track: string;
  fill: string;
  snail: string;
}

/** 发布文案里按线路变的那几个产物名 */
export interface PublishSkin {
  /** 方图文件名 */
  square: string;
  /** 表格里那一列的标题 */
  squareName: string;
  /** 正文里的简称 */
  squareShort: string;
  /** 横版缩略图自检文件名 */
  check: string;
  /** 有没有「整本」那一套（一本多期才有） */
  wholeBook: boolean;
}

export interface Line {
  /** 成品根目录。相对 joke-video/ */
  out: string;
  /** 主讲音色。**全季一条，不为单期新开**（见治愈系出片方案 §二） */
  cast: string;
  /**
   * 实测含停顿均速（字/分）。**量出来的，不是估的。**
   *
   * 拿它折预估片长。别用稿件文档里的「暂定」值 —— 那些数经常是把
   * 「整期含停顿均速」当成「说话速度」，治愈线为此废掉过六条候选音色。
   */
  cpm: number;
  /** 缺省床音（相对 joke-video/）。各期可用 发布.json 的 `bed` 覆盖 */
  defaultBed: string;
  /** 片内色板相对基准的差量。基准是治愈档，见 `zhiyu-scene.ts` 的 BASE */
  palette: Partial<Palette>;
  /**
   * 稿件体检。**按名字注册**，实现在各自的模块里：
   *   `'xinli'` → `xinli-check.ts` 的 gate()，查六段结构字数
   *   `'zhiyu'` → `zhiyu-check.ts` 的 gate()，查文本闸（叹号/问号/段长/⏸ 密度）
   *   `'chan'`  → `chan-check.ts` 的 gate()，查七段结构字数 + 说破层那几条
   *   `null`    → 这条线还没有闸
   *
   * **全都挂在 TTS 之前** —— 那是第一个花时间的步骤。
   */
  check: 'xinli' | 'zhiyu' | 'chan' | null;
  /** 封面脚本。两套骨架不同，不是同一版式换值 */
  cover: string;
  /** 稿件文件名（`发布.json` 的 acts 里写的那个） */
  publish: PublishSkin;
  /** 这条线的出片手册 */
  doc: string;
}

export const LINES: Record<string, Line> = {
  治愈: {
    out: OUT_ZHIYU,
    cast: '夜读',
    // 《方丈记》226 / 《枕草子》上篇 235。取偏保守的那个折预估
    cpm: 226,
    defaultBed: '../zhiyu/musics/1.wav',
    palette: {},
    check: 'zhiyu',
    cover: 'zhiyu-cover.ts',
    publish: {
      square: 'wechat-1080x1080.png',
      squareName: '微信 1:1',
      squareShort: '微信',
      check: 'check-210.png',
      wholeBook: true,
    },
    doc: 'zhiyu/治愈系出片方案.md',
  },

  心理: {
    out: OUT_XINLI,
    // **同一条音色。** 稿源说这条线「比治愈档快一档」，那已经由文本
    // 自己实现了（短句多、逗号少，实测 258 对 226），不需要动音色。
    cast: '夜读',
    cpm: 258,
    defaultBed: '../zhiyu/musics/1.wav',
    /**
     * 比治愈档冷两档（稿源 §七之二）：把绿相整体推向石青灰。
     * 主色取自封面 series 的 accent `#4A5B66`，让片内和封面同源。
     * **和纸底与窗框几乎不动** —— 那是频道骨架，四条线共用。
     */
    palette: {
      paper: '#F4F1EA',
      paperEdge: '#ECE8DE',
      skyTop: '#EEEDE9',
      skyBottom: '#E4E5E4',
      far: '#DFE2E4',
      ridge: '#D7DBDF',
      ground: '#C7CCD1',
      subject: '#AAB4BB',
      ink: '#3F4A52',
      inkDim: '#7E888F',
      track: '#E3DFD4',
      fill: '#8FA8B4',
      snail: '#7E888F',
      sealInk: '#F4F1EA',
    },
    check: 'xinli',
    cover: 'xinli-cover.ts',
    publish: {
      square: 'square-1400x1400.png',
      squareName: '方版 1:1',
      squareShort: '方版',
      check: 'check-320.png',
      wholeBook: false,
    },
    doc: 'zhiyu/心理洞察出片方案.md',
  },

  禅佛典: {
    out: OUT_CHAN,
    // **同一条音色。** 稿源 §〇 就写着「版权口径与主讲参数不变」——
    // 这条线跟治愈档、心理档共用主讲，听众认的是这个声音。
    cast: '夜读',
    /**
     * **实测。** E01《第七个饼》1960 字 / 473.6 秒（含全部停顿）＝ 248.3。
     *
     * 稿源 §九 的暂定值 190 差了 31%（按它折是 10:19，实际 7:53）——
     * 又一次把「整期含停顿均速」当成了「说话速度」。
     * 治愈线 226、心理线 258，这条线夹在中间。**一期不够定一个数**，
     * E02、E03 各再出一个之后再动。
     */
    cpm: 248,
    // **跟心理线同一条**：204 秒的纯器乐，7 分钟的片子循环三遍多。
    // 1.wav 只有 10.3 秒，循环四十几遍会被听成节拍器。
    // 这条线不是助眠档，垫床是常态，各期仍可用 发布.json 的 bed 覆盖。
    defaultBed: '../zhiyu/musics/LNDO_Glorious_instrumental_3_24.wav',
    /**
     * 比治愈档暖：绿相整体推向赭石（§七之二 的 series 主色 `#8C6A4A`），
     * 让片内和封面同源，跟心理线那档石青灰分得开。
     *
     * **和纸底与窗框几乎不动** —— 那是频道骨架，五条线共用。
     * 明度阶梯照抄治愈档，只换色相：深夜里刺不刺眼靠的是明度差，不是色相。
     */
    palette: {
      paper: '#F4EFE6',
      paperEdge: '#EDE7DA',
      skyTop: '#F1EBDD',
      skyBottom: '#EAE3D2',
      far: '#E5DED0',
      ridge: '#DED5C3',
      ground: '#CEC2AC',
      subject: '#BBAB92',
      ink: '#5A4A3A',
      inkDim: '#8F8271',
      track: '#E6DFCD',
      fill: '#C4A882',
      snail: '#8F8271',
    },
    check: 'chan',
    // 封面骨架跟心理线是同一套（和纸底 + 窗框 + 竖排标题 + 印 + motif），
    // 差别只在 series 那一组值和 motif —— 两样都在 xinli-cover.ts 的表里注册。
    cover: 'xinli-cover.ts',
    publish: {
      square: 'square-1400x1400.png',
      squareName: '方版 1:1',
      squareShort: '方版',
      check: 'check-320.png',
      wholeBook: false,
    },
    doc: 'zhiyu/禅佛典向_小故事大道理_书目与稿件.md',
  },
};

/** 缺省线路。**既有的八个脚本和所有命令因此不用改** */
export const DEFAULT_LINE = '治愈';

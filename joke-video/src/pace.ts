// ── 节奏预设：语速 + 三层停顿，一次配好，后面直接调用 ────────────────
//
// 《小老鼠做蛋糕》调这套值花了三轮反复（用户三次反馈"讲太快""每句之间要有缓冲"
// "说完上句紧接着下句"），所以固化成命名预设，新稿件写一行 `"pace": "bedtime"`
// 就能复用，不用再从头试。
//
// **停顿有三层，缺一层就白调。** 第一次改的时候只动了②③，
// 而一句旁白内部还拆成 2~3 个小句、中间只有 0.16~0.24s，听感照样是"一口气读完"：
//
//   ① 一句**内部**的小句之间   → clauseEnd / clauseComma（按上一小句怎么收尾）
//   ② 句与句之间（同一镜）      → padBefore + padAfter
//   ③ 换镜的地方               → padBefore + padAfterShot
//
// 语速不在这里配，在 cast.ts 的念法表（叙缓/叙平/叙快）——那是"这一句怎么说"，
// 跟"句子之间空多久"是两回事。两边的对应关系写在下面每个预设的注释里。

export interface Pace {
  /** 说明，出现在 npm run lines 的输出里 */
  desc: string;
  /** 台词起来之前留白 */
  padBefore: number;
  /** 说完之后留白（同一镜内的下一句） */
  padAfter: number;
  /** 说完之后留白（这一镜结束，下一句要换画面） */
  padAfterShot: number;
  /** 句内小句间停顿：上一小句以 。！？ 收尾（一个完整意思讲完了） */
  clauseEnd: number;
  /** 句内小句间停顿：上一小句以 ，、 收尾（话没说完，只是换口气） */
  clauseComma: number;
}

export const PACES: Record<string, Pace> = {
  /**
   * 睡前故事 —— 温柔妈妈给小朋友讲故事。
   *
   * 实际效果：句间空 0.90s，换镜空 1.95s。
   * 配套语速用 cast.ts 的 叙缓/叙平/叙快，叠上角色 rate -8% 后落到 -30% / -18% / -8%。
   * 《小老鼠做蛋糕》22 句、145 秒，就是这套值。
   */
  bedtime: {
    desc: '睡前故事：慢、每句之间留足缓冲',
    padBefore: 0.35,
    padAfter: 0.55,
    padAfterShot: 1.6,
    clauseEnd: 0.55,
    clauseComma: 0.3,
  },

  /**
   * 常规叙述 —— 科普、资讯这类。比睡前故事紧一档，但仍然是"讲"不是"念"。
   */
  narrate: {
    desc: '常规叙述：正常讲述节奏',
    padBefore: 0.25,
    padAfter: 0.35,
    padAfterShot: 1.1,
    clauseEnd: 0.38,
    clauseComma: 0.2,
  },

  /**
   * 段子对话（A 类）—— 你来我往要紧凑，留白是留给笑点的，不是留给每一句的。
   * 这是 typeA 一直在用的值，写进来只是为了三种节奏能放在一起看。
   */
  banter: {
    desc: '段子对话：紧凑，留白只给笑点',
    padBefore: 0.15,
    padAfter: 0.2,
    padAfterShot: 0.35,
    clauseEnd: 0.18,
    clauseComma: 0.12,
  },

  /**
   * 老马**累积式**（排比自嘲）——《累积式_出片方案》§二。
   *
   * 累积式是「一件比一件离谱，最后我认了」，**密度就是笑点**：
   * 三句同构句之间几乎不能停，一停排比就散成三句各说各的话。
   * 所以句内压到 0.25 / 0.15（比段子对话还紧一档），句间 0.35–0.45。
   *
   * **全片唯一一次「单独停一下」由稿件的 `beatPause` 给**（那一句 +0.8 秒）——
   * 留一拍留给落点前那一下，别的地方一律匀速推过去。全靠预设自动算的话，
   * 整条片子会被读平；而拉长某一处停顿去「制造节奏」，拉的是排比的密度。
   *
   * ⚠ 单点式**不用这个预设**（它写 `banter`，一句一议直接写 `padAfter`）。
   * 两个体裁的停顿是两套值，互相抄会各毁一半。
   */
  /**
   * 老马**长片**（第三条线，五分钟）——《长片001》§2.4。
   *
   * 句间 0.6（0.2 + 0.4）、换镜 1.2。**它落在 `bedtime` 0.90 和 `standup-fast` 0.40 中间**，
   * 是方案自己指定的那一档：短片的密度撑不住五分钟，睡前故事的慢又不是老马。
   *
   * ⚠ **别把段落边界也当换镜。** 一千五百字有七十多个段落，按 1.2 秒给
   * 光停顿就是一分半，而分镜表统共 16 镜 —— **段不是镜**。
   * 换镜那一档只用在八个章界上。
   */
  longform: {
    desc: '老马长片：句间 0.6，换镜 1.2 —— 慢，但不是睡前故事',
    padBefore: 0.2,
    padAfter: 0.4,
    padAfterShot: 1.0,
    clauseEnd: 0.35,
    clauseComma: 0.2,
  },

  'standup-fast': {
    desc: '老马累积式：排比要密，留白只给落点前那一拍',
    padBefore: 0.1,
    padAfter: 0.3,
    padAfterShot: 0.8,
    clauseEnd: 0.25,
    clauseComma: 0.15,
  },
};

export const PACE_NAMES = Object.keys(PACES);

/** 取预设。不认识的名字直接炸，别静默回退——回退等于出一条节奏不对的片子 */
export function getPace(name: string | undefined, fallback: string): Pace {
  const key = name ?? fallback;
  const hit = PACES[key];
  if (!hit) throw new Error(`没有这个节奏预设：${key}\n可用：${PACE_NAMES.join(' / ')}`);
  return hit;
}

/** 一小句说完之后该空多久：看它怎么收尾 */
export function clauseGap(text: string, pace: Pace): number {
  return /[。！？!?]$/.test(text.trim()) ? pace.clauseEnd : pace.clauseComma;
}

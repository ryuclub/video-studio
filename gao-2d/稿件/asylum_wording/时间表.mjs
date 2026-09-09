/* ===========================================================================
   ②《一个词干的活》时间表
   总长 31.355s / 941 帧 @30fps　模板 T7（Their Own Words）

   数据来源：首相 2024-01-02 公开声明；内政部 2023-12-28 统计（总积压 98,599 ／
   legacy 仍待决 4,537）；Nationality and Borders Act 2022 (Commencement No. 1)
   Regulations 2022（SI 2022/590，"the appointed day" means 28th June 2022）；
   统计监管局主席 2024-01-18 致 Alistair Carmichael MP 函；内政部 2026-06 统计。
   逐条陈述、级别、时点见同目录 工作表.md §1。

   ✅ **时间码已按实测音频回填**（2026-09-09）。八段 c/g 实测，配音.mjs 直接吐出这张表，
     总长 31.355s 跟成品人声一致。要改节奏先改 分句.mjs 重跑配音，别手改这一列。

   ⚠ **这条稿全篇零动机推断**（方案 §13 第 3 条）：不说「误导」「文字游戏」。
     只把三份官方文件按时间排开 —— 干活的是第 3 块那个定义，不是解说词。

   每块 C / DOC 的 `素材` 字段是备料说明；上屏英文的中文注在 `card.中` / `captions[].中`
   / `credit中`（中文只上汇总页，不进片子）。字段说明见方案 §11。
   =========================================================================== */

export default {
  slug: 'asylum_wording',
  题: '一个词干的活',
  线: '英国',
  模板: 'T7',
  状态: '待出片',            // 立项 / 待审 / 待配音 / 待素材 / 待出片 / 已出片
  克制型: false,
  工作表: '工作表.md',

  audio: 'audio/asylum_wording_voice.wav',   // 相对 projects/高总/<slug>/
  /* 背景音乐（2026-09-09 加）。db 是**相对这首曲子原始电平**的衰减：
     zhege-hao 实测 −14.03 LUFS，人声 −16，按 §5.1「音乐低 18–22dB」取 20dB 差 → −22。
     ⚠ 换一首必须重测重算，照抄这个数会翻车（见 projects/高总/_音乐/来源.md）。 */
  music: { file: '_音乐/zhege-hao.mp3', db: -22 },

  /* 封面抽帧的时间点（秒）。写在这儿而不是命令行参数 —— 换了素材重跑
     `node gao-2d/封面.mjs` 就回来，可复现。挑的是 DOC 块里标注画完之后那一帧。 */
  封面: { at: 10.5 },

  timeline: [
    /* 1 ── Hook：先放官方结论。主讲人说，语气像念公告 */
    { id: 1, start: 0.0, end: 3.8, layer: 'B', frames: 'ms_talk', loop: true },

    /* 2 ── 同一天，另一份官方数字。**数字走数据条，不再独占一屏**（2026-09-09 拆 A 层） */
    /* ⚠ 带 lower 的块只能用 MS 系帧组 —— MCU 特写的嘴正好在数据条那一行（自检会拦） */
    { id: 2, start: 3.8, end: 8.2, layer: 'B', frames: 'ms_gesture', loop: true,
      lower: { value: '98,599', label: 'still waiting', accent: '#ff4757',
               中: '98,599 件仍在等待初次决定' } },

    /* 3 ── 定义登场。**整条片子的支点** —— 法条原文自己写着分界日 */
    { id: 3, start: 8.2, end: 13.7, layer: 'DOC',
      clip: 'media/naba_appointed_day.png',
      box: { x: 45, y: 1238, w: 490, h: 36 },
      credit: 'SI 2022/590, reg. 1(2)',
      credit中: '2022 年第 590 号法规，第 1(2) 条',
      素材: { 源: '报告原件', 要: 'SI 2022/590 第 1 页：标题 ＋ 定义条款，红框圈 "the appointed day" means 28th June 2022',
              备注: '不开 kenburns（红框是固定坐标）。内容摆在 y=240–1267，底下留白给角标。'
                  + 'PDF 在 media/uksi_2022_590.pdf，重裁：crop2.mjs 336 504 1705 1621 240' } },

    /* 4 ── 连被承诺覆盖的那一批也没清完 */
    { id: 4, start: 13.7, end: 17.6, layer: 'B', frames: 'ms_gesture', loop: true,
      lower: { value: '4,537', label: 'legacy cases', accent: '#ff4757',
               中: '4,537 件 legacy 案件仍未决' } },

    /* 5 ── 第三份文件：监管机构。信里引着首相的原话和内政部的新闻稿 */
    { id: 5, start: 17.6, end: 22.0, layer: 'DOC',
      clip: 'media/uksa_letter.png',
      box: { x: 72, y: 852, w: 935, h: 155 },
      credit: 'UK Statistics Authority, 18 January 2024',
      credit中: '英国统计监管局，2024 年 1 月 18 日',
      素材: { 源: '报告原件', 要: '统计监管局主席致议员函第 1 页：信头 ＋ 前两段，红框圈引用首相原话与内政部新闻稿那一段',
              备注: '同上，不开 kenburns。裁切避开脚注区（那里有个人社媒账号）。'
                  + 'PDF 在 media/uksa_letter_2024-01-17.pdf，重裁：crop2.mjs 118 101 2164 1420 300' } },

    /* 6 ── 反面事实（§3.3）＋ 法务护栏（§13）。**完全真诚**，一带阴阳就塌 */
    /* 反面事实句用 ms_doubt（斜看半睁）—— 一本正经说反话的脸 */
    { id: 6, start: 22.0, end: 25.9, layer: 'B', frames: 'ms_doubt', loop: true },

    /* 7 ── 落点：把第 2 块那个数原样再放一遍。**同一条数据条**，不加重。
         景别换回 MS —— 落点靠数字重复，不靠景别 */
    { id: 7, start: 25.9, end: 28.6, layer: 'B', frames: 'ms_talk', loop: true,
      lower: { value: '98,599', label: 'still waiting', accent: '#ff4757',
               中: '98,599 —— 跟第二块同一个数，原样重放' } },

    /* 8 ── 引导问题（§8.1）：问观众自己的经验，不问立场 */
    { id: 8, start: 28.6, end: 31.355, layer: 'B', frames: 'ms_talk', loop: true },

    /* 9 ── **结尾留白**（2026-09-09）：问完之后停 2 秒，角色安静看着镜头。
         音频侧是分句最后一段的 `pauseAfter: 2.0` —— 配音真的拼了 2 秒静音进去，
         **不是画面单方面延长**，所以时长闸自然对得上。

         `ms_idle` 那组因为「有台词不能用」一直闲置，**这是它唯一正确的用法**：
         这一块没台词也没字幕，自检那条 idle 闸正好放行。
         `loop: false` —— 150 帧的待机组取前 60 帧，眨眼和眼珠微动走一遍就够，不循环。

         **收尾卡**放在这儿：观众先听到问题（上一块的字幕），
         说完画面收束、问题以大字留在屏幕上。 */
    { id: 9, start: 31.355, end: 33.355, layer: 'B', frames: 'ms_idle', loop: false,
      outro: { lines: 'Have you ever been counted as finished?', accent: '#ff4757' } },
  ],

  /* 字幕只给 B / C / DOC；A 层卡面本身就是字，不叠（方案 §6.6）。
     ⚠ 这条稿严格按 §6.6 的「每屏 3–5 词」拆 —— 坑洞篇 7 条全超标（最长 12 词排 5 行，
     压住了角标）。`自检.mjs` 现在会逐条数词。 */
  captions: [
    { t0: 0.0,  t1: 1.7,  text: 'THE GOVERNMENT SAID',        中: '政府说' },
    { t0: 1.7,  t1: 3.8,  text: 'THE BACKLOG WAS CLEARED',    中: '积压已经清空' },

    { t0: 3.8,  t1: 6.0,  text: 'NINETY-EIGHT THOUSAND',      中: '九万八千件' },
    { t0: 6.0,  t1: 8.2,  text: 'WERE WAITING THAT DAY',      中: '那一天还在等' },

    { t0: 8.2,  t1: 11.0, text: 'THE PLEDGE COVERED ONLY',    中: '那个承诺只覆盖' },
    { t0: 11.0, t1: 13.7, text: 'CLAIMS FILED BEFORE 2022',   中: '2022 年之前提交的申请' },

    { t0: 13.7, t1: 15.7, text: 'FOUR THOUSAND FIVE HUNDRED', 中: '四千五百件' },
    { t0: 15.7, t1: 17.6, text: 'WERE STILL WAITING',         中: '还在等' },

    { t0: 17.6, t1: 19.8, text: 'THE STATISTICS REGULATOR',   中: '统计监管局' },
    { t0: 19.8, t1: 22.0, text: 'WROTE ABOUT THE WORDING',    中: '为措辞写了信' },

    { t0: 22.0, t1: 23.3, text: 'TO BE FAIR',                 中: '公平地说' },
    { t0: 23.3, t1: 24.6, text: 'IT HAS SINCE FALLEN',        中: '之后确实降了' },
    { t0: 24.6, t1: 25.9, text: 'BY THREE QUARTERS',          中: '降了四分之三' },

    { t0: 25.9, t1: 28.6, text: 'NINETY-EIGHT THOUSAND',      中: '九万八千' },

    /* 说话块配字幕；下一块（静默）是 outro，整句在画面上，不再配 */
    { t0: 28.6, t1: 30.0, text: 'HAVE YOU EVER BEEN', 中: '你有没有' },
    { t0: 30.0, t1: 31.355, text: 'COUNTED AS FINISHED?', 中: '被算成「已办结」过？' },
  ],
};

/* ===========================================================================
   ③《他们写完，然后什么都没说》时间表
   总长 30.257s / 908 帧 @30fps　模板 T9（The File）

   档案：Defra《National security assessment — global biodiversity loss,
   ecosystem collapse and national security》，2026-01-20，14 页，页眉 UK OFFICIAL。
   **正片八句全部指回这一份 PDF 或 gov.uk 的发布记录，零媒体转述**（§13 第 2 条）。
   逐条陈述、级别、时点见同目录 工作表.md §1。

   ✅ **时间码已按实测音频回填**（2026-09-09）。配音.mjs 直接吐出这张表，
     总长 30.257s 跟成品人声一致。要改节奏先改 分句.mjs 重跑配音。

   ⚠ **Hook 用的是判断 4 不是判断 5**：判断 5（…collapse from 2030）听着更冲，
     但报告自己标的置信度是 **Low**；判断 4 标的是 **High**。
     拿低置信度的判断当钩子而不说明，是选择性引用 —— 详见工作表 §1。
   =========================================================================== */

export default {
  slug: 'nature_security',
  题: '他们写完，然后什么都没说',
  线: '英国',
  模板: 'T9',
  状态: '待出片',
  克制型: false,
  工作表: '工作表.md',

  audio: 'audio/nature_security_voice.wav',
  /* 背景音乐（2026-09-09 加）。db 是**相对这首曲子原始电平**的衰减：
     zhege-hao 实测 −14.03 LUFS，人声 −16，按 §5.1「音乐低 18–22dB」取 20dB 差 → −22。
     ⚠ 换一首必须重测重算，照抄这个数会翻车（见 projects/高总/_音乐/来源.md）。 */
  music: { file: '_音乐/zhege-hao.mp3', db: -22 },

  /* 封面抽帧的时间点（秒）。写在这儿而不是命令行参数 —— 换了素材重跑
     `node gao-2d/封面.mjs` 就回来，可复现。挑的是 DOC 块里标注画完之后那一帧。 */
  封面: { at: 2.6 },

  timeline: [
    /* 1 ── Hook：**开场直接给档案**（2026-09-09 改）。
         T9 The File 的定位就是「调阅一份档案」，第一帧就该是那份文件；
         而且 punch 叠在浅色文档上比叠在角色身上更清楚，顺带把 B 层从 69% 压到 51%。
         punch 去掉手写换行，交给自动折行 —— 手写两行最长 28 字符只能给到 47px，
         自动折三行最长 20 字符能到 66px。 */
    { id: 1, start: 0.0, end: 5.4, layer: 'DOC',
      clip: 'media/kj4_pathway.png',
      /* 只留红框：正文从 x40 起，左边距只有 30px，页边感叹号塞不下会压在字上（实测过） */
      标注: [{ 型: 'box', x: 30, y: 487, w: 1020, h: 118 }],
      credit: 'Defra nature security assessment, 20 Jan 2026 (p2, KJ4)',
      credit中: 'Defra 自然安全评估，2026 年 1 月 20 日（第 2 页，判断 4）',
      punch: { lines: 'Every critical ecosystem is on a pathway to collapse.',
               highlight: 3, accent: '#ff4757',
               中: '每一个关键生态系统，都走在崩溃的路上（报告判断 4，置信度 High）' },
      素材: { 源: '报告原件', 要: '报告 p2「Key judgements」标题 ＋ 判断 4 里「ecosystem is on a pathway to collapse」放大，红框圈住 ＋ 页边感叹号',
              备注: '开场帧。不开 kenburns（标注是固定坐标）。'
                  + '重做：doccard.mjs ns2.png 57,105,760,80 1288,858,615,58 560 1000' } },

    /* 2 ── 点明这是谁写的 */
    { id: 2, start: 5.4, end: 8.9, layer: 'B', frames: 'mcu_talk', loop: true },

    /* 3 ── 报告 p4 的 PHIA 概率标尺。「Realistic Possibility」就印在上面 */
    { id: 3, start: 8.9, end: 13.3, layer: 'DOC',
      clip: 'media/probability_yardstick.png',
      box: { x: 450, y: 490, w: 125, h: 212 },
      credit: 'Defra nature security assessment, 20 Jan 2026 (p4)',
      credit中: 'Defra 自然安全评估，2026 年 1 月 20 日（第 4 页）',
      素材: { 源: '报告原件', 要: '报告 p4 的 PHIA Probability Yardstick 标尺图 ＋ 小标题，红框圈 Realistic Possibility 那一档',
              备注: '不开 kenburns（红框固定坐标）。标尺比一行小字有力得多 —— 它自己就证明了「这是情报评估的语言」。'
                  + 'PDF 在 media/defra_nature_security_assessment.pdf，重做：doccard.mjs ns4.png 63,835,560,52 69,898,1900,400 560 1040' } },

    /* 4 ── 报告 p2 判断 2 里的两个词。这是整条片子话题性最高的一帧 */
    { id: 4, start: 13.3, end: 18.4, layer: 'DOC',
      clip: 'media/kj_conflict_migration.png',
      box: { x: 555, y: 495, w: 478, h: 78 },
      credit: 'Defra nature security assessment, 20 Jan 2026 (p2)',
      credit中: 'Defra 自然安全评估，2026 年 1 月 20 日（第 2 页）',
      素材: { 源: '报告原件', 要: '报告 p2「Key judgements」标题 ＋ 判断 2 里「economic insecurity, conflict, migration」那一段放大，红框圈 conflict, migration',
              备注: '横版页面整页缩进竖屏字高只剩 12px，所以做成摘录卡：标识在上、关键句放大在中。'
                  + '重做：doccard.mjs ns2.png 57,105,760,80 1555,445,665,58 560 1000' } },

    /* 5 ── 一份国安评估，十四页。
         **数据条不是独立一屏**：数字叠在主讲人身上，`lower` 是字段不占层
         （跟 credit / box 同类，方案 §7.3），这一块的 layer 仍然是 B。
         整片 A 层因此从 41% 降到 29%，不再有连着十几秒的黑底字卡。
         Hook（第 1 块）和落点（第 7 块）仍然独占画面 —— 那两处要的就是空。 */
    { id: 5, start: 18.4, end: 21.8, layer: 'B', frames: 'ms_gesture', loop: true,
      lower: { value: 14, label: 'pages', accent: '#ff4757',
               中: '全文 14 页（数据条，叠在主讲人下方）' } },

    /* 6 ── 反面事实（§3.3）＋ 法务护栏（§13）。**完全真诚地念**。
         用 ms_doubt（斜看半睁）—— 一本正经说反话的脸，一条片最多一次 */
    { id: 6, start: 21.8, end: 24.8, layer: 'B', frames: 'ms_doubt', loop: true },

    /* 7 ── **评论句**（模板 §八）。只限定第 6 句的范围，一个字不加断言。
         景别换成 MCU：落点收紧一次，比换成黑底更有力，而且画面不断。 */
    { id: 7, start: 24.8, end: 28.3, layer: 'B', frames: 'ms_talk', loop: true,
      punch: { lines: 'No launch.\nNo press release.', highlight: 2, accent: '#ff4757',
               中: '没有发布会。没有新闻稿。' } },

    /* 8 ── 引导问题（§8.1） */
    { id: 8, start: 28.3, end: 30.257, layer: 'B', frames: 'ms_talk', loop: true },

    /* 9 ── **结尾留白**（2026-09-09）：问完之后停 2 秒，角色安静看着镜头。
         音频侧是分句最后一段的 `pauseAfter: 2.0` —— 配音真的拼了 2 秒静音进去，
         **不是画面单方面延长**，所以时长闸自然对得上。

         `ms_idle` 那组因为「有台词不能用」一直闲置，**这是它唯一正确的用法**：
         这一块没台词也没字幕，自检那条 idle 闸正好放行。
         `loop: false` —— 150 帧的待机组取前 60 帧，眨眼和眼珠微动走一遍就够，不循环。

         **收尾卡**放在这儿：观众先听到问题（上一块的字幕），
         说完画面收束、问题以大字留在屏幕上。 */
    { id: 9, start: 30.257, end: 32.257, layer: 'B', frames: 'ms_idle', loop: false,
      outro: { lines: 'What did you not read this year?', accent: '#ff4757' } },
  ],

  /* 字幕按「每屏 3–5 词」拆（§6.6）。
     ⚠ **带 punch 的块不配字幕**（第 1、7 块）—— punch 已经把整句摆在画面上了，
     再叠一行字幕是同一句话说两遍。理由跟原来「A 层不配字幕」完全一样，
     只是判据从「哪一层」变成了「这一块有没有 punch」。 */
  captions: [
    { t0: 5.4,  t1: 7.2,  text: "THAT IS THE GOVERNMENT'S", 中: '这是政府' },
    { t0: 7.2,  t1: 8.9,  text: 'OWN ASSESSMENT',           中: '自己的评估' },

    { t0: 8.9,  t1: 11.1, text: 'IT USES THE LANGUAGE',     中: '它用的是' },
    { t0: 11.1, t1: 13.3, text: 'OF INTELLIGENCE ASSESSMENTS', 中: '情报评估的语言' },

    { t0: 13.3, t1: 16.0, text: 'IT NAMES CONFLICT AND MIGRATION', 中: '它把冲突和移民' },
    { t0: 16.0, t1: 18.4, text: 'AS CASCADING RISKS',       中: '列为连锁风险' },

    /* 第 5 块有数据条，字幕照配 —— 数据条显示的是「14 / PAGES」，字幕是整句台词，
       两者形式不同不算重复；而且 Shorts 大量观众是静音看的。
       纵向也不打架：数据条 920–1120，字幕两行到 1260 才起。 */
    { t0: 18.4, t1: 20.1, text: 'THE WHOLE THING IS',      中: '全文' },
    { t0: 20.1, t1: 21.8, text: 'FOURTEEN PAGES',          中: '十四页' },

    { t0: 21.8, t1: 23.0, text: 'TO BE FAIR',               中: '公平地说' },
    { t0: 23.0, t1: 24.8, text: 'THEY DID PUBLISH IT',      中: '他们确实发了' },

    /* 说话块配字幕；下一块（静默）是 outro，整句在画面上，不再配 */
    { t0: 28.3, t1: 29.4, text: 'WHAT DID YOU NOT READ', 中: '今年你没读到' },
    { t0: 29.4, t1: 30.257, text: 'THIS YEAR?', 中: '什么？' },
  ],
};

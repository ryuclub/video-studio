/* ===========================================================================
   ①《英国路面坑洞》时间表
   总长 48.447s / 1453 帧 @30fps　模板 T5（Timeline Escalation 变体）

   数据来源：ALARM Survey 2026（Asphalt Industry Alliance，2026-03-17 发布，
   覆盖英格兰与威尔士 79% 地方政府，对应 2025/26 财年）；AA 出动数据。
   逐条陈述、级别、时点见同目录 工作表.md §1。

   ✅ **时间码已按实测音频回填**（2026-09-09）。16 段 c/g 实测累加，段和 48.447s
     跟成品人声分毫不差。段→块的映射是工作表 §5 每行 ‖ 的个数（1/1/1/2/2/3/2/1/2/1），
     停顿归属它前面那一段。要再改先改 分句.mjs 重跑配音，别手改这一列。

   每块 C / DOC 的 `素材` 字段是**备料说明**：这块要准备成什么样。
   工作表 §6 那张清单由它生成 —— 跟 clip 名挨着写，改文件名时不会漏改。
   `build.mjs --check` 打成备料单，汇总页渲成表。字段说明见方案 §11。
   =========================================================================== */

export default {
  slug: 'uk_potholes',
  题: '英国路面坑洞',
  线: '英国',
  模板: 'T5',
  状态: '已出片',            // 立项 / 待审 / 待配音 / 待素材 / 待出片 / 已出片
  克制型: false,            // 方案 §4.3：涉及真实受害者的题材才走克制型
  工作表: '工作表.md',

  audio: 'audio/uk_potholes_voice.wav',   // 相对 projects/高总/<slug>/
  /* 背景音乐（2026-09-09 加）。db 是**相对这首曲子原始电平**的衰减：
     zhege-hao 实测 −14.03 LUFS，人声 −16，按 §5.1「音乐低 18–22dB」取 20dB 差 → −22。
     ⚠ 换一首必须重测重算，照抄这个数会翻车（见 projects/高总/_音乐/来源.md）。 */
  music: { file: '_音乐/zhege-hao.mp3', db: -22 },

  /* 封面抽帧的时间点（秒）。写在这儿而不是命令行参数 —— 换了素材重跑
     `node gao-2d/封面.mjs` 就回来，可复现。挑的是 DOC 块里标注画完之后那一帧。 */
  封面: { at: 15.5 },

  timeline: [
    /* 1 ── 钩子：97 年 */
    { id: 1, start: 0, end: 2.845, layer: 'B', frames: 'ms_gesture', loop: true,
      lower: { value: 97, label: 'years', accent: '#ff4757', 中: '97 年' } },

    /* 2 ── 主讲人接住 */
    { id: 2, start: 2.845, end: 7.152, layer: 'B', frames: 'ms_talk', loop: true },

    /* 3 ── 2123 */
    /* versus 卡没有叠加层形态，拆成两行 punch —— 对比靠上下两行并置，
         比原来那张上暗下红的对比卡朴素，但画面不用中断 */
    { id: 3, start: 7.152, end: 13.132, layer: 'B', frames: 'ms_talk', loop: true,
      punch: { lines: 'Resurfaced today: 2026\nNext time: 2123', highlight: 2, accent: '#ff4757',
               中: '今天铺过 2026　／　下次是 2123' } },

    /* 4 ── 报告原件：190 万个坑 */
    { id: 4, start: 13.132, end: 20.641, layer: 'DOC',
      clip: 'media/alarm2026_potholes.png',
      /* ⚠ DOC 层不开 kenburns：box 是固定坐标，画面一放大红框就指错柱子（2026-09-09 实测圈到了 2025） */
      box: { x: 802, y: 722, w: 88, h: 352 },
      credit: 'ALARM Survey 2026, Asphalt Industry Alliance',
      credit中: 'ALARM 2026 调查，沥青工业联盟',
      素材: { 源: '报告原件', 要: 'ALARM 2026 报告 PDF 第 22 页（刊面标 20）的 10 年趋势图 —— 数量和费用两条线都在这一张里',
              备注: '静图代替翻页录屏，不开 kenburns。红框圈 2026 那根柱子（1,903,498）。'
                  + '内容摆在 y=260–1181，底下留白给角标（角标固定叠在 y1300，铺满会压住数据）。'
                  + 'PDF 原件在 media/ALARM-Survey-2026.pdf，重裁：crop2.mjs 650 1420 1020 870 260' } },

    /* 5 ── 报告原件：积压 186 亿 */
    { id: 5, start: 20.641, end: 26.242, layer: 'DOC',
      clip: 'media/alarm2026_backlog.png',
      box: { x: 722, y: 530, w: 78, h: 602 },
      credit: 'ALARM Survey 2026, Asphalt Industry Alliance',
      credit中: 'ALARM 2026 调查，沥青工业联盟',
      素材: { 源: '报告原件', 要: '同报告 PDF 第 15 页（刊面标 13）的 10 年趋势图 —— 积压逐年上涨，2026 到 18.62',
              备注: '同上，不开 kenburns。红框圈 2026 那根柱子（18.62 £bn）。'
                  + '重裁：crop2.mjs 650 1430 1020 860 260。报告抬头在原件里出现没问题，不要单独放大 Logo（§6.4）' } },

    /* 6 ── 反面事实：预算确实涨了（方案 §3.3 要求每条至少一条反面事实） */
    { id: 6, start: 26.242, end: 34.863, layer: 'C',
      clip: '_素材/road/night_resurfacing_01.jpg', kenburns: true,
      credit: 'ALARM Survey 2026: budgets +17%, good-condition roads +3 points',
      credit中: 'ALARM 2026：养护预算 +17%，结构良好路段 +3 个百分点',
      素材: { 源: '图库', 要: '夜间摊铺作业俯拍 —— 钱确实在花、人确实在干活，配「预算涨了 17%」这句反面事实',
              检索: 'road repair crew asphalt / pothole patching workers',
              备注: 'Pexels #4394364，共用库。人只是反光背心的小点，无脸无品牌（红线见 _素材/来源.md）' } },

    /* 7 ── 主讲人：三次付钱 */
    /* 「你交道路税、你出钱填坑」—— 排比的前两段，用 ms_doubt 的斜看 */
    { id: 7, start: 34.863, end: 39.138, layer: 'B', frames: 'ms_doubt', loop: true },

    /* 8 ── 实拍：避震 / 轮胎 */
    { id: 8, start: 39.138, end: 42.676, layer: 'C',
      clip: '_素材/road/tyre_tread_01.jpg', kenburns: true,
      credit: 'AA: 137,000 pothole call-outs, Jan–Feb 2026',
      credit中: 'AA：2026 年 1–2 月坑洞救援出动 13.7 万次',
      素材: { 源: '图库', 要: '轮胎贴地特写，胎面纹路清楚 —— 落在「自费换避震」那一句上',
              检索: 'car wheel tyre close up road / suspension pothole',
              备注: 'Pexels #8886305，共用库。无脸无品牌；同批的 #9817874 胎壁有 Bridgestone，筛掉了' } },

    /* 9 ── 落点字卡 */
    { id: 9, start: 42.676, end: 46.173, layer: 'B', frames: 'ms_talk', loop: true,
      punch: { lines: 'Three times.\nOne hole.', highlight: 2, accent: '#ff4757',
               中: '三次。一个坑。' } },

    /* 10 ── 主讲人：引导问题（方案 §8.1 的「经历征集」型） */
    { id: 10, start: 46.173, end: 48.447, layer: 'B', frames: 'ms_talk', loop: true },

    /* 11 ── **结尾留白**（2026-09-09）：问完之后停 2 秒，角色安静看着镜头。
         音频侧是分句最后一段的 `pauseAfter: 2.0` —— 配音真的拼了 2 秒静音进去，
         **不是画面单方面延长**，所以时长闸自然对得上。

         `ms_idle` 那组因为「有台词不能用」一直闲置，**这是它唯一正确的用法**：
         这一块没台词也没字幕，自检那条 idle 闸正好放行。
         `loop: false` —— 150 帧的待机组取前 60 帧，眨眼和眼珠微动走一遍就够，不循环。

         **收尾卡**放在这儿：观众先听到问题（上一块的字幕），
         说完画面收束、问题以大字留在屏幕上。 */
    { id: 11, start: 48.447, end: 50.447, layer: 'B', frames: 'ms_idle', loop: false,
      outro: { lines: 'How long has yours been there?', accent: '#ff4757' } },
  ],

  /* 字幕只给 B / C / DOC；A 层卡面本身就是字，不叠（方案 §6.6） */
  captions: [
    { t0: 2.845, t1: 7.152, text: "THAT'S HOW OFTEN A BRITISH ROAD\nGETS RESURFACED",
      中: '英国的路，就是这么个重铺间隔' },
    { t0: 13.132, t1: 20.641, text: 'COUNCILS FILLED 1.9 MILLION POTHOLES\nLAST YEAR. 5,200 A DAY.',
      中: '地方政府去年填了 190 万个坑。每天 5200 个。' },
    { t0: 20.641, t1: 26.242, text: 'THE BACKLOG STILL WENT UP.\n£18.6 BILLION.',
      中: '积压反而还涨了。186 亿英镑。' },
    { t0: 26.242, t1: 34.863, text: 'TO BE FAIR, BUDGETS ROSE 17%\nAND CONDITIONS IMPROVED. BY THREE POINTS.',
      中: '公平地说，预算涨了 17%，路况也改善了。改善了三个百分点。' },
    { t0: 34.863, t1: 39.138, text: 'SO YOU PAY ROAD TAX,\nYOU PAY FOR THE POTHOLE',
      中: '所以你交道路税，你出钱填坑' },
    { t0: 39.138, t1: 42.676, text: 'AND YOU PAY FOR\nYOUR OWN SUSPENSION',
      中: '你还得自费换避震' },
    /* 说话块配字幕；下一块（静默）是 outro，整句在画面上，不再配 */
    { t0: 46.173, t1: 47.3, text: 'HOW LONG HAS YOURS', 中: '你家那个坑' },
    { t0: 47.3, t1: 48.447, text: 'BEEN THERE?', 中: '在那儿多久了？' },
  ],
};

/* ===========================================================================
   ②《一个词干的活》分句清单 —— 音频侧的机器事实源

   两个脚本共用这一份：
     node gao-2d/出声.mjs asylum_wording    Kokoro 本地生成 01.wav…08.wav
     node gao-2d/配音.mjs asylum_wording    拼接、段间插静音、双遍 loudnorm、回吐时间码

   text 跟工作表 §3 是两份：那份给人看，这份给机器读（脚本不解析 markdown，太脆）。
   改文本两处一起改，改完跑 `配音.mjs --check` —— 它逐段比对，不一致报硬伤。

   `pauseAfter` 一一对应稿面（§2）的 ‖ 数值。**改节奏只改这一列**，
   不动音频也不动 时间表.mjs。八行结构见 `gao-2d/稿件模板_30秒八行.md`。
   =========================================================================== */

export default {
  slug: 'asylum_wording',
  dir: 'audio/段',                            // 相对 projects/高总/<slug>/
  out: 'audio/asylum_wording_voice.wav',      // 必须跟 时间表.mjs 的 audio 一致
  targetLUFS: -16,

  /* 方案 §5.1：Kokoro 四个英式男声里 george 最慢，反讽需要慢。
     ⚠ 换音色 = 改片长 = 时间码全部作废，必须重跑 出声 ＋ 配音 ＋ 重排时间表。 */
  voice: 'bm_george',
  speed: 0.9,

  segments: [
    /* ── Hook：先放官方结论 ── */
    { file: '01.wav', pauseAfter: 1.0, text: 'The government said the backlog was cleared.' },

    /* ── 同一天，另一份官方数字 ── */
    { file: '02.wav', pauseAfter: 0.8, text: 'Ninety-eight thousand cases were waiting that day.' },

    /* ── 定义登场。整条片子的支点在这一句，重音咬 only ── */
    { file: '03.wav', pauseAfter: 0.6, text: 'The pledge covered only claims filed before June twenty twenty-two.' },

    /* ── 连被承诺覆盖的那一批也没清完 ── */
    { file: '04.wav', pauseAfter: 0.8, text: 'Four thousand five hundred were still waiting.' },

    /* ── 第三份文件：监管机构 ── */
    { file: '05.wav', pauseAfter: 0.8, text: 'The statistics regulator wrote about the wording.' },

    /* ── 反面事实（方案 §3.3）＋ 法务护栏（§13）。**完全真诚地念**，一带阴阳就塌 ── */
    { file: '06.wav', pauseAfter: 0.6, text: 'To be fair, it has since fallen by three quarters.' },

    /* ── 落点：把第 2 段那个数原样再念一遍，同一个语调，不加重 ── */
    { file: '07.wav', pauseAfter: 1.0, text: 'Ninety-eight thousand.' },

    /* ── 引导问题（§8.1）：问观众自己的经验，不问立场 ── */
    { file: '08.wav', pauseAfter: 2.0, text: 'Have you ever been counted as finished?' },
  ],
};

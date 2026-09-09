/* ===========================================================================
   ③《他们写完，然后什么都没说》分句清单 —— 音频侧的机器事实源

     node gao-2d/出声.mjs nature_security    Kokoro 本地生成 01.wav…08.wav
     node gao-2d/配音.mjs nature_security    拼接、段间插静音、双遍 loudnorm、回吐时间码

   text 跟工作表 §3 是两份：那份给人看，这份给机器读。改文本两处一起改，
   改完跑 `配音.mjs --check`（逐段比对，不一致报硬伤）。

   第一条 T9（The File）：全片素材就是一份 gov.uk 的 PDF。
   `pauseAfter` 对应稿面的 ‖ 数值，改节奏只改这一列。
   =========================================================================== */

export default {
  slug: 'nature_security',
  dir: 'audio/段',
  out: 'audio/nature_security_voice.wav',
  targetLUFS: -16,

  /* 方案 §5.1：george 最慢，反讽需要慢。换音色 = 时间码全部作废。 */
  voice: 'bm_george',
  speed: 0.9,

  segments: [
    /* ── Hook：直接引报告**判断 4** 的原文。
         ⚠ 原本用的是判断 5（realistic possibility…from 2030），但那条报告自己标的
         置信度是 **Low**。拿低置信度的判断当钩子而不说明，是选择性引用，
         对手一驳就倒。判断 4 标的是 **High**，而且更绝对。 ── */
    { file: '01.wav', pauseAfter: 1.2, text: 'Every critical ecosystem is on a pathway to collapse.' },

    /* ── 点明这是谁写的 ── */
    { file: '02.wav', pauseAfter: 0.8, text: "That is the government's own assessment." },

    /* ── 报告 p4 自己说的：用情报评估的不确定性框架 ── */
    { file: '03.wav', pauseAfter: 0.8, text: 'It uses the language of intelligence assessments.' },

    /* ── 报告 p2 判断 2 原文里的两个词。**重音咬 conflict / migration** ── */
    { file: '04.wav', pauseAfter: 1.0, text: 'It names conflict and migration as cascading risks.' },

    /* ── 一份国安评估，十四页 ── */
    { file: '05.wav', pauseAfter: 0.6, text: 'The whole thing is fourteen pages.' },

    /* ── 反面事实（§3.3）＋ 法务护栏（§13）。**完全真诚地念** ── */
    { file: '06.wav', pauseAfter: 0.6, text: 'To be fair, they did publish it.' },

    /* ── **评论句**（模板 §八）：只限定范围，不加断言。两句之间要断开 ── */
    { file: '07.wav', pauseAfter: 1.2, text: 'No launch. No press release.' },

    /* ── 引导问题（§8.1）：问观众自己的经验 ── */
    { file: '08.wav', pauseAfter: 2.0, text: 'What did you not read this year?' },
  ],
};

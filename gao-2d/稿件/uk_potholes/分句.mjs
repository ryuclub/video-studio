/* ===========================================================================
   ①《英国路面坑洞》分句清单 —— 音频侧的机器事实源

   两个脚本共用这一份：
     node gao-2d/出声.mjs uk_potholes    Kokoro 本地生成 01.wav…16.wav
     node gao-2d/配音.mjs uk_potholes    拼接、段间插静音、双遍 loudnorm、回吐时间码

   ── text 为什么在这儿，而工作表 §3 也有一份 ──

   方案 §7.2 说工作表是「唯一的中枢文件」，交接稿 v2 说这份是「音频侧的单一事实源」。
   两个「唯一」不能都成立，所以分工：
     · 工作表 §3 是**给人看的**，跟稿面、来源表、时间表排在一起，改稿在那儿改；
     · 这儿是**给机器读的**，脚本不去解析 markdown（那太脆）。
     · 两份会不会飘 —— 交给闸：`配音.mjs --check` 逐段比对文本，不一致就报硬伤。
   所以改文本要两处一起改，改完跑一次 --check。

   ── 2026-09-09：9 段 → 16 段 ──

   原来只在**段末**的 ‖ 处切，稿面（工作表 §2）里另有 7 处 ‖ 落在段内、合计 3.2s，
   没有任何机制去实现 —— 只能指望引擎从句号里读出来，而引擎给的句间停顿约
   0.25–0.35s，比稿面要的 0.4–0.8s 短一截。Edge 试听版实听下来，
   「To be fair… Conditions improved. By three points.」那两处明显不够，反讽的落点是软的。

   现在**每一处 ‖ 都是段边界**，15 处停顿合计 9.4s 全部由 配音.mjs 硬插静音实现，
   工作表 §6 那句「按 ‖ 插静音」终于是真的了。本地生成不计费，切多切少不花钱。

   `pauseAfter` 一一对应稿面的 ‖ 数值。**改节奏只改这一列**，不动音频也不动 时间表.mjs。
   =========================================================================== */

export default {
  slug: 'uk_potholes',
  dir: 'audio/段',                          // 相对 projects/高总/<slug>/
  out: 'audio/uk_potholes_voice.wav',       // 必须跟 时间表.mjs 的 audio 一致
  targetLUFS: -16,

  /* 方案 §5.1：Kokoro 四个英式男声里 george 最慢，反讽需要慢。
     ⚠ 换音色 = 改片长 = 时间码全部作废，必须重跑 出声 ＋ 配音 ＋ 重排时间表。 */
  voice: 'bm_george',
  speed: 0.9,

  segments: [
    /* ── 钩子 ── */
    { file: '01.wav', pauseAfter: 1.2, text: 'Ninety-seven years.' },
    { file: '02.wav', pauseAfter: 0.8, text: "That's how often a British road gets resurfaced." },
    { file: '03.wav', pauseAfter: 1.0, text: 'If yours was done today, the next one is due in twenty one twenty-three.' },

    /* ── 规模 ── */
    { file: '04.wav', pauseAfter: 0.3, text: 'Councils filled one point nine million potholes last year.' },
    { file: '05.wav', pauseAfter: 0.5, text: 'Five thousand two hundred a day.' },

    /* ── 反转：填了这么多，积压反而涨 ── */
    { file: '06.wav', pauseAfter: 0.4, text: 'The backlog still went up.' },
    { file: '07.wav', pauseAfter: 0.6, text: 'Eighteen point six billion pounds.' },

    /* ── 反讽核心。三句各自独立成段，就是为了那两处段内停顿 ── */
    { file: '08.wav', pauseAfter: 0.4, text: 'To be fair, budgets rose seventeen percent.' },
    { file: '09.wav', pauseAfter: 0.6, text: 'Conditions improved.' },
    { file: '10.wav', pauseAfter: 0.8, text: 'By three points.' },

    /* ── 落到观众身上：三次付钱，一句一顿才砸得实 ── */
    { file: '11.wav', pauseAfter: 0.3, text: 'So you pay road tax.' },
    { file: '12.wav', pauseAfter: 0.3, text: 'You pay for the pothole.' },
    { file: '13.wav', pauseAfter: 1.0, text: 'And you pay for your own suspension.' },

    /* ── 收 ── */
    { file: '14.wav', pauseAfter: 0.4, text: 'Three times.' },
    { file: '15.wav', pauseAfter: 0.8, text: 'One hole.' },
    { file: '16.wav', pauseAfter: 2.0, text: 'How long has yours been there?' },
  ],
};

// ── 正音层：多音字读错的补救 ────────────────────────────────────────
//
// **只改送给 TTS 的那份文本。** 字幕、manifest、画面上的字全都用原文 ——
// 观众看到的永远是「假」，听到的才是替身字的音。
//
// ── 为什么非要用替身字这种土办法 ──
//
// 正经做法是 SSML 的 `<phoneme alphabet="sapi" ph="jia 4">假</phoneme>`。
// **Edge 这个免费接口把它拒了**，2026-08-20 实测：
//
//   纯文本            40608 字节  ✓
//   <phoneme sapi>    Stream closed before the synthesis completed
//   <phoneme x-sampa> 同上
//   <sub alias>       同上
//   <break time>      同上（记忆里早就有这一条，是同一个毛病）
//
// 一个标签都不吃。所以唯一的杠杆是纯文本本身，只剩同音字替换这一条路。
// 哪天换成 Azure 官方 key（tts.ts 顶上那条授权说明里提过），
// 第一件该做的事就是把这一层换成 `<phoneme>`。
//
// ── 什么时候会读错：在小句开头 ──
//
// 2026-08-20 拿基频探针量的（`npx tsx src/tone-check.ts`），同一个「假」：
//
//   调半天假          344→256 Hz   四声参照「架」338→236　✓ 读对
//   假也批了          233→317 Hz   三声参照「甲」235→314　✗ 读成 jiǎ
//   假当然批          227→194 Hz   三声参照「甲」224→196　✗
//   语气正常，假也批了  209→168 Hz   三声参照「甲」209→168　✗
//
// **规律很清楚：跟在词里就对，站在小句开头就错。** 句读一断，模型手上
// 就只剩这个字本身，只能挑那个更常见的读音。所以这一层的告警只盯小句开头，
// 全篇每个多音字都报一遍的话，噪声大到没人看。

/** 一个多音字的一种读法：这个读音下的安全组词，以及一个同音替身 */
interface Reading {
  /** 拼音，写全带调号，出错时打给人看 */
  yin: string;
  /** 同音替身。**必须是完全同音（同声母韵母同调）且本身不是多音字** */
  stand: string;
  /** 这个读音下，Edge 已经能读对的词。命中就不动它 */
  words: string[];
}

interface Poly {
  /** 小句开头缺上下文时，模型默认会挑的那个读音（也就是会出错的那个） */
  fallback: string;
  readings: Reading[];
  /** 实测记录。**没量过就不许往这儿加条目** —— 猜一个替身字比不改更糟 */
  verified: string;
}

/**
 * 多音字表。**加条目之前先跑 `src/tone-check.ts` 量一遍**，
 * 把数字写进 `verified`。这张表的价值全在「量过」三个字上。
 *
 * ⚠ **有一类多音字这张表永远收不了：两个读音同调的。**
 * 探针量的是基频曲线（声调），声母韵母它看不见 —— 「落」là / luò 都是四声，
 * 「血」xuè / xiě 都是四声，「都」dōu / dū 都是一声，量出来一模一样。
 * 而且替身字机制本身也不成立：替身靠的是同音替换，可这里两个读音本来就不同音，
 * 挑哪个替身都得先知道该读哪个。
 *
 * **写稿的时候绕开它，别在这儿修。** 老马 009 原来写「该在的人一个不落」，
 * 改成了「一个不少」—— 同义、口语、而且「少」在那个位置只有一读得通。
 * 详见 `tone-check.ts` 顶上「两个盲区」。
 */
export const POLY: Record<string, Poly> = {
  假: {
    fallback: 'jiǎ',
    readings: [
      {
        yin: 'jià',
        stand: '架',
        words: ['请假', '休假', '放假', '假期', '假日', '销假', '年假', '病假', '产假', '婚假', '调假', '天假'],
      },
      {
        yin: 'jiǎ',
        stand: '',
        words: ['真假', '假装', '假如', '假设', '假象', '假使', '虚假', '假名', '假冒', '假货', '假话', '掺假', '作假', '假面'],
      },
    ],
    verified:
      '2026-08-20 XiaoxiaoNeural：「调半天假」344→256（对），' +
      '「假也批了」233→317＝三声参照「甲」235→314（错）。替身「架」338→236。',
  },
};

/** 小句边界。模型丢上下文就是在这些符号后面 */
const BOUNDARY = /[。！？；，、：…—「」『』（）()\n]/;

export interface Hit {
  /** 原文里的那一小句，报给人看 */
  clause: string;
  char: string;
  /** 定成了哪个读音 */
  yin: string;
  /** 换成了什么字；空表示只告警没动 */
  stand: string;
}

/**
 * 把一段正文切成小句。**要保留分隔符**，替换完还得原样拼回去。
 */
function clauses(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (BOUNDARY.test(ch)) {
      if (cur) out.push(cur);
      out.push(ch);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** 本期的正音配置。写在 发布.json 的 `正音` 字段里 */
export interface YinTable {
  /** 人工替换，键是原文片段，值是送给 TTS 的片段。先跑，优先级最高 */
  改?: Record<string, string>;
  /**
   * 自动规则的豁免名单。**含有这里任一片段的小句，自动规则一律不碰。**
   *
   * 需要它是因为自动规则会赌一把：小句开头的多音字，默认写稿人要的不是那个
   * 「缺上下文时模型会挑的读音」。这个赌绝大多数时候对，但「假的东西」这种
   * 正好要 jiǎ 又没进安全词表的，就会被改成「架的东西」—— 而且没人听得出来
   * 哪儿不对，只觉得这句怪。豁免名单是给这种情况留的手动刹车。
   */
  免?: string[];
}

/**
 * 正音。返回送给 TTS 的文本，以及改了哪些地方。
 *
 * @param text 原文（字幕用的那一份，不会被改）
 * @param t    本期正音配置
 */
export function zhengyin(text: string, t: YinTable = {}): { tts: string; hits: Hit[] } {
  const hits: Hit[] = [];
  let tts = text;

  // ① 本期人工表。整段字面替换，写什么是什么
  for (const [from, to] of Object.entries(t.改 ?? {})) {
    if (!tts.includes(from)) continue;
    tts = tts.split(from).join(to);
    hits.push({ clause: from, char: '', yin: '人工', stand: to });
  }

  // ② 自动规则：多音字站在小句开头，而且不在任何安全组词里
  const exempt = t.免 ?? [];
  const parts = clauses(tts);
  for (let i = 0; i < parts.length; i++) {
    const c = parts[i];
    if (c.length === 0 || BOUNDARY.test(c)) continue;
    if (exempt.some((e) => c.includes(e))) continue;
    const head = c[0];
    const p = POLY[head];
    if (!p) continue;

    // 开头这个字已经在某个安全词里了（「假期批了」这种），模型读得对，别动
    const inSafe = p.readings.some((r) => r.words.some((w) => c.startsWith(w)));
    if (inSafe) continue;

    // 挑一个不是 fallback 的读音 —— fallback 正是模型缺上下文时会挑的那个，
    // 既然写稿人把这个字放在这里，要的多半是另一个。只有一个候选时才自动改。
    const cand = p.readings.filter((r) => r.yin !== p.fallback && r.stand);
    if (cand.length !== 1) {
      hits.push({ clause: c.slice(0, 12), char: head, yin: '待定', stand: '' });
      continue;
    }
    const r = cand[0];
    parts[i] = r.stand + c.slice(1);
    hits.push({ clause: c.slice(0, 12), char: head, yin: r.yin, stand: r.stand });
  }
  tts = parts.join('');

  return { tts, hits };
}

/** 把 hits 打成一段能直接看的报告 */
export function report(hits: Hit[]): string[] {
  return hits.map((h) =>
    h.char
      ? h.stand
        ? `　「${h.clause}」 ${h.char}→${h.stand}（定 ${h.yin}）`
        : `　「${h.clause}」 ${h.char} 有多个读音，自动定不了 —— 写进本期正音表`
      : `　「${h.clause}」→「${h.stand}」（人工表）`
  );
}

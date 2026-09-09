/**
 * 高总英语频道 · 时间表自检（出片方案 §7.3 的八项）
 *
 * **这份是唯一一处算配比和阈值的地方。** `build.mjs`（出片前的闸）和
 * `index.mjs`（稿件库那张页）都 import 它 —— 页面上写的「DOC 26%」和闸里
 * 拦不拦，必须是同一个数算出来的。两处各算一套，迟早会一边绿一边红。
 *
 * 纯函数 ＋ 一次 fs.existsSync：不跑 ffmpeg、不渲图，所以生成页面时可以随便调。
 */
import fs from 'node:fs';
import path from 'node:path';
import { statement字号 } from './numcard-core.mjs';

export const FPS = 30;

/** 一块的时长／帧数 */
export const dur = (s) => +(s.end - s.start).toFixed(3);
export const nfr = (s) => Math.round(dur(s) * FPS);

/**
 * 素材在哪儿。三种形状，别混：
 * - `frames` 写**组名** —— 帧序列全频道共用，落在 `projects/高总/_帧/`
 * - `clip` 以 `_素材/` 开头 —— 走全频道共用的 C 层素材库 `projects/高总/_素材/`
 * - `clip` 其余写法 —— 相对本条稿件的工作目录，本期专用
 *
 * 前两条跟交接过来的 v4 原稿不同，理由见《英文频道出片方案》§16 仓库版变更。
 *
 * **为什么 C 层要有共用层**：DOC 录屏跟本期数据绑死，攒不了；但通用空镜
 * （路面、车流、街景、施工）多期反复要，一期一份等于每期重找一次料 ——
 * 而 C 层每期预算 60 min，是单条里第二贵的素材工序（方案 §17 工时表）。
 * 存**原件**，不存调好色的：§6.5 那道统一调色是出片时过的，存调色后的会调两遍。
 */
export function 素材路径(s, 根) {
  if (s.layer === 'A') return null;
  if (s.layer === 'B') return path.join(根.帧, s.frames);
  const 共用 = '_素材/';
  if (s.clip?.startsWith(共用)) return path.join(根.素材, s.clip.slice(共用.length));
  return path.join(根.工作, s.clip);
}

/**
 * 音乐在哪儿。跟 `素材路径()` 同一个约定：`_音乐/` 开头走全频道共用库
 * `projects/高总/_音乐/`，其余相对本条工作目录。
 *
 * 背景音乐天然是跨期共用的 —— 同一首会在很多期里反复用，一期存一份既费盘
 * 又会出现「哪份是最新的」这种问题。**解析只在这一处**，`build.mjs` 和自检都用它。
 */
export function 音乐路径(cfg, 根) {
  if (!cfg.music?.file) return null;
  const 共用 = '_音乐/';
  return cfg.music.file.startsWith(共用)
    ? path.join(根.音乐 ?? 'projects/高总/_音乐', cfg.music.file.slice(共用.length))
    : path.join(根.工作, cfg.music.file);
}

/**
 * @param {object} cfg  时间表模块的 default 导出
 * @param {{工作:string, 帧:string}} 根
 * @returns {{行:Array, 总长:number, 配比:object, 硬伤:string[], 提醒:string[]}}
 */
export function 自检(cfg, 根) {
  const T = cfg.timeline || [];
  const 硬伤 = [], 提醒 = [], 行 = [];
  let cursor = 0;

  for (const s of T) {
    /* 1 时间轴连续性 —— 首尾相接、无缝无叠 */
    if (Math.abs(s.start - cursor) > 0.001)
      硬伤.push(`第 ${s.id} 块时间轴不连续：应从 ${cursor}s 起，实际 ${s.start}s`);
    cursor = s.end;

    /* 2 图层互斥 —— layer 是单值字段，这儿防的是配置里残留了旧的并列字段 */
    for (const k of ['layerA', 'layerB', 'layerC', 'layerDOC'])
      if (k in s) 硬伤.push(`第 ${s.id} 块含废弃字段 ${k}：现在用单值 layer`);
    if (!['A', 'B', 'C', 'DOC'].includes(s.layer))
      硬伤.push(`第 ${s.id} 块的 layer 非法：${s.layer}`);

    /* 6 素材齐备 ＋ 备料说明 */
    const src = 素材路径(s, 根);
    const 有 = s.layer === 'A' ? true : fs.existsSync(src);
    if (!有) 硬伤.push(`第 ${s.id} 块缺素材：${src}`);
    if (s.layer === 'DOC' && !s.credit) 提醒.push(`第 ${s.id} 块是 DOC 但没有 credit 角标`);

    /* 6（下半）备料说明 —— C / DOC 要写清楚「这块要准备成什么样」。
       说明缺了**不拦出片**：文件在就能合成，说明只是留档。
       但文件也缺、说明也没有，就是真卡住了 —— 既没素材，也不知道要去找什么。
       这一项换掉了原先手写在工作表 §6 的那张表：一处写两处用，
       改了 clip 名而忘了改说明的那种不同步，从数据结构上就不可能发生。 */
    const 需说明 = s.layer === 'C' || s.layer === 'DOC';
    const 说明 = 需说明 ? (s.素材 ?? null) : null;
    if (需说明 && !说明?.要)
      (有 ? 提醒 : 硬伤).push(
        `第 ${s.id} 块没写素材说明（\`素材.要\`）${有 ? '' : ' —— 缺件又不知道要准备什么'}`);

    /* 待机帧组不能配在有台词的块上 —— **嘴不动**。
       判据用 caption：这一块的时间范围内有字幕，就说明有人在说话。
       2026-09-09 实测三条片子的最后一块全犯了这个错（照抄上一条的模式），
       而它渲出来完全不报错，只是角色闭着嘴「说」完最后一句。 */
    if (s.layer === 'B' && /idle/i.test(s.frames || '')) {
      const 有字幕 = (cfg.captions ?? []).some((c) => c.t0 < s.end && c.t1 > s.start);
      if (有字幕)
        硬伤.push(`第 ${s.id} 块用了待机帧组 \`${s.frames}\`，但这一块有字幕（＝有台词）—— 嘴不会动，换 talk 组`);
    }

    /* statement 卡的句子长度。字号按行数和行宽取小，太长就压得看不清；
       resvg 既不换行也不报错，超出画面的字**直接被裁掉**。 */
    if (s.layer === 'A' && s.card?.type === 'statement' && s.card.lines) {
      const r = statement字号(String(s.card.lines).split('\n'));
      if (r.size < 78)
        提醒.push(`第 ${s.id} 块的 statement 卡最长一行 ${r.最长} 字符，字号被压到 ${r.size}`
          + `（按行数本该 ${r.按行数}）—— 落点句该更短，或者拆行`);
    }

    /* 数据条（lower）—— 叠在主讲人身上的一条数字，**不占层**。
       只能挂 B 层：A 层本身就是字卡，再叠一条是重复；C / DOC 的 overlay 位置
       已经被 credit 角标占着（`层素材()` 那条路径还没接 lower）。
       它不参与配比、不改变这一块的 layer —— 跟 credit / box 同类（方案 §7.3）。 */
    if (s.lower) {
      if (s.layer !== 'B')
        硬伤.push(`第 ${s.id} 块在 ${s.layer} 层挂了数据条 —— \`lower\` 目前只支持 B 层`);
      if (s.lower.value === undefined || s.lower.value === null || s.lower.value === '')
        硬伤.push(`第 ${s.id} 块的数据条没写 \`lower.value\``);
      /* 跟 punch 同一个坑：数据条在 y920–1120，而 MCU 特写的嘴正好落在那儿。
         2026-09-09 实测 asylum_wording 第 2 块，条子直接盖住下半张脸 ——
         punch 那条闸当时加了，lower 漏了，同一个坑踩两次。 */
      if (/^mcu/i.test(s.frames || ''))
        硬伤.push(`第 ${s.id} 块用 MCU 特写配数据条 —— 条子会盖住嘴，换 MS 系帧组`);
    }

    /* punch 强调字幕 —— A 层字卡的替代品（2026-09-09 拆掉 A 层）。 */
    if (s.punch) {
      if (s.layer === 'A')
        硬伤.push(`第 ${s.id} 块是 A 层还挂 punch —— A 层已废弃，直接换成 B / C / DOC`);
      if (!s.punch.lines)
        硬伤.push(`第 ${s.id} 块的 punch 没写 \`lines\``);
      /* punch 中心在 y1020，MCU 特写脸占到 y1150 —— 字必然盖住眼睛，实测过 */
      if (/^mcu/i.test(s.frames || ''))
        硬伤.push(`第 ${s.id} 块用 MCU 特写配 punch —— 字会盖住眼睛，换 MS 系帧组`);
      /* punch 两行占 y794–1246，数据条占 920–1120，同块必然叠在一起 */
      if (s.lower)
        硬伤.push(`第 ${s.id} 块同时有 punch 和 lower —— 两者纵向重叠，一块只能挂一个`);
      /* punch 已经把整句摆上画面了，再叠字幕是同一句话说两遍
         （判据从原来的「哪一层」变成「这一块有没有 punch」） */
      const 有字幕 = (cfg.captions ?? []).some((c) => c.t0 < s.end && c.t1 > s.start);
      if (有字幕)
        提醒.push(`第 ${s.id} 块有 punch 又配了字幕 —— 同一句话说两遍，参照原来「A 层不配字幕」`);
    }

    /* 收尾卡（outro）—— 只给最后一句引导问题（方案 §8.1）。
       前七句是陈述，最后这句是把球扔给观众，性质不同；而且落点刚用过 punch，
       紧接着再来一个强调就被稀释了 —— 一条片三次 punch 就不叫强调。 */
    if (s.outro) {
      if (s.id !== T[T.length - 1].id)
        硬伤.push(`第 ${s.id} 块用了 outro —— 收尾卡只给**最后一块**（§8.1 引导问题）`);
      if (!s.outro.lines) 硬伤.push(`第 ${s.id} 块的 outro 没写 \`lines\``);
      if (s.punch) 硬伤.push(`第 ${s.id} 块同时有 outro 和 punch —— 收尾卡本身就是强调，别叠`);
      const 有字幕 = (cfg.captions ?? []).some((c) => c.t0 < s.end && c.t1 > s.start);
      if (有字幕)
        提醒.push(`第 ${s.id} 块有 outro 又配了字幕 —— 同一句话说两遍，跟 punch 一个道理`);
    }

    /* A 层已废弃（2026-09-09）：字卡显示的就是台词，而字幕本来也在显示台词，
       为此牺牲整块画面是纯损失。改用 punch（句子）或 lower（数字）叠在画面上。 */
    if (s.layer === 'A')
      提醒.push(`第 ${s.id} 块还在用 A 层字卡 —— A 层已废弃，句子改 \`punch\`、数字改 \`lower\``);

    行.push({ id: s.id, layer: s.layer, start: s.start, end: s.end, 时长: dur(s),
              素材: s.layer === 'A' ? `字卡 ${s.card?.type ?? '?'}` : src, 有, credit: s.credit || null,
              说明, 共用: !!s.clip?.startsWith('_素材/'),
              /* 上屏的英文原样带出去，汇总页要拿它跟 `中` 并排显示 —— 页面是给中文读者看的 */
              credit中: s.credit中 || null, card: s.card || null });
  }

  const sum = (L) => T.filter((s) => s.layer === L).reduce((a, s) => a + dur(s), 0);
  const p = (L) => (cursor ? Math.round((sum(L) / cursor) * 100) : 0);
  const 配比 = { A: p('A'), B: p('B'), C: p('C'), DOC: p('DOC') };

  /* 4 字卡连排不超过 2 张 */
  let run = 0, worst = 0;
  for (const s of T) { run = s.layer === 'A' ? run + 1 : 0; worst = Math.max(worst, run); }
  if (worst > 2) 硬伤.push(`有 ${worst} 张字卡连排，超过 2 张的阈值`);

  /* 5 主讲人每条至少出现 3 次 */
  const b次 = T.filter((s) => s.layer === 'B').length;
  if (T.length && b次 < 3) 硬伤.push(`主讲人只出现 ${b次} 次，硬阈值是 3 次`);

  /* 3 / 7 四层配比与 DOC 下限 */
  if (T.length && 配比.DOC < 15) 硬伤.push(`DOC 层只有 ${配比.DOC}%，硬阈值是 15%`);
  if (T.length && 配比.B < 20) 提醒.push(`主讲人占比 ${配比.B}%，偏低（参考 25%）`);

  /* 字幕长度 —— 方案 §6.6「每屏 3–5 词」。
     这不只是排版偏好：字幕 MarginV=520 是**底边**，多出来的行往上长，
     行数一多就顶到角标那一层（角标底边距底 320）。坑洞篇第 6 块 12 个词排了 5 行，
     实测把角标压住了。词数是这件事最便宜的判据 —— 行数要等 libass 排完才知道。 */
  for (const c of cfg.captions ?? []) {
    const 词 = String(c.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    if (词 > 5) 提醒.push(`字幕 ${c.t0}–${c.t1} 有 ${词} 个词，超过 §6.6 的 5 词上限（会排成多行往上顶）`);
  }

  /* 音频与音乐 */
  const 音 = cfg.audio ? path.join(根.工作, cfg.audio) : null;
  if (!音) 硬伤.push('时间表里没写 audio');
  else if (!fs.existsSync(音)) 硬伤.push(`缺人声：${音}`);
  if (cfg.music?.file) {
    const m = 音乐路径(cfg, 根);
    if (!fs.existsSync(m)) 硬伤.push(`缺音乐：${m}`);
    /* db 是**相对这首曲子原始电平**的衰减，不是绝对目标 ——
       换一首不重测就照抄，音乐要么听不见要么盖住人声（见 _音乐/来源.md）。 */
    if (typeof cfg.music.db !== 'number')
      硬伤.push('配了音乐但没写 `music.db` —— 衰减量必须按那首曲子实测的 LUFS 算');
    else if (cfg.music.db > -12)
      提醒.push(`music.db 是 ${cfg.music.db}dB，衰减偏小 —— §5.1 要求音乐比人声低 18–22dB`);
  }

  /* 克制型篇目：方案 §4.3 —— 不出角色、不放引导问题、不用音乐 */
  if (cfg.克制型) {
    if (b次) 硬伤.push('克制型篇目不出角色，但时间表里有 B 层');
    if (cfg.music) 硬伤.push('克制型篇目不配音乐');
  }

  return { 行, 总长: +cursor.toFixed(3), 配比, 硬伤, 提醒, 主讲人次数: b次, 字卡连排: worst };
}

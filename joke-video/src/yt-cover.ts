// ── YouTube 缩略图：跨线的那一张 ──────────────────────────────────────
//
// 用法：npx tsx src/yt-cover.ts --ep E05
//
// 规范全文在仓库根 `YouTube封面规范.md`（v3）。**这里只做实现，版式数值一律照抄**，
// 想改版式去改那份文档，不要在这儿"顺手调一下"。
//
// ── 这是哪一张图 ──
//
// 规范 §〇：三张图是三回事。
//
//   缩略图    给还没点进来的人看，在 YouTube 白底信息流里被看见   ← **本文件**
//   片头首帧  给已经点进来的人看，接住、定调子                  ← shuoshu-cover.ts
//   片内画面  给正在听的人看，陪伴、不抢注意力                  ← shuoshu-scene.ts
//
// 所以**不要拿这套配色去对齐 shuoshu-cover.ts 的 SERIES.liaozhai**（渐变靛青＋朱砂）。
// 规范里专门写了一条警告：两张图各自服各自的场，改成一样是错的。
//
// ── 为什么是 TS 不是 Python ──
//
// 规范 §八 给了两条路：甲＝装 Python 让原型 `cover_yt.py` 入库；
// 乙＝移植到 shuoshu-cover.ts 已经在用的 resvg 链路。**走的是乙**：
// 字体（fonts/NotoSerifCJKsc 那七个静态 OTF）本来就是当初为说书封面放的，
// 自检缩图也是现成的；甲要多一个运行时，而且本机 python3 只是商店占位符。
//
// 代价是规范 §七 那四项像素级检测要自己写成位图扫描 —— 下面 probe() 那一段就是。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { resolveEp } from './shuoshu-ep.js';
import { resolveEp as resolveZhiyuEp, LINE as ZHIYU_LINE } from './zhiyu-ep.js';

// ── §一 画布与安全区 ──────────────────────────────────────────────────
const W = 1280;
const H = 720;
const M = 72;
/** 文字区右界。副标超过这里就降档（§七.2） */
const TEXT_MAX_X = 690;
/** 图形中心 */
const MOTIF_CX = 968;
const MOTIF_CY = 344;
/** 右下角 YouTube 时长角标的位置，必须留空（§一 / §七.3） */
const SAFE = { x0: 1080, x1: 1280, y0: 640, y1: 720 };

// ── §四 字号与坐标 ────────────────────────────────────────────────────
const MAIN_PT = 250;      // 主字（2 字）
const MAIN_PT_3 = 190;    // 3 字降到这里
const HOOK_PT = 58;       // 副标；眉标同此值
const SEAL_R = 34;
const SEAL_PT = 42;
const HOOK_INDENT = 64;   // 副标第二行错行缩进
const KICKER_PAD = 30;    // 眉标与图形的最小间隙
const SHADOW_OFF = 13;    // 主字错位影偏移

const SEAL_C = { x: 104, y: 88 };
const KICKER_X = 162;
const KICKER_CY = 88;
const MAIN_X = 64;        // 左对齐的左缘
const MAIN_CY = 266;      // 纵向居中的中线
const RULE = { x0: 72, y0: 412, x1: 204, y1: 423, h: 12 };
const HOOK_X = 72;
const HOOK_Y1 = 500;      // 第一行纵向中线
const HOOK_GAP = HOOK_PT * 1.32;

// ── 方版（微信 1:1）─────────────────────────────────────────────────
//
// **方版是另排的一版，不是把横版裁方。** 横版的版式横着长：主字占左边，
// 图形在右边一整块。裁成方的，图形就没了一半。
//
// 所以方版把图形挪到右上、主字压到中段、副标垫底 —— 元素一个不少，
// 但纵向排开。这条规矩是从旧版说书封面那边搬过来的，那边踩过一次。
const SQ = 1080;
const SQ_SEAL = { x: 96, y: 92 };
const SQ_KICKER_X = 154;
const SQ_KICKER_PT = 54;
const SQ_MAIN_CY = 640;
const SQ_MOTIF = { cx: 760, cy: 330, scale: 0.68 };
const SQ_RULE = { x0: 72, y0: 790, x1: 204, y1: 801, h: 12 };
const SQ_HOOK_Y1 = 880;

// ── §二 两套配色 ─────────────────────────────────────────────────────
export interface YtPalette {
  bg: string;
  ink: string;
  /** 副标字色。不给就是白（深底档）*/
  hook?: string;
  acc: string;
  mute: string;
  seal: string;
}
export const PALETTES: Record<string, YtPalette> = {
  /** 聊斋说书 / 心理洞察 / 哲理向 */
  ink: { bg: '#141C24', ink: '#F2EFE8', acc: '#D6452F', mute: '#5C6B75', seal: '#D6452F' },
  /** 治愈 / 助眠 / 古典随笔 / 禅佛典。错位影用暖月色，**不用朱砂** */
  night: { bg: '#142234', ink: '#F1EDE3', acc: '#E8C87A', mute: '#3A4E66', seal: '#C4432F' },
  /**
   * `paper` —— **治愈线保留自己的和纸画风，只借 V3 的版式**（2026-08-24 用户定）。
   *
   * 色值原样搬自 `zhiyu-cover.ts`：纸 #F6F2E8、远景墨绿 #2F4A3F、暖带 #E8A95E、印 #C0503C。
   * 所以它跟片内画面、片头首帧仍是同一套颜色，只有排版换成了 V3。
   *
   * ⚠ **这一档是知情地违反 §二 的。** 规范把治愈线定在 `night`（深靛底），
   * 理由写在 §〇：浅米白封面在 YouTube 的白界面里没有边界、直接融进背景，
   * 那是点击率被压住的直接原因。选 `paper` 等于把那条结论换成「风格统一」优先。
   * **要验就看 210 试样贴在白底上像不像一块**，不是看 1280 好不好看。
   *
   * 朱砂只留在印章里（这条跟 night 档一致）：错位影和副标重点词都走暖带色 `acc`。
 *
 * ⚠ **`mute` 在这一档是「副标的字色」，不是「远山的淡色」。** 第一版给了 #AEBFB0，
 * 山画得挺好看，副标在米白纸上白花花一片读不出来 —— 深底档是灰蓝配纸白字，
 * 浅底档整个反过来。要更淡的层次只能在 motif 里靠形状叠，不能靠再要一个色。
   */
  paper: { bg: '#E8DFCB', ink: '#2F4A3F', acc: '#E8A95E', mute: '#7E9184', seal: '#C0503C', hook: '#5B6F63' },
};
/** 副标固定纯白：比主字的纸白更实，压在错位影上不会被拖糊（§二末） */
/**
 * 副标字色的**兜底**。深底档就是纸白，浅底档必须在色板里另给一个（`YtPalette.hook`）——
 * 写死白色的时候，`paper` 档的副标在米白纸上整行看不见，而四项自动检测全绿：
 * 它们查的是位置、宽度、安全区，**没有一项在查「看不看得见」**。
 */
const HOOK_FILL = '#FFFFFF';

// ── §三 字体 ─────────────────────────────────────────────────────────
//
// 主字：思源宋体 Black。仓库里那七个静态 OTF 是**真字重** ——
// 别退回可变字体，resvg 对 weight 轴支持有限，font-weight 900 会渲成 Regular。
//
// 眉标/副标：规范写的是思源黑体 Bold，**仓库里没有黑体**，退到系统的微软雅黑 Bold。
// §三 那条"微软雅黑字重不足"的警告针对的是主字（250px 的大字露怯），
// 58px 的眉标副标用雅黑 Bold 是够的。哪天思源黑体入库，把 SANS_FAMILY 换掉即可。
const FONT_DIR = '../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/';
const SERIF_FILES = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular']
  .map((w) => `${FONT_DIR}NotoSerifCJKsc-${w}.otf`)
  .filter((f) => existsSync(f));
const SERIF_FAMILY = SERIF_FILES.length ? 'Noto Serif CJK SC' : 'Noto Serif SC, SimSun, serif';
const SANS_FAMILY = 'Noto Sans CJK SC, Source Han Sans SC, Microsoft YaHei, SimHei, sans-serif';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const n = (v: number) => Math.round(v * 100) / 100;

// ── §六 图形（motif）契约 ────────────────────────────────────────────
//
// 新增 motif 必须同时满足：
//   ① 只用 3 个色：bg / ink（或 acc）/ mute。不做渐变、不做描边叠加
//   ② 最小笔画宽度 ≥ 7px
//   ③ **主体是实心色块，不是线稿**
//   ④ 外接尺寸 ≈ 400 × 540，中心 (968, 344)
//   ⑤ 不得进入右下安全区
//   ⑥ 缩到 210px 仍能一眼说出画的是什么
//
// ③ 不是审美偏好：规范 §九 记着第一版蟋蟀是几条线拼的，缩小后只剩一团白影加两根须子。
export type Motif = (C: YtPalette) => string;

export const YT_MOTIFS: Record<string, Motif> = {
  /**
   * `snow_boat` —— **治愈 taoan-E01《痴人夜行》。** 一轮暖月、两层山影、一道湖面、
   * 湖上一条小得几乎看不见的船。出处是这一期的原文：「舟中人两三粒而已」。
   *
   * 跟 ink / night 那几个 motif 不一样，这一档要的是**这条线自己的插画语气**
   * （层叠山影、暖日轮），不是三色平涂的符号。但下面两条仍旧照 §六 守：
   *
   * ① **只用色板里的色，一个都不外加。** 探针那一步靠「把五个色全换成纯蓝、再量蓝色外接框」
   *    定眉标右界；motif 里出现色板之外的颜色，那一块就量不到，眉标会压上去。
   * ② **不用半透明。** 同理：opacity < 1 的地方在探针图里不是纯蓝，一样量不到。
   *    所以三层深浅只能靠 ink / mute 两个实色 ＋ 暖月 acc 来分。
   *
   * ⚠ 船只有 150×34。**210px 下它只剩 25×6 像素**，读出来的是"湖上有个小东西"，
   * 不是"一条船" —— 这是知情的：这一期要的就是"两三粒"，看不清正是那句原文的意思。
   * 真觉得不行就把船去掉，只留月和山，别把它放大到看得清（放大就不是那句话了）。
   */
  snow_boat: (C) => {
    const cx = MOTIF_CX;
    // 暖月：压在山后只露上半个。**别画大** —— 它是月不是太阳，大了整张的重心就跑到右边去
    const moon = `<circle cx="${cx + 112}" cy="178" r="62" fill="${C.acc}"/>`;
    // 远山：连绵的缓峰，不是孤立三角。**峰要多、要不等高**，那是这条线插画的语气
    const far =
      `<path d="M 758 430 L 830 340 L 884 380 L 952 302 L 1020 372 L 1082 326 L 1178 430 Z" fill="${C.mute}"/>`;
    // 近山：深的一层压在前面。**山脚停在 430**，下面留一条纸的空当给船
    const near =
      `<path d="M 758 430 L 852 368 L 918 410 L 1002 352 L 1064 406 L 1178 430 Z" fill="${C.ink}"/>`;
    // 水平线：一道细带，是雪面不是水，用中间那一色
    const lake = `<rect x="758" y="486" width="420" height="10" fill="${C.mute}"/>`;
    // 小船：坐在水平线上，**整条落在山脚与线之间那块纸上** ——
    // 第一版把它画在山脚同一高度、又是同色，等于没画（1280 上都找不着）
    const bx = cx - 74, by = 486;
    const boat =
      `<path d="M ${bx - 60} ${by - 22} L ${bx + 60} ${by - 22} L ${bx + 42} ${by} L ${bx - 42} ${by} Z" fill="${C.ink}"/>` +
      `<rect x="${bx - 22}" y="${by - 42}" width="44" height="20" fill="${C.ink}"/>`;
    return moon + far + near + lake + boat;
  },

  /**
   * `smile_flat` —— **E05《婴宁》新增。**
   *
   * 上面一道上翘的实心月牙（笑），下面一条平直的横杠（不笑）。
   * 中间那段空白是这一期的全部：她从上面变成了下面。
   *
   * 全实心、无线稿、最细处 ≥ 26px，缩到 210px 还是"一个笑和一条直线"。
   * **月牙用纸白不用朱砂** —— 朱砂已经占了印章、主字错位影和副标重点词三处，
   * 再加一处，整张就散成四个红点（§九 最后一条踩的就是这个坑）。
   */
  smile_flat: (C) => {
    // 月牙：外弧下垂、内弧下垂得更多，两条弧夹出一个上翘的嘴角
    const cx = MOTIF_CX;
    const w = 380;
    const yTop = 185;
    const outer = `M ${cx - w / 2} ${yTop} Q ${cx} ${yTop + 250} ${cx + w / 2} ${yTop}`;
    const inner = `Q ${cx} ${yTop + 140} ${cx - w / 2} ${yTop}`;
    return (
      `<path d="${outer} ${inner} Z" fill="${C.ink}"/>` +
      // 直杠：同宽、同色、厚 32。**同色是第一版栽的地方** ——
      // 一开始用 mute（#5C6B75）画它，1280 上还看得见，缩到 210px 就化进深底里没了，
      // 剩下一个笑，跟主字「不笑」正好打架。规范 §六.6 那条"缩到 210px 仍能一眼说出
      // 画的是什么"，说的就是这种失败：不报错，1280 上还挺好看。
      `<rect x="${cx - w / 2}" y="470" width="${w}" height="32" fill="${C.ink}"/>`
    );
  },

  /**
   * `face` —— 说书 E01《画皮》。侧脸整块 + 底下偏移一层。
   *
   * **侧脸只能整块用。** 规范 §九：试过"外面一张空皮、里面另一张脸"，
   * 做出来是个兜帽形状 —— 鼻子嘴巴那几个凹口太小，缩下去扛不住。
   * 那张皮的意思由**底下那一层朱砂**承担：同一个轮廓，错开一点，像脱下来的一层。
   */
  face: (C) => {
    const d =
      'M 872 600 L 872 330 Q 872 150 960 132 Q 1020 120 1032 226 Q 1038 262 1024 272 ' +
      'L 1062 336 Q 1068 348 1046 356 L 1026 362 Q 1040 372 1032 388 Q 1024 398 1010 400 ' +
      'Q 1022 412 1014 430 Q 1006 452 976 468 Q 946 484 940 512 L 946 600 Z';
    const fit = `translate(${MOTIF_CX},${MOTIF_CY}) scale(1.24,1.03) translate(${-MOTIF_CX},${-MOTIF_CY})`;
    return (
      `<g transform="${fit}"><path d="${d}" transform="translate(22,22)" fill="${C.acc}"/>` +
      `<path d="${d}" fill="${C.ink}"/></g>`
    );
  },

  /**
   * `wall` —— 说书 E03《崂山道士》。砖墙出血 + 人形撞上去 + 撞击线。
   *
   * **墙落在 y=624 的地面线上，不出血到底。** 规范 §九：原先从画布顶出血到底，
   * 右下安全区被占了 86%，肉眼看不出来，检测脚本一跑就出来。人站同一条地面线。
   *
   * 撞击线用纸白不用朱砂 —— 契约①只给三个色（bg / ink 或 acc / mute），
   * 墙已经占了 mute，再上朱砂就是第四个。
   */
  wall: (C) => {
    const groundY = 624;
    const wx = 1000;
    let out = `<rect x="${wx}" y="112" width="${W - wx}" height="${groundY - 112}" fill="${C.mute}"/>`;
    // 砖缝抠成底色。**横缝之外还要错开的竖缝** —— 第一版只有横缝，
    // 渲出来是一片百叶窗，不是砖墙。砖之所以是砖，全在那个错缝
    for (let i = 1; i < 6; i++)
      out += `<rect x="${wx}" y="${112 + i * 86}" width="${W - wx}" height="8" fill="${C.bg}"/>`;
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 2; c++)
        out += `<rect x="${wx + 66 + c * 152 + (r % 2) * 76}" y="${112 + r * 86}" width="8" height="86" fill="${C.bg}"/>`;
    // 撞击：**在墙上抠裂缝，不在人头上画线。**
    // 第一版是三道从脑袋后面伸出去的楔子，渲出来像头上插了根天线 ——
    // 挨撞的是墙，痕迹就该留在墙上，而且抠出来的缝跟砖缝是同一种语言
    for (const [x0, y0, x1, y1] of [
      [1024, 374, 1128, 268],
      [1030, 402, 1186, 396],
      [1024, 432, 1140, 520],
      [1018, 356, 1078, 232],
    ] as const)
      out += `<path d="M ${x0} ${y0 - 11} L ${x1} ${y1 - 5} L ${x1} ${y1 + 5} L ${x0} ${y0 + 11} Z" fill="${C.bg}"/>`;
    // 人形：整个人朝墙倾过去，脑袋扎进墙里。**倾角靠 rotate，不要手算折线** ——
    // 手拼的身子上一版出来是个鞠躬的棋子
    out +=
      `<g transform="rotate(12 960 ${groundY})">` +
      `<path d="M 916 ${groundY} L 926 470 Q 930 438 954 430 L 984 430 Q 1008 440 1010 470 L 1018 ${groundY} Z" fill="${C.ink}"/>` +
      `<circle cx="968" cy="398" r="41" fill="${C.ink}"/>` +
      `</g>`;
    return out;
  },

  /**
   * `seal_bug` —— 说书 E04《促织》。「令」字大印 + 底下一只小蟋蟀。
   *
   * 蟋蟀**只给实心身子 + 折起的后腿**。规范 §九：第一版是几条线拼的，
   * 缩小后只剩一团白影加两根须子 —— 这不是审美偏好，是缩略图尺寸下的物理事实。
   */
  seal_bug: (C) => {
    const s = 232;
    const sx = MOTIF_CX - s / 2;
    const sy = 132;
    return (
      `<rect x="${sx}" y="${sy}" width="${s}" height="${s}" rx="14" fill="${C.acc}"/>` +
      `<text x="${MOTIF_CX}" y="${sy + s * 0.5 + s * 0.36}" font-family="${SERIF_FAMILY}" font-weight="900" font-size="${s * 0.72}" fill="${C.bg}" text-anchor="middle">令</text>` +
      // 虫朝右：身子 + 头 + 两根须在右，折起的后腿在左（后腿在前面那一版画到了
      // 身子上方，渲出来像挂了面旗；尾须两根细三角则被读成速度线，一并去掉）
      `<ellipse cx="910" cy="505" rx="104" ry="42" fill="${C.ink}"/>` +
      `<circle cx="1006" cy="494" r="27" fill="${C.ink}"/>` +
      `<path d="M 1020 482 L 1130 424 L 1136 438 L 1026 494 Z" fill="${C.ink}"/>` +
      `<path d="M 1022 502 L 1134 492 L 1134 506 L 1024 514 Z" fill="${C.ink}"/>` +
      // **折起的后腿：整只虫的辨识度全押在这个折角上。**
      // 粗的股节朝上折，细的胫节再折回来朝下 —— 一个 Λ，缩到 210px 还在
      `<path d="M 924 496 L 860 386 L 826 406 L 890 516 Z" fill="${C.ink}"/>` +
      `<path d="M 844 396 L 806 556 L 828 560 L 866 400 Z" fill="${C.ink}"/>`
    );
  },

  /**
   * `two_hearts` —— **E06《陆判》新增。** 两颗心，一上一下、错开半个身位。
   * 上面那颗纸白（要换掉的），下面那颗是灰的一档（换上来的）。
   * 配主字「换心」，缩到 210px 读出来是"两颗心"，那就够了 —— §六.6 只要求这个。
   *
   * 两条跟前面几个 motif 同源的纪律：
   * ① **第二颗不用朱砂用 mute。** 朱砂已经占了印章、主字错位影、副标重点词三处，
   *    再给它第四处，整张就散成一片红点（smile_flat 那条注释踩过同一个坑）。
   * ② **错开的是横向半个身位，不是叠在一条竖线上。** 竖直对齐读出来是"一颗心的倒影"，
   *    错开才读得出"两颗、在换位置"。
   *
   * 全实心、无线稿，最细处是心尖那一段，仍有 40px 以上。
   */
  two_hearts: (C) => {
    // 心形：从下面的尖起笔，左瓣上去、顶上凹一道、右瓣下来。w/h 是外接尺寸
    const heart = (cx: number, cy: number, w: number, h: number, fill: string) =>
      `<path d="M ${cx} ${cy + h / 2}` +
      ` C ${cx - w * 0.62} ${cy + h * 0.02} ${cx - w * 0.5} ${cy - h * 0.54} ${cx} ${cy - h * 0.16}` +
      ` C ${cx + w * 0.5} ${cy - h * 0.54} ${cx + w * 0.62} ${cy + h * 0.02} ${cx} ${cy + h / 2} Z"` +
      ` fill="${fill}"/>`;
    return (
      heart(MOTIF_CX - 62, 212, 300, 264, C.ink) +
      heart(MOTIF_CX + 62, 478, 300, 264, C.mute)
    );
  },
};

// ── 版式 ─────────────────────────────────────────────────────────────
//
// 两种，靠 `YtSpec.layout` 选。**不是「改一下数值」，是两套排法。**
//
// ── `hook`（缺省，V3 原版）──
//
//   眉标（线名 · 篇名）
//   主字（两个字，250px，钩子不是书名）
//   ▂▂ 斜杠
//   副标两行，各 ≤10 字，第二行错行缩进
//
// 靠「两个大字」把人从信息流里拽住，篇名退到眉标、解释交给副标。
//
// ── `title`（2026-08-24 加）──
//
//   眉标（频道名）
//   标题全文，按标点断行，字号自动收到装得下为止
//   ▂▂ 斜杠
//
// **副标没有了，主位放的是完整标题。** 跟 `hook` 版的取舍正好相反：
// 那一版赌的是「两个字够勾人」，这一版赌的是「把话说全了更可信」。
// 标题本来就写成了一句话（「别人怎么看你，不归你管」），拆成
// 主字「不归」＋副标两行，等于把同一句话拆开又拼回去 —— 拆的那一下就漏了。
//
// 代价写在明处：主字从 250px 掉到 ~108px。**这是知情的**，
// §七.4 那条「主字外接高度 ≥ 画面 30%」靠的是**整块标题的外接框**，
// 不是单个字 —— 两行 108px 的块高约 229px，正好在线上。
// 再长的标题会自动降字号，降到块高不够就报警：那说明标题该改短，不是版式不行。

export interface YtSpec {
  /**
   * 排法。缺省 `hook`（V3 原版，两个大字 ＋ 副标两行）。
   *
   * `title` = 主位放完整标题、没有副标（见上面那段）。
   */
  layout?: 'hook' | 'title';
  /** `线名 · 篇名`。书名放这里，不放主字位（§五）。`title` 版这里放频道名就够了 */
  kicker: string;
  /**
   * 主位的字。
   *
   *   `hook` 版：**两个字、简体、是钩子不是书名**（§五）
   *   `title` 版：**完整标题**，按 `，、。；｜/` 断行（标点本身不上屏），最多三行
   */
  big: string;
  /**
   * 副标两行，各 ≤10 字。用 {} 圈重点词，圈对照关系的两端（§五末）。
   * **`title` 版没有副标**，写了也不画，只报一句。
   */
  hook?: [string, string];
  motif: string;
  palette: 'ink' | 'night' | 'paper';
  /** 副标重点词提示。默认 color；主字笔画少、影子红得整时换 underline（§九） */
  mark?: 'none' | 'color' | 'underline';
  /** 印章那个字 */
  seal?: string;
}

// ── `title` 版的数值 ────────────────────────────────────────────────
//
// 只有这一版用得上，所以摆在一起，别跟上面 V3 那组混着改。

/** 标题右界。图形最左伸到 758，留 38px 的间隙 */
const TITLE_MAX_X = 720;
/** 标题字号的上下限。自动从上限往下收，收到装得下为止 */
const TITLE_PT_MAX = 108;
const TITLE_PT_MIN = 52;
/** 行距系数 */
const TITLE_LH = 1.24;
/**
 * 整块标题的纵向中线。
 *
 * `hook` 版是 266，因为它下面还压着斜杠和两行副标。这一版下面空出来了，
 * 再钉在 266 就是整块字往上飘、底下空掉三分之一。
 *
 * **392 是对着图形的重心定的，不是对着 `MOTIF_CY`（344）。** 那个数是图形的
 * 几何中心，而 `snow_boat` 的分量全压在山上（y 300–496），月亮只是个点。
 * 按 344 排出来，左边一栏整体比右边那座山高一截，看着像没坐稳。
 */
const TITLE_CY = 392;
/** 斜杠跟在标题块下面多远。它在这一版里是收尾，不是分隔 */
const TITLE_RULE_GAP = 54;
/** 方版：整块标题的纵向中线 */
const SQ_TITLE_CY = 700;

/**
 * 标题断行。**按标点断，标点本身不上屏。**
 *
 * 「别人怎么看你，不归你管」→ 两行。断在标点上是因为那儿本来就是气口，
 * 按字数硬切会把词劈开（「别人怎么看」/「你，不归你管」），
 * 而封面上一个被劈开的词比字小更伤。
 */
function titleLines(big: string): string[] {
  return big
    .split(/[，,。、；;：:｜|/\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 把 `压垮她的不是{官司}` 拆成 [文字, 是否重点] */
function marks(line: string): [string, boolean][] {
  const out: [string, boolean][] = [];
  for (const part of line.split(/(\{[^}]*\})/)) {
    if (!part) continue;
    out.push(part.startsWith('{') ? [part.slice(1, -1), true] : [part, false]);
  }
  return out;
}
const plain = (line: string) => line.replace(/[{}]/g, '');
/** 汉字算一个字宽，ASCII 算半个。resvg 没有量文字的接口，只能这么估 */
const textW = (s: string, size: number) =>
  [...s].reduce((a, c) => a + (/[\x00-\xff]/.test(c) ? 0.5 : 1) * size, 0);

function hookLine(line: string, x: number, cy: number, size: number, C: YtPalette, mark: string): string {
  let cx = x;
  const out: string[] = [];
  for (const [text, hot] of marks(line)) {
    const fill = hot && mark === 'color' ? C.acc : C.hook ?? HOOK_FILL;
    out.push(
      `<text x="${n(cx)}" y="${n(cy + size * 0.36)}" font-family="${SANS_FAMILY}" font-weight="700" font-size="${n(size)}" fill="${fill}">${esc(text)}</text>`
    );
    if (hot && mark === 'underline') {
      out.push(`<rect x="${n(cx)}" y="${n(cy + size * 0.56)}" width="${n(textW(text, size))}" height="5" fill="${C.acc}"/>`);
    }
    cx += textW(text, size);
  }
  return out.join('\n');
}

const wrap = (body: string, bg: string, w = W, h = H) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="${bg}"/>
${body}
</svg>`;

/** 印章：一个实心圆 + 一个反白的字 */
const sealMark = (ch: string, C: YtPalette, cx: number, cy: number, r = SEAL_R, pt = SEAL_PT) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.seal}"/>` +
  `<text x="${cx}" y="${n(cy + 2 + pt * 0.36)}" font-family="${SERIF_FAMILY}" font-weight="700" font-size="${pt}" fill="${C.bg}" text-anchor="middle">${esc(ch)}</text>`;

const kickerText = (s: string, x: number, cy: number, pt: number, fill: string) =>
  `<text x="${n(x)}" y="${n(cy + pt * 0.36)}" font-family="${SANS_FAMILY}" font-weight="700" font-size="${n(pt)}" letter-spacing="8" fill="${fill}">${esc(s)}</text>`;

const ruleBar = (r: { x0: number; y0: number; x1: number; y1: number; h: number }, fill: string) =>
  `<path d="M ${r.x0} ${r.y0} L ${r.x1} ${r.y1} L ${r.x1} ${r.y1 + r.h} L ${r.x0} ${r.y0 + r.h} Z" fill="${fill}"/>`;

/** 主字：宋体 Black，一层朱砂错位影在下（§四 / §九「朱砂错位影对笔画少的字露怯」） */
function mainText(big: string, x: number, baseline: number, size: number, fill: string): string {
  return `<text x="${n(x)}" y="${n(baseline)}" font-family="${SERIF_FAMILY}" font-weight="900" font-size="${n(size)}" fill="${fill}">${esc(big)}</text>`;
}

/** `title` 版的主位：同一种字，多行左对齐 */
function titleText(lines: string[], x: number, baseline: number, size: number, fill: string): string {
  const gap = size * TITLE_LH;
  return lines.map((l, i) => mainText(l, x, baseline + i * gap, size, fill)).join('\n');
}

// ── §七 程序必须自动做的四件事：全靠位图扫描 ──────────────────────────
//
// 规范里这四项在 Python 原型里是 Pillow 的像素操作，这边用 resvg 的 .pixels（RGBA）。
// **不要用固定阈值代替实测** —— §九 记着"曾经定死眉标不得越过 x=760，
// 结果被一堵不存在的墙拦住，十条眉标全被压到 42pt"。

interface Box { x0: number; y0: number; x1: number; y1: number; empty: boolean }

function render(svg: string) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: SERIF_FILES, loadSystemFonts: true },
  }).render();
}

/** 扫出某个纯色的外接框。probe 图里每个元素涂成不同的纯色，一次渲染量三样东西 */
function bboxOf(px: Buffer, rgb: [number, number, number], band?: { y0: number; y1: number }): Box {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  const ya = band ? Math.max(0, band.y0) : 0;
  const yb = band ? Math.min(H, band.y1) : H;
  for (let y = ya; y < yb; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // 抗锯齿边缘会掺色，取个宽松的容差；probe 图只有纯色，不会误判
      if (Math.abs(px[i] - rgb[0]) < 60 && Math.abs(px[i + 1] - rgb[1]) < 60 && Math.abs(px[i + 2] - rgb[2]) < 60) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1, empty: x1 < 0 };
}

export interface YtIssue { level: 'error' | 'warn'; msg: string }

export interface YtOut {
  /** 1280×720，上传用（YouTube / B站 / 西瓜，同一张） */
  png: Buffer;
  /** 210px，**唯一的验收标准** */
  preview: Buffer;
  /** 1920×1080，压在成片第一帧 */
  firstFrame: Buffer;
  /** 1080×1080，微信 */
  square: Buffer;
  /** 200px，微信列表里的实际大小 */
  squareCheck: Buffer;
  svg: string;
  squareSvg: string;
  issues: YtIssue[];
}

export function renderYt(spec: YtSpec): YtOut {
  const issues: YtIssue[] = [];
  const C = PALETTES[spec.palette];
  if (!C) throw new Error(`没有这个配色档：${spec.palette}\n可用：${Object.keys(PALETTES).join(' / ')}`);
  const motif = YT_MOTIFS[spec.motif];
  if (!motif) throw new Error(`没有这个 motif：${spec.motif}\n可用：${Object.keys(YT_MOTIFS).join(' / ')}`);
  const mark = spec.mark ?? 'color';
  const layout = spec.layout ?? 'hook';
  const isTitle = layout === 'title';

  // ── 主位：两种版式各有各的字号规则 ──
  const lines = isTitle ? titleLines(spec.big) : [spec.big];
  let mainSize: number;
  if (isTitle) {
    if (!lines.length) throw new Error(`title 版式的 big 是空的：「${spec.big}」`);
    if (lines.length > 3)
      issues.push({ level: 'error', msg: `标题断出 ${lines.length} 行（上限 3）。封面不是简介栏 —— 标题该改短` });
    // 自动收字号：从上限往下 2px 一档，收到最宽那行装进 TITLE_MAX_X 为止
    const widest = Math.max(...lines.map((l) => textW(l, 1)));
    mainSize = TITLE_PT_MAX;
    while (mainSize > TITLE_PT_MIN && MAIN_X + widest * mainSize > TITLE_MAX_X) mainSize -= 2;
    if (mainSize !== TITLE_PT_MAX)
      issues.push({ level: 'warn', msg: `标题放不下，字号从 ${TITLE_PT_MAX} 收到 ${mainSize}（最长一行「${lines.reduce((a, b) => (a.length > b.length ? a : b))}」）` });
  } else {
    const bigChars = [...spec.big].length;
    if (bigChars > 3) issues.push({ level: 'error', msg: `主字「${spec.big}」${bigChars} 字。规范 §五：两个字，三字只在图形让位时才允许` });
    else if (bigChars === 3) issues.push({ level: 'warn', msg: `主字「${spec.big}」3 字，字号要降到 ${MAIN_PT_3}px —— 高度会跌到画面的 26%，只在图形让位时才用` });
    mainSize = bigChars >= 3 ? MAIN_PT_3 : MAIN_PT;
  }

  // ── 副标：只有 hook 版有 ──
  //
  // **title 版写了 hook 也不画**，但要说一句：数据留在 发布.json 里没人删，
  // 下次有人换回 hook 版才发现副标是三个月前的 —— 不如现在就报出来。
  const hook = spec.hook;
  if (isTitle && hook) issues.push({ level: 'warn', msg: `title 版式没有副标，发布.json 里那两行（「${plain(hook[0])}」…）不会上图` });
  if (!isTitle && !hook) throw new Error('hook 版式必须给副标两行（要没有副标就用 "layout": "title"）');
  if (!isTitle && hook) {
    for (const [i, line] of hook.entries()) {
      const len = [...plain(line)].length;
      if (len > 10) issues.push({ level: 'warn', msg: `副标第 ${i + 1} 行「${plain(line)}」${len} 字，超过 10 字（§五）` });
    }
    const hotCount = hook.reduce((a, l) => a + marks(l).filter(([, h]) => h).length, 0);
    if (hotCount > 2) issues.push({ level: 'warn', msg: `副标圈了 ${hotCount} 处重点词，两行合计最多两处 —— 多了就没有落点了（§五末）` });
  }

  // ── probe：一次渲染，量三样 ──
  //   红 = 主字（量外接框，好把它按 (64, 266) 左对齐＋纵向居中）
  //   绿 = 眉标（量宽度）
  //   蓝 = 图形（量它在眉标那条横带里最左伸到哪，定眉标右界）
  const PROBE_BASE = 300;
  const probeSvg = wrap(
    `<g fill="#0000FF">${motif({ ...C, bg: '#000000', ink: '#0000FF', acc: '#0000FF', mute: '#0000FF', seal: '#0000FF' })}</g>` +
      titleText(lines, MAIN_X, PROBE_BASE, mainSize, '#FF0000') +
      `<text x="${KICKER_X}" y="${KICKER_CY + HOOK_PT * 0.36}" font-family="${SANS_FAMILY}" font-weight="700" font-size="${HOOK_PT}" letter-spacing="8" fill="#00FF00">${esc(spec.kicker)}</text>`,
    '#000000'
  );
  const probe = render(probeSvg).pixels;

  const mainBox = bboxOf(probe, [255, 0, 0]);
  const kickBox = bboxOf(probe, [0, 255, 0]);
  // §七.1 眉标右界实测：扫眉标横带 y ∈ [52,126]，找图形最左的非底色像素，右界 = 该 x − 30
  const motifInBand = bboxOf(probe, [0, 0, 255], { y0: 52, y1: 126 });
  const kickerMaxX = motifInBand.empty ? W - M : motifInBand.x0 - KICKER_PAD;

  // 主位按实测外接框摆正：x 左缘对到 64，纵向中线对到 266（title 版是 344）
  const mainCy = isTitle ? TITLE_CY : MAIN_CY;
  const mainDx = MAIN_X - mainBox.x0;
  const mainDy = mainCy - (mainBox.y0 + mainBox.y1) / 2;
  const mainBaseline = PROBE_BASE + mainDy;
  const mainLeft = MAIN_X + mainDx;

  // §七.4 主字高度检测。**title 版量的是整块标题的外接框** ——
  // 那一版单个字只有 ~108px，按单字量必然报警，而它本来就不靠单个字大。
  const mainH = mainBox.y1 - mainBox.y0 + 1;
  if (mainH / H < 0.3)
    issues.push({
      level: 'warn',
      msg:
        `${isTitle ? '标题整块' : '主字'}外接高度 ${mainH}px = 画面的 ${((mainH / H) * 100).toFixed(0)}%，低于 30%（§七.4）` +
        (isTitle ? `　—— 标题太长把字号压下去了，改短标题，别调版式` : ''),
    });

  // title 版的斜杠跟着标题块走（它在那一版里是收尾，不是分隔）
  const ruleH = isTitle ? { ...RULE, y0: mainBox.y1 + mainDy + TITLE_RULE_GAP, y1: mainBox.y1 + mainDy + TITLE_RULE_GAP + 11 } : RULE;

  // 眉标：实测宽度超过右界才缩，不为长度改文案（§九「固定的横向阈值是错的」）
  let kickerSize = HOOK_PT;
  if (!kickBox.empty && kickBox.x1 > kickerMaxX) {
    kickerSize = Math.max(36, Math.floor((HOOK_PT * (kickerMaxX - KICKER_X)) / (kickBox.x1 - kickBox.x0 + 1)));
    issues.push({ level: 'warn', msg: `眉标「${spec.kicker}」撞上图形，字号降到 ${kickerSize}px（右界实测 x=${kickerMaxX}）` });
  }

  // §七.2 副标自动降档：含缩进后超过 x=690 则逐级减 2pt
  let hookSize = HOOK_PT;
  if (hook) {
    const overflow = (s: number) =>
      Math.max(HOOK_X + textW(plain(hook[0]), s), HOOK_X + HOOK_INDENT + textW(plain(hook[1]), s)) > TEXT_MAX_X;
    while (hookSize > 34 && overflow(hookSize)) hookSize -= 2;
    if (hookSize !== HOOK_PT) issues.push({ level: 'warn', msg: `副标放不下，字号从 ${HOOK_PT} 降到 ${hookSize}（§七.2）` });
  }

  // 错位影跟着字号走。**13px 是配 250px 主字的** ——
  // title 版的字只有 108px，照抄 13 会把影子糊到笔画里，看着像重影不像错位。
  const shadow = isTitle ? Math.max(4, Math.round((SHADOW_OFF * mainSize) / MAIN_PT)) : SHADOW_OFF;

  // ── 正式渲染 ──
  const sealCh = spec.seal ?? '醒';
  const svg = wrap(
    [
      motif(C),
      sealMark(sealCh, C, SEAL_C.x, SEAL_C.y),
      kickerText(spec.kicker, KICKER_X, KICKER_CY, kickerSize, C.seal),
      // 主位：先影后字
      titleText(lines, mainLeft + shadow, mainBaseline + shadow, mainSize, C.acc),
      titleText(lines, mainLeft, mainBaseline, mainSize, C.ink),
      ruleBar(ruleH, C.acc),
      // 副标两行，第二行错行缩进 64。**title 版没有这一段**
      ...(hook && !isTitle
        ? [
            hookLine(hook[0], HOOK_X, HOOK_Y1, hookSize, C, mark),
            hookLine(hook[1], HOOK_X + HOOK_INDENT, HOOK_Y1 + HOOK_GAP, hookSize, C, mark),
          ]
        : []),
    ].join('\n'),
    C.bg
  );

  // ── 方版：同样的元素，纵向排开 ──
  //
  // 主字的字号跟横版一样，所以横版量出来的那两个偏移直接复用 ——
  // 同字号同字体，外接框跟画布无关。**不用再跑一次 probe。**
  let sqKicker = SQ_KICKER_PT;
  const sqKickerMaxX = SQ_MOTIF.cx - (400 * SQ_MOTIF.scale) / 2 - KICKER_PAD;
  while (sqKicker > 34 && SQ_KICKER_X + textW(spec.kicker, sqKicker) > sqKickerMaxX) sqKicker -= 2;
  let sqHook = HOOK_PT;
  if (hook) {
    const sqOverflow = (s: number) =>
      Math.max(HOOK_X + textW(plain(hook[0]), s), HOOK_X + HOOK_INDENT + textW(plain(hook[1]), s)) > SQ - M;
    while (sqHook > 34 && sqOverflow(sqHook)) sqHook -= 2;
  }

  const sqBaseline = mainBaseline + ((isTitle ? SQ_TITLE_CY : SQ_MAIN_CY) - mainCy);
  const sqRule = isTitle
    ? { ...SQ_RULE, y0: mainBox.y1 + (sqBaseline - PROBE_BASE) + TITLE_RULE_GAP, y1: mainBox.y1 + (sqBaseline - PROBE_BASE) + TITLE_RULE_GAP + 11 }
    : SQ_RULE;
  const squareSvg = wrap(
    [
      `<g transform="translate(${n(SQ_MOTIF.cx - MOTIF_CX)},${n(SQ_MOTIF.cy - MOTIF_CY)}) translate(${MOTIF_CX},${MOTIF_CY}) scale(${SQ_MOTIF.scale}) translate(${-MOTIF_CX},${-MOTIF_CY})">${motif(C)}</g>`,
      sealMark(sealCh, C, SQ_SEAL.x, SQ_SEAL.y),
      kickerText(spec.kicker, SQ_KICKER_X, SQ_SEAL.y, sqKicker, C.seal),
      titleText(lines, mainLeft + shadow, sqBaseline + shadow, mainSize, C.acc),
      titleText(lines, mainLeft, sqBaseline, mainSize, C.ink),
      ruleBar(sqRule, C.acc),
      ...(hook && !isTitle
        ? [
            hookLine(hook[0], HOOK_X, SQ_HOOK_Y1, sqHook, C, mark),
            hookLine(hook[1], HOOK_X + HOOK_INDENT, SQ_HOOK_Y1 + sqHook * 1.32, sqHook, C, mark),
          ]
        : []),
    ].join('\n'),
    C.bg,
    SQ,
    SQ
  );

  const img = render(svg);
  const png = img.asPng();

  // §七.3 右下安全区检测：非底色像素 > 5% 就报警
  const px = img.pixels;
  const bg = [parseInt(C.bg.slice(1, 3), 16), parseInt(C.bg.slice(3, 5), 16), parseInt(C.bg.slice(5, 7), 16)];
  let dirty = 0;
  let total = 0;
  for (let y = SAFE.y0; y < SAFE.y1; y++)
    for (let x = SAFE.x0; x < SAFE.x1; x++) {
      const i = (y * W + x) * 4;
      total++;
      if (Math.abs(px[i] - bg[0]) > 12 || Math.abs(px[i + 1] - bg[1]) > 12 || Math.abs(px[i + 2] - bg[2]) > 12) dirty++;
    }
  const ratio = dirty / total;
  if (ratio > 0.05)
    issues.push({
      level: 'error',
      msg: `右下安全区被占了 ${(ratio * 100).toFixed(0)}%（上限 5%）—— 那儿要留给 YouTube 的时长角标（§七.3）`,
    });

  const at = (source: string, width: number) =>
    new Resvg(source, { fitTo: { mode: 'width', value: width }, font: { fontFiles: SERIF_FILES, loadSystemFonts: true } })
      .render()
      .asPng();

  return {
    png,                              // 1280×720，上传用（YouTube / B站 / 西瓜，同一张）
    preview: at(svg, 210),            // **唯一的验收标准**（§〇末）
    firstFrame: at(svg, 1920),        // 1920×1080，压在成片第一帧
    square: at(squareSvg, SQ),        // 1080×1080，微信
    squareCheck: at(squareSvg, 200),  // 微信列表里的实际大小
    svg,
    squareSvg,
    issues,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────
//
// 数据放在期目录 `scenes.json` 的 `yt` 块里，跟 `cover` 并排 ——
// 加一期只写一次数据，跟封面那边是同一条纪律。

/**
 * 治愈 / 心理洞察 / 小故事大道理 那三条线的封面。
 *
 * **跟说书线是两条路，因为项目结构不一样**：那边一期一个目录、数据在 `scenes.json`；
 * 这边一本书一个目录、一本书可能有上下两期，数据在 `发布.json` 的 `parts[].yt`。
 *
 * **不碰片头首帧。** 规范 §〇：缩略图和首帧是两回事，这条线的首帧是和纸插画那张
 * （`zhiyu-cover.ts` 出的 `first-frame-1920x1080.png`），成片认的也是它。
 * 说书线 2026-08-23 把两张并成一张是那条线知情的例外，不推广到这儿。
 *
 * **但方版和横版要一起换。** 同一期两种版式并存，等于频道有两套脸。
 */
function mainZhiyu(): void {
  const { id, dir, book } = resolveZhiyuEp(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(`${dir}/发布.json`, 'utf8')) as {
    parts: { part: string; epTitle?: string; yt?: YtSpec }[];
  };
  const want = flagOf('--part');
  const parts = doc.parts.filter((p) => !want || p.part === want);
  const todo = parts.filter((p) => p.yt);
  if (!todo.length) {
    console.log(`《${book}》${want ? `（${want} 篇）` : ''}的 发布.json 里没有 yt 那一块。照这个写，放进 parts[i] 里：
`);
    console.log(
      JSON.stringify(
        {
          yt: {
            kicker: '陶庵梦忆 · 痴人夜行',
            big: '看雪',
            hook: ['他半夜出门都是{闲事}', '白天的{正事}一字没写'],
            motif: 'snow_boat',
            palette: 'paper',
            seal: '醒',
          },
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  console.log(`《${book}》封面（${ZHIYU_LINE}线，V3 版式 ＋ 本线画风）`);
  let bad = false;
  for (const p of todo) {
    const name = p.epTitle ?? p.part;
    const r = renderYt(p.yt!);
    const coverDir = `${dir}/cover/${p.part}`;
    mkdirSync(coverDir, { recursive: true });
    writeFileSync(`${dir}/YT_${name}.png`, r.png);
    writeFileSync(`${coverDir}/YT-check-210.png`, r.preview);
    // 横版和方版一起换：留着旧版式那两张，频道就有两套脸了
    writeFileSync(`${coverDir}/upload-1280x720.png`, r.png);
    writeFileSync(`${coverDir}/wechat-1080x1080.png`, r.square);
    writeFileSync(`${coverDir}/check-square-200.png`, r.squareCheck);

    console.log(`
  ${p.part} 篇　主字「${p.yt!.big}」　眉标「${p.yt!.kicker}」　图形 ${p.yt!.motif}　配色 ${p.yt!.palette}`);
    if (!r.issues.length) console.log('  ✓ 四项自动检测都过了');
    for (const i of r.issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
    if (r.issues.some((i) => i.level === 'error')) bad = true;
    console.log(`  → YT_${name}.png　cover/${p.part}/{upload-1280x720, wechat-1080x1080, YT-check-210}.png`);
  }
  console.log(
    `
**先看 cover/<篇>/YT-check-210.png 再上传** —— 210px 是唯一的验收标准。
` +
      `片头首帧没动（first-frame-1920x1080.png 还是 zhiyu-cover.ts 出的那张，成片认它）。`
  );
  if (bad) process.exitCode = 1;
}

const flagOf = (k: string) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? undefined : process.argv[i + 1];
};

function main() {
  // --line 一给就是治愈那三条线（治愈 / 心理 / 禅佛典），不给就是说书
  if (process.argv.includes('--line')) return mainZhiyu();
  const { id, dir } = resolveEp(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(`${dir}/scenes.json`, 'utf8')) as { yt?: YtSpec };
  if (!doc.yt) {
    console.log(`《${id}》的 scenes.json 里没有 yt 那一块。照这个写（跟 cover 并排）：\n`);
    console.log(
      JSON.stringify(
        { yt: { kicker: '聊斋 · 婴宁', big: '不笑', hook: ['压垮她的不是{官司}', '是婆婆那句{好话}'], motif: 'smile_flat', palette: 'ink' } },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }
  const name = doc.yt.kicker.split('·').pop()!.trim();
  const r = renderYt(doc.yt);

  mkdirSync(`${dir}/cover`, { recursive: true });
  // **cover.png 是成片第一帧**（shuoshu-video.ts 认死这个名字）。
  // 2026-08-23 起它由这套版式出，不再由 shuoshu-cover.ts 出 —— 见下面那段。
  writeFileSync(`${dir}/cover.png`, r.firstFrame);
  writeFileSync(`${dir}/YT_${name}.png`, r.png);
  writeFileSync(`${dir}/YT_预览210.png`, r.preview);
  writeFileSync(`${dir}/cover/wechat-1080x1080.png`, r.square);
  writeFileSync(`${dir}/cover/check-square-200.png`, r.squareCheck);
  writeFileSync(`${dir}/cover/cover.svg`, r.svg);
  writeFileSync(`${dir}/cover/cover-square.svg`, r.squareSvg);

  console.log(`《${id}》封面（一种版式，横版 + 方版 + 第一帧）`);
  console.log(`  主字「${doc.yt.big}」　眉标「${doc.yt.kicker}」　图形 ${doc.yt.motif}　配色 ${doc.yt.palette}`);
  if (!r.issues.length) console.log('  ✓ 四项自动检测都过了');
  for (const i of r.issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  console.log(`\n→ cover.png                      1920×1080　成片第一帧`);
  console.log(`→ YT_${name}.png${' '.repeat(Math.max(0, 24 - name.length * 2))}1280×720 　上传（YouTube / B站 / 西瓜，同一张）`);
  console.log(`→ cover/wechat-1080x1080.png     1080×1080　微信 1:1`);
  console.log(`→ YT_预览210.png / cover/check-square-200.png　**先看这两张再上传**`);
  if (r.issues.some((i) => i.level === 'error')) process.exitCode = 1;
}

if (process.argv[1]?.includes('yt-cover')) main();

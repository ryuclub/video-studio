import { existsSync } from 'node:fs';
// ── 全局参数：改这里就能改片子规格 ──────────────────────────────────────

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const SR = 48000; // 音频采样率

/** 舞台基准：角色站/卧的地平线 */
export const GROUND = 1290;

/** 人物：双脚中心 x */
export const SLOT = { left: 330, right: 752 };

/**
 * 宽体动物（乌龟）：身体横着铺开，比人物占宽得多。
 * 用 SLOT（330/752）会让两只叠在一起——正片里各自单人镜看不出来，
 * 封面把两只放一起时头就被对方盖住了。
 */
export const WIDE = { left: 250, right: 790 };

/** 长条动物：头部位置 x（身体向画外延伸），左右头之间留出间隙不打架 */
export const SNAKE = { left: 430, right: 656 };
/** 左右错开的 y，避免两条身体叠在一起 */
export const SNAKE_DY = { left: -18, right: 62 };

/**
 * 字体。resvg 会加载系统字体，这里给的是首选族名。
 * Windows 建议：Microsoft YaHei / 微软雅黑；日文环境：Yu Gothic UI。
 * 也可以用环境变量覆盖：JOKE_FONT="Noto Sans CJK SC" npm run draft ...
 */
export const FONT =
  process.env.JOKE_FONT ||
  'Noto Sans CJK SC, Noto Sans CJK JP, Source Han Sans SC, Microsoft YaHei, Yu Gothic UI, PingFang SC, sans-serif';

/**
 * 封面主标题用的**特粗**字族。老马线的封面标题规范要求 Heavy / Black 字重 ——
 * 那条规范的描边宽度是字号的 0.15，**Regular / Bold 撑不住这么粗的描边，出来会脏**。
 *
 * ⚠ **必须点名到「Black」那个字族，不能靠 `font-weight="900"` 去够。**
 * resvg 是按字族名找字的，`Noto Sans SC` 和 `Noto Sans SC Black` 在系统里是
 * 两个独立的族；只写前者加 900，多数情况下拿到的还是 Regular，**而且不报错**。
 *
 * 本机实测装着：Noto Sans SC Black / Noto Serif SC Black / Noto Sans JP Black。
 * 一个都没有的时候会退到 `FONT`，那时候封面会明显变细 —— 出片前扫一眼封面就看得出来。
 */
/**
 * **仓库自带的字体文件**，喂给 resvg 的 `fontFiles`。
 *
 * ⚠ **不装进系统也要能用。** 换台机器、换个人接手，靠「记得先装字体」是靠不住的 ——
 * 字体缺了 resvg **不报错**，它静默回退到别的字族，你只会觉得「字怎么没变」。
 * 实测：`font-family="Smiley Sans"` 不喂文件时，渲出来跟雅黑**字节数完全一样**。
 *
 * 路径相对仓库根（脚本的 cwd 是 joke-video/）。
 */
export const FONT_FILES: string[] = [
  '../fonts/smiley-sans-v2.0.1/SmileySans-Oblique.otf',
  // 站酷快乐体：**只给标题牌匾**（`horse/plaque.mjs`）。
  // 字幕规范 §二 点名禁止它用于字幕 —— 那种圆滚滚的字自带「我在逗你笑」的语气，
  // **字体先笑了，台词就不好笑了**。牌匾是场景里的一块牌子，不是台词，可以有语气。
  '../fonts/ZCOOLKuaiLe-Regular.ttf',
].filter((p) => existsSync(p));

/**
 * 老马线主字幕：**得意黑 Smiley Sans**（字幕规范 §二）。
 *
 * ── 为什么不是「搞笑字体」，也不是默认黑体 ──
 *
 * 站酷快乐体那类圆滚滚的字**自带「我在逗你笑」的语气** —— 老马的笑点全靠平静陈述，
 * **字体先笑了，台词就不好笑了**。这跟「落点句不加重音」是同一条道理。
 * 但纯黑无描边的默认黑体也不对：它没有态度，在暖色场景里还会糊进背景。
 * 得意黑正好在中间：倾斜紧凑有速度感，字形本身不卖萌。
 *
 * ⚠ **必须写英文名。** 写中文「得意黑」在部分渲染器里匹配不到，会**静默回退**到思源黑。
 * ⚠ 只有一个字重而且是斜体，**层次只能靠字号和颜色做，不能靠字重**。
 * ⚠ 只给老马线。段子和《一页故事》照旧走 `FONT` —— 换字体是换语气，不是换皮肤。
 * ⚠ **字族名用单引号，不能用双引号。** 这个串会塞进 SVG 的
 * `font-family="…"` 属性里，里面再出现双引号就把属性提前截断了 ——
 * resvg 报的是「expected space not 'S'」，跟字体一点关系都没有。
 */
export const FONT_LAOMA = `'Smiley Sans', ${FONT}`;

export const FONT_HEAVY =
  process.env.JOKE_FONT_HEAVY ||
  'Noto Sans SC Black, Source Han Sans SC Heavy, Noto Sans CJK SC Black, Noto Sans JP Black, Microsoft YaHei, sans-serif';

/**
 * 账号名，署在封面右下角。**频道级常量，不写在每条稿件里** ——
 * 写进稿件的话每条都得记得填，漏一条封面上就是另一个号。
 * 临时换用环境变量：JOKE_ACCOUNT="别的名字" npm run cover ...
 *
 * ⚠ **这条管线上跑着不止一个频道，署名不能只有一个。**
 * `ACCOUNT` 是缺省（段子 / 《一页故事》），老马那条线是自己的号，见下。
 * 谁署谁由 `cover.ts` 的 `accountFor()` 判，判据跟 `yiye-publish.ts` 一致。
 */
export const ACCOUNT = process.env.JOKE_ACCOUNT || 'Ellie';

/**
 * 老马独白线的账号名。频道文档在 `horse/CHANNEL_LAOMA.md`
 * （名字的读法、备选名的退让顺序都在那儿，改名先看那份）。
 */
export const ACCOUNT_LAOMA = process.env.JOKE_ACCOUNT_LAOMA || '碎嘴老马';

/** 音频总体电平（dBFS 目标峰值） */
export const PEAK_DBFS = -1.0;

/** 各音轨增益 */
export const GAIN = {
  voice: 1.0,
  bgm: 0.24,
  sfxPercussive: 0.75, // 咚 / 木鱼：合成效果最好，可以给足
  sfxTonal: 0.5,
  ambience: 0.06, // 环境音压到很低当垫底，合成的氛围音不耐听
};

export const OUT = 'out';

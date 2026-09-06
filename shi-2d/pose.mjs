/**
 * 石总 2D · 定格姿势
 *
 * 美术单独画的整张姿势图（说话／思考／坐姿…），**不是骨架的部件**。
 * 每张的比例都不一样，所以不按画布对位，**按两只瞳孔对** ——
 * 量出眼距和眼线就能算出缩放和位置。登记表在 `素材库/姿势.json`。
 *
 * 这份只做两件事：把一张姿势图摆到精灵画布上、给它一点呼吸浮动。
 * 关节、口型、眨眼这些**都做不了** —— 那些是画死的。
 *
 * 用法：
 *   import { POSE, renderPose } from './pose.mjs';
 *   const svg = renderPose('思考姿势', { t: 1.4 });      // 直接是精灵画布那么大的 SVG
 */
import fs from 'node:fs';
import { load } from './素材.mjs';

const CFG = JSON.parse(fs.readFileSync(new URL('./素材库/姿势.json', import.meta.url), 'utf8'));
const SRC = 'E:/ryu/石总/SVG/正面new/SVG/';

/**
 * 精灵画布。**跟 shoot.mjs 的 CANVAS 必须一模一样** —— 合片时是同一串帧，
 * 尺寸不一致 ffmpeg 直接报错；就算尺寸对了、原点错了，切镜头人会跳。
 * 高度 1600 是为半身机位留的：摞到成片时 overlay y=380，1600 正好盖到画面底边下面。
 */
export const CANVAS = { w: 1080, h: 1600, cx: 540 };

export const POSE = Object.fromEntries(
  Object.entries(CFG.姿势).filter(([k]) => !k.startsWith('_')),
);

/**
 * 组合姿势 —— **上半身来自一张图、腿来自另一张**。
 *
 * 单手插兜那一族（`单手插兜站立`／`单手插兜抬手`）跟 `插兜走路` 是**同一个坐标系**
 * 画出来的：眼距都是 58、眼线都在 116.8~117.5、躯干逐像素叠上去只差几十个点。
 * 所以「换腿」不用标偏移，把腿那一带按坐标切开、两张各出一半就行。
 *
 * 拿它补齐的是这两个组合（美术没画、也不用画）：
 *   站着抬手 = 抬手那张的身 ＋ 站立那张的腿
 *   走着垂手 = 站立那张的身 ＋ 走路那张的腿（带两相，会走）
 *
 * 五官、机位、臂全部**跟身走**（眉毛的序号是身那张的），画布高度**跟腿走**（脚在腿那张上）。
 */
for (const [name, p] of Object.entries(POSE)) {
  if (!p.组合) continue;
  const 身 = POSE[p.组合.身], 腿源 = POSE[p.组合.腿];
  if (!身) throw new Error(`组合姿势「${name}」的身「${p.组合.身}」不在姿势库里`);
  if (!腿源) throw new Error(`组合姿势「${name}」的腿「${p.组合.腿}」不在姿势库里`);
  for (const k of ['类型', '机位', '嘴', '眼距', '眼线', '眼中', '眼距px',
    '眼眶', '肤色', '嘴心', '嘴框', '眉', '眉支点', '脸源', '洗', '臂']) {
    if (p[k] === undefined && 身[k] !== undefined) p[k] = 身[k];
  }
  // 画布：宽取两张里大的（抬手那张为了容下抬起的手臂宽一截），高取腿那张 —— 脚踩的是它
  p.画布 = [Math.max(身.画布[0], 腿源.画布[0]), 腿源.画布[1]];
  // 腿源会走，这张就跟着会走。shoot.mjs 读的是 `POSE[名].腿`，照抄过来它就不用改
  if (腿源.腿) p.腿 = 腿源.腿;
}

const cache = new Map();
/** 按文件名缓存图元 —— 换相要按文件取，不能按姿势名取 */
function shapesOfFile(file) {
  if (!cache.has(file)) cache.set(file, load(SRC + file).shapes.map((s) => s.xml));
  return cache.get(file);
}
function shapesOf(name) {
  const p = POSE[name];
  if (!p) throw new Error(`姿势库里没有「${name}」，有的是：${Object.keys(POSE).join(' ')}`);
  return shapesOfFile(p.文件);
}

const RIG_EYE = 57.5;

/**
 * 拼这张图的图元。给了 `brow` 就把原画那两条眉毛**各自包进一个 `<g>` 里**再转。
 *
 * 眉毛是**挪原画**，不像眼珠和嘴要重画 —— 眉毛下面是纯肤色，怎么挪都没接缝。
 * 这是定格姿势上最有效的一根表情杠杆（眼珠和眼睑都动不了，脸是画死的）。
 */
const 展开 = (list) => {
  const s = new Set();
  for (const x of list || []) {
    if (Array.isArray(x)) for (let i = x[0]; i <= x[1]; i++) s.add(i);
    else s.add(x);
  }
  return s;
};

/**
 * 换腿。有些姿势带 `腿` 配置（目前只有 `插兜走路`）：
 * **整片自带的腿就是其中一相**，另一相是单独一张图。
 * 换相 = 把整片里那段腿的图元隐掉、在**原来的位置**贴上另一张。
 *
 * ⚠ **必须插在原位，不能追加到最后。** 腿在图层顺序里是压在西装下摆底下的，
 * 追加到末尾会盖到夹克上面去。
 */
const 腿件缓存 = new Map();
function 腿件(m) {
  if (!腿件缓存.has(m.文件)) {
    腿件缓存.set(m.文件,
      `<g transform="translate(${m.dx},${m.dy})">` +
      load(SRC + m.文件).shapes.map((x) => x.xml).join('') + '</g>');
  }
  return 腿件缓存.get(m.文件);
}

/**
 * 转臂。`单手插兜站立`／`单手插兜抬手` 的那条臂在绘制顺序里是**结尾一整段**
 * （2026-09-06 美术重导时挪过去的），而且**拿掉之后身子是完整的** ——
 * 描摹图没有被遮挡的图层，在那之前摘掉臂腋下是个洞，所以臂根本转不了。
 *
 * 做法：把那一段拎出来、绕肩转、再接回末尾。**接回末尾是对的** ——
 * 臂本来就画在最上层（跟换腿正相反，腿是压在西装下摆底下的，必须插回原位）。
 */
function 转臂(xs, p, 角) {
  const 区 = 展开(p.臂.图元);
  const [lo, hi] = p.臂.可转;
  if (角 < lo || 角 > hi) {
    // 为什么是这个范围，写在库里的 `可转_` 上 —— 报错时原样带出来，
    // 免得看见 `0~0` 一脸问号（`单手插兜抬手` 就是锁死的那张）
    throw new Error(`臂角 ${角}° 超出「${p.文件}」的可转范围 ${lo}~${hi}°\n  ` +
      (p.臂.可转_ || '再转肩口就脱开了').replace(/\*\*/g, ''));
  }
  if (Math.max(...区) > xs.length) {
    throw new Error(`姿势「${p.文件}」的「臂.图元」超出图元数（${Math.max(...区)} > ${xs.length}）—— ` +
      '美术重导之后序号变了？跑 asset-scan 重核');
  }
  // ⚠ **不能假定臂是「结尾一整段」。** 2026-09-06 出片时发现 `单手插兜抬手` 的
  // 410／411 是**腋下那道接缝**（沿着躯干边缘的两条细线），它们排在臂那一段的后面，
  // 但属于身 —— 跟着臂一起转，就会在空中甩出一条黑线（00:14 那一帧）。
  // 所以这儿改成：**臂可以是散的几段**，整组转完**放回最后一条臂图元的位置**，
  // 排在它后面的（接缝）照旧最后画，压回躯干边上。
  return { 区, 转: (s) => `<g transform="rotate(${角} ${p.臂.支点[0]} ${p.臂.支点[1]})">${s}</g>` };
}

/**
 * 拼这张图的图元。一次遍历同时做两件事：**换腿**和**转眉毛**。
 *
 * ⚠ **两件事必须在同一次遍历里做，按原始序号判断。** 换完腿数组长度就变了
 * （藏掉 56 个、插进 1 个），再按数组下标去找眉毛就全错位了 —— 这个坑差点踩进去。
 */
function body(name, brow, 腿相, 臂角 = 0, 相 = 0) {
  const p = POSE[name];
  if (p.组合) return 组合body(p, brow, 腿相, 臂角);
  // 换相：**整片轮换**，不是换腿。美术把三张整片同源导出（只改腿再导一次），
  // 所以身子逐像素一样、轮换不会闪 —— 各画各的三张会闪，那是另一回事（见 README）。
  // dx 是把某一相整体的水平偏移拉回来，量出来的，不是拍的。
  let xs = shapesOf(name), 相dx = 0;
  if (p.相) {
    const 张 = p.相.张[Math.max(0, Math.min(p.相.张.length - 1, 相 | 0))];
    xs = shapesOfFile(张.文件);
    相dx = 张.dx || 0;
  }
  // 转臂：只算出「哪几条是臂、怎么转」，真正的摘和放在下面那次遍历里做 ——
  // 眉毛的序号是按原始数组数的，所以不能先把数组改短
  const 臂 = (臂角 && p.臂) ? 转臂(xs, p, 臂角) : null;
  const 臂末 = 臂 ? Math.max(...臂.区) : -1;
  const 臂件 = [];

  // 腿：整片自带的是其中一相，换到另一相就把那段藏掉、**在原位**贴上另一张。
  // 必须插在原位 —— 腿在图层顺序里压在西装下摆底下，追加到末尾会盖到夹克上面
  const 换 = 腿相 && p.腿?.[腿相];
  const 藏 = 换 ? 展开(p.腿.隐藏) : null;
  const 起 = 换 ? Math.min(...藏) : -1;
  const 腿xml = 换 ? 腿件(p.腿[腿相]) : '';

  // 眉毛：挪原画，不重画 —— 眉毛下面是纯肤色，怎么挪都没接缝。
  // 这是定格姿势上最有效的一根表情杠杆（眼珠和眼睑都动不了，脸是画死的）
  const k = p.眼距 / RIG_EYE;
  const tf = (brow && p.眉 && p.眉支点) ? [0, 1].map((i) => {
    const v = brow[i] || 0;
    if (!v || !p.眉[i] || !p.眉支点[i]) return null;
    const [px, py] = p.眉支点[i];
    // 抬起量同时给一点旋转 —— 只平移的眉毛像贴纸，转一点才有情绪。
    // 正值抬起＋外端下压（惊讶／为难），负值压下＋内端下压（生气），跟骨架那边同一套
    return `translate(0,${(-v * k).toFixed(2)}) ` +
      `rotate(${((i === 0 ? -1 : 1) * v * 0.35).toFixed(2)} ${px} ${py})`;
  }) : null;

  // ⚠ **一条眉毛可能是好几条路径。** 这批图的眉毛是「深色底 ＋ 浅色面」两条叠着画的
  // （站立那张：画面左 135＋301、画面右 133＋131）。库里只记深色那条的话，
  // 转的时候浅色那条留在原地 —— 出来是**双层眉毛**，挑眉那一句最明显（00:01／00:06 那两帧）。
  // 所以 `眉[s]` 收一个数组，整组一起转。
  const 眉组 = [0, 1].map((s) => new Set([p.眉?.[s]].flat().filter((x) => x != null)));
  // 借脸：整套眉眼都从 _脸件.来源 那张搬过来（见 姿势.json 的 _脸件）
  const 借得到 = p.脸源 === '通用' && p.洗 && CFG._脸件;
  const 洗集 = 借得到 ? 展开(p.洗) : null;

  /**
   * ⚠ **眉毛底下不一定是肤色 —— 插兜那一族的脸在眉毛那儿是个洞。**
   *
   * 老那批图（说话姿势／思考／坐姿）眉毛下面是整块脸，怎么挪都没接缝；
   * 插兜这一族的脸路径在眉毛处**是缺一块的**，眉毛正好盖住。一挪眉毛，
   * 露出来的不是皮肤，是**背景**（渲在白底上就是一条白，观众读成「双层眉毛」）。
   * 2026-09-06 出片的 00:01／00:06 两帧就是这个。
   *
   * 补法：挪之前，先拿**眉毛自己的形状**填一层肤色贴在原位 ——
   * 形状严丝合缝，只补那个洞，多一点都不盖。
   */
  const 抹肤色 = (xml) => (p.肤色 ? xml.replace(/fill="#[0-9a-f]{6}"/i, `fill="${p.肤色}"`) : '');
  const 补眉底 = (s, xml) => 抹肤色(xml);

  /**
   * **通用眉毛。** 插兜这一族的眉毛是三层叠着画的（深色底 ＋ 浅色面 ＋ 底下一道眼睑褶），
   * 整组挪起来眼睑褶留在原地，挑眉那一句就读成**两条眉毛**（2026-09-06 出片 00:06）。
   * `代表性站姿` 那张的眉毛是**一条实心形状**，怎么抬怎么压都干净 —— 借它的。
   *
   * 对位按**包围盒中心**（两边尺寸几乎一样，40×14 vs 40×13），缩放按眼距比例微调。
   * 原生那两条**抹成肤色留在原位**，不能删 —— 删了露出脸路径在眉毛处的洞。
   */
  const 借脸 = (i, v) => {
    const B = CFG._脸件, D = POSE[B.来源];
    const s = p.眼距 / D.眼距;
    // 一只眼一只眼地对瞳孔（瞳孔位置 = 眼中 ± 眼距/2，眼线）
    const 源 = [D.眼中 + (i ? 0.5 : -0.5) * D.眼距, D.眼线];
    const 标 = [p.眼中 + (i ? 0.5 : -0.5) * p.眼距, p.眼线];
    const 摆 = `translate(${(标[0] - s * 源[0]).toFixed(2)},${(标[1] - s * 源[1]).toFixed(2)}) scale(${s.toFixed(4)})`;
    const xsD = shapesOfFile(D.文件);
    const 取 = (l) => [...展开([l])].map((n) => xsD[n - 1]).join('');
    const [px, py] = p.眉支点?.[i] || 标;
    // 眉毛的表情变换在**目标坐标系**里，所以套在最外层
    const 姿 = v
      ? `translate(0,${(-v * (p.眼距 / RIG_EYE)).toFixed(2)}) ` +
        `rotate(${((i === 0 ? -1 : 1) * v * 0.35).toFixed(2)} ${px} ${py}) `
      : '';
    return `<g transform="${姿}${摆}">${取(B.眉[i])}</g>`;
  };

  const out = [];
  for (let i = 0; i < xs.length; i++) {
    const n = i + 1;
    if (n === 起) out.push(腿xml);
    if (藏?.has(n)) continue;
    // 臂：整组收起来，到最后一条臂图元的位置再整个转着放回去
    if (臂?.区.has(n)) {
      臂件.push(xs[i]);
      if (n === 臂末) out.push(臂.转(臂件.join('')));
      continue;
    }
    // 借脸的：原生那一整片眉眼**抹成肤色留在原位**（删了会露出脸路径上的洞），借来的最后画
    if (洗集?.has(n)) { out.push(抹肤色(xs[i])); continue; }
    let done = false;
    for (const s of [0, 1]) {
      if (!眉组[s].has(n)) continue;
      if (tf?.[s]) {
        // 用原生眉的：先在原位补一层肤色（补眉毛底下那个洞），再把眉毛挪过去
        out.push(补眉底(s, xs[i]));
        out.push(`<g transform="${tf[s]}">${xs[i]}</g>`);
        done = true; break;
      }
    }
    if (!done) out.push(xs[i]);
  }
  // 借来的眉画在最后 —— 眉毛本来就在最上层，挡不住别的
  if (借得到) for (const s of [0, 1]) out.push(借脸(s, brow?.[s] || 0));
  const s = out.join('');
  return 相dx ? `<g transform="translate(${相dx},0)">${s}</g>` : s;
}

/**
 * 组合姿势：腿在下、身盖在上，接缝在**夹克下摆正下方**、还带一段羽化。
 *
 * 参数是量出来的，全在 `素材库/姿势.json` 的 `_组合` 里 —— 改之前先看那儿写的为什么。
 * 结构上有两处不是一条横线：
 *   **腿带只切 x 44–246**：右边留给站立那张垂着的手（它伸到 x295、y577）
 *   **y580 以下放开全宽**：站立那双脚岔到 x20 和 x291，窄了会漏出鞋尖
 */
let 组合序 = 0;
function 组合body(p, brow, 腿相, 臂角) {
  const C = CFG._组合;
  const k = ++组合序;                    // 一帧一个 id，免得同一份 SVG 里撞名
  const [x0, x1] = C.腿带;
  const 上 = C.切口 - C.羽化, W = C.遮罩幅[0], H = C.遮罩幅[1];
  return '<defs>' +
    `<linearGradient id="hem${k}" x1="0" y1="${上}" x2="0" y2="${C.切口}" gradientUnits="userSpaceOnUse">` +
    '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' +
    `<mask id="up${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    // ⚠ **两块要叠 2px。** 拼在一起的两个矩形，resvg 会各自把边抗锯齿一遍，
    // 合起来在接边上只有半个像素的覆盖 —— 出来是一条**贯穿整条裤子的浅色细线**，
    // 不报错、单看一帧还以为是裤缝。叠上就没有了
    `<rect x="${x0}" y="${上}" width="${x1 - x0}" height="${C.让手 - 上 + 2}" fill="url(#hem${k})"/>` +
    `<rect x="0" y="${C.让手}" width="${W}" height="${H - C.让手}" fill="#000"/></mask>` +
    `<clipPath id="lo${k}">` +
    `<rect x="${x0}" y="${上}" width="${x1 - x0}" height="${C.让手 - 上 + 2}"/>` +
    `<rect x="0" y="${C.让手}" width="${W}" height="${H - C.让手}"/></clipPath>` +
    '</defs>' +
    // 腿在下、身在上。**顺序不能反** —— 身那半要盖住腿那张自己的上半身
    `<g clip-path="url(#lo${k})">${body(p.组合.腿, null, 腿相)}</g>` +
    `<g mask="url(#up${k})">${body(p.组合.身, brow, null, 臂角)}</g>`;
}

/**
 * 算这张姿势图该怎么摆：缩放多少、平移到哪儿。
 * 全身机位按脚底对齐（跟骨架同一条地平线），半身机位按眼线对齐。
 */
export function place(name) {
  const p = POSE[name];
  const shot = CFG._机位[p.机位];
  // 没写机位的是**配件**（比如坐姿下半身），它跟着上半身走，不单独摆
  if (!p.机位) throw new Error(`「${name}」是配件，没有自己的机位 —— 它要配 ${p.配腿 ? '上半身' : '主姿势'} 一起用`);
  if (!shot) throw new Error(`姿势「${name}」的机位「${p.机位}」不在 _机位 里`);
  // ⚠ **全身按身高对齐，半身按眼距对齐 —— 两种机位的锚点不一样，这是故意的。**
  //
  // 这几张姿势图的身材比例跟骨架不同：骨架 身高/眼距 = 16.04，插兜那三张是 16.8~17.1
  // （头更小、腿更长）。一套缩放对不齐两样东西，只能挑一样：
  //   按头对齐  → 眼距都是 74.75px，但新姿势比骨架**高 54~76px**，切一下人突然长高一截
  //   按身高对齐 → 身高都是 1199px，代价是头小 3~4.5px 眼距（4~6%），基本看不出来
  // 全身镜头观众看的是整个人站在那儿，**身高和地平线最扎眼**；半身镜头看的是脸，眼距和眼线最扎眼。
  let s, ty;
  if (p.机位 === '全身') {
    s = shot.身高 / p.画布[1];
    ty = shot.脚底 - p.画布[1] * s;      // 画布底就是脚底，踩同一条地平线
  } else {
    if (!p.眼距px) throw new Error(`姿势「${name}」缺「眼距px」—— 半身机位要一张一个地定`);
    s = p.眼距px / p.眼距;
    ty = shot.眼线 - p.眼线 * s;
  }
  const tx = CANVAS.cx - p.眼中 * s;
  return { s, tx, ty };
}

/**
 * 眨眼。`k` 0=睁 1=闭。
 *
 * 这几张是整张画死的图，眼睛动不了 —— **一直睁着眼放五秒，人是死的**。
 * 做法跟骨架那边一样：拿脸上那块纯肤色从上往下盖住眼眶，下沿画一条睫毛线。
 * 眼周围本来就是同一块肤色，盖上去看不出接缝。
 *
 * 眼眶和肤色都登记在 `素材库/姿势.json` 里（量出来的，见那份的说明）。
 * **别用压扁眼球的做法** —— 这几张的眼白是分片画的，压扁会散架。
 */
const BLINK_GATE = 0.22;

function blinkSvg(name, k0) {
  const p = POSE[name];
  if (!p.眼眶 || !p.肤色) return '';
  // ⚠ 借了脸的，眼眶要换成**借来那只眼**的框 —— 拿原来那张的框去盖，位置和大小都不对
  const 眼眶 = p.眼眶;
  // ⚠ **小的下垂量在这几张脸上不能用。**
  // 骨架那边的眼睑是画好的一片、压下来多少就是多少；这儿是拿肤色盖 ——
  // 一盖就**把原画自己那道上眼睑线抹掉了**，换成我画的睫毛线，位置和粗细都跟原画对不上。
  // 哪怕只盖 0.12，眼睛也立刻读成「半睁着」。
  // （2026-09-05 实测：00:37 那一段整段睡眼惺忪，就是这个原因。）
  // 所以低于 GATE 一律不画，超过之后从 0 重新起算 —— 真眨眼会一路冲到 1，不受影响。
  const k = k0 <= BLINK_GATE ? 0 : (k0 - BLINK_GATE) / (1 - BLINK_GATE);
  if (k <= 0) return '';
  let s = '';
  for (const [x0, y0, x1, y1] of 眼眶) {
    const y = (y0 - 1) + k * (y1 - y0 + 2);
    const w = x1 - x0 + 3;
    s += `<rect x="${x0 - 1.5}" y="${y0 - 3}" width="${w}" height="${(y - y0 + 3).toFixed(2)}" fill="${p.肤色}"/>` +
      `<path d="M${(x0 + 0.5).toFixed(1)},${(y - 0.8).toFixed(2)} ` +
      `Q${((x0 + x1) / 2).toFixed(1)},${(y + (x1 - x0) * 0.16).toFixed(2)} ` +
      `${(x1 - 0.5).toFixed(1)},${(y - 0.8).toFixed(2)}" ` +
      `fill="none" stroke="#3b2418" stroke-width="${((x1 - x0) * 0.075).toFixed(2)}" stroke-linecap="round"/>`;
  }
  return s;
}

/**
 * 口型。做法跟骨架一样：**肤色补丁盖住原画那张嘴，上面画自己的**。
 *
 * ⚠ **一旦给了口型就要一直给。** 补丁在和不在，脸上是两个样子 ——
 * 中途开关会闪。所以 `mouth` 只要不是 null，`rest` 也照样贴补丁，
 * 只是画一条闭着的嘴线。
 *
 * 每张脸大小不一样，口型半径要按 `眼距/57.5` 跟着缩 —— 骨架那套数是在
 * 眼距 57.5 的脸上定的，直接套到眼距 29 的 `说话姿势4` 上，嘴会大得像在喊。
 */
const VIS = { M: [17, 2], A: [16, 11], I: [18.5, 4.5], U: [8.5, 7.5], E: [15, 7.5], O: [11.5, 10.5] };

function mouthSvg(name, key, curve) {
  const p = POSE[name];
  if (!key || !p.嘴心 || !p.肤色) return '';
  const k = p.眼距 / RIG_EYE;
  const [cx, cy] = p.嘴心;
  // 补丁要同时盖住**原画那张嘴**（嘴框，量出来的）和**要画上去的口型**（绕嘴心）。
  // 只盖嘴框不行 —— 嘴心是按比例算的、通常比框心高一点，
  // 补丁跟着嘴心走就会在上面漏出原画的唇线（坐姿那两张最明显）。
  const rxMax = 18.5 * k, ryMax = 11 * k;
  const box = p.嘴框 || [cx - rxMax, cy - ryMax, cx + rxMax, cy + ryMax];
  const x0 = Math.min(box[0], cx - rxMax), x1 = Math.max(box[2], cx + rxMax);
  const y0 = Math.min(box[1], cy - ryMax), y1 = Math.max(box[3], cy + ryMax);
  const pcx = (x0 + x1) / 2, pcy = (y0 + y1) / 2;
  const px = (x1 - x0) / 2 + 3 * k, py = (y1 - y0) / 2 + 2.5 * k;
  let s = `<ellipse cx="${pcx.toFixed(1)}" cy="${pcy.toFixed(1)}" ` +
    `rx="${px.toFixed(2)}" ry="${py.toFixed(2)}" fill="${p.肤色}"/>`;
  if (key === 'rest') {
    // 闭着嘴的时候画嘴角 —— **定格姿势上第二根表情杠杆**（第一根是眉毛）。
    // curve = [k, 歪]：k 正=上扬负=下撇，歪=左右不对称。不给就是一条平的唇线
    // **微笑基线**：不管哪个情绪，嘴角都带一点点上扬（见 姿势.json 的 _笑底）——
    // 「看穿一切的自信」那种，不是咧嘴。0 会让人显得没表情，太大就成了假笑
    const [ck0, tilt] = curve || [0, 0];
    const ck = ck0 + (CFG._笑底?.值 ?? 0);
    const w = 13 * k;
    const ya = cy - 0.6 * k - ck * 4.4 * k + tilt * k;
    const yb = cy - 0.6 * k - ck * 4.4 * k - tilt * k;
    return s + `<path d="M${(cx - w).toFixed(1)},${ya.toFixed(1)} ` +
      `Q${cx},${(cy + (2.6 + ck * 7.6) * k).toFixed(1)} ${(cx + w).toFixed(1)},${yb.toFixed(1)}" ` +
      `fill="none" stroke="#80503b" stroke-width="${(2.7 * k).toFixed(2)}" stroke-linecap="round"/>`;
  }
  const [rx0, ry0] = VIS[key] || VIS.M;
  const rx = rx0 * k, ry = ry0 * k;
  s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" fill="#5a3222"/>`;
  if (ry0 > 8) {                       // 只有 A 和 O 张得够大才露牙，I/E 露牙会像龇着
    // 张得大的时候露一点牙，不然是个黑洞
    s += `<path d="M${(cx - rx * 0.8).toFixed(1)},${(cy - ry * 0.45).toFixed(1)} ` +
      `Q${cx},${(cy - ry * 1.0).toFixed(1)} ${(cx + rx * 0.62).toFixed(1)},${(cy - ry * 0.5).toFixed(1)} Z" ` +
      `fill="#f2ece4"/>`;
  }
  return s;
}


/**
 * **眼神光**（catchlight）—— 瞳孔上那一点白，「眼睛有神」最省力的一根杠杆。
 *
 * ⚠ **眼珠的方向驱动不了。** 脸是画死的（README 坑 5：眼睛是「一整块深色杏仁 ＋
 * 左右两牙白 ＋ 中间露出的底就是虹膜」，只挪瞳孔会像瞳孔从眼球上滑下去；
 * 2026-09-06 试过整只借别的姿势的眼，眼白是分片画的、拼过去只剩一团暗）。
 * 所以「正视前方」只能靠**原画本来就画成正视**，我们能加的只有这一点光。
 *
 * 位置和大小按**眼距的比例**给，一张脸一个大小自动跟着缩。
 * 眨眼的时候要收 —— 眼睛都盖住了还留一点白，那是最假的。
 */
function 眼神光(p, blink) {
  const C = CFG._眼神光;
  if (!C || !p.眼距 || !p.眼线 || p.眼中 == null) return '';
  const 开 = 1 - Math.min(1, Math.max(0, blink || 0));
  if (开 < 0.15) return '';
  const r = C.半径 * p.眼距, [ox, oy] = C.偏;
  return [0, 1].map((i) => {
    const cx = p.眼中 + (i ? 0.5 : -0.5) * p.眼距 + ox * p.眼距;
    const cy = p.眼线 + oy * p.眼距;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 开).toFixed(2)}" ` +
      `fill="${C.色}" opacity="${(C.亮 * 开).toFixed(2)}"/>`;
  }).join('');
}

/** 这张姿势图有没有走路的两相 */
export const 会走 = (name) => !!(POSE[name]?.腿 || POSE[name]?.相);

/** 这张姿势图能不能驱动口型 */
export const 能说话 = (name) => !!(POSE[name]?.嘴心 && POSE[name]?.肤色);

/**
 * 摆一帧。
 *   t       秒。用来做呼吸浮动 —— 一张完全不动的图放三秒就像卡住了
 *   blink   0–1 闭眼量。出片时喂 `makeBlinker()`（跟骨架同一套调度，两边节奏才一致）
 *   mouth   'rest' | 'M' | 'A' | 'I' | 'U' | 'E' | 'O'，给 null 就用原画的嘴
 *   腿      '右' = 换到另一相（只有带「腿」配置的姿势能用，目前是 插兜走路）
 *   相      第几张整片（只有带「相」配置的能用，目前是 插兜侧走；0 起）
 *   臂角    绕肩转多少度（只有带「臂」配置的能用，超出可转范围当场停）
 *   dx/dy   额外位移（走路的行进和上下颠）
 */
export function renderPose(name, { t = 0, dx = 0, dy = 0, blink = 0, mouth = null, zoom = 1, expr = null, 腿 = null, 臂角 = 0, 相 = 0, breathe = true } = {}) {
  const { s, tx, ty } = place(name);
  const float = breathe ? 2.2 * Math.sin(t * 1.5) : 0;
  const inner =
    `<g transform="translate(${(tx + dx).toFixed(2)},${(ty + float + dy).toFixed(2)}) scale(${s.toFixed(4)})">` +
    body(name, expr?.brow, 腿, 臂角, 相) + mouthSvg(name, mouth, expr?.mouth) + blinkSvg(name, blink) + 眼神光(POSE[name], blink) + '</g>';
  // 缓推：一张定格图放四五秒会「冻住」。**推一点点就够** —— 一整句推 3~4%，
  // 单帧看不出来，连起来看是镜头在缓缓靠近。绕画面中心推，别绕人物中轴（会显得在飘）
  const g = zoom === 1 ? inner
    : `<g transform="translate(${CANVAS.cx},${(CANVAS.h * 0.42).toFixed(0)}) scale(${zoom.toFixed(4)}) ` +
      `translate(${-CANVAS.cx},${(-CANVAS.h * 0.42).toFixed(0)})">${inner}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.w}" height="${CANVAS.h}" ` +
    `viewBox="0 0 ${CANVAS.w} ${CANVAS.h}">${g}</svg>`;
}

/** 这张姿势的嘴是不是画死张开的 —— 是的话别让它停超过两秒 */
export const 嘴张着 = (name) => POSE[name]?.嘴 === '张';

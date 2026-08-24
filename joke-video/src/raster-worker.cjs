// ── 光栅化 worker：只做 SVG → PNG 这一件事 ────────────────────────────
//
// **为什么只把光栅化搬过来。** 实测单帧成本里，拼出整帧 SVG 字符串只要 1ms，
// resvg 光栅化要 240ms —— 99.6% 在这一步。所以主线程照旧拼 SVG（顺带保住
// renderFrame 里那些 WeakMap 缓存和时间轴状态），worker 只收字符串、吐 PNG，
// 不需要把时间轴、配音包络这些大对象复制到每个线程里去。
//
// **是 .cjs 不是 .ts**：worker_threads 起的新线程不继承 tsx 的加载器，
// 直接给它 .ts 会报 ERR_UNKNOWN_FILE_EXTENSION。这个文件依赖少（只有 resvg），
// 写成 CommonJS 最省事——package.json 是 "type": "module"，所以扩展名必须是 .cjs。

const { parentPort, workerData } = require('node:worker_threads');
const { Resvg } = require('@resvg/resvg-js');

const opts = {
  fitTo: { mode: 'original' },
  // fontFiles 由主线程传进来（见 video.ts 的 makeRasterPool）。
  // **worker 不共享主线程的 resvg 配置**，漏了这一项的表现是：
  // 静帧上字体对、成片里回退成系统字体，两边都不报错。
  font: {
    loadSystemFonts: true,
    fontFiles: workerData.fontFiles || [],
    defaultFontFamily: workerData.font,
  },
};

parentPort.on('message', (msg) => {
  try {
    // **不走 transferList。** asPng() 返回的 Buffer 底下可能是 Node 的共享池，
    // 把它的 ArrayBuffer 转移走会顺带弄坏池里别的 Buffer。
    // PNG 一帧两三百 KB，结构化克隆的开销跟 240ms 的光栅化比可以忽略。
    parentPort.postMessage({ id: msg.id, png: new Resvg(msg.svg, opts).render().asPng() });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, err: String((e && e.message) || e) });
  }
});

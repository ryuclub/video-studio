把剪映导出的配音 wav 放到这里，按 `voice/<段子id>/<句号>-<角色id>.wav` 命名。

例（对应 jokes/snake-poison.json）：
  voice/snake-poison/1-small.wav
  voice/snake-poison/2-big.wav
  voice/snake-poison/3-small.wav

然后跑 `npm run align -- jokes/snake-poison.json`，脚本会做静音检测、
把首尾静音切掉、并把真实时长回填进 json；接着 `npm run build -- ...` 出正片。

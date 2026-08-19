# Windows 自带 TTS（SAPI）离线配音 —— 完全断网可用，音色机械但零授权风险
#
# 列出系统已装音色：
#   powershell -ExecutionPolicy Bypass -File tools/win-sapi.ps1 -List
#
# 生成一句：
#   powershell -ExecutionPolicy Bypass -File tools/win-sapi.ps1 `
#     -Text "大哥，我们有毒吗？" -Voice "Microsoft Huihui Desktop" `
#     -Out "voice/snake-poison/1-small.wav"
#
# 中文音色一般是 Microsoft Huihui Desktop（女）/ Microsoft Kangkang Desktop（男）。
# 只装了英文音色的话，去「设置 → 时间和语言 → 语言 → 中文 → 语音」补装语言包。
# 输出是 16-bit PCM wav，align/build 直接能读。

param(
  [string]$Text,
  [string]$Voice = "",
  [string]$Out = "",
  [switch]$List,
  [int]$Rate = 0        # -10 ~ 10，负数更慢
)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

if ($List) {
  Write-Host "已安装音色："
  foreach ($v in $synth.GetInstalledVoices()) {
    $i = $v.VoiceInfo
    Write-Host ("  {0,-38} {1,-8} {2}" -f $i.Name, $i.Gender, $i.Culture.Name)
  }
  $synth.Dispose()
  exit 0
}

if (-not $Text -or -not $Out) {
  Write-Host "缺参数。用法：-Text ""台词"" -Out ""voice/xxx/1-a.wav"" [-Voice ""音色名""] [-Rate -2]"
  $synth.Dispose()
  exit 1
}

if ($Voice) {
  try { $synth.SelectVoice($Voice) }
  catch { Write-Host "找不到音色 '$Voice'，改用默认。跑 -List 看可用音色。" }
}

$synth.Rate = $Rate
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$synth.SetOutputToWaveFile($Out)
$synth.Speak($Text)
$synth.Dispose()
Write-Host "已生成 $Out"

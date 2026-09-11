# fonts/

**进版本库的只有两个，其余靠自己下。**

| 文件 | 授权 | 谁在用 | 在不在 git 里 |
|---|---|---|---|
| `smiley-sans-v2.0.1/SmileySans-Oblique.otf` | SIL OFL（[许可证](smiley-sans-v2.0.1/OFL.txt)）| 老马线字幕（`FONT_LAOMA`） | **在**（1.9M） |
| `ZCOOLKuaiLe-Regular.ttf` | SIL OFL（[许可证](ZCOOLKuaiLe-OFL.txt)）| 老马线标题牌匾（`horse/plaque.mjs`） | **在**（1.5M） |
| `NotoSerifCJKsc/` | SIL OFL | 说书线题字 | **不在**（162M，自己下） |

## 为什么那两个必须进版本库

`src/config.ts` 的 `FONT_FILES` 是 `.filter(existsSync)` —— 文件不在就**悄悄少喂一个字体**，
resvg 跟着回退到系统字体。**不报错**，字幕规范 §二 专门警告过：
「你只会觉得『字怎么没变』」。实测 `font-family="Smiley Sans"` 不喂文件时，
渲出来跟微软雅黑**字节数完全一样**。

所以：**出片链真正依赖的字体，跟着代码走**；只有大到不合适的（Noto Serif CJK 162M）才留给人下。

## Noto Serif CJK 怎么下

GitHub `notofonts/noto-cjk` 的 release，取 `SimplifiedChinese` 那包，
解开成 `fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/*.otf`。

## 加新字体的时候

1. 确认授权允许分发（OFL / 免费商用）
2. 小的（几 M）就在 `.gitignore` 里放行，跟着代码走
3. 大的留给人下，**并且在这儿写清楚从哪下**
4. 无论哪种，都要进 `FONT_FILES` —— 只写 `font-family` 不喂文件等于没接

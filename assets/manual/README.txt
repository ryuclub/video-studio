把 AI 生成或自备的素材放这里，会优先于 Pexels 检索被使用。

命名：
  关键词_下划线分隔.mp4           横版 / 通用
  关键词_下划线分隔_portrait.mp4  竖版专用

例：script.json 里写 "clip": "empty office night"，就命名为
  empty_office_night.mp4
  empty_office_night_portrait.mp4

竖版找不到 _portrait 的会回退到通用那个，但画面要被中心裁掉七成，
渲染时会打警告。情绪落点的镜头建议两版都备。

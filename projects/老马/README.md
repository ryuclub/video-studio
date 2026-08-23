# 老马 · 成品与排期

**这棵目录树既是成品库，也是排期账本。** 规范和字段说明看
[joke-video/horse/SCHEDULE.md](../../joke-video/horse/SCHEDULE.md)，
校验跑 `npm run laoma:schedule`（在 `joke-video/` 底下）。

```
段子/_待发/<日期>_<时刻>JST_段子_<栏目>_<稿件内容>_<天数号>/    publish.json ＋ out.mp4 ＋ thumb.png ＋ 方案/发布文案
段子/_待发/未排期_段子_<栏目>_<稿件内容>_<天数号>/              出了片还没定发布日
段子/_已发/…                                （发布后整个目录 mv 过来，**不改名**）
```

**稿件不在这儿**，在 `joke-video/jokes/laoma-00N.json`；`publish.json` 的 `script` 指过去。

- **改期**：只动目录名前缀 ＋ `publish.json` 里的时刻。**天数号一个字都不动。**
- **发布后**：`mv 段子/_待发/<那个目录> 段子/_已发/`
- **看还剩几期**：数一下 `段子/_待发/` 里有几个目录（低于 7 该补产）
- **看片子**：[index.html](index.html)（`npm run preview` 生成）

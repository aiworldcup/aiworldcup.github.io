# 自动化任务

本项目的线上站点由 GitHub Pages 发布,本机负责定时生成静态 JSON 并 push 到 `main`。

## 任务

- `com.tom.worldcup-ai-arena-results`
  - 频率:每 10 分钟
  - 命令:`npm run publish:settle`
  - 行为:同步真实赛程/赛果,重算排行榜;只有 `public/data` 发生语义变化时才 commit + push。

- `com.tom.worldcup-ai-arena-roundtable`
  - 频率:每天北京时间 10:00
  - 命令:`npm run publish:roundtable`
  - 行为:先同步赛程,只检查次日比赛;如果次日没有未完赛比赛,直接跳过;如果有未生成圆桌的比赛,逐场生成并发布。

## 模型策略

- `claude-fable-5` 已禁用,后续不再尝试。
- `muse-spark` 已禁用,后续不再尝试。
- 自动圆桌只读取 `public/data/models.json` 中 `enabled !== false` 的模型。
- 圆桌生成默认把模型调用 timeout 控制在 25 秒左右,避免单个慢模型拖死整场发布。
- 如果当天已过北京时间 10:00 且改了圆桌策略或日程,需要手动执行 `npm run publish:roundtable` 补跑下一日比赛。

## 常用命令

```bash
npm run publish:settle
npm run publish:roundtable
ops/install-launchd.sh
launchctl list com.tom.worldcup-ai-arena-results
launchctl list com.tom.worldcup-ai-arena-roundtable
```

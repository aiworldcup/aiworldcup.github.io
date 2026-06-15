# 项目决策记忆

更新时间: 2026-06-16

## 产品定位

- 项目定位是“大模型预测能力的长期评测基准”,世界杯只是第一个舞台。
- 当前传播重点是“赛前 AI 圆桌 + 赛后打脸/命中榜”,不要继续堆第二版功能。
- 第一版统计口径保持简单:赛果榜和比分榜,不再做积分下注榜。

## 自动化

- 赛果更新由本机 launchd 每 10 分钟执行 `npm run publish:settle`。
- 自动圆桌由本机 launchd 每天北京时间 10:00 执行 `npm run publish:roundtable`。
- 自动圆桌会先同步赛程,再 best-effort 同步竞彩单关核对数据,然后只处理“下一日”未完赛且尚未生成圆桌的比赛;没有下一日比赛时必须跳过。
- 竞彩单关同步使用中国竞彩网足球赛果开奖页“仅显示胜平负单固场次”口径;接口失败只报警,不能阻塞圆桌自动发布。
- 如果当天已经过 10:00 且改了圆桌策略或日程,需要手动跑一次 `npm run publish:roundtable` 补下一日比赛。

## 圆桌发言策略

- 圆桌必须短,目标是像赛前群聊嘴仗,不是长篇分析报告。
- 普通发言限制 46 个中文字符以内,最终预测发言限制 60 个中文字符以内。
- 启用模型默认总发言控制在 20 条左右;当前 12 个启用模型约 19 条。
- Claude Opus 4.8、GPT-5.5、Gemini 3.1、Kimi K2.6、Claude Sonnet 4.6 每场 1 句。
- Qwen 3.7 Max、MiniMax-M3、Mimo v2.5 Pro、Grok 4.3、DeepSeek V4 Pro、GLM-5.1、Doubao-Seed-2.0-pro 每场 2 句。
- 每个模型最后一句必须包含可解析的赛果方向和比分,格式倾向于:`结论:主胜/平局/客胜,比分X-X;理由`。
- 慢模型不能拖死自动任务;圆桌默认把模型调用 timeout 压到 25 秒,超时模型跳过或兜底。

## 模型状态

- Claude Fable 5 停用,后续不用再尝试。
- Muse Spark 停用,后续不用再尝试。
- Kimi、Mimo、Qwen、DeepSeek、Doubao 等模型偶发超时是已知情况;自动圆桌要优先保证整场完整发布。

## 访问统计

- 访问统计后台使用 Cloudflare Worker + D1。
- Worker URL:`https://worldcup-ai-arena-analytics.worldcup-ai-arena-ccavtjy.workers.dev`
- D1 database:`worldcup_ai_arena_analytics`
- 后台入口:`/admin.html`
- Worker 已设置 `ADMIN_TOKEN` secret;不要把 token 写入代码或文档。

## 域名策略

- 当前线上站点已迁移到 GitHub Organization Pages:`https://aiworldcup.github.io/`
- 旧个人 Pages 地址保留为备份:`https://ccavtjy.github.io/worldcup-ai-arena/`
- 已创建 GitHub Organization:`https://github.com/aiworldcup`
- 已创建组织 Pages 仓库:`https://github.com/aiworldcup/aiworldcup.github.io`
- 本地 `origin` 应指向组织 Pages 仓库,让自动赛果/圆桌发布继续更新新站。
- 主要受众是中国大陆,长期更推荐购买 `.com` 域名,先接 GitHub Pages,后续再做备案和国内 CDN/静态托管。
- `.ai`、`.io` 适合海外传播,但对大陆访问速度没有直接帮助,未来备案/国内接入不如 `.com` 稳。
- 候选优先级:短期品牌传播可看 `aiworldcup.io`;面向大陆长期更偏向 `modelwc.com`、`matcharenaai.com`、`footballbrainai.com` 这类 `.com`。

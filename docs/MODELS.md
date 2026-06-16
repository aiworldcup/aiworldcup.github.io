# 参赛模型清单

本项目当前保留以下 14 个模型。页面展示必须标注模型名与公司。

| 序号 | 模型 | 公司 | 接入变量 |
|----|------|------|---------|
| 1 | Claude Fable 5(已禁用) | Anthropic | 不再自动调用 |
| 2 | Claude Opus 4.8 | Anthropic | dk: `DK_OPUS_ANTHROPIC_API_KEY` / `DK_OPUS_ANTHROPIC_API_BASE` / `DK_CLAUDE_OPUS_MODEL` |
| 3 | GPT-5.5 | OpenAI | ZenMux: `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GPT_5_5_MODEL` |
| 4 | Gemini 3.1 | Google | ZenMux Vertex 或 Gemini: `GEMINI_API_KEY` 或 `ZENMUX_API_KEY` / `GOOGLE_GEMINI_BASE_URL` / `GEMINI_MODEL` |
| 5 | Qwen 3.7 Max | 阿里云 / 通义千问 | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `QWEN_MODEL` |
| 6 | MiniMax-M3 | MiniMax | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `MINIMAX_MODEL` |
| 7 | Kimi K2.6 | 月之暗面 / Moonshot AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `KIMI_MODEL` |
| 8 | Mimo v2.5 Pro | 小米 / MiMo | `MIMO_ANTHROPIC_API_KEY` / `MIMO_ANTHROPIC_API_BASE` / `MIMO_ANTHROPIC_MODEL` |
| 9 | Grok 4.3 | xAI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GROK_MODEL` |
| 10 | Muse Spark(已禁用) | Muse AI | 不再自动调用 |
| 11 | Claude Sonnet 4.6 | Anthropic | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `CLAUDE_SONNET_MODEL` |
| 12 | DeepSeek V4 Pro | DeepSeek | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `DEEPSEEK_MODEL` |
| 13 | GLM-5.1 | 智谱 AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GLM_MODEL` |
| 14 | Doubao-Seed-2.0-pro | 字节跳动 / 豆包 | ZenMux: `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `DOUBAO_MODEL` |

## 豆包选择说明

已查询 ZenMux `/api/v1/models`,豆包可用模型包括 `bytedance/doubao-seed-2.0-mini`、`bytedance/doubao-seed-2.0-lite`、`bytedance/doubao-seed-2.0-code`、`bytedance/doubao-seed-2.0-pro`。本项目按最早需求接入 `Doubao-Seed-2.0-pro`,默认模型 ID 为 `bytedance/doubao-seed-2.0-pro`。

## 接入约束(公平性)

- **同一时刻**触发所有模型(或尽量靠近),记录每个预测的真实时间戳。
- **同一套 prompt**(见 `pipeline/prompts.js`),不为某个模型特调。
- 所有模型用**默认温度**或统一温度,记录在存证里。
- 模型返回必须是**结构化 JSON**(见 DATA-SCHEMA.md 的 prediction 结构),便于结算。
- 如某模型 API 暂不可用,在 `models.json` 标 `"enabled": false`,不影响其他模型。

## ZenMux 接入状态

- 已查询 ZenMux `/api/v1/models`,可用 GPT-5.5 模型 ID:`openai/gpt-5.5`、`openai/gpt-5.5-pro`;当前默认用 `openai/gpt-5.5`,避免直接上更贵的 pro。
- 已查询 ZenMux `/api/v1/models`,可用 Gemini 3.1 模型 ID:`google/gemini-3.1-flash-lite-preview`、`google/gemini-3.1-pro-preview`;当前默认用 `gemini-3.1-flash-lite-preview` 走 `GOOGLE_GEMINI_BASE_URL=https://zenmux.ai/api/vertex-ai`。
- 已验证通过 ZenMux `/api/v1/responses` 接通:Qwen 3.7 Max、GLM-5.1、MiniMax-M3、Kimi K2.6、Grok 4.3、Claude Sonnet 4.6、DeepSeek V4 Pro。
- 已查询 ZenMux `/api/v1/models`,Doubao-Seed-2.0-pro 可用模型 ID:`bytedance/doubao-seed-2.0-pro`;当前默认走 ZenMux responses 协议。
- Muse Spark 已停用;ZenMux `/api/v1/models` 当前未返回可用的 `muse` 或 `spark` 相关模型 ID。

## 圆桌发言限制

- Claude Fable 5 已停用,不再参与自动圆桌。
- Muse Spark 已停用,不再参与自动圆桌。
- 圆桌发言要短,普通发言不超过 46 个中文字符,最终预测发言不超过 60 个中文字符。
- Claude Opus 4.8、GPT-5.5、Gemini 3.1、Kimi K2.6、Claude Sonnet 4.6 每场 1 句。
- Qwen 3.7 Max、MiniMax-M3、Mimo v2.5 Pro、Grok 4.3、DeepSeek V4 Pro、GLM-5.1、Doubao-Seed-2.0-pro 每场 2 句。
- 每个模型最后一句必须包含可解析的赛果方向和比分,推荐格式:`结论:主胜/平局/客胜,比分X-X;理由`。
- 圆桌默认 timeout 为 25 秒;慢模型超时后先留空,等整轮跑完后补跑一次。补跑仍失败就跳过,不能用 1-1 平或赔率最低项做兜底填充。

## Claude Fable 5 状态

- Fable 5 已按当前运营策略禁用。
- `public/data/models.json` 中 `enabled:false`,自动预测和自动圆桌不会再尝试调用。

## 反作弊 / 存证

- 每场每模型的预测,封盘时计算内容哈希 + 时间戳,写入 matches.json。
- 封盘后不得修改。结算只读取,不回写预测字段。

## key 管理

- 所有 key 走 `.env`(见 `.env.example`),**严禁硬编码进任何 .js**。
- 缺 key 时,predict.js 应跳过该模型并在日志提示,不应崩溃。

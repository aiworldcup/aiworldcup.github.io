# 参赛模型清单

本项目当前保留以下 14 个模型。页面展示必须标注模型名与公司。

| 序号 | 模型 | 公司 | 接入变量 |
|----|------|------|---------|
| 1 | Claude Fable 5 | Anthropic | Claude Code CLI: `DK_ANTHROPIC_API_KEY` / `DK_CLAUDE_FABLE_MODEL` / `CLAUDE_CLI_TIMEOUT_MS` |
| 2 | Claude Opus 4.8 | Anthropic | dk: `DK_OPUS_ANTHROPIC_API_KEY` / `DK_OPUS_ANTHROPIC_API_BASE` / `DK_CLAUDE_OPUS_MODEL` |
| 3 | GPT-5.5 | OpenAI | ZenMux: `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GPT_5_5_MODEL` |
| 4 | Gemini 3.1 | Google | ZenMux Vertex 或 Gemini: `GEMINI_API_KEY` 或 `ZENMUX_API_KEY` / `GOOGLE_GEMINI_BASE_URL` / `GEMINI_MODEL` |
| 5 | Qwen 3.7 Max | 阿里云 / 通义千问 | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `QWEN_MODEL` |
| 6 | MiniMax-M3 | MiniMax | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `MINIMAX_MODEL` |
| 7 | Kimi K2.6 | 月之暗面 / Moonshot AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `KIMI_MODEL` |
| 8 | Mimo v2.5 Pro | 小米 / MiMo | `MIMO_ANTHROPIC_API_KEY` / `MIMO_ANTHROPIC_API_BASE` / `MIMO_ANTHROPIC_MODEL` |
| 9 | Grok 4.3 | xAI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GROK_MODEL` |
| 10 | Muse Spark | Muse AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `MUSE_MODEL` |
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
- Muse Spark 已预留 `muse-spark` provider,但 ZenMux `/api/v1/models` 当前未返回 `muse` 或 `spark` 相关模型 ID;需要 ZenMux 提供准确 ID 后再把 `.env` 的 `MUSE_MODEL` 改成真实值。

## 圆桌发言限制

- Claude Fable 5 固定作为首个发言模型,每场只说 1 句,必须直接给简要理由、赛果方向和比分。
- Claude Opus 4.8 每场最多 2 句。
- GPT-5.5 每场最多 2 句。
- 其他模型每场最多 3 句。

## Claude Fable 5 接入方式

- Fable 5 不走普通 Anthropic HTTP 请求;DK 网关会返回 "only allows Claude Code clients"。
- 本项目改为通过本机 Claude Code CLI 调用:`claude -p ... --model claude-fable-5 --output-format json --max-turns 1 --no-session-persistence`。
- 即使当前 Claude Code 默认配置是 Opus 4.8,单次调用也会用 `--model claude-fable-5` 覆盖,不需要改全局默认配置。
- `DK_ANTHROPIC_API_KEY` 只作为项目侧启用开关,实际认证和网关路由由 Claude Code 客户端配置负责。
- 当前最小测试已绕开 "only allows Claude Code clients",但 DK 返回 `503 no available accounts`;这属于网关账户可用性问题,不是项目调用协议问题。

## 反作弊 / 存证

- 每场每模型的预测,封盘时计算内容哈希 + 时间戳,写入 matches.json。
- 封盘后不得修改。结算只读取,不回写预测字段。

## key 管理

- 所有 key 走 `.env`(见 `.env.example`),**严禁硬编码进任何 .js**。
- 缺 key 时,predict.js 应跳过该模型并在日志提示,不应崩溃。

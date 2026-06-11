# 参赛模型清单

本项目当前保留以下 14 个模型。页面展示必须标注模型名与公司。

| 序号 | 模型 | 公司 | 接入变量 |
|----|------|------|---------|
| 1 | Claude Fable 5 | Anthropic | `ANTHROPIC_API_KEY` / `CLAUDE_FABLE_MODEL` |
| 2 | Claude Opus 4.8 | Anthropic | dk: `DK_ANTHROPIC_API_KEY` / `DK_ANTHROPIC_API_BASE` / `DK_CLAUDE_OPUS_MODEL` |
| 3 | GPT-5.5 | OpenAI | `OPENAI_API_KEY` / `OPENAI_MODEL` |
| 4 | Gemini 3.1 | Google | `GEMINI_API_KEY` 或 `ZENMUX_API_KEY` / `GOOGLE_GEMINI_BASE_URL` / `GEMINI_MODEL` |
| 5 | Qwen 3.7 Max | 阿里云 / 通义千问 | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `QWEN_MODEL` |
| 6 | MiniMax-M3 | MiniMax | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `MINIMAX_MODEL` |
| 7 | Kimi K2.6 | 月之暗面 / Moonshot AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `KIMI_MODEL` |
| 8 | Mimo v2.5 Pro | 小米 / MiMo | `MIMO_ANTHROPIC_API_KEY` / `MIMO_ANTHROPIC_API_BASE` / `MIMO_ANTHROPIC_MODEL` |
| 9 | Grok 4.3 | xAI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GROK_MODEL` |
| 10 | Muse Spark | Muse AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `MUSE_MODEL` |
| 11 | Claude Sonnet 4.6 | Anthropic | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `CLAUDE_SONNET_MODEL` |
| 12 | DeepSeek V4 Pro | DeepSeek | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `DEEPSEEK_MODEL` |
| 13 | GLM-5.1 | 智谱 AI | `ZENMUX_API_KEY` / `ZENMUX_API_BASE` / `GLM_MODEL` |
| 14 | 豆包 Seed 1.5 Thinking Pro | 字节跳动 / 火山方舟 | `DOUBAO_API_KEY` / `DOUBAO_API_BASE` / `DOUBAO_MODEL` |

## 豆包选择说明

火山方舟文档页面需要浏览器 JS 才能完整读取。可公开检索到的 ByteDance Seed 技术报告说明 Seed-Thinking-v1.5 与 Seed1.5-VL 已在 Volcengine 可用,其中给出的火山方舟模型 ID 包括 `doubao-1-5-thinking-vision-pro-250428`。本项目当前用文本预测占位 `doubao-1-5-thinking-pro-250428`;如火山方舟控制台显示更新的豆包文本模型,只需改 `.env` 的 `DOUBAO_MODEL`。

## 接入约束(公平性)

- **同一时刻**触发所有模型(或尽量靠近),记录每个预测的真实时间戳。
- **同一套 prompt**(见 `pipeline/prompts.js`),不为某个模型特调。
- 所有模型用**默认温度**或统一温度,记录在存证里。
- 模型返回必须是**结构化 JSON**(见 DATA-SCHEMA.md 的 prediction 结构),便于结算。
- 如某模型 API 暂不可用,在 `models.json` 标 `"enabled": false`,不影响其他模型。

## ZenMux 接入状态

- 已验证通过 ZenMux `/api/v1/responses` 接通:Qwen 3.7 Max、GLM-5.1、MiniMax-M3、Kimi K2.6、Grok 4.3、Claude Sonnet 4.6、DeepSeek V4 Pro。
- Muse Spark 已预留 `muse-spark` provider,但 ZenMux `/api/v1/models` 当前未返回 `muse` 或 `spark` 相关模型 ID;需要 ZenMux 提供准确 ID 后再把 `.env` 的 `MUSE_MODEL` 改成真实值。

## 反作弊 / 存证

- 每场每模型的预测,封盘时计算内容哈希 + 时间戳,写入 matches.json。
- 封盘后不得修改。结算只读取,不回写预测字段。

## key 管理

- 所有 key 走 `.env`(见 `.env.example`),**严禁硬编码进任何 .js**。
- 缺 key 时,predict.js 应跳过该模型并在日志提示,不应崩溃。

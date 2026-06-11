# 参赛模型清单

目标:**至少 10 个大模型**同场竞技。下面是建议清单,执行 AI 可按可用 API 调整,但数量不少于 10。

| 序号 | 模型 | 厂商 | 接入方式 | 备注 |
|----|------|------|---------|------|
| 1 | GPT-5.x | OpenAI | OpenAI API | |
| 2 | Claude Opus 4.x | Anthropic | Anthropic API | |
| 3 | Gemini 2.5/3 Pro | Google | Google API | |
| 4 | DeepSeek V3/R1 | DeepSeek | DeepSeek API | 中文社区粉丝多,有话题性 |
| 5 | Qwen Max | 阿里 | DashScope | |
| 6 | Grok | xAI | xAI API | |
| 7 | Llama 4 | Meta | 开源/托管 | |
| 8 | Mistral Large | Mistral | Mistral API | |
| 9 | GLM-4.x | 智谱 | 智谱 API | |
| 10 | Kimi | 月之暗面 | Moonshot API | |
| 11 | Doubao | 字节 | 火山方舟 | 可选,凑话题 |
| 12 | MiniMax | MiniMax | MiniMax API | 可选 |

## 接入约束(公平性)

- **同一时刻**触发所有模型(或尽量靠近),记录每个预测的真实时间戳。
- **同一套 prompt**(见 `pipeline/prompts.js`),不为某个模型特调。
- 所有模型用**默认温度**或统一温度,记录在存证里。
- 模型返回必须是**结构化 JSON**(见 DATA-SCHEMA.md 的 prediction 结构),便于结算。
- 如某模型 API 暂不可用,在 `models.json` 标 `"enabled": false`,不影响其他模型。

## 反作弊 / 存证

- 每场每模型的预测,封盘时计算内容哈希 + 时间戳,写入 matches.json。
- 封盘后不得修改。结算只读取,不回写预测字段。

## key 管理

- 所有 key 走 `.env`(见 `.env.example`),**严禁硬编码进任何 .js**。
- 缺 key 时,predict.js 应跳过该模型并在日志提示,不应崩溃。

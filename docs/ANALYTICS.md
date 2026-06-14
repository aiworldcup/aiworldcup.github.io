# 访问统计后台

站点继续保持 GitHub Pages 静态部署,访问统计由 Cloudflare Worker + D1 承接。

## 数据口径

- 总访问量:所有页面访问事件数。
- 总独立访客:按浏览器本地匿名 ID 去重。
- 今日访问量 / 今日独立访客:按北京时间自然日统计。
- 其他维度:最近 7 天趋势、热门页面、来源域名、设备类型、国家/地区、最近访问记录。

埋点不写 cookie,只在浏览器 `localStorage` 保存一个匿名 visitor id,Worker 侧只保存 hash。

## 文件

- `worker/analytics-worker.mjs`:Cloudflare Worker API。
- `worker/schema.sql`:D1 表结构。
- `public/analytics.js`:前台访问埋点。
- `public/analytics-config.js`:Worker URL 配置。
- `public/admin.html`:访问数据后台。

## 部署

首次部署:

```bash
npx wrangler d1 create worldcup_ai_arena_analytics
# 把返回的 database_id 写入 wrangler.toml
npm run analytics:migrate
npm run analytics:deploy
# 把部署得到的 Worker URL 写入 public/analytics-config.js
```

后台地址:

```text
https://ccavtjy.github.io/worldcup-ai-arena/admin.html
```

如果给 Worker 设置 `ADMIN_TOKEN` secret,后台页需要填 token 才能读取统计:

```bash
npx wrangler secret put ADMIN_TOKEN
```

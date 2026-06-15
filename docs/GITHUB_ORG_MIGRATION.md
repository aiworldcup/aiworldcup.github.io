# GitHub Organization 迁移准备

目标:把站点从个人 GitHub Pages 地址迁到组织 Pages 地址。

## 当前状态

- 当前线上地址:`https://aiworldcup.github.io/`
- 旧个人 Pages 地址:`https://ccavtjy.github.io/worldcup-ai-arena/`
- 旧代码仓库:`https://github.com/ccavtjy/worldcup-ai-arena`
- 新 GitHub Organization:`https://github.com/aiworldcup`
- 新组织 Pages 仓库:`https://github.com/aiworldcup/aiworldcup.github.io`

## 已完成前置

- `aiworldcup` Organization 已创建。
- 当前 GitHub 登录账号 `ccavtjy` 在组织内是 admin。
- `aiworldcup/aiworldcup.github.io` 已创建为 public 仓库。
- 站点内容已推送到组织仓库 `main` 分支。
- GitHub Pages 通过 `.github/workflows/pages.yml` 从 `public/` 发布。
- 本地 `origin` 已切换为组织仓库,`legacy` 保留旧个人仓库。

## 已完成迁移项

1. 确认当前工作区所有前端改动已经提交。
2. 把完整站点推送到 `aiworldcup/aiworldcup.github.io`。
3. 对新仓库启用 GitHub Pages。
4. 更新后台入口说明,默认地址从 `ccavtjy.github.io/worldcup-ai-arena` 切到 `aiworldcup.github.io`。
5. 确认自动发布脚本的推送目标已切换到新仓库。
6. 保留旧仓库作为备份,不要立刻删除。

## 注意

- 不要删除旧仓库或旧 Pages 地址。
- 如果后续换自定义域名,先在 GitHub Pages 设置 custom domain,再改 DNS。

# GitHub Organization 迁移准备

目标:先保留当前开发节奏,最后再把站点从个人 GitHub Pages 地址迁到组织 Pages 地址。

## 当前状态

- 现在线上地址:`https://ccavtjy.github.io/worldcup-ai-arena/`
- 当前代码仓库:`https://github.com/ccavtjy/worldcup-ai-arena`
- 新 GitHub Organization:`https://github.com/aiworldcup`
- 新组织 Pages 仓库已创建:`https://github.com/aiworldcup/aiworldcup.github.io`
- 目标公开地址:`https://aiworldcup.github.io/`

## 已完成前置

- `aiworldcup` Organization 已创建。
- 当前 GitHub 登录账号 `ccavtjy` 在组织内是 admin。
- `aiworldcup/aiworldcup.github.io` 已创建为 public 仓库。
- 新仓库暂未启用 Pages,因为还没有搬入站点内容。

## 最后迁移时再做

1. 确认当前工作区所有前端改动已经提交。
2. 把完整站点推送到 `aiworldcup/aiworldcup.github.io`。
3. 对新仓库启用 GitHub Pages。
4. 更新站内分享/说明链接,把默认地址从 `ccavtjy.github.io/worldcup-ai-arena` 切到 `aiworldcup.github.io`。
5. 确认自动发布脚本的推送目标是否切换到新仓库。
6. 保留旧仓库作为备份或跳转页,不要立刻删除。

## 不要现在做

- 不要改当前 `origin`。
- 不要把当前未完成的前端改动强行提交到新仓库。
- 不要删除旧仓库或旧 Pages 地址。

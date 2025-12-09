# MediaTracker AI

[English](README.md) | [中文](README.zh.md)

跨平台桌面应用，用于搜索、收藏与追踪电影、电视剧、书籍、漫画、短剧、音乐。前端 React + Vite，后端 Tauri (Rust)。支持首屏先返回、海报异步补全、本地缓存、国际化与隐私保护。

## 功能
- AI 搜索与热门：首屏快速返回
- 海报异步补全；本地缓存 2 小时
- 离线友好：无网时基于上下文返回，后台异步校验
- 收藏（喜欢/想看/看过）与连载追更
- 图片加载/失败状态（符合 i18n）
- API Key 本地 AES 加密保存

## 快速开始
- 桌面开发：`npm run tauri dev`
- 仅前端开发：`npm run dev`
- 桌面构建：`npm run tauri build`

## GitHub Actions 发布
- 推送标签 `vX.Y.Z` 或在 Actions 手动运行，将自动构建 Windows 可执行文件并发布到 GitHub Release。

## 隐私
- API Key 仅本地保存并加密
- `.env` 已忽略，不提交密钥到仓库

## 许可
用于学习与个人使用。公开分发前请补充许可证。

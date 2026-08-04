# 与 Windows 电脑版的关系

英语刷题机 Android 是基于 Windows 电脑版产品理念和界面代码发展出的独立项目。

## 初始来源

- 电脑版项目：英语刷题机
- Android MVP 来源提交：`f76f113 Add Android tablet MVP with Capacitor`
- 独立日期：2026-08-04

独立之后，Android 项目使用自己的 Git 历史、版本号、更新通道、签名证书和发布计划。来源提交只用于追踪首版代码关系，不代表两个项目之后自动同步。

## 保持兼容的内容

- ESQ 1.0 的 `manifest.json`、试卷、答案和可选标签结构。
- `packageId`、`paperKey`、`unitKey`、`questionKey` 等稳定标识。
- 不将个人练习记录、错题、单词本、聊天或 API 配置写入 ESQ。
- 替换题库时尽量按稳定键保留本地题目 ID 和学习记录关联。

## 不共享的内容

- Windows SQLite 数据库与 Android SQLite 数据库。
- API Key 与模型配置。
- 练习、错题、单词和对话记录。
- Windows 便携包与 Android APK。
- Windows 版本号与 Android `versionCode`。
- Windows 发布仓库与 Android 发布仓库。

## 从电脑版移植功能

需要从电脑版引入功能时：

1. 先确认该功能是否适合触控、Android 权限和应用生命周期。
2. 只移植明确相关的提交或文件，不复制整个电脑版目录。
3. 保持 Android 本地 API 适配层，不重新引入 FastAPI 运行时。
4. 涉及题库格式时，同时检查 ESQ 1.0 向后兼容性。
5. 在 Android 项目中独立测试、提交和发布。

Android 项目的功能可以晚于、早于或不同于电脑版，两个项目不要求逐版本一致。

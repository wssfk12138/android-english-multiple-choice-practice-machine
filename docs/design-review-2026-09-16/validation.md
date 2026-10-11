# 预览验证记录

核验日期：2026-09-16。对象是本轮独立 HTML 设计原型及交付文档；没有对应用源码实施修改，也没有构建、安装或改变学习数据。

## 实际执行结果

使用本机 Playwright / Chromium 检查最终预览，最近一次运行退出码为 0。

| 检查 | 覆盖 | 结果 |
| --- | --- | --- |
| 页面布局 | 19 页 × 1205、1024、753、390、320 CSS px，共 95 次 | 未发现页面或所检查元素的横向溢出 |
| 深色与字体模拟 | 单词本、每日一背、设置、API × 1205/390，共 8 次，深色且根字号 125% | 未发现横向溢出 |
| 备选布局与窄屏 | 12 个截图状态 | 未发现横向溢出 |
| JavaScript | 上述页面检查及交互 | 未捕获运行错误 |

共 115 个布局状态检查。没有横向溢出不代表所有原生交互、文字对比度或无障碍要求均已验证。

交付文件检查：5 份 Markdown 按 UTF-8 解码通过，61 个本地链接目标存在，31 张 PNG 齐全，未发现行末空白或所扫描的疑似密钥模式。git diff --check 通过；既有文件的 LF/CRLF 提示未通过改写文件处理。新文件另行检查，不以 Git 对既有差异的检查代替。

交互检查得到以下 7 项结果：显示设置数为 11；关闭笔记显示后示例详情隐藏；编辑后笔记在预览状态中保留；API 更多菜单可见；目录筛选使一条示例模型记录隐藏；复习评分可进入下一词；组内批量开关只影响该组。预览状态保留不等于应用数据库持久化。

已逐页查看 19 张主页面截图，并查看批量按钮、窄屏单词本、深色窄屏 API，以及复习、设置和 API 双栏备选。检查中修正了深色工具栏背景可读性、重复筛选入口和示例交互文字；最终截图已重新生成。其余备选完成自动布局检查，未声称逐张人工检查。

## 31 张截图索引

19 张主页面展示推荐布局，12 张展示备选或窄屏状态。

| 主页面 | 截图 |
| --- | --- |
| 单词本 | [vocab](previews/vocab.png) |
| 每日一背 | [review](previews/review.png) |
| 单词显示 | [display](previews/display.png) |
| 设置首页 | [settings](previews/settings.png) |
| 词条维护 | [maintenance](previews/maintenance.png) |
| 模型与 API | [api](previews/api.png) |
| 首页 | [home](previews/home.png) |
| 题库与练习 | [library](previews/library.png) |
| 错题本 | [wrong](previews/wrong.png) |
| 导入题库 | [imports](previews/imports.png) |
| 草稿校对 | [draft](previews/draft.png) |
| 智能标注 | [labeling](previews/labeling.png) |
| 做题 | [practice](previews/practice.png) |
| AI 助手 | [assistant](previews/assistant.png) |
| 更新与远程题库 | [updates](previews/updates.png) |
| 设备同步 | [sync](previews/sync.png) |
| 诊断日志 | [diagnostics](previews/diagnostics.png) |
| 回收站 | [trash](previews/trash.png) |
| 帮助 | [help](previews/help.png) |

| 备选 / 状态 | 截图 |
| --- | --- |
| D01 列表 A / C | [A](previews/vocab-a.png)、[C](previews/vocab-c.png) |
| D02 比例宽度 | [30% 列表](previews/vocab-ratio.png) |
| D03 折叠 / D05 我的卡片 | [组合示例](previews/vocab-card-collapsed.png) |
| D04 复习双栏 | [双栏](previews/review-two.png) |
| D07 设置双列 | [双列](previews/settings-two.png) |
| D09 API 两组并排 | [两组](previews/api-two.png) |
| D08 组内批量操作 | [批量按钮](previews/display-batch.png) |
| D06 隐藏计数 | [不显示计数](previews/settings-no-count.png) |
| D10 宽松密度 | [宽松布局](previews/settings-roomy.png) |
| 窄屏单词本 | [390 CSS px](previews/vocab-mobile.png) |
| 深色窄屏 API | [390 CSS px，菜单与密钥管理展开](previews/api-dark-mobile.png) |

## 验证边界与复核入口

- 这是浏览器原型检查；未执行 Android 真机、系统字号 150%/200%、键盘遮挡、旋转、原生返回键、真实 API、数据库和密钥存储验收。125% 根字号模拟不能替代 Android 系统字号检查。
- 模型、进度和题目均为示例数据。部分次要按钮只显示演示提示，未实现完整导入、同步、删除、下载或会话业务。
- 宿主调整面板的绑定通过测试用 Tweak 替身触发并验证；未验证真实宿主面板的全部交互。页面自身的布局下拉框可直接使用，备选截图可独立查看。
- 本轮未测量真实应用首屏性能，不把原型流畅度作为卡顿已经修复的证据。
- 私有工作目录中的 preview-qa.mjs 与 preview-qa.json 保存脚本和机器结果；原始对话摘录未复制进本交付。
- 后续 Android 验收按 [整改方案](README.md) 的阶段门槛执行。

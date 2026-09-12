# GitHub Android 小包接收定向闭环

- 2026-09-05：公开目录四项已在 Android 真机显示，包含 CET-4、CET-6、考研英语一和英语二；复用此前四包 PC HTTP 大小/SHA-256 验证，不重复下载大包。
- 原生 expectedSize 经 JSON 解析为 Integer，Capacitor 8.5.0 getLong 仅接受 Long，导致下载参数错误。修复仓 github-v2 改为验证 Number 的有限整数及既有大小边界；QuestionBankSizeTest 和 assembleLocalTest 通过，同签名 code105 install -r 成功。
- 考研英语二 294673-byte 小包已通过真机下载、大小/SHA 校验和 ESQ 解析预览，显示 ESQ 1.0、720 道题、96 篇。私有证据：qa-20260905/remote3-preview.xml/png。
- 未批准发布；远程导入未出现独立目标配置选择，现阶段作为隔离风险，下一阶段需沿源码确认并修复/验证，不将 UI 观察直接等同数据库污染。
- 远程目录 URL 清空并保存（remote3-url-saved），首页原考研英语一 18/107/805 可见（remote3-home）；Clash 已停止（remote-final-check）。不等于手机全库逐行校验，草稿保留。
- CET 大包真机下载、批准入库与作答、真实高版本 APK 远程升级均未执行。APK 更新已有 PC 下载/大小/SHA/验签及旧清单解析证据，不能替代真机升级。
- 此闭环不含新源码提交、push、Release 或跨仓同步。只复查差异和更新当前记录，不重复构建或全量验收。

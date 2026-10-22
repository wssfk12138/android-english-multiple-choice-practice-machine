# G0-B 公测升级库启动阻塞复现

日期：2026-10-21。状态：**已按方案 A 解决（RESOLVED）**。修复前状态为 **FAIL / BLOCKED**；修复只改公测清单和共享预检逻辑，未修改公测真实库、未改正文、未删保护清单。

## 修复前结论

公测安装库在真实启动生命周期中仍被内容保护拦住。预检 65 篇中 **7 篇冲突，全部集中在 `passage` 字段**；39 篇需要处理（含这 7 篇，其中 32 篇需更新正文、7 篇只需标记修订），其余 26 篇已匹配。启动异常为 `ValueError: 题库内容存在未审查差异，修正已停止`。

这不是仅存在于历史回执里的问题：修复前公测源码和构建产物仍携带同一份 `frontend/public/content-remediation.json`，SHA-256 为 `45625023d50705f34bef50ec1911e280696c1e7e0387c1af1737ed936a79fbae`，修订 `2026-09-r3`，共 65 篇。公测安装库没有 `content_remediation_receipts` 表，说明这份清单尚未在该库成功应用。

当前 P 开发库 `backend/data/question_bank.db` 已经是修正后的状态（65 条回执、0 冲突），不能用它代替升级库验收；本次使用公测安装库的在线备份复现。

## 样本与方法

| 项目 | 值 |
| --- | --- |
| 公测安装库 | `C:/Users/MEC/AppData/Local/EnglishPracticeMachinePublic/question_bank.db`，2,953,216 字节 |
| 结构 | 34 套 / 203 篇；65 篇修订 `2026-09-r3`；无 `content_remediation_receipts` |
| 迁移 | `question-label-auto-lock-v1`、`wrong-current-pool-v1` |
| 隔离备份 | `work/g0b/public-upgraded.db`，SQLite 在线备份，`integrity_check=ok` |
| 逻辑摘要 | 原库与备份均为 `a2300a51568ef28ee9b2649ea9775bd6ee4b92a1b1aa3fe34f239216806e90e5` |
| 启动探针 | `work/g0b/probe-data/question_bank.db`，`ENGLISH_PRACTICE_DATA_DIR` 指向隔离目录，`TestClient` 触发 FastAPI lifespan |
| 启动结果 | `startup=blocked`，`ValueError: 题库内容存在未审查差异，修正已停止` |
| 原库改动 | 原库修改时间保持 `2026-10-11 14:56:11`；探针只使用副本 |

复现脚本位于 `work/g0b/`（临时证据，不入库）：`backup_public.py`、`startup_probe.py`、`scan_preflight.py`、`analyze_conflicts.py`、`logical_digest.py`、`make_conflict_review.py`。

## 7 篇冲突

全部只差 `passage`，题目、选项、答案未报告冲突。去掉空白后仍不相等，不能靠空白归一化放行。

| unitKey | actual / before / after 归一化长度 | actual-before 相似度 | actual-after 相似度 | 判断 |
| --- | --- | ---: | ---: | --- |
| `local.english-practice.2002.unit1` | 1463 / 1474 / 1543 | 0.9963 | 0.7106 | 与 before 极近，仍有少量文本差异 |
| `local.english-practice.2013.unit6` | 1995 / 1996 / 2015 | 0.9997 | 0.9800 | 与 before 仅差约 1 字符 |
| `local.english-practice.2015.unit1` | 1448 / 1454 / 1528 | 0.9979 | 0.8091 | 与 before 极近 |
| `local.english-practice.2016.unit1` | 1330 / 1331 / 1410 | 0.9996 | 0.8248 | 与 before 仅差约 1 字符 |
| `local.english-practice.2016.unit6` | 2432 / 1426 / 2452 | 0.6630 | 0.9836 | 与 after 接近，但与 before 差异大 |
| `local.english-practice.2020.unit6` | 2431 / 2481 / 2451 | 0.9898 | 0.9836 | 与 after 接近，仍有少量差异 |
| `kaoyan2:2022.unit6` | 2434 / 2409 / 2454 | 0.9928 | 0.9836 | 与 after 接近，仍有少量差异 |

完整逐行差异保存在本地 `work/g0b/conflict-review.html`，包含题库正文，**只供本机审阅，不提交、不发布、不复制到公开树**。

## A 方案：已审阅指纹接受（已实装）

用户确认 7 篇实际正文是合法版本，选择 A。为避免把用户库正文写进公测源码，清单没有新增 `reviewedBefore` 正文，而是给对应篇目增加 `reviewedHashes`（整篇内容的 SHA-256）。预检命中该指纹时视为“已审阅版本”：

- 不覆盖 `passage`、题目、选项或答案；
- 只把 `shared.content_revision` 标到清单修订号；
- 只有正文变化才写回执，已接受版本不写正文回执；
- 未命中 `before`、`after` 或 `reviewedHashes` 的第三种版本仍然报冲突。

公测清单从 `45625023…`（4,140,323 字节）更新为 `34e9fa63…`（4,141,114 字节），只新增 7 个哈希；结构核对 `changedWithoutHashes=[]`，没有新增或改动任何正文。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 隔离库预检（修复后） | 65 篇：0 冲突、7 篇已接受、32 篇正文待更新、26 篇原本已匹配 |
| 真实 lifespan 第一次启动 | `startup=ok status=200`；创建 1 份内容备份 |
| 应用结果 | 32 篇更新到 `after`；7 篇保持实际正文并标记修订号；26 篇未变；203 单元 / 34 套不变 |
| 回执 | 32 条正文更新回执；7 篇已接受版本不需要正文回执 |
| 第二次启动 | `startup=ok status=200`；内容备份仍为 1 份，没有重复备份或重复更新 |
| 原库 | 逻辑摘要与在线备份一致 `a2300a51…`；修改时间保持 `2026-10-11 14:56:11` |
| 自动化 | 两树 `test_content_remediation` 3/3；W ESQ 3/3、启动 4/4；P ESQ 2/2、启动 8/8 |

## 处置结论

1. 保留现有保护，不移除清单、不吞异常、不用测试库冒充用户库。
2. 7 篇已按用户确认的 A 方案接受；实际正文保留，公测清单只增加哈希。
3. 新增的 `reviewedHashes` 规则只接受已审阅版本；未命中指纹的第三种版本仍会阻塞，保护没有被放宽成“任何版本都通过”。
4. P 可以继续进入后续门禁；真实公测库的覆盖安装、打包和发布仍按 G7/G8 另行验证。

G0-B 当前状态记为 **RESOLVED（A）**。本回执不替代真实安装、打包或用户验收。

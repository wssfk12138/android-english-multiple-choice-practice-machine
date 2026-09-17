# 本次任务变更报告

- 基线：`load-surfaces-batch-0917`
- 创建时间：`2026-09-17T04:31:55.682903+00:00`
- 范围：仅包含基线创建之后发生的文件变化。

## 文件变化

| 状态 | 新增 | 删除 | 文件 |
| --- | ---: | ---: | --- |
| 新增 | 458 | 0 | `docs/context/history/2026-09-17-load-surfaces-changes.md` |
| 删除 | 0 | 99 | `frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js` |
| 新增 | 99 | 0 | `frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js` |
| 新增 | 3 | 0 | `frontend/android/app/src/main/assets/public/assets/content-remediation-CPQLUn6F.js` |
| 删除 | 0 | 3 | `frontend/android/app/src/main/assets/public/assets/content-remediation-D72u918K.js` |
| 新增 | 64 | 0 | `frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js` |
| 删除 | 0 | 64 | `frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js` |
| 删除 | 0 | 2 | `frontend/android/app/src/main/assets/public/assets/index-DAs1h9zC.js` |
| 新增 | 2 | 0 | `frontend/android/app/src/main/assets/public/assets/index-ZmYdvK6A.js` |
| 删除 | 0 | 80 | `frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js` |
| 新增 | 80 | 0 | `frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js` |
| 删除 | 0 | 136 | `frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js` |
| 新增 | 137 | 0 | `frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js` |
| 新增 | 2 | 0 | `frontend/android/app/src/main/assets/public/assets/practice-snapshots-CO0oK2Ix.js` |
| 删除 | 0 | 2 | `frontend/android/app/src/main/assets/public/assets/practice-snapshots-Cc_tbYE5.js` |
| 删除 | 0 | 13 | `frontend/android/app/src/main/assets/public/assets/study-todos-CxlnmdrH.js` |
| 新增 | 13 | 0 | `frontend/android/app/src/main/assets/public/assets/study-todos-DyummtJI.js` |
| 删除 | 0 | 2 | `frontend/android/app/src/main/assets/public/assets/sync-scheduler-BMX5O2fK.js` |
| 新增 | 2 | 0 | `frontend/android/app/src/main/assets/public/assets/sync-scheduler-e4GG5iz4.js` |
| 新增 | 54 | 0 | `frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js` |
| 删除 | 0 | 54 | `frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-BVx114ki.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-BXAsv6RI.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-CFwk5pmQ.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-CRvteqfv.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-Crt0wWY-.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-DS7ypyM-.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-DZj2H0-2.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-DtILukJZ.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-Dv9keq8L.js` |
| 新增 | 1 | 0 | `frontend/android/app/src/main/assets/public/assets/web-X_rCUTyG.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-q0BFx2Jg.js` |
| 删除 | 0 | 1 | `frontend/android/app/src/main/assets/public/assets/web-r_ObljKP.js` |
| 修改 | 1 | 1 | `frontend/android/app/src/main/assets/public/index.html` |
| 修改 | 2 | 1 | `frontend/src/platform/android/ai.ts` |
| 修改 | 9 | 2 | `frontend/src/platform/android/model-key-store.ts` |
| 修改 | 12 | 11 | `frontend/src/platform/android/practice.ts` |
| 修改 | 26 | 7 | `frontend/src/platform/android/study-todos.ts` |
| 修改 | 5 | 2 | `frontend/src/platform/android/vocabulary.ts` |
| 修改 | 17 | 3 | `frontend/tests/android-read-path-latency.mjs` |
| 修改 | 1 | 1 | `frontend/tests/document-draft-persistence.mjs` |
| 修改 | 2 | 0 | `frontend/tests/maintenance-routing.mjs` |
| 新增 | 106 | 0 | `frontend/tests/model-config-read-path.mjs` |
| 修改 | 19 | 0 | `frontend/tests/startup-todo-dedup.mjs` |

## 代表性差异

```diff
--- baseline/docs/context/history/2026-09-17-load-surfaces-changes.md
+++ current/docs/context/history/2026-09-17-load-surfaces-changes.md
@@ -0,0 +1,458 @@
+# 变更报告
+
+- 仓库：`E:\EnglishPracticeMachine\Codex\english-multiple-choice-practice-machine-android`
+- 基准：`HEAD`（包含 staged 和 unstaged 修改）
+
+## 文件状态
+
+| 状态 | 文件 |
+| --- | --- |
+| `M` | `PROJECT_INDEX.md` |
+| `M` | `docs/context/2026-09-tablet-landscape-ui-plan.md` |
+| `M` | `docs/context/DECISIONS.md` |
+| `M` | `docs/context/NOW.md` |
+| `M` | `docs/context/RISKS.md` |
+| `M` | `docs/context/RUNBOOK.md` |
+| `M` | `docs/context/remediation-followup-2026-09-11.md` |
+| `M` | `docs/context/remediation-plan-2026-09.md` |
+| `M` | `frontend/src/App.vue` |
+| `M` | `frontend/src/components/NamedModelKeys.vue` |
+| `M` | `frontend/src/components/StudyTodos.vue` |
+| `M` | `frontend/src/main.ts` |
+| `M` | `frontend/src/platform/android/ai.ts` |
+| `M` | `frontend/src/platform/android/content-remediation.ts` |
+| `M` | `frontend/src/platform/android/local-api.ts` |
+| `M` | `frontend/src/platform/android/model-key-store.ts` |
+| `M` | `frontend/src/platform/android/practice.ts` |
+| `M` | `frontend/src/platform/android/question-bank-profiles.ts` |
+| `M` | `frontend/src/platform/android/question-bank.ts` |
+| `M` | `frontend/src/platform/android/study-todos.ts` |
+| `M` | `frontend/src/platform/android/vocabulary-enrichment-runner.ts` |
+| `M` | `frontend/src/platform/android/vocabulary.ts` |
+| `M` | `frontend/src/router.ts` |
+| `M` | `frontend/src/settings-hub.css` |
+| `M` | `frontend/src/study-theme.css` |
+| `M` | `frontend/src/views/AndroidVocabularyDisplayView.vue` |
+| `M` | `frontend/src/views/DashboardView.vue` |
+| `M` | `frontend/src/views/MobileSettingsView.vue` |
+| `M` | `frontend/src/views/SettingsView.vue` |
+| `M` | `frontend/src/views/VocabularyView.vue` |
+| `M` | `frontend/src/views/WrongView.vue` |
+| `M` | `frontend/src/vocabulary-context.ts` |
+| `M` | `frontend/tests/database-migration.mjs` |
+| `M` | `frontend/tests/document-draft-persistence.mjs` |
+| `M` | `frontend/tests/maintenance-routing.mjs` |
+| `M` | `frontend/tests/model-keys.mjs` |
+| `M` | `frontend/tests/run-all.mjs` |
+| `M` | `frontend/tests/settings-layout.mjs` |
+| `M` | `frontend/tests/ui-omissions.mjs` |
+| `M` | `frontend/tests/vocabulary-enrichment-jobs.mjs` |
+| `M` | `frontend/tests/vocabulary-layout.mjs` |
+| `M` | `frontend/tests/vocabulary-manual-edit.mjs` |
+| `M` | `frontend/tests/vocabulary-model-validation.mjs` |
+| `M` | `frontend/tests/vocabulary-review-refresh.mjs` |
+| `M` | `frontend/tests/vocabulary-review-revision.mjs` |
+| `M` | `frontend/vite.config.ts` |
+| `??` | `docs/context/2026-09-overall-remediation-plan.md` |
+| `??` | `docs/context/2026-09-ui-decisions.md` |
+| `??` | `docs/context/2026-09-ui-next-round-design.md` |
+| `??` | `docs/context/2026-09-ui-next-round-plan.md` |
+| `??` | `docs/context/history/2026-09-14-android-first-load-lag-audit.md` |
+| `??` | `docs/context/history/2026-09-16-landscape-remediation-implementation.md` |
+| `??` | `docs/context/history/2026-09-17-tablet-delivery.md` |
+| `??` | `docs/context/history/2026-09-17-vocabulary-latency.md` |
+| `??` | `docs/context/history/2026-09-vocabulary-lag-deferred-handoff.md` |
+| `??` | `docs/design-review-2026-09-15/` |
+| `??` | `docs/design-review-2026-09-16/` |
+| `??` | `frontend/src/components/VocabularyMaintenance.vue` |
+| `??` | `frontend/src/composables/` |
+| `??` | `frontend/src/platform/android/wrong-analysis-history.ts` |
+| `??` | `frontend/src/services/configAutosave.ts` |
+| `??` | `frontend/src/services/keyDrafts.ts` |
+| `??` | `frontend/src/services/profileDrafts.ts` |
+| `??` | `frontend/src/services/wrongAnalysisSessions.ts` |
+| `??` | `frontend/src/services/wrongListReturn.ts` |
+| `??` | `frontend/src/views/WrongAnalysisView.vue` |
+| `??` | `frontend/tests/android-read-path-latency.mjs` |
+| `??` | `frontend/tests/config-autosave.mjs` |
+| `??` | `frontend/tests/model-config-read-path.mjs` |
+| `??` | `frontend/tests/papers-read-path.mjs` |
+| `??` | `frontend/tests/profile-drafts.mjs` |
+| `??` | `frontend/tests/remediation-startup-gate.mjs` |
+| `??` | `frontend/tests/startup-todo-dedup.mjs` |
+| `??` | `frontend/tests/wrong-analysis-history.mjs` |
+| `??` | `session-70b8c0da-b83c-4efe-bf00-f819bdf069f0.tmp` |
+
+## 增删统计
+
+| 新增 | 删除 | 文件 |
+| ---: | ---: | --- |
+| 3 | 2 | `PROJECT_INDEX.md` |
+| 9 | 2 | `docs/context/2026-09-tablet-landscape-ui-plan.md` |
+| 7 | 1 | `docs/context/DECISIONS.md` |
+| 22 | 10 | `docs/context/NOW.md` |
+| 5 | 5 | `docs/context/RISKS.md` |
+| 4 | 0 | `docs/context/RUNBOOK.md` |
+| 2 | 0 | `docs/context/remediation-followup-2026-09-11.md` |
+| 3 | 1 | `docs/context/remediation-plan-2026-09.md` |
+| 3 | 6 | `frontend/src/App.vue` |
+| 59 | 21 | `frontend/src/components/NamedModelKeys.vue` |
+| 5 | 11 | `frontend/src/components/StudyTodos.vue` |
+| 6 | 2 | `frontend/src/main.ts` |
+| 31 | 8 | `frontend/src/platform/android/ai.ts` |
+| 12 | 6 | `frontend/src/platform/android/content-remediation.ts` |
+| 6 | 1 | `frontend/src/platform/android/local-api.ts` |
+| 38 | 7 | `frontend/src/platform/android/model-key-store.ts` |
+| 16 | 8 | `frontend/src/platform/android/practice.ts` |
+| 34 | 1 | `frontend/src/platform/android/question-bank-profiles.ts` |
+| 12 | 3 | `frontend/src/platform/android/question-bank.ts` |
+| 56 | 7 | `frontend/src/platform/android/study-todos.ts` |
+| 2 | 1 | `frontend/src/platform/android/vocabulary-enrichment-runner.ts` |
+| 80 | 25 | `frontend/src/platform/android/vocabulary.ts` |
+| 2 | 0 | `frontend/src/router.ts` |
+| 11 | 0 | `frontend/src/settings-hub.css` |
+| 17 | 8 | `frontend/src/study-theme.css` |
+| 16 | 3 | `frontend/src/views/AndroidVocabularyDisplayView.vue` |
+| 26 | 10 | `frontend/src/views/DashboardView.vue` |
+| 13 | 3 | `frontend/src/views/MobileSettingsView.vue` |
+| 68 | 55 | `frontend/src/views/SettingsView.vue` |
+| 178 | 49 | `frontend/src/views/VocabularyView.vue` |
+| 31 | 3 | `frontend/src/views/WrongView.vue` |
+| 8 | 0 | `frontend/src/vocabulary-context.ts` |
+| 1 | 1 | `frontend/tests/database-migration.mjs` |
+| 1 | 1 | `frontend/tests/document-draft-persistence.mjs` |
+| 2 | 0 | `frontend/tests/maintenance-routing.mjs` |
+| 23 | 0 | `frontend/tests/model-keys.mjs` |
+| 6 | 1 | `frontend/tests/run-all.mjs` |
+| 5 | 3 | `frontend/tests/settings-layout.mjs` |
+| 8 | 3 | `frontend/tests/ui-omissions.mjs` |
+| 2 | 2 | `frontend/tests/vocabulary-enrichment-jobs.mjs` |
+| 65 | 8 | `frontend/tests/vocabulary-layout.mjs` |
+| 18 | 2 | `frontend/tests/vocabulary-manual-edit.mjs` |
+| 8 | 0 | `frontend/tests/vocabulary-model-validation.mjs` |
+| 133 | 7 | `frontend/tests/vocabulary-review-refresh.mjs` |
+| 80 | 5 | `frontend/tests/vocabulary-review-revision.mjs` |
+| 7 | 0 | `frontend/vite.config.ts` |
+| 129 | 0 | `docs/context/2026-09-overall-remediation-plan.md` |
+| 573 | 0 | `docs/context/2026-09-ui-decisions.md` |
+| 688 | 0 | `docs/context/2026-09-ui-next-round-design.md` |
+| 355 | 0 | `docs/context/2026-09-ui-next-round-plan.md` |
+| 161 | 0 | `docs/context/history/2026-09-14-android-first-load-lag-audit.md` |
+| 99 | 0 | `docs/context/history/2026-09-16-landscape-remediation-implementation.md` |
+| 40 | 0 | `docs/context/history/2026-09-17-tablet-delivery.md` |
+| 51 | 0 | `docs/context/history/2026-09-17-vocabulary-latency.md` |
+| 23 | 0 | `docs/context/history/2026-09-vocabulary-lag-deferred-handoff.md` |
+| 14 | 0 | `docs/design-review-2026-09-15/decision-list-2026-09-15.md` |
+| 18 | 0 | `docs/design-review-2026-09-15/evidence-and-coverage-2026-09-15.md` |
+| 25 | 0 | `docs/design-review-2026-09-15/remediation-plan-2026-09-15.md` |
+| 22 | 0 | `docs/design-review-2026-09-15/ui-design-spec-2026-09-15.md` |
+| 8 | 0 | `docs/design-review-2026-09-15/ui-prototype.html` |
+| 79 | 0 | `docs/design-review-2026-09-16/README.md` |
+| 117 | 0 | `docs/design-review-2026-09-16/decisions.md` |
+| 114 | 0 | `docs/design-review-2026-09-16/evidence.md` |
+| ? | 0 | `docs/design-review-2026-09-16/previews/api-dark-mobile.png` |
+| ? | 0 | `docs/design-review-2026-09-16/previews/api-two.png` |
+| ? | 0 | `docs/design-review-2026-09-16/previews/api.png` |
+| ? | 0 | `docs/design-review-2026-09-16/previews/assistant.png` |
+| ? | 0 | `docs/design-review-2026-09-16/previews/diagnostics.png` |
```

## 图差异

- 图差异状态：`partial`
- 降级原因：基线或当前图不是 fresh
- 新增节点：`156`
- 删除节点：`152`
- 节点范围/签名变化：`3`
- 新增关系：`740`
- 删除关系：`713`

### 节点变化

- 新增：`B` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:24)
- 新增：`Ce` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:22)
- 新增：`H` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:79)
- 新增：`I` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:16)
- 新增：`L` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:64)
- 新增：`Me` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:17)
- 新增：`O` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:5)
- 新增：`Oe` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:11)
- 新增：`Te` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:8)
- 新增：`Ue` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:46)
- 新增：`be` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:18)
- 新增：`Ue.ce` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:57)
- 新增：`i` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:25)
- 新增：`le` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:29)
- 新增：`ne` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:1)
- 新增：`xe` (frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:68)
- 新增：`R` (frontend/android/app/src/main/assets/public/assets/content-remediation-CPQLUn6F.js:2)
- 新增：`R.Y` (frontend/android/app/src/main/assets/public/assets/content-remediation-CPQLUn6F.js:3)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/content-remediation-CPQLUn6F.js:1)
- 新增：`Oe.Ce` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:47)
- 新增：`Ie` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:62)
- 新增：`K` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:50)
- 新增：`Oe` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:42)
- 新增：`P` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:17)
- 新增：`K.Se` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:54)
- 新增：`Te` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:49)
- 新增：`Z` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:33)
- 新增：`q.be` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:22)
- 新增：`fe` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:18)
- 新增：`ge` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:15)
- 新增：`le` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:11)
- 新增：`me` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:13)
- 新增：`q` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:21)
- 新增：`Oe.qe` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:48)
- 新增：`re` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:1)
- 新增：`ue` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:5)
- 新增：`we` (frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:38)
- 新增：`C` (frontend/android/app/src/main/assets/public/assets/index-ZmYdvK6A.js:2)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/index-ZmYdvK6A.js:1)
- 新增：`A` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:31)
- 新增：`Et` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:77)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:1)
- 新增：`ct` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:9)
- 新增：`A.ft` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:60)
- 新增：`pt` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:27)
- 新增：`q` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:2)
- 新增：`s` (frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:78)
- 新增：`B` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:7)
- 新增：`L` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:67)
- 新增：`Nt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:45)
- 新增：`Ot` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:99)
- 新增：`Rt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:59)
- 新增：`St` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:80)
- 新增：`T` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:57)
- 新增：`Tt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:87)
- 新增：`_` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:126)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:1)
- 新增：`_t` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:9)
- 新增：`c` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:135)
- 新增：`d` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:73)
- 新增：`dt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:39)
- 新增：`gt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:113)
- 新增：`rt.h` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:6)
- 新增：`ht` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:134)
- 新增：`j` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:33)
- 新增：`mt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:55)
- 新增：`pt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:69)
- 新增：`rt` (frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:2)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/practice-snapshots-CO0oK2Ix.js:1)
- 新增：`w` (frontend/android/app/src/main/assets/public/assets/practice-snapshots-CO0oK2Ix.js:2)
- 新增：`C` (frontend/android/app/src/main/assets/public/assets/study-todos-DyummtJI.js:13)
- 新增：`E` (frontend/android/app/src/main/assets/public/assets/study-todos-DyummtJI.js:1)
- 新增：`N` (frontend/android/app/src/main/assets/public/assets/sync-scheduler-e4GG5iz4.js:2)
- 新增：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/sync-scheduler-e4GG5iz4.js:1)
- 新增：`Ae` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:43)
- 新增：`B` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:1)
- 新增：`Pe` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:39)
- 新增：`Ue` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:12)
- 新增：`We` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:37)
- 新增：`be` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:45)
- 新增：`ge` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:40)
- 新增：`q` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:54)
- 新增：`xe` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:27)
- 新增：`u` (frontend/android/app/src/main/assets/public/assets/web-BXAsv6RI.js:1)
- 新增：`i` (frontend/android/app/src/main/assets/public/assets/web-CFwk5pmQ.js:1)
- 新增：`s` (frontend/android/app/src/main/assets/public/assets/web-CRvteqfv.js:1)
- 新增：`o` (frontend/android/app/src/main/assets/public/assets/web-DZj2H0-2.js:1)
- 新增：`f` (frontend/android/app/src/main/assets/public/assets/web-DtILukJZ.js:1)
- 新增：`m` (frontend/android/app/src/main/assets/public/assets/web-X_rCUTyG.js:1)
- 新增：`LocalApiError` (frontend/tests/model-config-read-path.mjs:69)
- 新增：`load` (frontend/tests/model-config-read-path.mjs:13)
- 新增：`agentTurn` (frontend/src/platform/android/ai.ts:349)
- 新增：`analyzeWrongQuestions` (frontend/src/platform/android/ai.ts:708)
- 新增：`analyzeWrongStatus` (frontend/src/platform/android/ai.ts:680)
- 新增：`apiHeaders` (frontend/src/platform/android/ai.ts:166)
- 新增：`candidate` (frontend/src/platform/android/ai.ts:449)
- 新增：`chatCompletion` (frontend/src/platform/android/ai.ts:221)
- 新增：`clean` (frontend/src/platform/android/ai.ts:533)
- 新增：`conversation` (frontend/src/platform/android/ai.ts:305)
- 新增：`createConversation` (frontend/src/platform/android/ai.ts:317)
- 新增：`createProfile` (frontend/src/platform/android/ai.ts:82)
- 新增：`deleteConversation` (frontend/src/platform/android/ai.ts:322)
- 新增：`deleteProfile` (frontend/src/platform/android/ai.ts:154)
- 新增：`discriminationList` (frontend/src/platform/android/ai.ts:460)
- 新增：`enrichVocabularyEntry` (frontend/src/platform/android/ai.ts:576)
- 新增：`ensureDefault` (frontend/src/platform/android/ai.ts:75)
- 新增：`extractJsonObject` (frontend/src/platform/android/ai.ts:447)
- 新增：`history` (frontend/src/platform/android/ai.ts:383)
- 新增：`latestCompletedWrongRetrySession` (frontend/src/platform/android/ai.ts:653)
- 新增：`latestWrongSnapshot` (frontend/src/platform/android/ai.ts:614)
- 新增：`listConversations` (frontend/src/platform/android/ai.ts:297)
- 新增：`normalizeAttachments` (frontend/src/platform/android/ai.ts:328)
- 新增：`parseAttachments` (frontend/src/platform/android/ai.ts:340)
- 新增：`parseJsonObject` (frontend/src/platform/android/ai.ts:671)
- 新增：`profileOr404` (frontend/src/platform/android/ai.ts:69)
- 新增：`questions` (frontend/src/platform/android/ai.ts:852)
- 新增：`saveAgentExchange` (frontend/src/platform/android/ai.ts:361)
- 新增：`scopeKeyOf` (frontend/src/platform/android/ai.ts:610)
- 新增：`selectorModels` (frontend/src/platform/android/ai.ts:285)
- 新增：`sendChat` (frontend/src/platform/android/ai.ts:372)
- 新增：`setAllModelVisibility` (frontend/src/platform/android/ai.ts:276)
- 新增：`setModelVisibility` (frontend/src/platform/android/ai.ts:267)
- 新增：`syncModels` (frontend/src/platform/android/ai.ts:175)
- 新增：`testProfile` (frontend/src/platform/android/ai.ts:259)
- 新增：`translateVocabularyEntries` (frontend/src/platform/android/ai.ts:478)
- 新增：`updateProfile` (frontend/src/platform/android/ai.ts:118)
- 新增：`editNamedKey` (frontend/src/platform/android/model-key-store.ts:115)
- 新增：`editUnlocked` (frontend/src/platform/android/model-key-store.ts:83)
- 新增：`item` (frontend/src/platform/android/model-key-store.ts:79)
- 新增：`migrateExistingKeys` (frontend/src/platform/android/model-key-store.ts:52)
- 新增：`namedKeySummary` (frontend/src/platform/android/model-key-store.ts:74)
- 新增：`selectedKey` (frontend/src/platform/android/model-key-store.ts:77)
- 新增：`suppressProfileKeys` (frontend/src/platform/android/model-key-store.ts:129)
- 新增：`writeLegacyKey` (frontend/src/platform/android/model-key-store.ts:118)
- 新增：`archiveWrongUnits` (frontend/src/platform/android/practice.ts:1123)
- 新增：`current` (frontend/src/platform/android/practice.ts:1139)
- 新增：`listWrong` (frontend/src/platform/android/practice.ts:1026)
- 新增：`rounds` (frontend/src/platform/android/practice.ts:1106)
- 新增：`rounds` (frontend/src/platform/android/practice.ts:1140)
- 新增：`state` (frontend/src/platform/android/practice.ts:1148)
- 新增：`StudyTodosPayload` (frontend/src/platform/android/study-todos.ts:71)
- 新增：`dueVocabularyCount` (frontend/src/platform/android/study-todos.ts:63)
- 新增：`frequentQuestionCount` (frontend/src/platform/android/study-todos.ts:32)
- 新增：`frequentQuestionIds` (frontend/src/platform/android/study-todos.ts:25)
- 新增：`resumablePracticeSession` (frontend/src/platform/android/study-todos.ts:38)
- 新增：`studyTodoCountValues` (frontend/src/platform/android/study-todos.ts:21)
- 新增：`StudyTodosPayload.studyTodos` (frontend/src/platform/android/study-todos.ts:78)
- 新增：`applyVocabularyReview` (frontend/src/platform/android/vocabulary.ts:470)
- 新增：`deleteVocabulary` (frontend/src/platform/android/vocabulary.ts:445)
- 新增：`homeVocabulary` (frontend/src/platform/android/vocabulary.ts:393)
- 新增：`itemIds` (frontend/src/platform/android/vocabulary.ts:368)
- 新增：`listVocabulary` (frontend/src/platform/android/vocabulary.ts:304)
- 新增：`queueTranslations` (frontend/src/platform/android/vocabulary.ts:498)
- 新增：`retryVocabulary` (frontend/src/platform/android/vocabulary.ts:451)
- 新增：`reviewVocabulary` (frontend/src/platform/android/vocabulary.ts:460)
- 新增：`updateVocabulary` (frontend/src/platform/android/vocabulary.ts:415)
- 删除：`B` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:24)
- 删除：`Ce` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:22)
- 删除：`H` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:79)
- 删除：`I` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:16)
- 删除：`L` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:64)
- 删除：`Me` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:17)
- 删除：`O` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:5)
- 删除：`Oe` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:11)
- 删除：`Te` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:8)
- 删除：`Ue` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:46)
- 删除：`be` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:18)
- 删除：`Ue.ce` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:57)
- 删除：`i` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:25)
- 删除：`le` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:29)
- 删除：`ne` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:1)
- 删除：`xe` (frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:68)
- 删除：`R` (frontend/android/app/src/main/assets/public/assets/content-remediation-D72u918K.js:2)
- 删除：`R.Y` (frontend/android/app/src/main/assets/public/assets/content-remediation-D72u918K.js:3)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/content-remediation-D72u918K.js:1)
- 删除：`Oe.Ce` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:47)
- 删除：`Ie` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:62)
- 删除：`K` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:50)
- 删除：`Oe` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:42)
- 删除：`P` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:17)
- 删除：`K.Se` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:54)
- 删除：`Te` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:49)
- 删除：`Z` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:33)
- 删除：`q.be` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:22)
- 删除：`fe` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:18)
- 删除：`ge` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:15)
- 删除：`le` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:11)
- 删除：`me` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:13)
- 删除：`q` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:21)
- 删除：`Oe.qe` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:48)
- 删除：`re` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:1)
- 删除：`ue` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:5)
- 删除：`we` (frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:38)
- 删除：`C` (frontend/android/app/src/main/assets/public/assets/index-DAs1h9zC.js:2)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/index-DAs1h9zC.js:1)
- 删除：`A` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:31)
- 删除：`Et` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:77)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:1)
- 删除：`ct` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:9)
- 删除：`A.ft` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:60)
- 删除：`pt` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:27)
- 删除：`q` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:2)
- 删除：`s` (frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:78)
- 删除：`B` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:7)
- 删除：`L` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:67)
- 删除：`Nt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:45)
- 删除：`Ot` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:99)
- 删除：`Rt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:59)
- 删除：`St` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:80)
- 删除：`T` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:57)
- 删除：`Tt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:87)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:1)
- 删除：`_t` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:9)
- 删除：`d` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:73)
- 删除：`dt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:39)
- 删除：`gt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:112)
- 删除：`rt.h` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:6)
- 删除：`ht` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:133)
- 删除：`j` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:33)
- 删除：`mt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:55)
- 删除：`p` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:134)
- 删除：`pt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:69)
- 删除：`rt` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:2)
- 删除：`u` (frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:125)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/practice-snapshots-Cc_tbYE5.js:1)
- 删除：`w` (frontend/android/app/src/main/assets/public/assets/practice-snapshots-Cc_tbYE5.js:2)
- 删除：`N` (frontend/android/app/src/main/assets/public/assets/study-todos-CxlnmdrH.js:1)
- 删除：`l` (frontend/android/app/src/main/assets/public/assets/study-todos-CxlnmdrH.js:13)
- 删除：`N` (frontend/android/app/src/main/assets/public/assets/sync-scheduler-BMX5O2fK.js:2)
- 删除：`__vite__mapDeps` (frontend/android/app/src/main/assets/public/assets/sync-scheduler-BMX5O2fK.js:1)
- 删除：`Ae` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:43)
- 删除：`B` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:1)
- 删除：`Pe` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:39)
- 删除：`Ue` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:12)
- 删除：`We` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:37)
- 删除：`be` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:45)
- 删除：`he` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:40)
- 删除：`q` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:54)
- 删除：`xe` (frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:27)
- 删除：`o` (frontend/android/app/src/main/assets/public/assets/web-BVx114ki.js:1)
- 删除：`s` (frontend/android/app/src/main/assets/public/assets/web-Crt0wWY-.js:1)
- 删除：`m` (frontend/android/app/src/main/assets/public/assets/web-DS7ypyM-.js:1)
- 删除：`u` (frontend/android/app/src/main/assets/public/assets/web-Dv9keq8L.js:1)
- 删除：`f` (frontend/android/app/src/main/assets/public/assets/web-q0BFx2Jg.js:1)
- 删除：`i` (frontend/android/app/src/main/assets/public/assets/web-r_ObljKP.js:1)
- 删除：`agentTurn` (frontend/src/platform/android/ai.ts:348)
- 删除：`analyzeWrongQuestions` (frontend/src/platform/android/ai.ts:707)
- 删除：`analyzeWrongStatus` (frontend/src/platform/android/ai.ts:679)
- 删除：`apiHeaders` (frontend/src/platform/android/ai.ts:165)
- 删除：`candidate` (frontend/src/platform/android/ai.ts:448)
- 删除：`chatCompletion` (frontend/src/platform/android/ai.ts:220)
- 删除：`clean` (frontend/src/platform/android/ai.ts:532)
- 删除：`conversation` (frontend/src/platform/android/ai.ts:304)
- 删除：`createConversation` (frontend/src/platform/android/ai.ts:316)
- 删除：`createProfile` (frontend/src/platform/android/ai.ts:81)
- 删除：`deleteConversation` (frontend/src/platform/android/ai.ts:321)
- 删除：`deleteProfile` (frontend/src/platform/android/ai.ts:153)
- 删除：`discriminationList` (frontend/src/platform/android/ai.ts:459)
- 删除：`enrichVocabularyEntry` (frontend/src/platform/android/ai.ts:575)
- 删除：`ensureDefault` (frontend/src/platform/android/ai.ts:74)
- 删除：`extractJsonObject` (frontend/src/platform/android/ai.ts:446)
- 删除：`history` (frontend/src/platform/android/ai.ts:382)
- 删除：`latestCompletedWrongRetrySession` (frontend/src/platform/android/ai.ts:652)
- 删除：`latestWrongSnapshot` (frontend/src/platform/android/ai.ts:613)
- 删除：`listConversations` (frontend/src/platform/android/ai.ts:296)
- 删除：`normalizeAttachments` (frontend/src/platform/android/ai.ts:327)
- 删除：`parseAttachments` (frontend/src/platform/android/ai.ts:339)
- 删除：`parseJsonObject` (frontend/src/platform/android/ai.ts:670)
- 删除：`profileOr404` (frontend/src/platform/android/ai.ts:68)
- 删除：`questions` (frontend/src/platform/android/ai.ts:851)
- 删除：`saveAgentExchange` (frontend/src/platform/android/ai.ts:360)
- 删除：`scopeKeyOf` (frontend/src/platform/android/ai.ts:609)
- 删除：`selectorModels` (frontend/src/platform/android/ai.ts:284)
- 删除：`sendChat` (frontend/src/platform/android/ai.ts:371)
- 删除：`setAllModelVisibility` (frontend/src/platform/android/ai.ts:275)
- 删除：`setModelVisibility` (frontend/src/platform/android/ai.ts:266)
- 删除：`syncModels` (frontend/src/platform/android/ai.ts:174)
- 删除：`testProfile` (frontend/src/platform/android/ai.ts:258)
- 删除：`translateVocabularyEntries` (frontend/src/platform/android/ai.ts:477)
- 删除：`updateProfile` (frontend/src/platform/android/ai.ts:117)
- 删除：`editNamedKey` (frontend/src/platform/android/model-key-store.ts:108)
- 删除：`editUnlocked` (frontend/src/platform/android/model-key-store.ts:76)
- 删除：`item` (frontend/src/platform/android/model-key-store.ts:72)
- 删除：`namedKeySummary` (frontend/src/platform/android/model-key-store.ts:67)
- 删除：`selectedKey` (frontend/src/platform/android/model-key-store.ts:70)
- 删除：`suppressProfileKeys` (frontend/src/platform/android/model-key-store.ts:122)
- 删除：`writeLegacyKey` (frontend/src/platform/android/model-key-store.ts:111)
- 删除：`archiveWrongUnits` (frontend/src/platform/android/practice.ts:1122)
- 删除：`current` (frontend/src/platform/android/practice.ts:1138)
- 删除：`listWrong` (frontend/src/platform/android/practice.ts:1025)
- 删除：`rounds` (frontend/src/platform/android/practice.ts:1105)
- 删除：`rounds` (frontend/src/platform/android/practice.ts:1139)
- 删除：`state` (frontend/src/platform/android/practice.ts:1147)
- 删除：`StudyTodosPayload` (frontend/src/platform/android/study-todos.ts:57)
- 删除：`dueVocabularyCount` (frontend/src/platform/android/study-todos.ts:49)
- 删除：`frequentQuestionCount` (frontend/src/platform/android/study-todos.ts:18)
- 删除：`frequentQuestionIds` (frontend/src/platform/android/study-todos.ts:11)
- 删除：`resumablePracticeSession` (frontend/src/platform/android/study-todos.ts:24)
- 删除：`StudyTodosPayload.studyTodos` (frontend/src/platform/android/study-todos.ts:64)
- 删除：`applyVocabularyReview` (frontend/src/platform/android/vocabulary.ts:467)
- 删除：`deleteVocabulary` (frontend/src/platform/android/vocabulary.ts:442)
- 删除：`homeVocabulary` (frontend/src/platform/android/vocabulary.ts:390)
- 删除：`itemIds` (frontend/src/platform/android/vocabulary.ts:365)
- 删除：`listVocabulary` (frontend/src/platform/android/vocabulary.ts:301)
- 删除：`queueTranslations` (frontend/src/platform/android/vocabulary.ts:495)
- 删除：`retryVocabulary` (frontend/src/platform/android/vocabulary.ts:448)
- 删除：`reviewVocabulary` (frontend/src/platform/android/vocabulary.ts:457)
- 删除：`updateVocabulary` (frontend/src/platform/android/vocabulary.ts:412)
- 变化：`listProfiles` (frontend/src/platform/android/ai.ts:34)；签名/范围发生变化
- 变化：`migrateKeys` (frontend/src/platform/android/model-key-store.ts:46)；签名/范围发生变化
- 变化：`dashboard` (frontend/src/platform/android/practice.ts:969)；签名/范围发生变化

### 受影响调用方

- `fallback:frontend/android/app/src/main/java/com/wssfk/englishpracticemachine/DocumentExtractorPlugin.java`
- `fallback:frontend/src/components/QuestionBankSwitcher.vue`
- `fallback:frontend/src/views/SettingsView.vue`
- `javascript:frontend/android/app/src/main/assets/public/assets/ai-5_hWsfaV.js:ne:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/ai-D1dPhCrB.js:ne:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/content-remediation-CPQLUn6F.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/content-remediation-D72u918K.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:ge:15`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:le:11`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:me:13`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:re:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-ChAdw-H0.js:ue:5`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:ge:15`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:le:11`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:me:13`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:re:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/document-import-Cl_8bKJu.js:ue:5`
- `javascript:frontend/android/app/src/main/assets/public/assets/index-DAs1h9zC.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/index-ZmYdvK6A.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/local-api-5eGptGzv.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/local-api-C4rwboig.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-BwBpW_2v.js:h:6`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-DoQKruPl.js:h:6`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-snapshots-CO0oK2Ix.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/practice-snapshots-Cc_tbYE5.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/study-todos-CxlnmdrH.js:N:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/study-todos-DyummtJI.js:E:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/sync-scheduler-BMX5O2fK.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/sync-scheduler-e4GG5iz4.js:__vite__mapDeps:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-DdtzwWab.js:B:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/vocabulary-translation-runner-PiUFV81n.js:B:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-BVx114ki.js:o:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-BXAsv6RI.js:u:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-CFwk5pmQ.js:i:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-DS7ypyM-.js:m:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-DZj2H0-2.js:o:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-DtILukJZ.js:f:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-Dv9keq8L.js:u:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-X_rCUTyG.js:m:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-q0BFx2Jg.js:f:1`
- `javascript:frontend/android/app/src/main/assets/public/assets/web-r_ObljKP.js:i:1`
- `javascript:frontend/tests/ai-reasoning-effort.mjs`
- `javascript:frontend/tests/android-read-path-latency.mjs`
- `javascript:frontend/tests/assistant-agent-api.mjs`
- `javascript:frontend/tests/assistant-agent.mjs:mount:76`
- `javascript:frontend/tests/content-remediation.mjs`
- `javascript:frontend/tests/lan-s6-ui.mjs`
- `javascript:frontend/tests/lan-sync-contract.mjs`
- `javascript:frontend/tests/lan-sync-errors.mjs`
- `javascript:frontend/tests/lan-sync-errors.mjs:flush:61`
- `javascript:frontend/tests/learning-history-diagnostics.mjs`
- `javascript:frontend/tests/learning-history-rebind.mjs`
- `javascript:frontend/tests/maintenance-pages.mjs`
- `javascript:frontend/tests/model-config-read-path.mjs`
- `javascript:frontend/tests/model-config-read-path.mjs:load:13`
- `javascript:frontend/tests/model-keys.mjs`
- `javascript:frontend/tests/model-keys.mjs:selectedBefore:65`
- `javascript:frontend/tests/model-snapshot.mjs`
- `javascript:frontend/tests/papers-read-path.mjs:since:85`
- `javascript:frontend/tests/practice-snapshots.mjs`
- `javascript:frontend/tests/question-bank-toolbar-layout.mjs`
- `javascript:frontend/tests/resume-query-remediation.mjs`
- `javascript:frontend/tests/settings-layout.mjs`
- `javascript:frontend/tests/startup-todo-dedup.mjs`
- `javascript:frontend/tests/translation-queue-remediation.mjs`
- `javascript:frontend/tests/ui-omissions.mjs`
- `javascript:frontend/tests/vocabulary-display.mjs`
- `javascript:frontend/tests/vocabulary-enrichment-jobs.mjs`
- `javascript:frontend/tests/vocabulary-layout.mjs`
- `javascript:frontend/tests/vocabulary-manual-edit.mjs:fixture:95`
- `javascript:frontend/tests/vocabulary-model-validation.mjs`
- `javascript:frontend/tests/vocabulary-review-revision.mjs`
- `javascript:work/perf-probe.cjs`
- `javascript:work/perf-probe.cjs:one:21`
- `javascript:work/perf-probe.cjs:plan:213`
- `javascript:work/perf-probe.cjs:q:17`
- `typescript:frontend/src/platform/android/ai.ts`
- `typescript:frontend/src/platform/android/ai.ts:JsonRecord:8`
- `typescript:frontend/src/platform/android/ai.ts:agentTurn:348`
- `typescript:frontend/src/platform/android/ai.ts:agentTurn:349`
- `typescript:frontend/src/platform/android/ai.ts:apiHeaders:165`
- `typescript:frontend/src/platform/android/ai.ts:apiHeaders:166`
- `typescript:frontend/src/platform/android/ai.ts:chatCompletion:220`
- `typescript:frontend/src/platform/android/ai.ts:chatCompletion:221`
- `typescript:frontend/src/platform/android/ai.ts:conversation:304`
- `typescript:frontend/src/platform/android/ai.ts:conversation:305`
- `typescript:frontend/src/platform/android/ai.ts:createConversation:316`
- `typescript:frontend/src/platform/android/ai.ts:createConversation:317`
- `typescript:frontend/src/platform/android/ai.ts:createProfile:81`
- `typescript:frontend/src/platform/android/ai.ts:createProfile:82`
- `typescript:frontend/src/platform/android/ai.ts:deleteConversation:321`
- `typescript:frontend/src/platform/android/ai.ts:deleteConversation:322`
- `typescript:frontend/src/platform/android/ai.ts:deleteProfile:153`
- `typescript:frontend/src/platform/android/ai.ts:deleteProfile:154`
- `typescript:frontend/src/platform/android/ai.ts:ensureDefault:74`
- `typescript:frontend/src/platform/android/ai.ts:ensureDefault:75`
- `typescript:frontend/src/platform/android/ai.ts:listConversations:296`
- `typescript:frontend/src/platform/android/ai.ts:listConversations:297`
- `typescript:frontend/src/platform/android/ai.ts:listProfiles:34`
- `typescript:frontend/src/platform/android/ai.ts:normalizeAttachments:327`
- `typescript:frontend/src/platform/android/ai.ts:normalizeAttachments:328`
- `typescript:frontend/src/platform/android/ai.ts:parseAttachments:339`
- `typescript:frontend/src/platform/android/ai.ts:parseAttachments:340`
- `typescript:frontend/src/platform/android/ai.ts:profileOr404:68`
- `typescript:frontend/src/platform/android/ai.ts:profileOr404:69`
- `typescript:frontend/src/platform/android/ai.ts:saveAgentExchange:360`
- `typescript:frontend/src/platform/android/ai.ts:saveAgentExchange:361`
- `typescript:frontend/src/platform/android/ai.ts:selectorModels:284`
- `typescript:frontend/src/platform/android/ai.ts:selectorModels:285`
- `typescript:frontend/src/platform/android/ai.ts:setAllModelVisibility:275`
- `typescript:frontend/src/platform/android/ai.ts:setAllModelVisibility:276`
- `typescript:frontend/src/platform/android/ai.ts:setModelVisibility:266`
- `typescript:frontend/src/platform/android/ai.ts:setModelVisibility:267`
- `typescript:frontend/src/platform/android/ai.ts:syncModels:174`
- `typescript:frontend/src/platform/android/ai.ts:syncModels:175`
- `typescript:frontend/src/platform/android/ai.ts:testProfile:258`
- `typescript:frontend/src/platform/android/ai.ts:testProfile:259`
- `typescript:frontend/src/platform/android/ai.ts:updateProfile:117`
- `typescript:frontend/src/platform/android/ai.ts:updateProfile:118`
- `typescript:frontend/src/platform/android/app-update.ts:checkAppUpdate:107`
- `typescript:frontend/src/platform/android/app-update.ts:downloadQuestionBankPackage:155`
- `typescript:frontend/src/platform/android/app-update.ts:installAppUpdate:121`
- `typescript:frontend/src/platform/android/database.ts`
- `typescript:frontend/src/platform/android/document-import.ts:JsonRecord:10`
- `typescript:frontend/src/platform/android/document-import.ts:answerMap:48`
- `typescript:frontend/src/platform/android/document-import.ts:hasObjectivePartB:339`
- `typescript:frontend/src/platform/android/document-import.ts:parseCompactClozeOptions:107`
- `typescript:frontend/src/platform/android/document-import.ts:parseReading:279`
- `typescript:frontend/src/platform/android/document-import.ts:readingPartBBounds:347`
- `typescript:frontend/src/platform/android/document-import.ts:splitOptions:31`
- `typescript:frontend/src/platform/android/errors.ts:incompleteSubmission:13`
- `typescript:frontend/src/platform/android/import-destination.ts:saveImportDraft:7`
- `typescript:frontend/src/platform/android/lan-question-banks.ts:catalog:38`
- `typescript:frontend/src/platform/android/lan-question-banks.ts:downloadLanQuestionBank:49`
- `typescript:frontend/src/platform/android/lan-question-banks.ts:validateLanBankCatalog:18`
- `typescript:frontend/src/platform/android/lan-sync.ts:baseUrl:115`
- `typescript:frontend/src/platform/android/lan-sync.ts:handshake:252`
- `typescript:frontend/src/platform/android/lan-sync.ts:withLanQuestionBankSession:38`
- `typescript:frontend/src/platform/android/local-api.ts:JsonRecord:45`
- `typescript:frontend/src/platform/android/local-api.ts:androidLocalApi:61`
- `typescript:frontend/src/platform/android/model-key-store.ts:editNamedKey:108`
- `typescript:frontend/src/platform/android/model-key-store.ts:editNamedKey:115`
- `typescript:frontend/src/platform/android/model-key-store.ts:editUnlocked:76`
- `typescript:frontend/src/platform/android/model-key-store.ts:editUnlocked:83`
- `typescript:frontend/src/platform/android/model-key-store.ts:item:72`
- `typescript:frontend/src/platform/android/model-key-store.ts:item:79`
- `typescript:frontend/src/platform/android/model-key-store.ts:migrateExistingKeys:52`
- `typescript:frontend/src/platform/android/model-key-store.ts:migrateKeys:46`
- `typescript:frontend/src/platform/android/model-key-store.ts:namedKeySummary:67`
- `typescript:frontend/src/platform/android/model-key-store.ts:namedKeySummary:74`
- `typescript:frontend/src/platform/android/model-key-store.ts:selectedKey:70`
- `typescript:frontend/src/platform/android/model-key-store.ts:selectedKey:77`
- `typescript:frontend/src/platform/android/model-key-store.ts:suppressProfileKeys:122`
- `typescript:frontend/src/platform/android/model-key-store.ts:suppressProfileKeys:129`
- `typescript:frontend/src/platform/android/model-key-store.ts:writeLegacyKey:111`
- `typescript:frontend/src/platform/android/model-key-store.ts:writeLegacyKey:118`
- `typescript:frontend/src/platform/android/native-http.ts:nativeBytes:51`
- `typescript:frontend/src/platform/android/native-http.ts:nativeJson:4`
- `typescript:frontend/src/platform/android/native-http.ts:nativeRaw:26`
- `typescript:frontend/src/platform/android/practice.ts`
- `typescript:frontend/src/platform/android/practice.ts:createSession:408`
- `typescript:frontend/src/platform/android/practice.ts:selectUnitIds:184`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:activateQuestionBankProfile:127`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:createQuestionBankProfile:92`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:deleteImportDraft:270`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:deletePaper:251`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:deleteQuestionBankProfile:162`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:movePapers:299`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:purgeTrash:532`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:restoreTrash:362`
- `typescript:frontend/src/platform/android/question-bank-profiles.ts:updateQuestionBankProfile:106`
- `typescript:frontend/src/platform/android/question-bank.ts:createEsqImportFromNativePackage:270`
- `typescript:frontend/src/platform/android/question-bank.ts:installBundledQuestionBank:319`
- `typescript:frontend/src/platform/android/question-bank.ts:jsonFile:72`
- `typescript:frontend/src/platform/android/question-bank.ts:parseEsqBytes:117`
- `typescript:frontend/src/platform/android/question-bank.ts:readEsqImport:402`
- `typescript:frontend/src/platform/android/question-bank.ts:validateManifest:90`
- `typescript:frontend/src/platform/android/question-labeling.ts:ensureRunContext:73`
- `typescript:frontend/src/platform/android/question-labeling.ts:pauseLabelRun:120`
- `typescript:frontend/src/platform/android/question-labeling.ts:requestLabels:245`
- `typescript:frontend/src/platform/android/question-labeling.ts:requestWithFallback:279`
- `typescript:frontend/src/platform/android/question-labeling.ts:resolveProfileId:49`
- `typescript:frontend/src/platform/android/study-todos.ts:dueVocabularyCount:49`
- `typescript:frontend/src/platform/android/study-todos.ts:dueVocabularyCount:63`
- `typescript:frontend/src/platform/android/study-todos.ts:frequentQuestionCount:18`
- `typescript:frontend/src/platform/android/study-todos.ts:frequentQuestionCount:32`
- `typescript:frontend/src/platform/android/study-todos.ts:frequentQuestionIds:11`
- `typescript:frontend/src/platform/android/study-todos.ts:frequentQuestionIds:25`
- `typescript:frontend/src/platform/android/study-todos.ts:resumablePracticeSession:24`
- `typescript:frontend/src/platform/android/study-todos.ts:resumablePracticeSession:38`
- `typescript:frontend/src/platform/android/study-todos.ts:studyTodoCountValues:21`
- `typescript:frontend/src/platform/android/study-todos.ts:studyTodos:64`
- `typescript:frontend/src/platform/android/study-todos.ts:studyTodos:78`
- `typescript:frontend/src/platform/android/vocabulary-enrichment-runner.ts:requestVocabularyEnrichment:92`
- `typescript:frontend/src/platform/android/vocabulary-enrichment-runner.ts:work:66`
- `typescript:frontend/src/platform/android/vocabulary-translation-runner.ts:queueAndStartVocabularyTranslations:63`
- `typescript:frontend/src/platform/android/vocabulary-translation-runner.ts:work:16`
- `typescript:frontend/src/platform/android/vocabulary.ts:discriminationList:39`
- `typescript:frontend/src/platform/android/vocabulary.ts:listVocabulary:301`
- `typescript:frontend/src/platform/android/vocabulary.ts:listVocabulary:304`
- `typescript:frontend/src/platform/android/vocabulary.ts:localSimilarMatches:80`
- `typescript:frontend/src/platform/android/vocabulary.ts:reviewEntry:194`
- `typescript:frontend/src/platform/android/vocabulary.ts:reviewState:166`
- `typescript:frontend/src/platform/android/vocabulary.ts:serializeDetails:201`
- `typescript:frontend/src/platform/android/vocabulary.ts:validateTerm:22`
- `typescript:frontend/src/resume-title.ts:resumeTitle:1`

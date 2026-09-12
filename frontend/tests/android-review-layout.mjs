import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [styles, vocabularyView, importView, assistantView, dashboardView, wrongView, settingsView, updatesView, mobileSettingsView, appView, appUpdate, questionBank] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/VocabularyView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/ImportView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AiAssistant.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/WrongView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/AndroidUpdatesView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/MobileSettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/app-update.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/platform/android/question-bank.ts', import.meta.url), 'utf8'),
])

assert.ok(vocabularyView.includes('class="review-overlay vocabulary-review-overlay"'))
assert.ok(vocabularyView.includes('class="review-card vocabulary-review-card" data-review-fullscreen'))
assert.ok(importView.includes('class="review-card import-assist-dialog"'))
assert.ok(assistantView.includes('platformRuntime.isAndroid'))
assert.ok(assistantView.includes("? '输入问题…'"))
assert.ok(assistantView.includes(':placeholder="inputPlaceholder"'))
assert.ok(dashboardView.includes('class="portrait-practice-card part-b"'))
assert.ok(dashboardView.includes("type === 'listening'"))
assert.ok(dashboardView.includes('paper_type_counts?.listening'))
assert.ok(dashboardView.includes('class="card action-card listening-action"'))
assert.ok(importView.includes('{{ job.display_name || job.filename }}'))
assert.ok(importView.includes('{{ importStatusText(job.status) }}'))
assert.ok(wrongView.includes('class="wrong-scope-actions"'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="portrait"] .portrait-practice-card.part-b strong'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="portrait"] .portrait-practice-card.part-b img'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .dashboard-page .listening-action .feature-icon'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="portrait"] .import-page .import-source-card'))
assert.ok(styles.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'))
assert.ok(settingsView.includes('class="grid grid-2 api-connection-grid"'))
assert.ok(settingsView.includes('class="api-profile-hints"'))
assert.ok(!updatesView.includes('程序更新和题库更新相互独立。APK 下载后会校验 SHA-256'))
assert.ok(!updatesView.includes('程序更新清单 URL'))
assert.ok(!updatesView.includes('<h2>远程题库源</h2>'))
assert.ok(!updatesView.includes('placeholder="http://192.168.x.x:8765"'))
assert.ok(updatesView.includes('placeholder="http://192.168.x.x:8766"'))
assert.ok(updatesView.includes('<h2>远程题库目录 URL</h2>'))
assert.ok(updatesView.includes('class="page-title-row"'))
assert.ok(mobileSettingsView.includes('class="page-title-row"'))
assert.ok(appView.includes("const ANDROID_ONBOARDING_KEY = 'linjian-android-onboarding-v1'"))
assert.ok(appView.includes('先配置可用模型，再获取需要的题库。'))
assert.ok(appView.includes("finishAndroidOnboarding('/settings')"))
assert.ok(styles.includes('.android-onboarding-overlay'))
assert.ok(styles.includes('.page-title-row'))
assert.ok(updatesView.includes('选择远程题库导入位置'))
assert.ok(updatesView.includes('按题库包名称创建新题库配置（推荐）'))
assert.ok(updatesView.includes("profile_id: profileId"))
assert.ok(updatesView.includes("post('/question-bank-profiles'"))
assert.ok(appUpdate.includes('const profileId = Number(body.profile_id)'))
assert.ok(appUpdate.includes('目标题库配置不存在，请重新选择导入位置'))
assert.ok(appUpdate.includes('createEsqImportFromNativePackage(filename, packageData, profileId)'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .study-hero'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .dashboard-page .grid.grid-4'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .dashboard-page .grid.grid-4 > .card'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .dashboard-page .ticker-heading a'))
assert.ok(styles.includes('min-height: 132px'))
assert.ok(styles.includes('min-height: 82px'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .api-profile-hints'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .vocab-tools .button'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="landscape"] .practice-submit-actions .button'))

const androidRules = styles
  .split('}')
  .filter(rule => rule.includes('html[data-platform="android"]'))
assert.ok(androidRules.some(rule =>
  rule.includes('.vocabulary-review-card')
  && rule.includes('height: 100dvh')
  && rule.includes('overflow: hidden'),
))
for (const rule of androidRules) {
  const selector = rule.slice(0, rule.indexOf('{'))
  const body = rule.slice(rule.indexOf('{') + 1)
  const isFullscreenRule = [
    'height: 100dvh',
    'max-height: 100dvh',
    'overflow: hidden',
    'padding: 0',
  ].some(declaration => body.includes(declaration))
  if (isFullscreenRule && selector.includes('.review-card')) {
    assert.ok(selector.includes('.vocabulary-review-card') || selector.includes('[data-review-fullscreen]'))
    assert.ok(!selector.includes('.import-assist-dialog'))
  }
}

const androidStatusSpanRules = androidRules.filter(rule =>
  rule.includes('.listening-question-status') && rule.includes('grid-column: 1 / -1'))
assert.ok(androidStatusSpanRules.length >= 2, 'listening status must span full row in android multi-column player surfaces')
assert.ok(styles.includes('[data-window-mode="compact"] .mobile-pane-questions .listening-console .listening-question-status'))
assert.ok(importView.includes('startPublishStage'))
assert.ok(importView.includes('publishSeconds'))
assert.ok(importView.includes('大题库包发布可能需要数分钟'))
assert.ok(questionBank.includes('refreshPreviewConflicts'))
assert.ok(/readEsqImport[\s\S]{0,600}refreshPreviewConflicts/.test(questionBank))

console.log('Android review layout tests passed')

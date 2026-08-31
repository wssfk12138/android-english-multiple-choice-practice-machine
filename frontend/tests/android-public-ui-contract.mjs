import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [
  appView, updatesView, mobileSettingsView, styles, libraryView, vocabularyView,
  wrongView, trashView, importView, practiceView, settingsView, notesHubView,
  dashboardView, helpView,
] = await Promise.all([
  readFile(new URL('../src/App.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/AndroidUpdatesView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/MobileSettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/LibraryView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/VocabularyView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/WrongView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/TrashView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/ImportView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/SettingsView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/NotesHubView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/DashboardView.vue', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/HelpView.vue', import.meta.url), 'utf8'),
])

assert.ok(appView.includes("const ANDROID_ONBOARDING_KEY = 'linjian-android-onboarding-v1'"))
assert.ok(appView.includes('先配置可用模型，再获取需要的题库。'))
assert.ok(appView.includes("finishAndroidOnboarding('/settings')"))
assert.ok(appView.includes('checkAppUpdate()'), 'public update channel must remain enabled')
assert.ok(appView.includes('class="silent-update-bar"'), 'public silent update notice must remain enabled')
assert.ok(updatesView.includes('class="page-title-row"'))
assert.ok(mobileSettingsView.includes('class="page-title-row"'))
assert.ok(updatesView.includes('<h2>远程题库目录 URL</h2>'))
assert.ok(updatesView.includes('<h2>局域网学习记录同步</h2>'))
assert.ok(updatesView.includes('独立的 8766 同步服务'))
assert.ok(updatesView.includes("auto: false"), 'LAN auto sync must remain disabled by default')
assert.ok(updatesView.includes('type="password"'))
assert.ok(updatesView.includes("get('/android/lan-sync/status')"))
assert.ok(updatesView.includes("put('/android/lan-sync/settings'"))
assert.ok(updatesView.includes("post('/android/lan-sync/run')"))
assert.ok(!updatesView.includes('程序更新和题库更新相互独立。APK 下载后会校验 SHA-256'))
assert.ok(!updatesView.includes('<h2>远程题库源</h2>'))
assert.ok(!updatesView.includes('导入或更新失败时自动保存在本机。'))
assert.ok(styles.includes('.android-onboarding-overlay'))
assert.ok(styles.includes('.page-title-row'))
assert.ok(styles.includes('.lan-sync-status'))

assert.ok(libraryView.includes('class="button paper-primary-action"'))
assert.ok(libraryView.includes('class="button ghost paper-restart-action"'))
assert.ok(!libraryView.includes('<h2 class="paper-year">'))

assert.ok(vocabularyView.includes('class="review-overlay vocabulary-review-overlay"'))
assert.ok(vocabularyView.includes('class="review-card vocabulary-review-card" data-review-fullscreen'))
assert.ok(vocabularyView.includes("document.documentElement.dataset.orientation === 'portrait'"))
assert.ok(!vocabularyView.includes('从真题语境中收集、理解并复习真正困扰你的词。'))
assert.ok(!wrongView.includes('正式重做会留下快照'))
assert.ok(!trashView.includes('重要内容保留七天'))

assert.ok(importView.includes('startPublishStage'))
assert.ok(importView.includes('publishSeconds'))
assert.ok(importView.includes('大题库包发布可能需要数分钟'))
assert.ok(importView.includes('@click="closeEsqPreview"'))
assert.ok(importView.includes('class="review-card import-assist-dialog"'))
assert.ok(!importView.includes('Word/PDF 提取、模型辅助校对、逐字段审核'))

assert.ok(practiceView.includes("document.documentElement.dataset.orientation === 'portrait'"))
assert.equal((practiceView.match(/@click\.self\.prevent/g) || []).length, 2)
assert.equal((practiceView.match(/class="timer-dialog[^"]*" @click\.stop/g) || []).length, 2)

assert.ok(styles.includes('html[data-platform="android"] .vocabulary-review-card'))
assert.ok(styles.includes('html[data-platform="android"] .wrong-scope-actions'))
assert.ok(styles.includes('grid-template-columns: repeat(3, minmax(0, 1fr))'))
assert.ok(styles.includes('html[data-platform="android"] .paper-card .paper-actions .paper-primary-action:only-child'))
assert.ok(styles.includes('html[data-platform="android"][data-orientation="portrait"] .import-page .import-source-card'))

const androidRules = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector, body }))
  .filter(({ selector }) => selector.includes('html[data-platform="android"]'))
for (const { selector, body } of androidRules) {
  const isFullscreenRule = ['height: 100dvh', 'max-height: 100dvh', 'padding: 0']
    .some(declaration => body.includes(declaration))
  if (isFullscreenRule && selector.includes('.review-card')) {
    assert.ok(selector.includes('.vocabulary-review-card') || selector.includes('[data-review-fullscreen]'))
    assert.ok(!selector.includes('.import-assist-dialog'))
  }
}

assert.ok(settingsView.includes('SELECTABLE_ADAPTERS'))
assert.ok(settingsView.includes('adapterFor'))
assert.ok(!notesHubView.includes("get('/wrong"))
assert.ok(!notesHubView.includes("get('/vocabulary"))
assert.ok(!dashboardView.includes('resume_session'))
assert.ok(helpView.includes('copyReportTemplate'))
assert.ok(helpView.includes('https://api.xiaoheihe.cn/v3/bbs/app/api/web/share'))
assert.ok(appView.includes('startAutoSync'))
assert.ok(appView.includes('stopAutoSync'))
assert.ok(!appView.includes("from './platform/android/lan-sync'"), 'App lifecycle must use the scheduler boundary')

console.log('Android public UI contract tests passed')

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'
import './remediation-foundations.css'
import './study-theme.css'
import { platformRuntime } from './platform/runtime'

// 关注西安财经大学吧喵，谢谢喵。
const androidUiPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('previewPlatform') === 'android'
document.documentElement.dataset.platform = androidUiPreview ? 'android' : platformRuntime.kind
document.documentElement.classList.toggle('native-app', platformRuntime.isNative)

let startupChanged = false
let startupRequiresHomeRefresh = false

function waitForFirstScreen(): Promise<void> {
  return new Promise(resolve => {
    const schedule = () => window.setTimeout(resolve, 250)
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(schedule))
    } else {
      schedule()
    }
  })
}

async function runAndroidStartupPreparation() {
  await platformRuntime.ready()
  if (platformRuntime.isAndroid) {
    // Let the first route open and issue its minimal reads before one-time
    // content repair, trash cleanup, or bundled-bank installation competes
    // for the same SQLite connection and Capacitor bridge.
    await waitForFirstScreen()
    const { ensureContentRemediation } = await import('./platform/android/content-remediation')
    startupChanged = await ensureContentRemediation()
    startupRequiresHomeRefresh = startupChanged
    const { purgeExpiredTrash } = await import('./platform/android/question-bank-profiles')
    await purgeExpiredTrash()
    if (import.meta.env.VITE_BUNDLED_QUESTION_BANKS !== '0') {
      const { installBundledQuestionBanks } = await import('./platform/android/question-bank')
      const result = await installBundledQuestionBanks()
      if (Array.isArray(result.results) && result.results.some(item => item.installed === true)) {
        startupChanged = true
        startupRequiresHomeRefresh = true
      }
    } else if (import.meta.env.VITE_BUNDLED_QUESTION_BANK === '1') {
      const { installBundledQuestionBank } = await import('./platform/android/question-bank')
      const result = await installBundledQuestionBank()
      if (result.installed === true) {
        startupChanged = true
        startupRequiresHomeRefresh = true
      }
    }
  }
}

// Mount the shell immediately so a slow SQLite migration or bundled package
// install cannot turn startup into a blank screen. The route-level API calls
// still await androidDatabase(), while this preparation runs once in the
// background and records failures for diagnostics.
createApp(App).use(router).mount('#app')

void runAndroidStartupPreparation().catch(error => {
  startupChanged = true
  console.warn('Android startup preparation failed:', String(error))
  if (platformRuntime.isAndroid) {
    void import('./platform/android/diagnostics').then(({ recordDiagnosticError }) =>
      recordDiagnosticError('startup', 'bundled_question_bank_install', error),
    ).catch(() => undefined)
  }
}).finally(() => {
  ;(window as any).__LINJIAN_ANDROID_STARTUP_PREPARED__ = true
  window.dispatchEvent(new CustomEvent('android-startup-prepared', {
    detail: { changed: startupChanged, needsHomeRefresh: startupRequiresHomeRefresh },
  }))
})

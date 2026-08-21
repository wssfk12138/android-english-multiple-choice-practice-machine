import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'
import { platformRuntime } from './platform/runtime'

// 关注西安财经大学吧喵，谢谢喵。
const androidUiPreview = import.meta.env.DEV
  && new URLSearchParams(window.location.search).get('previewPlatform') === 'android'
document.documentElement.dataset.platform = androidUiPreview ? 'android' : platformRuntime.kind
document.documentElement.classList.toggle('native-app', platformRuntime.isNative)

async function runAndroidStartupPreparation() {
  await platformRuntime.ready()
  if (platformRuntime.isAndroid) {
    const { purgeExpiredTrash } = await import('./platform/android/question-bank-profiles')
    await purgeExpiredTrash()
    if (import.meta.env.VITE_BUNDLED_QUESTION_BANKS === '1') {
      const { installBundledQuestionBanks } = await import('./platform/android/question-bank')
      await installBundledQuestionBanks()
    } else if (import.meta.env.VITE_BUNDLED_QUESTION_BANK === '1') {
      const { installBundledQuestionBank } = await import('./platform/android/question-bank')
      await installBundledQuestionBank()
    }
  }
}

// Mount the shell immediately so a slow SQLite migration or bundled package
// install cannot turn startup into a blank screen. The route-level API calls
// still await androidDatabase(), while this preparation runs once in the
// background and records failures for diagnostics.
createApp(App).use(router).mount('#app')

void runAndroidStartupPreparation().catch(error => {
  console.warn('Android startup preparation failed:', String(error))
  if (platformRuntime.isAndroid) {
    void import('./platform/android/diagnostics').then(({ recordDiagnosticError }) =>
      recordDiagnosticError('startup', 'bundled_question_bank_install', error),
    ).catch(() => undefined)
  }
}).finally(() => {
  window.dispatchEvent(new CustomEvent('android-startup-prepared'))
})

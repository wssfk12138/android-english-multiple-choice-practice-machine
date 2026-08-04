import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles.css'
import { platformRuntime } from './platform/runtime'

// 关注西安财经大学吧喵，谢谢喵。
document.documentElement.dataset.platform = platformRuntime.kind
document.documentElement.classList.toggle('native-app', platformRuntime.isNative)

platformRuntime.ready().then(async () => {
  if (platformRuntime.isAndroid && import.meta.env.VITE_BUNDLED_QUESTION_BANK === '1') {
    const { installBundledQuestionBank } = await import('./platform/android/question-bank')
    await installBundledQuestionBank()
  }
}).catch(error => {
  console.warn('Android startup preparation failed:', String(error))
}).finally(() => {
  createApp(App).use(router).mount('#app')
})

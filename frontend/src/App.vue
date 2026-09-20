<script setup lang="ts">
import { BookOpenText, Download, Moon, PackageCheck, Settings2, Sun, Trash2 } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useRoute, useRouter } from 'vue-router'
import { platformRuntime } from './platform/runtime'
import { useThemeState } from './composables/useThemeState'
import AppDialogHost from './components/AppDialogHost.vue'
import { post } from './api'
import {
  checkAppUpdate,
  pendingInstallerCleanup,
  resolveInstallerCleanup,
  type PendingInstallerCleanup,
} from './platform/android/app-update'

const route = useRoute()
const router = useRouter()
const ANDROID_ONBOARDING_KEY = 'linjian-android-onboarding-v1'
// 初始化时同步读取主题偏好，避免暗色用户在首帧渲染前闪一下浅色（FOUC）。
const dark = useThemeState()
dark.value = localStorage.getItem('linjian-theme') === 'dark'
const installerCleanup = ref<PendingInstallerCleanup | null>(null)
const installerCleanupBusy = ref(false)
const installerCleanupError = ref('')
const retainInstallerButton = ref<HTMLButtonElement | null>(null)
const silentUpdate = ref<{ versionName: string } | null>(null)
const onboardingOpen = ref(false)
const onboardingPrimaryButton = ref<HTMLButtonElement | null>(null)
let appStateListener: PluginListenerHandle | null = null
let androidStartupPrepared = false
let startSyncAfterAndroidStartup: (() => void) | null = null

async function showAndroidOnboardingIfNeeded() {
  if (!platformRuntime.isAndroid || installerCleanup.value) return
  if (localStorage.getItem(ANDROID_ONBOARDING_KEY) === 'done') return
  onboardingOpen.value = true
  await nextTick()
  onboardingPrimaryButton.value?.focus()
}

async function finishAndroidOnboarding(destination = '') {
  localStorage.setItem(ANDROID_ONBOARDING_KEY, 'done')
  onboardingOpen.value = false
  if (destination) await router.push(destination)
}

function detectPortrait() {
  // Android WebView can briefly report a stale CSS orientation while a
  // tablet is rotating. Prefer the native screen orientation, then use the
  // visual viewport dimensions and only finally fall back to matchMedia.
  const orientationType = typeof screen !== 'undefined'
    ? screen.orientation?.type
    : undefined
  if (orientationType?.startsWith('portrait')) return true
  if (orientationType?.startsWith('landscape')) return false
  const viewport = window.visualViewport
  const width = viewport?.width || window.innerWidth
  const height = viewport?.height || window.innerHeight
  if (width > 0 && height > 0 && Math.abs(width - height) > 24) {
    return height > width
  }
  return window.matchMedia('(orientation: portrait)').matches
}

function updateWindowMode() {
  const width = window.visualViewport?.width || window.innerWidth
  const portrait = detectPortrait()
  // Portrait is a dedicated Android information architecture on phones and
  // tablets. Landscape continues to use the existing rail and split panes.
  const androidPortrait = platformRuntime.isAndroid && portrait
  const mode = androidPortrait || width < 600 ? 'compact' : width < 840 ? 'medium' : 'expanded'
  document.documentElement.dataset.windowMode = mode
  document.documentElement.dataset.orientation = portrait ? 'portrait' : 'landscape'
  // The mobile settings hub stays available in both orientations; rotation no
  // longer force-jumps to the model page. Each page adapts its own layout.
}

watch(() => route.path, () => {
  dark.value = document.documentElement.classList.contains('dark')
})
function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !document.documentElement.classList.contains('dark')
  applyTheme()
}

function installerSize(size: number) {
  if (!Number.isFinite(size) || size < 1) return ''
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function finishInstallerCleanup(shouldDelete: boolean) {
  if (installerCleanupBusy.value) return
  installerCleanupBusy.value = true
  installerCleanupError.value = ''
  try {
    await resolveInstallerCleanup(shouldDelete)
    installerCleanup.value = null
    await showAndroidOnboardingIfNeeded()
  } catch (cause) {
    installerCleanupError.value = String(cause)
  } finally {
    installerCleanupBusy.value = false
  }
}

function handleInstallerCleanupKeydown(event: KeyboardEvent) {
  if (onboardingOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      void finishAndroidOnboarding()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.android-onboarding-dialog button:not(:disabled)'),
    )
    if (!buttons.length) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
    return
  }
  if (!installerCleanup.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void finishInstallerCleanup(false)
    return
  }
  if (event.key !== 'Tab') return
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.installer-cleanup-dialog button:not(:disabled)'),
  )
  if (!buttons.length) return
  const first = buttons[0]
  const last = buttons[buttons.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  updateWindowMode()
  window.addEventListener('resize', updateWindowMode, { passive: true })
  window.addEventListener('orientationchange', updateWindowMode, { passive: true })
  window.visualViewport?.addEventListener('resize', updateWindowMode, { passive: true })
  window.setTimeout(updateWindowMode, 120)
  window.setTimeout(updateWindowMode, 320)
  applyTheme()
  if (platformRuntime.isAndroid) {
    const { resumeVocabularyTranslations } = await import('./platform/android/vocabulary-translation-runner')
    resumeVocabularyTranslations()
    startSyncAfterAndroidStartup = () => {
      if (androidStartupPrepared) return
      androidStartupPrepared = true
      void import('./platform/android/sync-scheduler').then(({ startAutoSync }) => startAutoSync())
    }
    window.addEventListener('android-startup-prepared', startSyncAfterAndroidStartup, { once: true })
    if ((window as any).__LINJIAN_ANDROID_STARTUP_PREPARED__) {
      startSyncAfterAndroidStartup()
    }
    appStateListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        updateWindowMode()
        window.setTimeout(updateWindowMode, 180)
        resumeVocabularyTranslations()
      } else if (route.path.startsWith('/practice')) {
        void post('/vocabulary/translation-runs', {
          entry_ids: [],
          trigger: 'practice_exit',
        }).catch(() => undefined)
      }
    })
    try {
      const pending = await pendingInstallerCleanup()
      if (pending.pending) {
        installerCleanup.value = pending
        await nextTick()
        retainInstallerButton.value?.focus()
      } else {
        await showAndroidOnboardingIfNeeded()
      }
    } catch (cause) {
      console.warn('Unable to inspect downloaded update package:', String(cause))
      await showAndroidOnboardingIfNeeded()
    }
    // 启动后静默检查更新：不打扰当前操作，只在发现新版本时显示可关闭的提示条。
    checkAppUpdate()
      .then((result) => {
        if (result.available && !silentUpdate.value) {
          silentUpdate.value = { versionName: String(result.manifest?.versionName || '') }
        }
      })
      .catch(() => undefined)
  }
  window.addEventListener('keydown', handleInstallerCleanupKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateWindowMode)
  window.removeEventListener('orientationchange', updateWindowMode)
  window.visualViewport?.removeEventListener('resize', updateWindowMode)
  window.removeEventListener('keydown', handleInstallerCleanupKeydown)
  void appStateListener?.remove()
  if (platformRuntime.isAndroid) {
    if (startSyncAfterAndroidStartup) {
      window.removeEventListener('android-startup-prepared', startSyncAfterAndroidStartup)
    }
    void import('./platform/android/sync-scheduler').then(({ stopAutoSync }) => stopAutoSync())
  }
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'practice-shell': route.path.startsWith('/practice') }"
  >
    <section
      v-if="onboardingOpen"
      class="android-onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="android-onboarding-title"
      aria-describedby="android-onboarding-description"
    >
      <div class="android-onboarding-dialog card">
        <div class="android-onboarding-heading">
          <span class="android-onboarding-icon"><Settings2 :size="26" /></span>
          <div>
            <h2 id="android-onboarding-title">开始前完成两步设置</h2>
            <p id="android-onboarding-description">先配置可用模型，再获取需要的题库。</p>
          </div>
        </div>
        <ol class="android-onboarding-steps">
          <li><Settings2 :size="19" /><span><strong>模型与 API</strong><small>选择模型并填写对应的 API Key。</small></span></li>
          <li><Download :size="19" /><span><strong>更新与日志</strong><small>配置完成后，从这里检查并获取远程题库。</small></span></li>
        </ol>
        <div class="android-onboarding-actions">
          <button class="button ghost" type="button" @click="finishAndroidOnboarding()">稍后设置</button>
          <button ref="onboardingPrimaryButton" class="button" type="button" @click="finishAndroidOnboarding('/settings')">去配置模型与 API</button>
        </div>
      </div>
    </section>
    <section
      v-if="installerCleanup"
      class="installer-cleanup-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="installer-cleanup-title"
      aria-describedby="installer-cleanup-description"
    >
      <div class="installer-cleanup-dialog card">
        <span class="installer-cleanup-icon"><PackageCheck :size="28" /></span>
        <div>
          <h2 id="installer-cleanup-title">是否删除安装包？</h2>
          <p class="lead">
            {{ installerCleanup.versionName ? `${installerCleanup.versionName} 已完成更新。` : '应用已完成更新。' }}
            删除缓存中的安装包可以释放{{ installerSize(installerCleanup.size) || '存储' }}空间，不影响当前应用和学习数据。
          </p>
          <small id="installer-cleanup-description">{{ installerCleanup.fileName }}</small>
        </div>
        <div v-if="installerCleanupError" class="warning" role="alert">{{ installerCleanupError }}</div>
        <div class="installer-cleanup-actions">
          <button ref="retainInstallerButton" class="button secondary" type="button" :disabled="installerCleanupBusy" @click="finishInstallerCleanup(false)">
            暂时保留
          </button>
          <button class="button" type="button" :disabled="installerCleanupBusy" @click="finishInstallerCleanup(true)">
            <Trash2 :size="16" />{{ installerCleanupBusy ? '正在处理…' : '删除安装包' }}
          </button>
        </div>
      </div>
    </section>
    <aside class="sidebar" v-if="!route.path.startsWith('/practice')">
      <RouterLink class="brand" to="/">
        <span class="brand-mark"><img src="/assets/icons/brand-mark.png" alt="" /></span>
        <span class="brand-copy"><strong>英语刷题机</strong><small>考研英语一 · 本地题库</small></span>
      </RouterLink>
      <nav class="primary-nav" aria-label="主要导航">
        <RouterLink to="/"><img src="/assets/icons/home.png" alt="" /><span>首页</span></RouterLink>
        <RouterLink to="/library"><img src="/assets/icons/paper.png" alt="" /><span>题库与练习</span></RouterLink>
        <RouterLink to="/wrong"><img src="/assets/icons/wrong-book.png" alt="" /><span>错题本</span></RouterLink>
        <RouterLink to="/vocabulary"><img src="/assets/icons/vocabulary.png" alt="" /><span>单词本</span></RouterLink>
        <RouterLink to="/imports"><img src="/assets/icons/import.png" alt="" /><span>导入题库</span></RouterLink>
        <RouterLink to="/assistant"><img src="/assets/icons/ai.png" alt="" /><span>AI 学习助手</span></RouterLink>
        <RouterLink to="/mobile-settings"><Settings2 :size="22" /><span>设置</span></RouterLink>
        <RouterLink v-if="platformRuntime.isAndroid" to="/android-updates"><img src="/assets/icons/update.png" alt="" /><span>更新</span></RouterLink>
      </nav>
      <nav class="mobile-tab-nav" aria-label="手机主要导航">
        <RouterLink to="/"><img src="/assets/icons/home.png" alt="" /><span>首页</span></RouterLink>
        <RouterLink to="/notes"><img src="/assets/icons/notes.png" alt="" /><span>笔记</span></RouterLink>
        <RouterLink to="/assistant"><img src="/assets/icons/ai.png" alt="" /><span>AI</span></RouterLink>
        <RouterLink to="/mobile-settings"><img src="/assets/icons/settings.png" alt="" /><span>设置</span></RouterLink>
      </nav>
      <div class="sidebar-note">
        <BookOpenText :size="18" />
        <p>慢一点读，答案常藏在句子之间。</p>
      </div>
      <button class="theme-button" type="button" @click="toggleTheme" :aria-label="dark ? '切换到浅色模式' : '切换到夜间模式'">
        <Sun v-if="dark" :size="18" /><Moon v-else :size="18" />
        {{ dark ? '浅色模式' : '夜间模式' }}
      </button>
    </aside>
    <div v-if="silentUpdate" class="silent-update-bar" role="status">
      <span class="silent-update-text">发现新版本{{ silentUpdate.versionName ? ` ${silentUpdate.versionName}` : '' }}</span>
      <button class="button compact" type="button" @click="router.push('/android-updates')">查看更新</button>
      <button class="button ghost compact" type="button" @click="silentUpdate = null">稍后</button>
    </div>
    <main class="main-content">
      <RouterView />
    </main>
    <AppDialogHost />
  </div>
</template>

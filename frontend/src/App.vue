<script setup lang="ts">
import { BookMarked, BookOpenText, Brain, Download, FileUp, Home, Library, MessageCircle, Moon, PackageCheck, Settings, Sun, Trash2 } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { App as CapacitorApp } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { useRoute } from 'vue-router'
import { platformRuntime } from './platform/runtime'
import { post } from './api'
import {
  pendingInstallerCleanup,
  resolveInstallerCleanup,
  type PendingInstallerCleanup,
} from './platform/android/app-update'

const route = useRoute()
const dark = ref(false)
const installerCleanup = ref<PendingInstallerCleanup | null>(null)
const installerCleanupBusy = ref(false)
const installerCleanupError = ref('')
const retainInstallerButton = ref<HTMLButtonElement | null>(null)
let appStateListener: PluginListenerHandle | null = null
function updateWindowMode() {
  const width = window.innerWidth
  const height = window.innerHeight
  const portrait = window.matchMedia('(orientation: portrait)').matches
  // Some Android WebViews report a scaled CSS width above 600px on phones.
  // Use the viewport's short edge and height as a fallback so those devices
  // still receive the compact bottom navigation layout.
  const phonePortrait = portrait
    && width < 840
    && height / Math.max(width, 1) > 1.35
  const mode = width < 600 || phonePortrait ? 'compact' : width < 840 ? 'medium' : 'expanded'
  document.documentElement.dataset.windowMode = mode
  document.documentElement.dataset.orientation = portrait ? 'portrait' : 'landscape'
}
function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light')
}

function toggleTheme() {
  dark.value = !dark.value
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
  } catch (cause) {
    installerCleanupError.value = String(cause)
  } finally {
    installerCleanupBusy.value = false
  }
}

function handleInstallerCleanupKeydown(event: KeyboardEvent) {
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
  dark.value = localStorage.getItem('linjian-theme') === 'dark'
    || (!localStorage.getItem('linjian-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
  applyTheme()
  if (platformRuntime.isAndroid) {
    const { resumeVocabularyTranslations } = await import('./platform/android/vocabulary-translation-runner')
    resumeVocabularyTranslations()
    appStateListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
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
      }
    } catch (cause) {
      console.warn('Unable to inspect downloaded update package:', String(cause))
    }
  }
  window.addEventListener('keydown', handleInstallerCleanupKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateWindowMode)
  window.removeEventListener('orientationchange', updateWindowMode)
  window.removeEventListener('keydown', handleInstallerCleanupKeydown)
  void appStateListener?.remove()
})
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'practice-shell': route.path.startsWith('/practice') }"
  >
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
          <span class="eyebrow">UPDATE COMPLETE</span>
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
      <nav aria-label="主要导航">
        <RouterLink to="/"><Home :size="19" aria-hidden="true" /><span>首页</span></RouterLink>
        <RouterLink to="/library"><Library :size="19" aria-hidden="true" /><span>题库与练习</span></RouterLink>
        <RouterLink to="/wrong"><Brain :size="19" aria-hidden="true" /><span>错题本</span></RouterLink>
        <RouterLink to="/vocabulary"><BookMarked :size="19" aria-hidden="true" /><span>单词本</span></RouterLink>
        <RouterLink to="/imports"><FileUp :size="19" aria-hidden="true" /><span>导入题库</span></RouterLink>
        <RouterLink to="/assistant">
          <MessageCircle :size="19" aria-hidden="true" /><span>AI 学习助手</span>
        </RouterLink>
        <RouterLink to="/settings"><Settings :size="19" aria-hidden="true" /><span>模型与设置</span></RouterLink>
        <RouterLink v-if="platformRuntime.isAndroid" to="/android-updates"><Download :size="19" aria-hidden="true" /><span>更新</span></RouterLink>
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
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

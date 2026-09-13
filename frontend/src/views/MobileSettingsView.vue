<script setup lang="ts">
import {
  BookOpen,
  ChevronDown,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  Eye,
  Import,
  LibraryBig,
  Moon,
  NotebookText,
  ScrollText,
  Settings2,
  Sun,
  Trash2,
} from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import {
  VOCAB_DISPLAY_OPTIONS,
  loadVocabDisplayConfig,
  saveVocabDisplayConfig,
  type VocabDisplayKey,
} from '../services/vocabularyDisplayConfig'

const dark = ref(false)
const vocabDisplayOpen = ref(false)
const vocabDisplayConfig = reactive<Record<VocabDisplayKey, boolean>>(loadVocabDisplayConfig())
// 分组入口按规格固定顺序；设备与维护三项都落在“更新与远程题库”页的对应分区。
const groups = [
  {
    title: '题库与数据',
    items: [
      { label: '题库管理', to: '/library', icon: LibraryBig },
      { label: '导入题库', to: '/imports', icon: Import },
      { label: '回收站', to: '/trash', icon: Trash2 },
    ],
  },
  {
    title: 'AI 与模型',
    items: [
      { label: '模型与 API', to: '/settings', icon: Settings2 },
    ],
  },
  {
    title: '设备与维护',
    items: [
      { label: '设备同步', to: '/android-updates?section=sync', icon: CloudUpload },
      { label: '更新与远程题库', to: '/android-updates', icon: Download },
      { label: '诊断日志', to: '/android-updates?section=diagnostics', icon: ScrollText },
    ],
  },
] as const

const vocabDisplaySummary = computed(() => {
  const enabled = VOCAB_DISPLAY_OPTIONS.filter(option => vocabDisplayConfig[option.key])
  return enabled.length ? enabled.map(option => option.label).join('、') : '已全部隐藏'
})

function toggleVocabDisplay(key: VocabDisplayKey) {
  vocabDisplayConfig[key] = !vocabDisplayConfig[key]
  saveVocabDisplayConfig({ ...vocabDisplayConfig })
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light')
}
function toggleTheme() {
  dark.value = !dark.value
  applyTheme()
}

onMounted(() => {
  dark.value = document.documentElement.classList.contains('dark')
  document.documentElement.classList.toggle('dark', dark.value)
})
</script>

<template>
  <div class="page mobile-hub settings-hub">
    <div class="page-head compact-page-head">
      <div class="page-title-row"><span class="page-title-icon-lucide"><Settings2 :size="24" /></span><h1>设置</h1></div>
    </div>

    <section class="settings-hub-group" aria-labelledby="hub-appearance-title">
      <h2 id="hub-appearance-title" class="settings-hub-group-title">外观与显示</h2>
      <div class="settings-hub-rows">
        <div class="settings-hub-row">
          <span class="settings-hub-row-icon"><Moon v-if="dark" :size="19" /><Sun v-else :size="19" /></span>
          <span><strong>深色模式</strong></span>
          <button class="settings-theme-switch" type="button" role="switch" :aria-checked="dark" aria-label="深色模式" @click="toggleTheme"><span aria-hidden="true"></span></button>
        </div>
        <div class="settings-hub-row stack">
          <button class="settings-hub-row-toggle" type="button" :aria-expanded="vocabDisplayOpen" @click="vocabDisplayOpen=!vocabDisplayOpen">
            <span class="settings-hub-row-icon"><Eye :size="19" /></span>
            <span class="settings-hub-row-copy"><strong>单词本显示</strong><small>{{ vocabDisplaySummary }}</small></span>
            <ChevronDown :size="19" class="settings-hub-chevron" :class="{ open: vocabDisplayOpen }" />
          </button>
          <div v-if="vocabDisplayOpen" class="settings-vocab-display-options">
            <label v-for="option in VOCAB_DISPLAY_OPTIONS" :key="option.key">
              <input type="checkbox" :checked="vocabDisplayConfig[option.key]" @change="toggleVocabDisplay(option.key)">
              <span>{{ option.label }}</span>
            </label>
          </div>
        </div>
      </div>
    </section>

    <section v-for="group in groups" :key="group.title" class="settings-hub-group" :aria-labelledby="`hub-${group.title}`">
      <h2 :id="`hub-${group.title}`" class="settings-hub-group-title">{{ group.title }}</h2>
      <div class="settings-hub-rows">
        <RouterLink v-for="item in group.items" :key="item.label" class="settings-hub-row link" :to="item.to">
          <span class="settings-hub-row-icon"><component :is="item.icon" :size="19" /></span>
          <span><strong>{{ item.label }}</strong></span>
          <b class="settings-hub-chevron" aria-hidden="true">›</b>
        </RouterLink>
      </div>
    </section>

    <section class="settings-hub-group" aria-labelledby="hub-help">
      <h2 id="hub-help" class="settings-hub-group-title">帮助</h2>
      <div class="settings-hub-rows">
        <RouterLink class="settings-hub-row link" to="/help">
          <span class="settings-hub-row-icon"><BookOpen :size="19" /></span>
          <span><strong>使用帮助</strong></span>
          <b class="settings-hub-chevron" aria-hidden="true">›</b>
        </RouterLink>
        <a class="settings-hub-row link" href="https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&amp;h_src=YXBwX3NoYXJl&amp;link_id=0ad4723fda0b" target="_blank" rel="noopener noreferrer">
          <span class="settings-hub-row-icon"><NotebookText :size="19" /></span>
          <span><strong>问题反馈</strong></span>
          <ExternalLink class="settings-hub-chevron" :size="17" />
        </a>
      </div>
    </section>

    <div class="settings-hub-brand" aria-hidden="true"><Database :size="15" />学习数据保存在本机，可随时在设备同步中备份</div>
  </div>
</template>

<style scoped>
.settings-theme-switch { width: 52px; height: 48px; padding: 10px 0; border: 0; background: transparent; cursor: pointer; flex-shrink: 0; }
.settings-theme-switch > span { display: block; position: relative; width: 52px; height: 28px; border-radius: 14px; background: var(--muted); }
.settings-theme-switch > span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: white; }
.settings-theme-switch[aria-checked="true"] > span { background: var(--primary); }
.settings-theme-switch[aria-checked="true"] > span::after { transform: translateX(24px); }
.settings-theme-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.settings-hub-group { margin: 0 0 18px; }
.settings-hub-group-title { margin: 0 0 8px; padding: 0 4px; color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: .04em; }
.settings-hub-rows { overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface); box-shadow: var(--shadow-sm); }
.settings-hub-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) 52px; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 6px 14px; border: 0; border-bottom: 1px solid var(--line); border-radius: 0; box-shadow: none; background: transparent; color: var(--ink); text-align: left; }
.settings-hub-rows > :last-child { border-bottom: 0; }
.settings-hub-row.link { min-height: 56px; }
.settings-hub-row.link:hover { background: var(--primary-faint); }
.settings-hub-row-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--primary-soft); color: var(--primary); }
.settings-hub-row strong { font-size: 16px; line-height: 1.5; font-weight: 600; }
.settings-hub-row-copy { display: grid; gap: 1px; min-width: 0; }
.settings-hub-row-copy small { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.settings-hub-chevron { justify-self: end; color: var(--muted); transition: transform .2s ease; }
.settings-hub-chevron.open { transform: rotate(180deg); }
.settings-hub-row.stack { display: block; padding: 0; }
.settings-hub-row-toggle { display: grid; width: 100%; min-height: 56px; padding: 6px 14px; grid-template-columns: 32px minmax(0, 1fr) 52px; gap: 12px; align-items: center; border: 0; background: transparent; color: var(--ink); text-align: left; }
.settings-hub-row-toggle:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.settings-vocab-display-options { display: grid; gap: 0; padding: 2px 14px 12px 58px; }
.settings-vocab-display-options label { display: flex; align-items: center; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--line); font-size: 15px; }
.settings-vocab-display-options label:last-child { border-bottom: 0; }
.settings-vocab-display-options input { width: 19px; height: 19px; }
.settings-hub-brand { display: flex; align-items: center; gap: 7px; justify-content: center; margin-top: 6px; color: var(--muted); font-size: 12px; line-height: 1.6; }
@media (max-width: 720px) {
  .settings-hub-row, .settings-hub-row-toggle { grid-template-columns: 32px minmax(0, 1fr) 52px; }
}
</style>

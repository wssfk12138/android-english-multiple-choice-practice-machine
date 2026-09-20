<script setup lang="ts">
import {
  BookOpen,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  Eye,
  Import,
  Moon,
  NotebookText,
  ScrollText,
  Settings2,
  Trash2,
} from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { useThemeState } from '../composables/useThemeState'
import '../settings-hub.css'
import {
  VOCAB_DISPLAY_OPTIONS,
  loadVocabDisplayConfig,
} from '../services/vocabularyDisplayConfig'

const landscape = useAndroidLandscape()
const dark = useThemeState()
function toggleTheme() {
  dark.value = !document.documentElement.classList.contains('dark')
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light')
}
// 每个设置入口对应独立页面。
const groups = [
  {
    title: '题库与数据',
    items: [
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
      { label: '设备同步', to: '/android-sync', icon: CloudUpload },
      { label: '更新与远程题库', to: '/android-updates', icon: Download },
      { label: '诊断日志', to: '/android-diagnostics', icon: ScrollText },
    ],
  },
] as const

const vocabDisplaySummary = computed(() => '已开启 ' + VOCAB_DISPLAY_OPTIONS.filter(option => loadVocabDisplayConfig()[option.key]).length + ' 项')
</script>

<template>
  <div class="page mobile-hub settings-hub">
    <div class="page-head compact-page-head">
      <div class="page-title-row"><span class="page-title-icon-lucide"><Settings2 :size="24" /></span><h1>设置</h1></div>
    </div>

    <section class="settings-hub-group" aria-labelledby="hub-appearance-title">
      <h2 id="hub-appearance-title" class="settings-hub-group-title">外观与显示</h2>
      <div class="settings-hub-rows">
        <div v-if="landscape" class="settings-hub-row"><span class="settings-hub-row-icon"><Moon :size="19" /></span><strong>深色模式</strong><button class="settings-theme-switch" type="button" role="switch" :aria-checked="dark" aria-label="深色模式" @click="toggleTheme"><span /></button></div>
        <RouterLink v-else class="settings-hub-row link" to="/android-appearance"><span class="settings-hub-row-icon"><Moon :size="19" /></span><span><strong>外观与显示</strong><small>浅色或深色主题</small></span><b class="settings-hub-chevron">›</b></RouterLink>
        <RouterLink class="settings-hub-row link" to="/android-vocabulary-display">
            <span class="settings-hub-row-icon"><Eye :size="19" /></span>
            <span class="settings-hub-row-copy"><strong>{{ landscape ? '单词本设置' : '单词显示' }}</strong><small>{{ vocabDisplaySummary }}</small></span>
            <b class="settings-hub-chevron" aria-hidden="true">›</b>
        </RouterLink>
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

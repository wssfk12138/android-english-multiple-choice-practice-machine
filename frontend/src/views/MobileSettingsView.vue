<script setup lang="ts">
import { BookOpen, ChevronDown, ExternalLink, Eye } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'

const dark = ref(false)
const vocabDisplayOpen = ref(false)
const vocabularyDisplayOptions = [
  ['common_meaning', '常用释义'],
  ['contextual', '语境释义'],
  ['sentence', '真题例句'],
  ['memory_hint', '记忆提示'],
  ['synonyms', '同义词辨析'],
  ['antonyms', '反义词辨析'],
  ['similar_forms', '形近词辨析'],
] as const
const vocabDisplayConfig = ref<Record<string, boolean>>({
  common_meaning: true,
  contextual: true,
  sentence: true,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
})

function applyTheme() {
  document.documentElement.classList.toggle('dark', dark.value)
  localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light')
}
function toggleTheme() {
  dark.value = !dark.value
  applyTheme()
}

function loadVocabularyDisplayConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('vocab-display-config') || '{}')
    if (saved && typeof saved === 'object') {
      vocabDisplayConfig.value = { ...vocabDisplayConfig.value, ...saved }
    }
  } catch {
    // Keep the defaults when an older local value is invalid.
  }
}

function saveVocabularyDisplayConfig() {
  localStorage.setItem('vocab-display-config', JSON.stringify(vocabDisplayConfig.value))
}

onMounted(() => {
  dark.value = document.documentElement.classList.contains('dark')
  loadVocabularyDisplayConfig()
})
</script>

<template>
  <div class="page mobile-hub settings-hub">
    <div class="page-head compact-page-head">
      <div><span class="eyebrow">SETTINGS</span><h1>设置</h1><p class="lead">集中管理题库、模型、外观与设备更新。</p></div>
    </div>
    <section class="settings-theme-row card">
      <img src="/assets/icons/theme.png" alt="">
      <span><strong>外观</strong><small>{{ dark ? '深色模式已开启' : '浅色模式已开启' }}</small></span>
      <button class="button secondary compact" type="button" @click="toggleTheme">切换</button>
    </section>
    <section class="card settings-vocab-display">
      <button class="settings-vocab-display-toggle" type="button" :aria-expanded="vocabDisplayOpen" @click="vocabDisplayOpen=!vocabDisplayOpen">
        <span class="settings-vocab-display-icon"><Eye :size="20" /></span>
        <span><strong>单词本显示</strong><small>选择竖屏单词详情默认展开的内容</small></span>
        <ChevronDown :size="19" :class="{ open: vocabDisplayOpen }" />
      </button>
      <div v-if="vocabDisplayOpen" class="settings-vocab-display-options">
        <label v-for="[key, label] in vocabularyDisplayOptions" :key="key">
          <input v-model="vocabDisplayConfig[key]" type="checkbox" @change="saveVocabularyDisplayConfig">
          <span>{{ label }}</span>
        </label>
        <small>仅影响 Android 竖屏单词本，横屏与电脑端保持原有显示。</small>
      </div>
    </section>
    <div class="mobile-hub-list settings-hub-list">
      <RouterLink class="card mobile-hub-item" to="/library"><img src="/assets/icons/paper.png" alt=""><span><strong>题库管理</strong><small>查看试卷、批量移动或移入回收站。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/imports"><img src="/assets/icons/import.png" alt=""><span><strong>导入题库</strong><small>导入 Word、PDF 或 ESQ 题库包。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/settings"><img src="/assets/icons/settings.png" alt=""><span><strong>模型与 API</strong><small>配置服务商、可用模型与学习辅助参数。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/android-updates"><img src="/assets/icons/update.png" alt=""><span><strong>更新与日志</strong><small>检查内测更新、查看或发送脱敏日志。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/trash"><img src="/assets/icons/diagnostics.png" alt=""><span><strong>回收站</strong><small>七天内恢复删除的试卷与题库配置。</small></span><b aria-hidden="true">›</b></RouterLink>
    </div>
    <section class="settings-about card" aria-labelledby="mobile-settings-about-title">
      <div class="settings-about-heading">
        <span class="settings-about-icon"><BookOpen :size="20" /></span>
        <div><span class="eyebrow">HELP &amp; FEEDBACK</span><h2 id="mobile-settings-about-title">帮助与关于</h2><p>离线查看功能说明与常见问题，遇到问题可直接反馈。</p></div>
      </div>
      <div class="settings-about-actions">
        <RouterLink class="button secondary" to="/help"><BookOpen :size="16" />使用帮助</RouterLink>
        <a class="button ghost" href="https://xiaoheihe.cn/creator/content_management/detail/187311918" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />问题反馈</a>
      </div>
    </section>
  </div>
</template>

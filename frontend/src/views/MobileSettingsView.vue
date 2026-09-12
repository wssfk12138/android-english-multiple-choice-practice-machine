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
  ['morphology', '显示单词词形'],
] as const
const vocabDisplayConfig = ref<Record<string, boolean>>({
  common_meaning: true,
  contextual: true,
  sentence: true,
  memory_hint: false,
  synonyms: false,
  antonyms: false,
  similar_forms: false,
  morphology: true,
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
      <div class="page-title-row"><img class="page-title-icon" src="/assets/icons/settings.png" alt=""><h1>设置</h1></div>
    </div>
    <section class="settings-theme-row">
      <img src="/assets/icons/theme.png" alt="">
      <span><strong>外观</strong></span>
      <button class="settings-theme-switch" type="button" role="switch" :aria-checked="dark" aria-label="深色模式" :title="dark ? '关闭深色模式' : '开启深色模式'" @click="toggleTheme"><span aria-hidden="true"></span></button>
    </section>
    <section class="settings-vocab-display">
      <button class="settings-vocab-display-toggle" type="button" :aria-expanded="vocabDisplayOpen" @click="vocabDisplayOpen=!vocabDisplayOpen">
        <span class="settings-vocab-display-icon"><Eye :size="20" /></span>
        <span><strong>单词本显示</strong></span>
        <ChevronDown :size="19" :class="{ open: vocabDisplayOpen }" />
      </button>
      <div v-if="vocabDisplayOpen" class="settings-vocab-display-options">
        <label v-for="[key, label] in vocabularyDisplayOptions" :key="key">
          <input v-model="vocabDisplayConfig[key]" type="checkbox" @change="saveVocabularyDisplayConfig">
          <span>{{ label }}</span>
        </label>
      </div>
    </section>
    <div class="mobile-hub-list settings-hub-list">
      <RouterLink class="mobile-hub-item" to="/library"><img src="/assets/icons/paper.png" alt=""><span><strong>题库管理</strong></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="mobile-hub-item" to="/imports"><img src="/assets/icons/import.png" alt=""><span><strong>导入题库</strong></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="mobile-hub-item" to="/settings"><img src="/assets/icons/settings.png" alt=""><span><strong>模型与 API</strong></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="mobile-hub-item" to="/android-updates"><img src="/assets/icons/update.png" alt=""><span><strong>更新与日志</strong></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="mobile-hub-item" to="/trash"><img src="/assets/icons/diagnostics.png" alt=""><span><strong>回收站</strong></span><b aria-hidden="true">›</b></RouterLink>
    </div>
    <section class="settings-about" aria-labelledby="mobile-settings-about-title">
      <div class="settings-about-heading">
        <span class="settings-about-icon"><BookOpen :size="20" /></span>
        <div><h2 id="mobile-settings-about-title">帮助与关于</h2><p>离线查看功能说明与常见问题，遇到问题可直接反馈。</p></div>
      </div>
      <div class="settings-about-actions">
        <RouterLink class="button secondary" to="/help"><BookOpen :size="16" />使用帮助</RouterLink>
        <a class="button ghost" href="https://api.xiaoheihe.cn/v3/bbs/app/api/web/share?h_camp=link&amp;h_src=YXBwX3NoYXJl&amp;link_id=0ad4723fda0b" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />问题反馈</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-theme-switch { width: 52px; height: 44px; padding: 8px 0; border: 0; background: transparent; cursor: pointer; flex-shrink: 0; }
.settings-theme-switch > span { display: block; position: relative; width: 52px; height: 28px; border-radius: 14px; background: var(--muted); }
.settings-theme-switch > span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: white; }
.settings-theme-switch[aria-checked="true"] > span { background: var(--primary); }
.settings-theme-switch[aria-checked="true"] > span::after { transform: translateX(24px); }
.settings-theme-switch:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
html[data-platform="android"] .settings-hub > .settings-theme-row,
html[data-platform="android"] .settings-hub > .settings-vocab-display,
html[data-platform="android"] .settings-hub > .settings-about {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}
html[data-platform="android"] .settings-hub .settings-hub-list { gap: 0; }
html[data-platform="android"] .settings-hub .mobile-hub-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  padding: 8px 4px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
  background: transparent;
}
html[data-platform="android"] .settings-hub .mobile-hub-item > img { width: 28px; height: 28px; }
html[data-platform="android"] .settings-hub .mobile-hub-item strong { font-size: 16px; line-height: 1.5; }
html[data-platform="android"] .settings-hub .mobile-hub-item:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }

/* Keep every settings row on one alignment grid: icon, label, trailing control. */
html[data-platform="android"] .settings-hub > .settings-theme-row,
html[data-platform="android"] .settings-hub > .settings-vocab-display,
html[data-platform="android"] .settings-hub .mobile-hub-item {
  width: 100%;
  min-height: 64px;
  padding: 8px 4px;
  margin: 0;
  box-sizing: border-box;
}
html[data-platform="android"] .settings-hub > .settings-theme-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 52px;
  align-items: center;
  gap: 10px;
}
html[data-platform="android"] .settings-hub > .settings-theme-row > img,
html[data-platform="android"] .settings-hub .mobile-hub-item > img {
  width: 32px !important;
  height: 32px !important;
  min-width: 32px;
  max-width: 32px;
  min-height: 32px;
  max-height: 32px;
  margin: 0;
  object-fit: contain;
}
html[data-platform="android"] .settings-hub > .settings-vocab-display {
  display: block;
  padding: 0;
}
html[data-platform="android"] .settings-hub .settings-vocab-display-toggle {
  display: grid;
  width: 100%;
  min-height: 63px;
  padding: 8px 4px;
  grid-template-columns: 32px minmax(0, 1fr) 52px;
  gap: 10px;
  box-sizing: border-box;
  align-items: center;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
}
html[data-platform="android"] .settings-hub .settings-vocab-display-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 10px;
}
html[data-platform="android"] .settings-hub .mobile-hub-item { grid-template-columns: 32px minmax(0, 1fr) 52px; }
html[data-platform="android"] .settings-hub .mobile-hub-item > b,
html[data-platform="android"] .settings-hub .settings-vocab-display-toggle > svg { justify-self: end; }
html[data-platform="android"] .settings-hub .settings-theme-row strong,
html[data-platform="android"] .settings-hub .settings-vocab-display-toggle strong { font-size: 16px; line-height: 1.5; }
</style>

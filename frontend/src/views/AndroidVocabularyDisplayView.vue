<script setup lang="ts">
import '../settings-hub.css'
import { computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Eye } from 'lucide-vue-next'
import VocabularyMaintenance from '../components/VocabularyMaintenance.vue'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { VOCAB_DISPLAY_OPTIONS, loadVocabDisplayConfig, saveVocabDisplayConfig, type VocabDisplayKey } from '../services/vocabularyDisplayConfig'
const config = reactive<Record<VocabDisplayKey, boolean>>(loadVocabDisplayConfig())
const landscape = useAndroidLandscape()
const groups = [
  { title: '核心信息', options: VOCAB_DISPLAY_OPTIONS.slice(0, 4) },
  { title: '补充学习', options: VOCAB_DISPLAY_OPTIONS.slice(4, 10) },
  { title: '个人记录', options: VOCAB_DISPLAY_OPTIONS.slice(10) },
]
const summary = computed(() => VOCAB_DISPLAY_OPTIONS.filter(o => config[o.key]).map(o => o.label).join('、') || '已全部隐藏')
function toggle(key: VocabDisplayKey) { config[key] = !config[key]; saveVocabDisplayConfig({ ...config }) }
</script>
<template>
  <div class="page mobile-hub vocabulary-display">
    <div class="page-head compact-page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><span class="page-title-icon-lucide"><Eye :size="22" /></span><h1>{{ landscape ? '单词本设置' : '单词显示' }}</h1></div></div>
    <section v-for="group in landscape ? groups : [{ title: '显示栏目', options: VOCAB_DISPLAY_OPTIONS }]" :key="group.title" class="settings-hub-group"><h2 class="settings-hub-group-title">{{ group.title }}</h2><div class="settings-hub-rows"><label v-for="option in group.options" :key="option.key" class="settings-hub-row selection-option"><span class="settings-hub-row-icon"><Eye :size="18" /></span><span><strong>{{ option.label }}</strong><small v-if="option.key === 'common_meaning'">默认显示</small></span><input type="checkbox" :checked="config[option.key]" @change="toggle(option.key)"></label></div></section>
    <VocabularyMaintenance v-if="landscape" />
    <p class="settings-hub-brand">当前显示：{{ summary }}</p>
  </div>
</template>
<style scoped>
.selection-option { cursor:pointer; }
.selection-option input { width:19px; height:19px; justify-self:end; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option { display:grid; grid-template-columns:minmax(0,1fr) 24px; background:transparent; border-radius:0; border-bottom:1px solid var(--line); padding:6px 0; min-height:56px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option input { grid-column:2; grid-row:1; justify-self:end; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option > span:not(.settings-hub-row-icon) { grid-column:1; grid-row:1; }
html[data-platform="android"][data-orientation="landscape"] .selection-option small { display:none; }
</style>

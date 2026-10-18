<script setup lang="ts">
import '../settings-hub.css'
import { computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Check, Eye, Volume2 } from 'lucide-vue-next'
import VocabularyMaintenance from '../components/VocabularyMaintenance.vue'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { VOCAB_DISPLAY_OPTIONS, loadVocabDisplayConfig, saveVocabDisplayConfig, type VocabDisplayKey } from '../services/vocabularyDisplayConfig'
const config = reactive<Record<VocabDisplayKey, boolean>>(loadVocabDisplayConfig())
const landscape = useAndroidLandscape()
type DisplayGroup = {
  title: string
  keys: VocabDisplayKey[]
  options: typeof VOCAB_DISPLAY_OPTIONS[number][]
}
const landscapeGroups: DisplayGroup[] = ([
  { title: '词语信息', keys: ['common_meaning', 'contextual', 'phonetic', 'part_of_speech', 'source_sentence'] },
  { title: '释义与例句', keys: ['model_sentence', 'memory_hint'] },
  { title: '辨析与词形变化', keys: ['synonyms', 'antonyms', 'similar_forms', 'morphology'] },
  { title: '个人记录', keys: ['note'] },
] as { title: string; keys: VocabDisplayKey[] }[]).map(group => ({
  ...group,
  options: group.keys.map(key => VOCAB_DISPLAY_OPTIONS.find(option => option.key === key)!),
}))
const displayGroups = computed<DisplayGroup[]>(() => landscape.value
  ? landscapeGroups
  : [{ title: '显示栏目', keys: VOCAB_DISPLAY_OPTIONS.map(option => option.key), options: [...VOCAB_DISPLAY_OPTIONS] }])
const summary = computed(() => VOCAB_DISPLAY_OPTIONS.filter(o => config[o.key]).map(o => o.label).join('、') || '已全部隐藏')
function toggle(key: VocabDisplayKey) { config[key] = !config[key]; saveVocabDisplayConfig({ ...config }) }
function setGroup(group: DisplayGroup, value: boolean) {
  group.keys.forEach(key => { config[key] = value })
  saveVocabDisplayConfig({ ...config })
}
</script>
<template>
  <div class="page mobile-hub vocabulary-display">
    <div class="page-head compact-page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><span class="page-title-icon-lucide"><Eye :size="22" /></span><h1>{{ landscape ? '单词本设置' : '单词显示' }}</h1></div></div>
    <section class="settings-hub-group voice-built-in" aria-labelledby="offline-voice-title">
      <div class="settings-hub-group-head"><h2 id="offline-voice-title" class="settings-hub-group-title"><Volume2 :size="19" />离线发音</h2><span class="voice-ready"><Check :size="16" />已内置</span></div>
      <div class="settings-hub-rows">
        <div class="settings-hub-row voice-row"><span><strong>美式英语</strong><small>LJSpeech · 已随应用安装</small></span><span class="voice-ready">可用</span></div>
        <div class="settings-hub-row voice-row"><span><strong>英式英语</strong><small>Cori · 已随应用安装</small></span><span class="voice-ready">可用</span></div>
      </div>
    </section>
    <section v-for="group in displayGroups" :key="group.title" class="settings-hub-group" :class="{ 'single-option': group.options.length === 1, 'scheme-c-group': landscape }"><div class="settings-hub-group-head"><h2 class="settings-hub-group-title">{{ group.title }}</h2><div v-if="landscape" class="scheme-c-group-actions"><button type="button" @click="setGroup(group, true)">全部开启</button><button type="button" @click="setGroup(group, false)">全部关闭</button></div></div><div class="settings-hub-rows"><label v-for="option in group.options" :key="option.key" class="settings-hub-row selection-option"><span><strong>{{ option.label }}</strong></span><input type="checkbox" :checked="config[option.key]" @change="toggle(option.key)"></label></div></section>
    <VocabularyMaintenance v-if="landscape" />
    <p v-if="!landscape" class="settings-hub-brand">当前显示：{{ summary }}</p>
  </div>
</template>
<style scoped>
.selection-option { cursor:pointer; }
.selection-option input { width:19px; height:19px; justify-self:end; }
.voice-built-in .settings-hub-group-title { display:flex; align-items:center; gap:8px; }
.voice-built-in .settings-hub-group-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.voice-row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.voice-row small { display:block; margin-top:4px; color:var(--muted); font-size:13px; }
.voice-ready { display:inline-flex; align-items:center; gap:5px; color:var(--success, #34785f); font-size:13px; white-space:nowrap; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .settings-hub-group-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:0 0 8px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .settings-hub-group-title { margin:0; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group-actions { display:flex; gap:7px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group-actions button { min-height:32px; padding:0 10px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--muted); cursor:pointer; font:inherit; font-size:12px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group-actions button:hover { border-color:var(--primary); color:var(--primary); }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-rows { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; padding:8px; overflow:visible; border-radius:var(--radius-md); }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-row { display:grid; grid-template-columns:minmax(0,1fr) 24px; min-height:72px; padding:12px; border:1px solid var(--line); border-radius:11px; background:var(--surface-solid); }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-row > span { min-width:0; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-row strong { font-size:15px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-row input { grid-column:2; grid-row:1; }
@media (max-width: 760px) {
  html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group .settings-hub-rows { grid-template-columns:minmax(0,1fr); }
  html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .settings-hub-group-head { align-items:flex-start; }
  html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .scheme-c-group-actions { flex-wrap:wrap; justify-content:flex-end; }
}
</style>


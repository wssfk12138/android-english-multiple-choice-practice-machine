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
// 横屏按「栏目落在卡片的什么位置」分组，分组名直接说明这组开关画出的是卡片的哪一部分；
// 旧的 基础信息/进阶内容 只表达了难度感，看不出开关对应卡片的哪一段。
// 分组顺序也与卡片上的出现顺序一致（词语信息 → 释义与例句 → 辨析与词形变化 → 个人记录）。
// 竖屏仍走下面的单组列表，本次不改动。
const landscapeGroups = ([
  { title: '词语信息', keys: ['phonetic', 'part_of_speech'] },
  { title: '释义与例句', keys: ['common_meaning', 'source_sentence', 'model_sentence', 'memory_hint'] },
  { title: '辨析与词形变化', keys: ['synonyms', 'antonyms', 'similar_forms', 'morphology'] },
  { title: '个人记录', keys: ['note'] },
] as { title: string; keys: VocabDisplayKey[] }[]).map(group => ({
  title: group.title,
  // VOCAB_DISPLAY_OPTIONS 是键、文案与默认值的唯一权威来源，这里只做分组，不复制标签文本。
  options: group.keys.map(key => VOCAB_DISPLAY_OPTIONS.find(option => option.key === key)!),
}))
const summary = computed(() => VOCAB_DISPLAY_OPTIONS.filter(o => config[o.key]).map(o => o.label).join('、') || '已全部隐藏')
function toggle(key: VocabDisplayKey) { config[key] = !config[key]; saveVocabDisplayConfig({ ...config }) }
</script>
<template>
  <div class="page mobile-hub vocabulary-display">
    <div class="page-head compact-page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><span class="page-title-icon-lucide"><Eye :size="22" /></span><h1>{{ landscape ? '单词本设置' : '单词显示' }}</h1></div></div>
    <p v-if="landscape" class="vocabulary-display-scope">这些栏目作用于单词本的学习卡片；每日一背固定显示常用释义和真题原句。</p>
    <section v-for="group in landscape ? landscapeGroups : [{ title: '显示栏目', options: VOCAB_DISPLAY_OPTIONS }]" :key="group.title" class="settings-hub-group" :class="{ 'single-option': group.options.length === 1 }"><h2 class="settings-hub-group-title">{{ group.title }}</h2><div class="settings-hub-rows"><label v-for="option in group.options" :key="option.key" class="settings-hub-row selection-option"><span class="settings-hub-row-icon"><Eye :size="18" /></span><span><strong>{{ option.label }}</strong><small v-if="!landscape && option.key === 'common_meaning'">默认显示</small></span><input type="checkbox" :checked="config[option.key]" @change="toggle(option.key)"></label></div></section>
    <VocabularyMaintenance v-if="landscape" />
    <p v-if="!landscape" class="settings-hub-brand">当前显示：{{ summary }}</p>
  </div>
</template>
<style scoped>
.selection-option { cursor:pointer; }
/* 横屏的页面级说明：先说清这些开关只作用于单词本学习卡片，避免再误以为它会改动每日一背。 */
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .vocabulary-display-scope { margin:0 4px 14px; color:var(--muted); font-size:13px; line-height:1.6; }
/* 只有一项的分组（个人记录）铺满整行，否则双列网格会空出右半边。 */
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .settings-hub-group.single-option .settings-hub-rows { grid-template-columns:minmax(0,1fr); }
.selection-option input { width:19px; height:19px; justify-self:end; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option { display:grid; grid-template-columns:minmax(0,1fr) 24px; background:transparent; border-radius:0; border-bottom:1px solid var(--line); padding:6px 0; min-height:52px; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option input { grid-column:2; grid-row:1; justify-self:end; }
html[data-platform="android"][data-orientation="landscape"] .vocabulary-display .selection-option > span:not(.settings-hub-row-icon) { grid-column:1; grid-row:1; }
html[data-platform="android"][data-orientation="landscape"] .selection-option small { display:none; }
</style>


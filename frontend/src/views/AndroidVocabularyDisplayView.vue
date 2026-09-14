<script setup lang="ts">
import '../settings-hub.css'
import { computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Eye } from 'lucide-vue-next'
import { VOCAB_DISPLAY_OPTIONS, loadVocabDisplayConfig, saveVocabDisplayConfig, type VocabDisplayKey } from '../services/vocabularyDisplayConfig'
const config = reactive<Record<VocabDisplayKey, boolean>>(loadVocabDisplayConfig())
const summary = computed(() => VOCAB_DISPLAY_OPTIONS.filter(o => config[o.key]).map(o => o.label).join('、') || '已全部隐藏')
function toggle(key: VocabDisplayKey) { config[key] = !config[key]; saveVocabDisplayConfig({ ...config }) }
</script>
<template>
  <div class="page mobile-hub">
    <div class="page-head compact-page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><span class="page-title-icon-lucide"><Eye :size="22" /></span><h1>单词显示</h1></div></div>
    <section class="settings-hub-group"><h2 class="settings-hub-group-title">显示栏目</h2><div class="settings-hub-rows"><label v-for="option in VOCAB_DISPLAY_OPTIONS" :key="option.key" class="settings-hub-row selection-option"><span class="settings-hub-row-icon"><Eye :size="18" /></span><span><strong>{{ option.label }}</strong><small v-if="option.key === 'common_meaning'">默认显示</small></span><input type="checkbox" :checked="config[option.key]" @change="toggle(option.key)"></label></div></section>
    <p class="settings-hub-brand">当前显示：{{ summary }}</p>
  </div>
</template>
<style scoped>
.selection-option { cursor:pointer; }
.selection-option input { width:19px; height:19px; justify-self:end; }
</style>


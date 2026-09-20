<script setup lang="ts">
import { ref } from 'vue'
function savedConfig() { try { return JSON.parse(localStorage.getItem('vocab-display-config') || '{}') } catch { return {} } }
const enabled = ref(savedConfig().morphology !== false)
function save() { localStorage.setItem('vocab-display-config', JSON.stringify({ ...savedConfig(), morphology: enabled.value })); window.dispatchEvent(new Event('vocab-display-change')) }
</script>
<template><section class="panel"><h3>单词本显示</h3><label><input v-model="enabled" type="checkbox" @change="save"> 显示单词词形</label><p>详情和复习答案中展示原形及不同词形，显示答案前隐藏。</p></section></template>

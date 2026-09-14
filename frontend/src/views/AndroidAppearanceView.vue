<script setup lang="ts">
import '../settings-hub.css'
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Moon } from 'lucide-vue-next'
const dark = ref(false)
function toggle() { dark.value = !dark.value; document.documentElement.classList.toggle('dark', dark.value); localStorage.setItem('linjian-theme', dark.value ? 'dark' : 'light') }
onMounted(() => { dark.value = document.documentElement.classList.contains('dark') })
</script>
<template><div class="page mobile-hub"><div class="page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>外观与显示</h1></div></div><section class="settings-hub-group"><h2 class="settings-hub-group-title">主题</h2><div class="settings-hub-rows"><div class="settings-hub-row"><span class="settings-hub-row-icon"><Moon :size="19" /></span><span><strong>深色模式</strong></span><button class="settings-theme-switch" type="button" role="switch" :aria-checked="dark" aria-label="深色模式" @click="toggle"><span /></button></div></div></section></div></template>

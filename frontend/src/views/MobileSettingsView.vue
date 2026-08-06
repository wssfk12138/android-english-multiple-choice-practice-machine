<script setup lang="ts">
import { onMounted, ref } from 'vue'

const dark = ref(false)
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
    <div class="mobile-hub-list settings-hub-list">
      <RouterLink class="card mobile-hub-item" to="/library"><img src="/assets/icons/paper.png" alt=""><span><strong>题库管理</strong><small>查看试卷、批量移动或移入回收站。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/imports"><img src="/assets/icons/import.png" alt=""><span><strong>导入题库</strong><small>导入 Word、PDF 或 ESQ 题库包。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/settings"><img src="/assets/icons/settings.png" alt=""><span><strong>模型与 API</strong><small>配置服务商、可用模型与学习辅助参数。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/android-updates"><img src="/assets/icons/update.png" alt=""><span><strong>更新与日志</strong><small>检查内测更新、查看或发送脱敏日志。</small></span><b aria-hidden="true">›</b></RouterLink>
      <RouterLink class="card mobile-hub-item" to="/trash"><img src="/assets/icons/diagnostics.png" alt=""><span><strong>回收站</strong><small>七天内恢复删除的试卷与题库配置。</small></span><b aria-hidden="true">›</b></RouterLink>
    </div>
  </div>
</template>

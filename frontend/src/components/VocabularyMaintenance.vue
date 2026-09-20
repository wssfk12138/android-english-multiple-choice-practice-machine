<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { get, post } from '../api'
const status = ref<any>(null)
const busy = ref(false)
const error = ref('')
const total = computed(() => ['ready','queued','inflight','failed'].reduce((n,key) => n + Number(status.value?.[key] || 0),0))
const progress = computed(() => total.value ? Math.round(100 * (status.value?.ready || 0) / total.value) : 0)
const stateLabel = computed(() => !status.value ? '读取中' : status.value.paused ? '已暂停' : status.value.waiting_configuration ? '等待配置' : status.value.inflight ? '补缺中' : status.value.queued ? '等待补缺' : '已完成')
let refreshing = false
let disposed = false
async function refresh() {
  if (refreshing || busy.value || disposed) return
  refreshing = true
  try { const next = await get('/vocabulary/enrichment-status'); if (!disposed && !busy.value) { status.value = next; error.value = '' } }
  catch { error.value = '无法读取补缺状态，请重试' }
  finally { refreshing = false }
}
async function act(action: string) {
  if (busy.value) return
  busy.value = true
  try { status.value = await post('/vocabulary/enrichment-runs', { action }); error.value = '' }
  catch { error.value = '补缺操作失败，请重试' }
  finally { busy.value = false }
}
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => { void refresh(); poll = setInterval(() => { if (!busy.value) void refresh() }, 3000) })
onBeforeUnmount(() => { disposed = true; clearInterval(poll) })
</script>
<template>
  <section class="settings-hub-group vocabulary-maintenance">
    <h2 class="settings-hub-group-title">词条维护</h2>
    <div class="card">
      <div class="maintenance-heading"><strong>历史词条补缺</strong><span class="muted" role="status">{{ stateLabel }}</span></div>
      <p v-if="status">已完成 {{ status.ready || 0 }} · 待补 {{ (status.queued || 0) + (status.inflight || 0) }} · 失败 {{ status.failed || 0 }}</p>
      <progress :value="progress" max="100" aria-label="词条补缺进度" />
      <p v-if="status?.waiting_configuration" class="muted">等待配置默认模型</p>
      <div class="maintenance-actions">
        <button class="button secondary" :disabled="busy || !status" @click="act(status.paused ? 'resume' : 'pause')">{{ status?.paused ? '继续补缺' : '暂停补缺' }}</button>
        <button class="button secondary" :disabled="busy || !status?.failed" @click="act('retry')">重试失败词条</button>
        <RouterLink class="button secondary" to="/settings">检查模型配置</RouterLink>
      </div>
      <p v-if="status?.failed" class="error" role="alert">{{ status.failed }} 个词条补缺失败，可重试失败词条或检查模型配置。</p>
      <p v-if="error" class="error" role="alert">{{ error }} <button class="button ghost" @click="refresh">重试</button></p>
    </div>
  </section>
</template>
<style scoped>
.maintenance-actions { display:flex; gap:8px; align-items:center; }
.maintenance-actions > * { flex:1; min-width:0; text-align:center; }
.card { padding:14px; }
.maintenance-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
progress { width:100%; height:8px; margin:8px 0 16px; accent-color:var(--primary); }
progress { appearance:none; border:0; border-radius:4px; overflow:hidden; background:var(--primary-soft); }
progress::-webkit-progress-bar { background:var(--primary-soft); }
progress::-webkit-progress-value { background:var(--primary); }
html[data-platform="android"][data-orientation="landscape"] .card { padding:0; border:0; background:transparent; box-shadow:none; }
html[data-platform="android"][data-orientation="landscape"] .maintenance-actions > * { flex:0 1 212px; min-height:44px; }
</style>

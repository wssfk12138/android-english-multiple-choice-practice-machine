<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ArrowLeft, RefreshCw, ScanLine, Save, Send, Wifi } from 'lucide-vue-next'
import { get, post, put } from '../api'
import { confirmDialog } from '../platform/dialogs'
const busy = ref('')
const notice = ref('')
const error = ref('')
import type { LanSyncQrPayload } from '../platform/android/lan-sync-qr'
import LanSyncScanner from '../components/LanSyncScanner.vue'
import { CATEGORY_LABELS, DEFAULT_CATEGORIES, type LanCategory } from '../platform/android/lan-categories'

import LanQuestionBanks from '../components/LanQuestionBanks.vue'
const lanSync = reactive({
  categories: [...DEFAULT_CATEGORIES],
  effectiveCategories: [] as LanCategory[],
  hostId: '',
  host: '',
  passcode: '',
  auto: false,
  configured: false,
  runtime: { running: false, online: true, lastSyncAt: '', lastError: '', errorCode: '', autoPaused: false, nextRetryAt: '' },
})
const scannerOpen = ref(false)
const scannedPairing = ref<LanSyncQrPayload['pairing']>()
const syncConnectionOpen = ref(false)
async function refreshLanSync() {
  try {
    const result: any = await get('/android/lan-sync/status')
    lanSync.host = String(result.host || '')
    lanSync.hostId = String(result.host_id || '')
    lanSync.categories = result.categories || [...DEFAULT_CATEGORIES]
    lanSync.effectiveCategories = result.effective_categories || []
    lanSync.auto = Boolean(result.auto)
    lanSync.configured = Boolean(result.configured)
    syncConnectionOpen.value = !lanSync.configured
    Object.assign(lanSync.runtime, result.runtime || {}, {
      lastSyncAt: result.runtime?.lastSyncAt || result.last_sync_at || '',
    })
  } catch (cause) {
    error.value = `读取局域网同步状态失败：${String(cause)}`
  }
}

async function saveLanSync() {
  busy.value = 'lan-sync-save'
  notice.value = '';
  error.value = ''
  try {
    const result: any = await put('/android/lan-sync/settings', {
      host: lanSync.host,
      passcode: lanSync.passcode,
      pairing: scannedPairing.value,
      categories: lanSync.categories,
      auto: lanSync.auto,
    })
    lanSync.host = String(result.host || lanSync.host)
    lanSync.hostId = String(result.host_id || '')
    scannedPairing.value = undefined
    lanSync.configured = Boolean(result.configured)
    Object.assign(lanSync.runtime, result.runtime || {})
    lanSync.passcode = ''
    try {
      const syncResult: any = await post('/android/lan-sync/run')
      lanSync.runtime.lastSyncAt = String(syncResult.last_sync_at || '')
      lanSync.runtime.lastError = ''
      notice.value = '已保存并连接到电脑，学习记录同步完成'
      await refreshLanSync()
    } catch (cause) {
      error.value = '设置已保存，但连接测试失败：' + String(cause)
      await refreshLanSync()
    }
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

function scanLanSync() {
  if (scannerOpen.value) return
  busy.value = 'lan-sync-scan'
  error.value = ''
  scannerOpen.value = true
}

function scannedLanSync(payload: LanSyncQrPayload) {
  lanSync.host = payload.host
  lanSync.passcode = payload.passcode
  scannedPairing.value = payload.pairing
  notice.value = '二维码已识别，请保存并测试连接'
}

function closeScanner() {
  scannerOpen.value = false
  busy.value = ''
}

async function runLanSyncNow() {
  busy.value = 'lan-sync-run'
  notice.value = '';
  error.value = ''
  try {
    const result: any = await post('/android/lan-sync/run')
    lanSync.runtime.lastSyncAt = String(result.last_sync_at || '')
    lanSync.runtime.lastError = ''
    notice.value = '双方已启用的类别同步完成'
    await refreshLanSync()
  } catch (cause) {
    error.value = `局域网同步失败：${String(cause)}`
    await refreshLanSync()
  } finally {
    busy.value = ''
  }
}

function formatSyncTime(value: string) {
  if (!value) return '尚未同步'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('zh-CN')
}

async function sendModelConfiguration() {
  if (busy.value) return
  const confirmed = await confirmDialog({
    title: '以本机为准发送模型配置与 Key 到已绑定电脑？',
    message: [
      '同名配置将覆盖，缺失配置将补建；电脑独有配置保留。',
      '模型列表、启用状态、默认选择和命名 Key 均以本机为准。',
      '此操作不处理练习记录。',
    ],
    confirmLabel: '发送模型配置',
  })
  if (!confirmed) return
  busy.value = 'lan-models-send'
  error.value = ''
  notice.value = ''
  try {
    const result: any = await post('/android/lan-sync/models/authoritative', { confirm: true })
    notice.value = '已发送 ' + result.applied_profiles + ' 个模型配置及 Key；未处理练习记录'
  } catch {
    error.value = '模型配置发送未确认成功，请检查新版电脑、安全连接及双方模型同步权限后重试'
  } finally {
    busy.value = ''
  }
}



onMounted(refreshLanSync)

async function saveAutoSync() {
  busy.value = 'auto'; error.value = ''
  try {
    await put('/android/lan-sync/settings', { auto: lanSync.auto })
    notice.value = lanSync.auto ? '自动同步已开启' : '自动同步已关闭'
  } catch (cause) { lanSync.auto = !lanSync.auto; error.value = String(cause) }
  finally { busy.value = '' }
}

</script>
<template>
<div class="page android-updates-page"><div class="page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>设备同步</h1></div></div><p v-if="error" class="warning" role="alert">{{ error }}</p><p v-if="notice" class="settings-success" role="status">{{ notice }}</p><p v-if="busy" role="status" class="operation-status">正在处理，请稍候…</p>
<LanSyncScanner v-if="scannerOpen" @scanned="scannedLanSync" @failed="error = $event" @closed="closeScanner" />    <section class="card update-source-card" data-update-section="sync">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Wifi :size="20" /></span>
        <div>
          <h2>设备同步</h2>
          <small class="sync-summary">{{ lanSync.configured ? (lanSync.runtime.online ? '已连接' : '设备离线') : '尚未配置' }} · {{ lanSync.runtime.running ? '同步中' : '空闲' }}</small>
        </div>
        <label class="lan-sync-header-toggle selection-option"><span>自动同步</span><input v-model="lanSync.auto" type="checkbox" :disabled="Boolean(busy) || !lanSync.configured" @change="saveAutoSync"></label>
      </div>
      <details class="sync-connection" :open="syncConnectionOpen" @toggle="syncConnectionOpen = ($event.target as HTMLDetailsElement).open"><summary>连接</summary>
      <div class="lan-sync-connection-grid">
        <div class="field">
          <label for="lan-sync-host">电脑端地址</label>
          <div class="lan-sync-host-row">
            <input id="lan-sync-host" v-model.trim="lanSync.host" inputmode="url" placeholder="http://192.168.x.x:8766">
            <button class="icon-button" type="button" :disabled="busy === 'lan-sync-scan'" aria-label="扫描电脑端二维码" title="扫描电脑端二维码" @click="scanLanSync">
              <ScanLine :size="20" />
            </button>
          </div>
        </div>
        <div class="field">
          <label for="lan-sync-passcode">同步口令</label>
          <input id="lan-sync-passcode" v-model.trim="lanSync.passcode" type="password" autocomplete="new-password" :disabled="Boolean(lanSync.hostId || scannedPairing)" placeholder="旧版配对口令">
        </div>
        <button class="button" type="button" :disabled="busy === 'lan-sync-save'" @click="saveLanSync">
          <Save :size="16" />保存并测试连接
        </button>
      </div>

      <span v-if="scannedPairing || lanSync.hostId" class="lan-sync-host-id">HTTPS · {{ scannedPairing?.tls.hostId || lanSync.hostId }}</span>
      </details>
      <div class="lan-sync-work-grid">
        <fieldset class="lan-category-options">
          <legend>同步类别</legend>
          <label class="selection-option" v-for="(label, category) in CATEGORY_LABELS" :key="category">
            <input v-model="lanSync.categories" type="checkbox" :value="category" :disabled="Boolean(busy)">
            <span>{{ label }}</span>
            <span>{{ lanSync.effectiveCategories.includes(category) ? '上次已启用' : '上次未启用' }}</span>
          </label>
        </fieldset>
      <div class="lan-sync-operation-column">
      <div class="update-actions lan-sync-actions">
        <button class="button secondary" type="button" :disabled="busy === 'lan-sync-run' || !lanSync.configured" @click="runLanSyncNow">
          <RefreshCw :size="16" />立即同步
        </button>
      </div>
      <div class="lan-sync-status" aria-live="polite">
        <button class="button secondary" type="button" :disabled="Boolean(busy) || !lanSync.configured || lanSync.runtime.running" @click="sendModelConfiguration">
          <Send :size="16" />以本机模型配置发送到电脑
        </button>
        <span>{{ lanSync.runtime.online ? '设备网络在线' : '设备当前离线' }}</span>
        <span>{{ lanSync.runtime.running ? '正在同步' : '当前空闲' }}</span>
        <span>上次同步：{{ formatSyncTime(lanSync.runtime.lastSyncAt) }}</span>
      </div>
      <p v-if="lanSync.runtime.autoPaused && lanSync.runtime.errorCode === 'AUTH_EXPIRED'" class="warning">自动同步已暂停，请重新输入电脑端当前口令并保存</p>
      <p v-else-if="lanSync.runtime.autoPaused" class="warning">自动同步已暂停，请处理上述问题后手动同步</p>
      <p v-else-if="lanSync.runtime.nextRetryAt" class="sync-retry-hint">连接异常，{{ formatSyncTime(lanSync.runtime.nextRetryAt) }} 自动重试</p>
      <p v-if="lanSync.runtime.lastError" class="warning">上次错误：{{ lanSync.runtime.lastError }}</p>
      </div></div>
    </section>

<LanQuestionBanks :key="lanSync.hostId" />
</div></template>
<style scoped>
.lan-sync-work-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.lan-sync-operation-column { min-width:0; }
.sync-connection { margin-bottom:16px; }
.sync-summary { display:block; margin-top:2px; color:var(--muted); font-size:12px; }
.lan-sync-header-toggle { display:flex; align-items:center; gap:8px; margin-left:auto; white-space:nowrap; }
.lan-sync-header-toggle input { width:20px; height:20px; }
@media(max-width:720px) { .lan-sync-work-grid { grid-template-columns:minmax(0,1fr); } }
.lan-sync-status > span, .lan-category-options span { min-width: 0; overflow-wrap: anywhere; }
.update-source-heading > div { min-width: 0; }
.lan-sync-connection-grid { display:grid; grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) auto; gap:12px; align-items:end; }
.lan-sync-connection-grid > .field { margin-bottom:0; }
.lan-sync-options-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; align-items:start; }
.lan-sync-options-grid { margin-top:12px; }
.lan-sync-host-id { display:block; margin-top:4px; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.lan-sync-host-row .icon-button { flex: 0 0 44px; min-width: 44px; min-height: 44px; }
.lan-sync-actions .button { max-width: 100%; white-space: normal; }
.lan-sync-actions svg { flex-shrink: 0; }
.lan-sync-toggle { min-height:44px; margin-top:0; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface-solid); }
.lan-sync-toggle-copy small { color:var(--muted); font-size:12px; line-height:1.4; overflow-wrap:anywhere; }
.warning { overflow-wrap: anywhere; }
.lan-category-options { border: 0; padding: 0; margin: 0; min-width: 0; }
.lan-category-options label { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 6px 0; }
.lan-category-options input { width: 18px; height: 18px; flex: 0 0 18px; }
@media (max-width: 720px) {
  .lan-sync-connection-grid,.lan-sync-options-grid { grid-template-columns: minmax(0,1fr); }
  .lan-sync-options-grid { gap: 10px; }
}
</style>

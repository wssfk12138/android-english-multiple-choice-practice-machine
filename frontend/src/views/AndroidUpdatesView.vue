<script setup lang="ts">
import { ArrowLeft, Download, PackageCheck, RefreshCw, Save } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import CommunityLinks from '../components/CommunityLinks.vue'
import { useRouter } from 'vue-router'
import { get, post, put } from '../api'
import type { QuestionBankDownloadProgress } from '../platform/android/app-update'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'
const router = useRouter()
const settings = reactive({
  question_bank_catalog_url: '',
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)

const selectedPackages = ref<string[]>([])
const packageResults = ref<Record<string, { status: 'pending' | 'success' | 'failed', message: string }>>({})
const busy = ref('')
const notice = ref('')
const error = ref('')
const destinationOpen = ref(false)
const destinationError = ref('')
const destinations = ref<{ item: any, mode: 'new' | 'existing', name: string, profileId: number }[]>([])
type DownloadState = 'queued' | 'preparing' | 'downloading' | 'verifying' | 'success' | 'failed'
type PackageProgress = {
  state: DownloadState
  downloadedBytes: number
  totalBytes: number
  speedBytesPerSecond: number
  message?: string
}
const destinationStage = ref<'config' | 'downloading' | 'finished'>('config')
const packageProgress = ref<Record<string, PackageProgress>>({})
const completedImportId = ref<number | null>(null)
let removeProgressListener: (() => Promise<void>) | null = null
const packageKey = (item: any) => `${item.packageId}@${item.contentVersion}`
const allPackagesSelected = computed(() => Boolean(questionBankCatalog.value?.packages?.length)
  && questionBankCatalog.value.packages.every((item: any) => selectedPackages.value.includes(packageKey(item))))

async function load() {
  try {
    Object.assign(settings, await get('/android/updates/settings'))
  } catch (cause) {
    error.value = String(cause)
  }
}

async function save() {
  busy.value = 'save'; error.value = ''
  try {
    Object.assign(settings, await put('/android/updates/settings', settings))
    notice.value = '远程题库地址已保存'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

async function checkApp() {
  busy.value = 'app'; error.value = ''
  try {
    appUpdate.value = await post('/android/updates/app/check')
    notice.value = appUpdate.value.available ? '检测到新版本' : '当前已经是最新版本'
  } catch (cause) {
    error.value = String(cause)
    } finally {
    busy.value = ''
  }
}

async function installApp() {
  if (!appUpdate.value?.manifest) return
  busy.value = 'install'; error.value = ''
  try {
    await post('/android/updates/app/install', { manifest: appUpdate.value.manifest })
    notice.value = '安装包已校验，正在打开 Android 系统安装界面'
  } catch (cause) {
    error.value = String(cause)
    } finally {
    busy.value = ''
  }
}

async function checkBanks() {
  busy.value = 'banks'; error.value = ''
  try {
    questionBankCatalog.value = await post('/android/updates/question-banks/check')
    selectedPackages.value = []
    packageResults.value = {}
    notice.value = questionBankCatalog.value.configured
      ? `远程题库源返回 ${questionBankCatalog.value.packages?.length || 0} 个题库包`
      : '尚未配置远程题库源，本地 ESQ 导入不受影响'
  } catch (cause) {
    error.value = String(cause)
    } finally {
    busy.value = ''
  }
}

function toggleAllPackages() {
  selectedPackages.value = allPackagesSelected.value
    ? []
    : (questionBankCatalog.value?.packages?.map(packageKey) || [])
}

async function openCatalogDestination() {
  error.value = ''
  try {
    await loadQuestionBankProfiles()
    destinations.value = (questionBankCatalog.value?.packages || [])
      .filter((item: any) => selectedPackages.value.includes(packageKey(item)))
      .map((item: any) => ({ item, mode: 'new', name: String(item.title).trim().slice(0, 80), profileId: 0 }))
    destinationError.value = ''
    destinationStage.value = 'config'
    packageProgress.value = {}
    completedImportId.value = null
    destinationOpen.value = destinations.value.length > 0
  } catch (cause) { error.value = String(cause) }
}

async function installSelectedPackages() {
  if (busy.value || !destinationOpen.value || destinationStage.value !== 'config') return
  destinationError.value = ''
  const names = new Set(questionBankProfilesState.items.map(item => String(item.name).trim().toLocaleLowerCase()))
  for (const target of destinations.value) {
    if (target.mode === 'new') {
      const name = target.name.trim()
      if (!name || name.length > 80) { destinationError.value = '请输入 1–80 字的题库名称'; return }
      if (names.has(name.toLocaleLowerCase())) { destinationError.value = '题库名称重复，请修改名称或选择已有题库'; return }
      names.add(name.toLocaleLowerCase())
    } else if (!questionBankProfilesState.items.some(item => Number(item.id) === target.profileId)) {
      destinationError.value = '请选择已有题库'; return
    }
  }
  const selected = destinations.value
  if (!selected.length) return
  destinationStage.value = 'downloading'
  busy.value = 'catalog-install'
  error.value = ''
  notice.value = ''
  packageResults.value = {}
  packageProgress.value = Object.fromEntries(selected.map(target => [packageKey(target.item), {
    state: 'queued', downloadedBytes: 0, totalBytes: Number(target.item.size), speedBytesPerSecond: 0,
  }]))
  const importIds: number[] = []
  const transferKeys = new Map<string, string>()
  try {
    if (document.documentElement.dataset.platform === 'android') {
      const { onQuestionBankDownloadProgress } = await import('../platform/android/app-update')
      const handle = await onQuestionBankDownloadProgress((event: QuestionBankDownloadProgress) => {
        const key = transferKeys.get(event.transferId)
        if (!key || !packageProgress.value[key]) return
        packageProgress.value[key] = {
          state: event.state,
          downloadedBytes: Math.max(0, Number(event.downloadedBytes) || 0),
          totalBytes: Math.max(0, Number(event.totalBytes) || 0),
          speedBytesPerSecond: Math.max(0, Number(event.speedBytesPerSecond) || 0),
        }
      })
      removeProgressListener = () => handle.remove()
    }
    for (const [index, target] of selected.entries()) {
      const item = target.item
      const key = packageKey(item)
      const transferId = String(Date.now()) + '-' + index + '-' + Math.random().toString(36).slice(2)
      transferKeys.set(transferId, key)
      packageProgress.value[key] = { ...packageProgress.value[key], state: 'downloading' }
      packageResults.value[key] = { status: 'pending', message: '正在下载、校验并建立导入草稿' }
      try {
        const result: any = await post('/android/updates/question-banks/download', {
          package_id: item.packageId,
          content_version: item.contentVersion,
          transfer_id: transferId,
          ...(target.mode === 'new' ? { new_profile_name: target.name.trim() } : { profile_id: target.profileId }),
        })
        importIds.push(Number(result.id))
        packageProgress.value[key] = { ...packageProgress.value[key], state: 'success', downloadedBytes: packageProgress.value[key].totalBytes, speedBytesPerSecond: 0 }
        packageResults.value[key] = { status: 'success', message: '已校验，等待你在导入预览中确认' }
      } catch (cause) {
        const message = String(cause)
        packageProgress.value[key] = { ...packageProgress.value[key], state: 'failed', speedBytesPerSecond: 0, message }
        packageResults.value[key] = { status: 'failed', message }
      } finally {
        transferKeys.delete(transferId)
      }
    }
  } finally {
    await removeProgressListener?.()
    removeProgressListener = null
    busy.value = ''
  }
  const failedCount = selected.length - importIds.length
  notice.value = `已建立 ${importIds.length} 个导入草稿${failedCount ? `，${failedCount} 个失败` : ''}`
  completedImportId.value = importIds[0] || null
  if (failedCount) {
    destinationStage.value = 'finished'
  } else if (importIds.length) {
    destinationOpen.value = false
    await router.push({ path: '/imports', query: { esqImportId: String(importIds[0]) } })
  }
}

function closeDestination() {
  if (destinationStage.value !== 'downloading') destinationOpen.value = false
}

async function openCompletedImport() {
  if (!completedImportId.value) return
  destinationOpen.value = false
  await router.push({ path: '/imports', query: { esqImportId: String(completedImportId.value) } })
}

function progressPercent(progress: PackageProgress) {
  return progress.totalBytes > 0 ? Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100)) : 0
}

function progressLabel(progress: PackageProgress) {
  return ({ queued: '等待下载', preparing: '准备下载', downloading: '下载中', verifying: '正在校验并建立导入草稿', success: '已完成', failed: '下载失败' })[progress.state]
}

function formatSpeed(bytesPerSecond: number) {
  return bytesPerSecond > 0 ? formatFileSize(bytesPerSecond) + '/秒' : '测速中'
}

function formatFileSize(value: unknown) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 1) return ''
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : bytes < 1024
      ? `${Math.round(bytes)} B`
    : `${Math.ceil(bytes / 1024)} KiB`
}

onMounted(async () => {
  await load()
})
onBeforeUnmount(() => {
  void removeProgressListener?.()
})
</script>
<template>
<div class="page android-updates-page">
  <div class="page-head updates-page-head">
    <div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>更新与远程题库</h1></div>
    <CommunityLinks />
  </div>
  <p v-if="error" class="warning" role="alert">{{ error }}</p>
  <p v-if="notice" class="settings-success" role="status">{{ notice }}</p>
  <p v-if="busy" role="status" class="operation-status">正在处理，请稍候…</p>
  <div class="maintenance-update-grid">
    <section class="card update-source-card catalog-band">
      <div class="update-band-head">
        <div class="update-source-heading"><span class="api-profile-icon"><Download :size="20" /></span><div><h2>远程题库</h2></div></div>
        <div class="update-band-actions"><button class="button secondary" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存目录地址</button><button class="button" type="button" :disabled="busy === 'banks' || busy === 'catalog-install'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button></div>
      </div>
      <div class="field catalog-url-field"><label for="android-catalog-url">远程题库目录 URL</label><input id="android-catalog-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://github.com/.../question-bank-catalog.json"></div>
      <div v-if="!questionBankCatalog" class="update-summary">尚未检查远程题库</div>
      <div v-else-if="!questionBankCatalog.configured" class="update-summary">尚未配置远程题库源，本地 ESQ 导入不受影响</div>
      <template v-else>
        <div class="update-summary"><strong>发现 {{ questionBankCatalog.packages.length }} 个可用题库 · 已选 {{ selectedPackages.length }} 个</strong></div>
        <div v-if="questionBankCatalog.packages.length" class="update-package-list catalog-content">
        <label v-for="item in questionBankCatalog.packages" :key="packageKey(item)" class="catalog-item selection-option">
          <input v-model="selectedPackages" type="checkbox" :value="packageKey(item)" :disabled="busy === 'catalog-install'">
          <span>
            <strong>{{ item.title }}</strong>
            <small>版本 {{ item.contentVersion }} · {{ item.years.join('、') || '多年份' }} · {{ Math.ceil(item.size / 1024) }} KiB</small>
            <small>{{ item.license }}</small>
            <small v-if="packageResults[packageKey(item)]" :class="`catalog-${packageResults[packageKey(item)].status}`">{{ packageResults[packageKey(item)].message }}</small>
          </span>
        </label>
        </div>
        <p v-else class="diagnostic-empty">远程目录当前没有可安装题库。</p>
        <div v-if="questionBankCatalog.packages.length" class="catalog-toolbar"><button class="button ghost compact" type="button" :disabled="busy === 'catalog-install'" @click="toggleAllPackages">{{ allPackagesSelected ? '清空选择' : '全选' }}</button><button class="button compact" type="button" :disabled="busy === 'catalog-install' || !selectedPackages.length" @click="openCatalogDestination"><Download :size="15" />安装选中题库（{{ selectedPackages.length }}）</button></div>
      </template>
    </section>
    <section class="card update-source-card app-band">
      <div class="update-band-head">
        <div class="update-source-heading"><span class="api-profile-icon"><PackageCheck :size="20" /></span><div><h2>程序更新</h2></div></div>
        <div class="update-band-actions"><button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button><button v-if="appUpdate?.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button></div>
      </div>
      <div v-if="!appUpdate" class="update-summary">尚未检查程序更新</div>
      <template v-else>
        <div class="update-summary">{{ appUpdate.available ? '检测到可用的新版本' : '当前已经是最新版本' }}</div>
        <div class="version-list"><article v-if="appUpdate.available" class="version-row available-version"><div class="version-top"><strong>{{ appUpdate.manifest.versionName }}</strong><span class="version-badge">可更新</span></div><small v-if="appUpdate.manifest?.apkSize">安装包 {{ formatFileSize(appUpdate.manifest.apkSize) }} · 下载后校验 SHA-256</small><p v-if="appUpdate.manifest?.releaseNotes" class="release-notes">{{ appUpdate.manifest.releaseNotes }}</p></article><article class="version-row"><div class="version-top"><strong>{{ appUpdate.current_version }}</strong><span class="version-meta">已安装</span></div></article></div>
      </template>
    </section>
  </div>
  <div v-if="destinationOpen" class="destination-overlay" role="dialog" aria-modal="true" aria-labelledby="remote-destination-title" @keydown.esc="closeDestination">
    <section class="destination-dialog">
      <div class="destination-dialog-head"><div><h2 id="remote-destination-title">{{ destinationStage === 'config' ? '选择导入位置' : '正在下载题库' }}</h2><p>{{ destinationStage === 'config' ? '为已选的 ' + destinations.length + ' 个题库分别设置目标。' : '下载进度会持续显示在这里，完成后进入导入预览。' }}</p></div><button class="destination-close" type="button" aria-label="关闭" :disabled="destinationStage === 'downloading'" @click="closeDestination">×</button></div>
      <div class="destination-list">
        <fieldset class="destination-item" v-for="(target, index) in destinations" :key="packageKey(target.item)">
          <legend>{{ target.item.title }}</legend>
          <template v-if="destinationStage === 'config'">
          <div class="destination-modes">
            <label><input v-model="target.mode" type="radio" :name="`destination-${index}`" value="new">新建题库</label>
            <label><input v-model="target.mode" type="radio" :name="`destination-${index}`" value="existing">已有题库</label>
          </div>
          <label v-if="target.mode === 'new'" class="field"><span>名称</span><input v-model="target.name" maxlength="80"></label>
          <label v-else class="field"><span>目标题库</span><select v-model.number="target.profileId"><option :value="0" disabled>请选择</option><option v-for="profile in questionBankProfilesState.items" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
          </template>
          <div v-else-if="packageProgress[packageKey(target.item)]" class="download-progress-panel" :class="'download-progress-' + packageProgress[packageKey(target.item)].state">
            <div class="download-progress-head"><span>{{ progressLabel(packageProgress[packageKey(target.item)]) }}</span><strong>{{ progressPercent(packageProgress[packageKey(target.item)]) }}%</strong></div>
            <div class="download-progress-track" role="progressbar" :aria-valuenow="progressPercent(packageProgress[packageKey(target.item)])" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: progressPercent(packageProgress[packageKey(target.item)]) + '%' }"></span></div>
            <div class="download-progress-meta"><span>已下载 {{ formatFileSize(packageProgress[packageKey(target.item)].downloadedBytes) || '0 KiB' }} / {{ formatFileSize(packageProgress[packageKey(target.item)].totalBytes) || formatFileSize(target.item.size) }}</span><span>速度 {{ formatSpeed(packageProgress[packageKey(target.item)].speedBytesPerSecond) }}</span></div>
            <small v-if="packageProgress[packageKey(target.item)].message" :class="packageProgress[packageKey(target.item)].state === 'failed' ? 'catalog-failed' : 'catalog-success'">{{ packageProgress[packageKey(target.item)].message }}</small>
          </div>
        </fieldset>
      </div>
      <p v-if="destinationError" role="alert" class="catalog-failed">{{ destinationError }}</p>
      <div class="catalog-actions destination-footer"><button class="button secondary" type="button" :disabled="destinationStage === 'downloading'" @click="closeDestination">{{ destinationStage === 'finished' ? '关闭' : '取消' }}</button><button v-if="destinationStage === 'config'" class="button" type="button" @click="installSelectedPackages"><Download :size="17" />下载并预览</button><button v-else-if="destinationStage === 'finished' && completedImportId" class="button" type="button" @click="openCompletedImport"><PackageCheck :size="17" />打开导入预览</button><span v-else-if="destinationStage === 'downloading'" class="download-progress-footnote">正在处理当前队列…</span></div>
    </section>
  </div>


</div>
</template>
<style scoped>
.android-updates-page { min-width:0; }
.updates-page-head { align-items:center; gap:12px; flex-wrap:wrap; }
.updates-page-head .page-title-row { min-width:0; flex:1 1 auto; }
.updates-page-head h1 { overflow-wrap:anywhere; }
.updates-page-head > .update-community { margin-top:0; margin-left:auto; flex:none; }
.maintenance-update-grid { display:grid; gap:12px; }
.maintenance-update-grid > section { min-width:0; margin:0; }
.update-source-card { padding:16px 18px; }
.update-band-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:13px; }
.update-source-heading { align-items:center; min-width:0; margin:0; }
.update-source-heading h2 { margin:0; }
.update-band-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; }
.update-band-actions .button { min-height:40px; }
.catalog-url-field { margin-bottom:11px; }
.catalog-url-field input { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.update-summary { padding:10px 12px; border:1px solid var(--line); border-radius:12px; background:var(--primary-faint); color:var(--ink); font-size:13px; overflow-wrap:anywhere; }
.catalog-content { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 10px; margin-top:10px; }
.catalog-content .catalog-item { display:grid; grid-template-columns:auto minmax(0,1fr); gap:10px; min-width:0; padding:11px 12px; border:1px solid var(--line); border-radius:11px; background:var(--surface-solid); cursor:pointer; }
.catalog-content .catalog-item:has(input:checked) { border-color:var(--primary); background:var(--primary-faint); }
.catalog-content .catalog-item > input { width:18px; height:18px; margin:2px 0 0; accent-color:var(--primary); }
.catalog-content .catalog-item > span { min-width:0; display:grid; gap:4px; }
.catalog-content .catalog-item strong, .catalog-content .catalog-item small { overflow-wrap:anywhere; }
.catalog-content .catalog-item small { color:var(--muted); line-height:1.45; }
.catalog-content .catalog-success { color:var(--success) !important; }
.catalog-content .catalog-failed { color:var(--danger) !important; }
.catalog-toolbar { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:11px; }
.catalog-toolbar .button { margin:0; }
.app-band { background:var(--surface); }
.version-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:9px; margin-top:10px; }
.version-row { min-width:0; display:grid; align-content:start; gap:7px; padding:11px 12px; border:1px solid var(--line); border-radius:11px; background:var(--surface-solid); overflow-wrap:anywhere; }
.version-row.available-version { border-color:var(--primary); background:var(--primary-faint); }
.version-top { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; }
.version-badge { border-radius:999px; padding:3px 9px; color:var(--primary); background:var(--primary-soft); font-size:11px; }
.version-meta, .version-row small { color:var(--muted); }
.release-notes { max-height:112px; margin:0; overflow:auto; overflow-wrap:anywhere; white-space:pre-wrap; color:var(--muted); line-height:1.55; }
.warning { overflow-wrap:anywhere; }
.catalog-destination-overlay, .destination-overlay { position:fixed; inset:0; z-index:150; display:grid; place-items:center; padding:calc(12px + env(safe-area-inset-top)) 12px calc(12px + env(safe-area-inset-bottom)); background:rgba(25,27,32,.52); backdrop-filter:blur(3px); }
.catalog-destination-dialog, .destination-dialog { width:min(530px,100%); max-height:calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); min-width:0; display:flex; flex-direction:column; gap:12px; padding:18px; border:1px solid var(--line); border-radius:18px; background:var(--surface-solid); color:var(--ink); box-shadow:var(--shadow-hover); }
.destination-dialog-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex:none; }
.destination-dialog-head h2, .destination-dialog-head h3 { margin:0; font-size:19px; }
.destination-dialog-head p { margin:5px 0 0; color:var(--muted); font-size:12px; line-height:1.5; }
.destination-close { flex:none; width:32px; height:32px; border:0; background:transparent; color:var(--muted); font-size:24px; cursor:pointer; }
.catalog-destination-body, .destination-list { min-height:0; overflow:auto; scrollbar-color:var(--line-strong) transparent; }
.catalog-destination-choice { display:flex; gap:10px; align-items:flex-start; padding:11px; border:1px solid var(--line); border-radius:11px; margin-bottom:9px; }
.catalog-destination-choice input { margin-top:4px; min-width:18px; min-height:18px; accent-color:var(--primary); }
.catalog-destination-choice span { display:grid; min-width:0; gap:3px; }
.catalog-destination-choice small { color:var(--muted); overflow-wrap:anywhere; }
.catalog-profile-name-list { display:grid; gap:9px; margin:10px 0; }
.catalog-profile-name-list .field span { overflow-wrap:anywhere; }
.destination-item { min-width:0; margin:0 0 9px; padding:11px; border:1px solid var(--line); border-radius:11px; }
.destination-item legend { max-width:100%; font-weight:650; overflow-wrap:anywhere; }
.destination-modes { display:flex; flex-wrap:wrap; gap:14px; margin:8px 0 10px; }
.destination-modes label { display:flex; align-items:center; gap:5px; }
.destination-modes input { accent-color:var(--primary); }
.download-progress-panel { display:grid; gap:8px; margin-top:10px; padding:10px 11px; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
.download-progress-head, .download-progress-meta { display:flex; align-items:center; justify-content:space-between; gap:10px; min-width:0; }
.download-progress-head { color:var(--ink); font-size:12px; }
.download-progress-head strong { color:var(--primary); font-size:12px; }
.download-progress-track { height:8px; overflow:hidden; border-radius:999px; background:var(--primary-faint); }
.download-progress-track span { display:block; height:100%; border-radius:inherit; background:var(--primary); transition:width .2s ease; }
.download-progress-meta { color:var(--muted); font-size:11px; line-height:1.4; }
.download-progress-meta span { min-width:0; overflow-wrap:anywhere; }
.download-progress-verifying .download-progress-track span, .download-progress-success .download-progress-track span { background:var(--success); }
.download-progress-failed { border-color:var(--danger); }
.download-progress-failed .download-progress-head strong { color:var(--danger); }
.download-progress-failed .download-progress-track span { background:var(--danger); }
.download-progress-footnote { color:var(--muted); font-size:12px; }
.destination-dialog input, .destination-dialog select { max-width:100%; min-width:0; }
.destination-footer { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; flex:none; padding-top:12px; border-top:1px solid var(--line); }
.destination-footer .button { margin:0; }
@media(max-width:650px) {
  .updates-page-head { display:flex; }
  .update-community .icon-button { width:40px; height:40px; flex-basis:40px; }
  .update-band-head { align-items:flex-start; flex-wrap:wrap; }
  .update-band-actions { justify-content:flex-start; }
  .catalog-content, .version-list { grid-template-columns:minmax(0,1fr); }
}

</style>

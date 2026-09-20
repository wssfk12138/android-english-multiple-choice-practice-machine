<script setup lang="ts">
import { ArrowLeft, Download, PackageCheck, RefreshCw, Save } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post, put } from '../api'
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
    destinationOpen.value = destinations.value.length > 0
  } catch (cause) { error.value = String(cause) }
}

async function installSelectedPackages() {
  if (busy.value || !destinationOpen.value) return
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
  destinationOpen.value = false
  const selected = destinations.value
  if (!selected.length) return
  busy.value = 'catalog-install'
  error.value = ''
  notice.value = ''
  packageResults.value = {}
  const importIds: number[] = []
  for (const target of selected) {
    const item = target.item
    const key = packageKey(item)
    packageResults.value[key] = { status: 'pending', message: '正在下载、校验并建立导入草稿' }
    try {
      const result: any = await post('/android/updates/question-banks/download', {
        package_id: item.packageId,
        content_version: item.contentVersion,
        ...(target.mode === 'new' ? { new_profile_name: target.name.trim() } : { profile_id: target.profileId }),
      })
      importIds.push(Number(result.id))
      packageResults.value[key] = { status: 'success', message: '已校验，等待你在导入预览中确认' }
    } catch (cause) {
      packageResults.value[key] = { status: 'failed', message: String(cause) }
    }
  }
  busy.value = ''
  const failedCount = selected.length - importIds.length
  notice.value = `已建立 ${importIds.length} 个导入草稿${failedCount ? `，${failedCount} 个失败` : ''}`
  if (importIds.length) {
    await router.push({ path: '/imports', query: { esqImportId: String(importIds[0]) } })
  }
}

function formatFileSize(value: unknown) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 1) return ''
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KiB`
}

onMounted(load)
</script>
<template>
<div class="page android-updates-page"><div class="page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>更新与远程题库</h1></div></div><p v-if="error" class="warning" role="alert">{{ error }}</p><p v-if="notice" class="settings-success" role="status">{{ notice }}</p><p v-if="busy" role="status" class="operation-status">正在处理，请稍候…</p>
<div class="maintenance-update-grid">    <section class="card update-source-card" data-update-section="catalog">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Download :size="20" /></span>
        <div><h2>远程题库</h2></div>
      </div>
      <div class="field">
        <label for="android-catalog-url">远程题库目录 URL</label>
        <input id="android-catalog-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://github.com/.../question-bank-catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存目录地址</button>
      <button class="button secondary" type="button" :disabled="busy === 'banks' || busy === 'catalog-install'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
    </section>

    <section class="card update-source-card" data-update-section="update">
      <div class="update-source-heading">
        <span class="api-profile-icon"><PackageCheck :size="20" /></span>
        <div><h2>程序更新</h2></div>
      </div>
      <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
      <div v-if="appUpdate" class="update-result">
        <span>当前版本 {{ appUpdate.current_version }}</span>
        <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
        <small v-if="appUpdate.manifest?.apkSize">安装包 {{ formatFileSize(appUpdate.manifest.apkSize) }} · 下载后校验 SHA-256</small><p v-if="appUpdate.manifest?.releaseNotes">{{ appUpdate.manifest?.releaseNotes }}</p>
        <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
      </div>
    </section>

</div><section v-if="questionBankCatalog?.configured" class="card catalog-results">      <div v-if="questionBankCatalog?.configured" class="update-package-list">
        <div class="catalog-toolbar">
          <span>{{ questionBankCatalog.packages.length }} 个可用 · 已选 {{ selectedPackages.length }} 个</span>
          <div class="update-actions">
            <button class="button ghost compact" type="button" :disabled="busy === 'catalog-install'" @click="toggleAllPackages">{{ allPackagesSelected ? '清空选择' : '全选' }}</button>
            <button class="button compact" type="button" :disabled="busy === 'catalog-install' || !selectedPackages.length" @click="openCatalogDestination">
              <Download :size="15" />安装选中题库（{{ selectedPackages.length }}）
            </button>
          </div>
        </div>
        <label v-for="item in questionBankCatalog.packages" :key="packageKey(item)" class="catalog-item selection-option">
          <input v-model="selectedPackages" type="checkbox" :value="packageKey(item)" :disabled="busy === 'catalog-install'">
          <span>
            <strong>{{ item.title }}</strong>
            <small>版本 {{ item.contentVersion }} · {{ item.years.join('、') || '多年份' }} · {{ Math.ceil(item.size / 1024) }} KiB</small>
            <small>{{ item.license }}</small>
            <small v-if="packageResults[packageKey(item)]" :class="`catalog-${packageResults[packageKey(item)].status}`">{{ packageResults[packageKey(item)].message }}</small>
          </span>
        </label>
        <p v-if="!questionBankCatalog.packages.length" class="diagnostic-empty">远程目录当前没有可安装题库。</p>
      </div>
</section>  <div v-if="destinationOpen" class="destination-overlay" role="dialog" aria-modal="true" aria-labelledby="remote-destination-title" @keydown.esc="destinationOpen = false">
    <section class="destination-dialog">
      <h2 id="remote-destination-title">选择导入位置</h2>
      <div class="destination-list">
        <fieldset v-for="(target, index) in destinations" :key="packageKey(target.item)">
          <legend>{{ target.item.title }}</legend>
          <div class="destination-modes">
            <label><input v-model="target.mode" type="radio" :name="`destination-${index}`" value="new">新建题库</label>
            <label><input v-model="target.mode" type="radio" :name="`destination-${index}`" value="existing">已有题库</label>
          </div>
          <label v-if="target.mode === 'new'" class="field"><span>名称</span><input v-model="target.name" maxlength="80"></label>
          <label v-else class="field"><span>目标题库</span><select v-model.number="target.profileId"><option :value="0" disabled>请选择</option><option v-for="profile in questionBankProfilesState.items" :key="profile.id" :value="profile.id">{{ profile.name }}</option></select></label>
        </fieldset>
      </div>
      <p v-if="destinationError" role="alert" class="catalog-failed">{{ destinationError }}</p>
      <div class="catalog-actions"><button class="button secondary" type="button" @click="destinationOpen = false">取消</button><button class="button" type="button" @click="installSelectedPackages"><Download :size="17" />下载并预览</button></div>
    </section>
  </div>

</div></template>
<style scoped>
.maintenance-update-grid { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,2fr); gap:16px; align-items:start; }
.maintenance-update-grid > section { min-width:0; margin:0; }
.update-result p { overflow-wrap:anywhere; }
.catalog-results { margin-top:16px; }
@media(max-width:900px) { .maintenance-update-grid { grid-template-columns:minmax(0,1fr); } }
.update-source-heading > div { min-width: 0; }
.warning { overflow-wrap: anywhere; }
.destination-overlay { position:fixed; inset:0; z-index:1000; background:#0008; display:grid; place-items:center; padding:16px; }
.destination-dialog { width:min(100%, 560px); max-height:calc(100dvh - 32px); display:flex; flex-direction:column; gap:16px; background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:20px; min-width:0; }
.destination-dialog h2 { font-size:20px; margin:0; }
.destination-list { overflow:auto; min-height:0; }
.destination-list fieldset { min-width:0; margin:0 0 16px; padding:12px 0; border:0; border-bottom:1px solid var(--line); }
.destination-list legend { overflow-wrap:anywhere; max-width:100%; font-weight:600; }
.destination-modes { display:flex; flex-wrap:wrap; gap:16px; margin-bottom:12px; }
.destination-modes label { display:flex; align-items:center; gap:6px; }
.destination-dialog input, .destination-dialog select { max-width:100%; min-width:0; }
.destination-dialog .catalog-actions { flex-shrink:0; }
.catalog-toolbar, .catalog-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.catalog-item { display:flex; align-items:flex-start; gap:10px; padding:12px; border:1px solid var(--line); border-radius:8px; }
.catalog-item > span { display:grid; gap:4px; min-width:0; }
.catalog-item input { margin-top:3px; }
.catalog-success { color:var(--success); }
.catalog-failed { color:var(--danger); }
.catalog-pending { color:var(--muted); }
</style>

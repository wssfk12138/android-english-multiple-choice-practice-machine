<script setup lang="ts">
import LanQuestionBanks from '../components/LanQuestionBanks.vue'
import {
  ClipboardCopy,
  Download,
  FileWarning,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Save,
  Send,
  Trash2,
  Wifi,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { get, post, put } from '../api'
import { confirmDialog } from '../platform/dialogs'
import OptionSheet from '../components/OptionSheet.vue'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'
import {
  clearDiagnosticLogs,
  copyIssueReportTemplate,
  copyDiagnosticLogs,
  listDiagnosticLogs,
  shareDiagnosticLogs,
  type DiagnosticLogEntry,
} from '../platform/android/diagnostics'
import {
  copyLearningHistoryDiagnostics,
  shareLearningHistoryDiagnostics,
} from '../platform/android/learning-history-diagnostics'
import {
  databaseExportAvailable,
  exportDatabaseSnapshot,
  formatDatabaseSize,
  readDatabaseInfo,
  shareDatabaseSnapshot,
  type DatabaseExportResult,
  type DatabaseFileInfo,
} from '../platform/android/database-export'
import type { LanSyncQrPayload } from '../platform/android/lan-sync-qr'
import LanSyncScanner from '../components/LanSyncScanner.vue'
import { CATEGORY_LABELS, DEFAULT_CATEGORIES, type LanCategory } from '../platform/android/lan-categories'

const router = useRouter()
const route = useRoute()
const sectionRefs: Record<string, HTMLElement | null> = {}
const activeSection = computed(() => String(route.query.section || ''))
const settings = reactive({
  question_bank_catalog_url: '',
})
const lanSync = reactive({
  categories: [...DEFAULT_CATEGORIES],
  effectiveCategories: [] as LanCategory[],
  hostId: '',
  host: '',
  passcode: '',
  auto: true,
  configured: false,
  runtime: { running: false, online: true, lastSyncAt: '', lastError: '', errorCode: '', autoPaused: false, nextRetryAt: '' },
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)
const selectedPackages = ref<string[]>([])
const packageResults = ref<Record<string, { status: 'pending' | 'success' | 'failed', message: string }>>({})
const catalogDestinationOpen = ref(false)
const catalogDestinationMode = ref<'new_profile' | 'existing_profile'>('new_profile')
const catalogProfileNames = ref<Record<string, string>>({})
const catalogExistingProfileId = ref(0)
const catalogDestinationError = ref('')
const diagnosticLogs = ref<DiagnosticLogEntry[]>([])
const databaseInfo = ref<DatabaseFileInfo | null>(null)
const databaseExport = ref<DatabaseExportResult | null>(null)
const databaseChannelEnabled = ref(false)
const busy = ref('')
const notice = ref('')
const error = ref('')
const scannerOpen = ref(false)
const scannedPairing = ref<LanSyncQrPayload['pairing']>()
const packageKey = (item: any) => `${item.packageId}@${item.contentVersion}`
const allPackagesSelected = computed(() => Boolean(questionBankCatalog.value?.packages?.length)
  && questionBankCatalog.value.packages.every((item: any) => selectedPackages.value.includes(packageKey(item))))

const categoryLabels: Record<string, string> = {
  question_bank_import: '本地题库导入',
  remote_question_bank: '远程题库',
  app_update: '程序更新',
  startup: '启动准备',
}

async function refreshLogs() {
  diagnosticLogs.value = await listDiagnosticLogs()
}

async function load() {
  try {
    Object.assign(settings, await get('/android/updates/settings'))
    await loadQuestionBankProfiles()
  } catch (cause) {
    error.value = String(cause)
  }
  await refreshLogs()
  await refreshLanSync()
}

async function refreshLanSync() {
  try {
    const result: any = await get('/android/lan-sync/status')
    lanSync.host = String(result.host || '')
    lanSync.hostId = String(result.host_id || '')
    lanSync.categories = result.categories || [...DEFAULT_CATEGORIES]
    lanSync.effectiveCategories = result.effective_categories || []
    lanSync.auto = Boolean(result.auto)
    lanSync.configured = Boolean(result.configured)
    Object.assign(lanSync.runtime, result.runtime || {}, {
      lastSyncAt: result.runtime?.lastSyncAt || result.last_sync_at || '',
    })
  } catch (cause) {
    error.value = `读取局域网同步状态失败：${String(cause)}`
  }
}

async function saveLanSync() {
  busy.value = 'lan-sync-save'
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


async function save() {
  busy.value = 'save'; error.value = ''
  try {
    Object.assign(settings, await put('/android/updates/settings', settings))
    notice.value = '远程题库目录地址已保存'
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
    await refreshLogs()
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
    await refreshLogs()
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
    await refreshLogs()
  } finally {
    busy.value = ''
  }
}

function toggleAllPackages() {
  selectedPackages.value = allPackagesSelected.value
    ? []
    : (questionBankCatalog.value?.packages?.map(packageKey) || [])
}

function selectedCatalogPackages() {
  return (questionBankCatalog.value?.packages || [])
    .filter((item: any) => selectedPackages.value.includes(packageKey(item)))
}

function suggestedCatalogProfileName(item: any) {
  const source = String(item.title || item.fileName || item.packageId || '新题库')
  return source.replace(/\.esq$/i, '').trim().slice(0, 80) || '新题库'
}

function chooseCatalogImportDestination() {
  const selected = selectedCatalogPackages()
  if (!selected.length) return
  catalogDestinationMode.value = 'new_profile'
  catalogProfileNames.value = Object.fromEntries(
    selected.map((item: any) => [packageKey(item), suggestedCatalogProfileName(item)]),
  )
  catalogExistingProfileId.value = questionBankProfilesState.activeId
    || Number(questionBankProfilesState.items[0]?.id || 0)
  catalogDestinationError.value = ''
  catalogDestinationOpen.value = true
}

async function confirmCatalogImportDestination() {
  const selected = selectedCatalogPackages()
  if (!selected.length) {
    catalogDestinationOpen.value = false
    return
  }
  catalogDestinationError.value = ''
  if (catalogDestinationMode.value === 'new_profile') {
    const names: string[] = selected.map(
      (item: any) => String(catalogProfileNames.value[packageKey(item)] || '').trim(),
    )
    if (names.some(name => !name)) {
      catalogDestinationError.value = '请输入每个新题库配置的名称'
      return
    }
    const normalized = names.map(name => name.toLocaleLowerCase())
    if (new Set(normalized).size !== normalized.length) {
      catalogDestinationError.value = '所选题库的新配置名称不能重复'
      return
    }
    const existingNames = new Set(
      questionBankProfilesState.items.map(profile => String(profile.name).trim().toLocaleLowerCase()),
    )
    const duplicateIndex = normalized.findIndex(name => existingNames.has(name))
    if (duplicateIndex >= 0) {
      catalogDestinationError.value = `已经存在题库配置“${names[duplicateIndex]}”，请选择导入已有配置或修改名称。`
      return
    }
  } else if (!questionBankProfilesState.items.some(
    profile => Number(profile.id) === catalogExistingProfileId.value,
  )) {
    catalogDestinationError.value = '请选择要导入的已有题库配置'
    return
  }

  catalogDestinationOpen.value = false
  await installSelectedPackages(selected)
}

async function installSelectedPackages(selected: any[]) {
  busy.value = 'catalog-install'
  error.value = ''
  notice.value = ''
  packageResults.value = {}
  const importIds: number[] = []
  for (const item of selected) {
    const key = packageKey(item)
    packageResults.value[key] = { status: 'pending', message: '正在下载、校验并建立导入草稿' }
    try {
      let profileId = catalogExistingProfileId.value
      if (catalogDestinationMode.value === 'new_profile') {
        const created: any = await post('/question-bank-profiles', {
          name: catalogProfileNames.value[key],
        })
        profileId = Number(created.id)
        await loadQuestionBankProfiles()
      }
      const result: any = await post('/android/updates/question-banks/download', {
        package_id: item.packageId,
        content_version: item.contentVersion,
        profile_id: profileId,
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
  await refreshLogs()
  if (importIds.length) {
    await router.push({ path: '/imports', query: { esqImportId: String(importIds[0]) } })
  }
}

function formatLogTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

async function copyLogs() {
  error.value = ''
  try {
    const count = await copyDiagnosticLogs()
    notice.value = count ? `已复制 ${count} 条脱敏诊断日志` : '暂无可复制的诊断日志'
  } catch (cause) {
    error.value = `复制日志失败：${String(cause)}`
  }
}

async function shareLogs() {
  error.value = ''
  try {
    const count = await shareDiagnosticLogs()
    notice.value = count ? '已打开系统发送界面，请选择发送方式' : '暂无可发送的诊断日志'
  } catch (cause) {
    error.value = `导出日志失败：${String(cause)}`
  }
}

async function copyReportTemplate() {
  error.value = ''
  try {
    await copyIssueReportTemplate()
    notice.value = '问题报告模板已复制，请补充复现步骤后主动提交'
  } catch (cause) {
    error.value = `复制模板失败：${String(cause)}`
  }
}

async function copyHistoryDiagnostics() {
  error.value = ''
  try {
    await copyLearningHistoryDiagnostics()
    notice.value = '学习历史只读汇总诊断已复制'
  } catch (cause) {
    error.value = `复制学习历史诊断失败：${String(cause)}`
  }
}

async function shareHistoryDiagnostics() {
  error.value = ''
  try {
    await shareLearningHistoryDiagnostics()
    notice.value = '已打开系统发送界面，请选择发送方式'
  } catch (cause) {
    error.value = `导出学习历史诊断失败：${String(cause)}`
  }
}

async function refreshDatabaseInfo() {
  try {
    databaseInfo.value = await readDatabaseInfo()
  } catch (cause) {
    databaseInfo.value = null
    error.value = `读取应用数据库信息失败：${String(cause)}`
  }
}

async function exportDatabaseCopy() {
  error.value = ''
  busy.value = 'database-export'
  try {
    const result = await exportDatabaseSnapshot()
    databaseExport.value = result
    notice.value = `已导出数据库副本 ${result.fileName}（${formatDatabaseSize(result.size)}）`
  } catch (cause) {
    error.value = `导出应用数据库副本失败：${String(cause)}`
  } finally {
    busy.value = ''
  }
}

async function shareDatabaseCopy() {
  error.value = ''
  busy.value = 'database-share'
  try {
    await shareDatabaseSnapshot(databaseExport.value?.path)
    notice.value = '已打开系统发送界面，请选择发送方式'
  } catch (cause) {
    error.value = `分享应用数据库副本失败：${String(cause)}`
  } finally {
    busy.value = ''
  }
}

async function clearLogs() {
  if (!diagnosticLogs.value.length) return
  const confirmed = await confirmDialog({
    title: '清空全部本地诊断日志？',
    message: [
      `当前共 ${diagnosticLogs.value.length} 条脱敏诊断日志。`,
      '清空后无法恢复，不影响题库和学习数据。',
    ],
    confirmLabel: '清空日志',
    danger: true,
  })
  if (!confirmed) return
  await clearDiagnosticLogs()
  diagnosticLogs.value = []
  notice.value = '诊断日志已清空'
}

function setSectionRef(name: string) {
  return (element: unknown) => { sectionRefs[name] = (element as HTMLElement) || null }
}

onMounted(async () => {
  load()
  if (databaseExportAvailable()) {
    databaseChannelEnabled.value = true
    await refreshDatabaseInfo()
  }
  // 设置中枢的“设备同步/诊断日志”等入口通过 ?section= 直接定位到对应分区。
  const section = String(route.query.section || '')
  if (section) {
    await nextTick()
    sectionRefs[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})
</script>

<template>
  <LanSyncScanner v-if="scannerOpen" @scanned="scannedLanSync" @failed="error = $event" @closed="closeScanner" />
  <div class="page android-updates-page">
    <div class="page-head">
      <div class="page-title-row">
        <span class="page-title-icon page-title-icon-lucide"><Download :size="22" /></span>
        <h1>更新与远程题库</h1>
      </div>
    </div>
    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="notice" class="settings-success" role="status"><PackageCheck :size="17" />{{ notice }}</div>

    <section v-if="!activeSection || activeSection === 'sync'" :ref="setSectionRef('sync')" class="card update-source-card" data-update-section="sync">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Wifi :size="20" /></span>
        <div>
          <h2>设备同步</h2>
        </div>
      </div>
      <details class="sync-connection"><summary>连接</summary>
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
          <span v-if="scannedPairing || lanSync.hostId" class="lan-sync-host-id">HTTPS · {{ scannedPairing?.tls.hostId || lanSync.hostId }}</span>
        </div>
      </div>

        <label class="lan-sync-toggle selection-option">
          <input v-model="lanSync.auto" type="checkbox">
          <span class="lan-sync-toggle-copy"><strong>自动同步</strong><small>连接可用时按计划同步</small></span>
        </label>
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
        <button class="button" type="button" :disabled="busy === 'lan-sync-save'" @click="saveLanSync">
          <Save :size="16" />{{ busy === 'lan-sync-save' ? '保存并测试中…' : '保存并测试连接' }}
        </button>
        <button class="button secondary" type="button" :disabled="busy === 'lan-sync-run' || !lanSync.configured" @click="runLanSyncNow">
          <RefreshCw :size="16" />{{ busy === 'lan-sync-run' ? '同步中…' : '立即同步' }}
        </button>
      </div>
      <div class="lan-sync-status" aria-live="polite">
        <button class="button secondary" type="button" :disabled="Boolean(busy) || !lanSync.configured || lanSync.runtime.running" @click="sendModelConfiguration">
          <Send :size="16" />{{ busy === 'lan-models-send' ? '发送模型配置中…' : '以本机模型配置发送到电脑' }}
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

    <LanQuestionBanks v-if="!activeSection || activeSection === 'update'" :key="lanSync.hostId" />

    <details v-if="!activeSection || activeSection === 'update'" :open="route.query.section === 'catalog'" :ref="setSectionRef('catalog')" class="card update-source-card" data-update-section="catalog">
      <summary class="update-source-heading">
        <span class="api-profile-icon"><Download :size="20" /></span>
        <div><h2>远程题库</h2></div>
      </summary>
      <div class="field">
        <label for="android-catalog-url">远程题库目录 URL</label>
        <input id="android-catalog-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://github.com/.../question-bank-catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />{{ busy === 'save' ? '保存中…' : '保存目录地址' }}</button>
      <button class="button secondary" type="button" :disabled="busy === 'banks' || busy === 'catalog-install'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
      <div v-if="questionBankCatalog?.configured" class="update-package-list">
        <div class="catalog-toolbar">
          <span>{{ questionBankCatalog.packages.length }} 个可用 · 已选 {{ selectedPackages.length }} 个</span>
          <div class="update-actions">
            <button class="button ghost compact" type="button" :disabled="busy === 'catalog-install'" @click="toggleAllPackages">{{ allPackagesSelected ? '清空选择' : '全选' }}</button>
            <button class="button compact" type="button" :disabled="busy === 'catalog-install' || !selectedPackages.length" @click="chooseCatalogImportDestination">
              <Download :size="15" />{{ busy === 'catalog-install' ? '正在处理所选题库…' : `安装选中题库（${selectedPackages.length}）` }}
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
    </details>

    <details v-if="!activeSection || activeSection === 'update'" :open="route.query.section === 'update'" :ref="setSectionRef('update')" class="card update-source-card" data-update-section="update">
      <summary class="update-source-heading">
        <span class="api-profile-icon"><PackageCheck :size="20" /></span>
        <div><h2>程序更新</h2></div>
      </summary>
      <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
      <div v-if="appUpdate" class="update-result">
        <span>当前版本 {{ appUpdate.current_version }}</span>
        <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
        <p v-if="appUpdate.manifest.releaseNotes">{{ appUpdate.manifest.releaseNotes }}</p>
        <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
      </div>
    </details>

    <section v-if="!activeSection || activeSection === 'diagnostics'" :ref="setSectionRef('diagnostics')" class="card diagnostic-card" data-update-section="diagnostics">
      <div class="diagnostic-heading">
        <div class="update-source-heading">
          <span class="api-profile-icon"><FileWarning :size="20" /></span>
          <div><h2>诊断日志</h2></div>
        </div>
        <span class="pill">{{ diagnosticLogs.length }} 条</span>
      </div>
      <div class="diagnostic-actions">
        <button class="button secondary" type="button" @click="copyReportTemplate">
          <ClipboardCopy :size="16" />复制问题报告模板
        </button>
        <button class="button secondary" type="button" :disabled="!diagnosticLogs.length" @click="copyLogs">
          <ClipboardCopy :size="16" />复制日志
        </button>
        <button class="button" type="button" :disabled="!diagnosticLogs.length" @click="shareLogs">
          <Send :size="16" />分享诊断日志
        </button>
        <button class="button ghost diagnostic-clear" type="button" :disabled="!diagnosticLogs.length" @click="clearLogs">
          <Trash2 :size="16" />清空
        </button>
      </div>
      <div class="diagnostic-actions">
        <button class="button secondary" type="button" @click="copyHistoryDiagnostics">
          <ClipboardCopy :size="16" />复制学习历史只读诊断
        </button>
        <button class="button secondary" type="button" @click="shareHistoryDiagnostics">
          <Send :size="16" />分享学习历史
        </button>
      </div>
      <template v-if="databaseChannelEnabled">
        <div class="diagnostic-actions">
          <button class="button secondary" type="button" :disabled="busy === 'database-export'" @click="exportDatabaseCopy">
            <Save :size="16" />导出应用数据库副本
          </button>
          <button class="button" type="button" :disabled="!databaseExport || busy === 'database-share'" @click="shareDatabaseCopy">
            <Send :size="16" />分享数据库副本
          </button>
        </div>
        <p v-if="databaseInfo?.exists" class="diagnostic-meta">当前库 {{ databaseInfo.fileName }}，{{ formatDatabaseSize(databaseInfo.size || 0) }}，{{ databaseInfo.tableCount ?? 0 }} 张表，日志模式 {{ databaseInfo.journalMode }}。</p>
        <p v-else-if="databaseInfo" class="diagnostic-meta">未找到数据库文件（{{ databaseInfo.expectedFileName }}），请先在应用内打开一次题库。</p>
        <p v-if="databaseExport" class="diagnostic-meta">最近导出 {{ databaseExport.fileName }}（{{ formatDatabaseSize(databaseExport.size) }}，完整性 {{ databaseExport.integrityCheck }}，快照 {{ databaseExport.snapshot }}），路径 {{ databaseExport.path }}<span v-if="!databaseExport.adbReadable">，电脑读取被系统拒绝，请改用系统分享</span></p>
      </template>
      <div v-if="diagnosticLogs.length" class="diagnostic-list">
        <details v-for="item in diagnosticLogs" :key="`${item.createdAt}:${item.event}`">
          <summary>
            <span>
              <strong>{{ categoryLabels[item.module] || item.module }}</strong>
              <small>{{ formatLogTime(item.createdAt) }} · {{ item.event }}</small>
            </span>
            <span class="diagnostic-code">{{ item.errorCategory }}</span>
          </summary>
          <div class="diagnostic-detail">
            <p>{{ item.symptom }}</p>
            <dl>
              <dt>应用版本</dt><dd>{{ item.appVersion }}</dd>
              <dt>错误类别</dt><dd>{{ item.errorCategory }}</dd>
            </dl>
          </div>
        </details>
      </div>
      <div v-else class="diagnostic-empty">目前没有导入或更新错误。</div>
    </section>

    <div v-if="catalogDestinationOpen" class="review-overlay" role="dialog" aria-modal="true" aria-labelledby="catalog-destination-title">
      <div class="review-card import-assist-dialog catalog-destination-dialog">
        <h3 id="catalog-destination-title">选择远程题库导入位置</h3>
        <p class="lead">默认按每个题库包的名称创建独立配置，不会切换当前学习题库。</p>
        <label class="catalog-destination-choice">
          <input v-model="catalogDestinationMode" type="radio" value="new_profile">
          <span><b>按题库包名称创建新题库配置（推荐）</b><small>适合四级、考研等不同考试题库，避免误导入当前配置。</small></span>
        </label>
        <div v-if="catalogDestinationMode === 'new_profile'" class="catalog-profile-name-list">
          <label v-for="item in selectedCatalogPackages()" :key="packageKey(item)" class="field">
            <span>{{ item.title }}</span>
            <input v-model.trim="catalogProfileNames[packageKey(item)]" maxlength="80" aria-label="新题库配置名称">
          </label>
        </div>
        <label class="catalog-destination-choice">
          <input v-model="catalogDestinationMode" type="radio" value="existing_profile">
          <span><b>导入已有题库配置</b><small>所选远程包将导入同一个已有配置，请确认考试类型一致。</small></span>
        </label>
        <label v-if="catalogDestinationMode === 'existing_profile'" class="field">
          <span>已有题库配置</span>
          <OptionSheet v-model="catalogExistingProfileId" :items="questionBankProfilesState.items.map((profile: any) => ({ value: Number(profile.id), label: profile.name }))" title="选择已有题库配置" searchable />
        </label>
        <p v-if="catalogDestinationError" class="warning" role="alert">{{ catalogDestinationError }}</p>
        <div class="catalog-destination-actions">
          <button class="button ghost" type="button" @click="catalogDestinationOpen=false">取消</button>
          <button class="button" type="button" @click="confirmCatalogImportDestination">继续下载并导入</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lan-sync-work-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:16px; }
.lan-sync-operation-column { min-width:0; }
.sync-connection { margin-bottom:16px; }
@media(max-width:720px) { .lan-sync-work-grid { grid-template-columns:minmax(0,1fr); } }
.lan-sync-status > span, .lan-category-options span { min-width: 0; overflow-wrap: anywhere; }
.update-source-heading > div { min-width: 0; }
.lan-sync-connection-grid,.lan-sync-options-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; align-items:start; }
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
.diagnostic-meta { margin:10px 0 0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.catalog-destination-dialog { text-align: left; }
.catalog-destination-choice { display: flex; gap: 10px; align-items: flex-start; padding: 11px; border: 1px solid var(--line); border-radius: 12px; margin-top: 12px; }
.catalog-destination-choice input { margin-top: 4px; min-width: 20px; min-height: 20px; }
.catalog-destination-choice span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.catalog-destination-choice small { color: var(--muted); overflow-wrap: anywhere; }
.catalog-profile-name-list { display: grid; gap: 10px; margin: 12px 0; }
.catalog-destination-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
@media (max-width: 720px) {
  .lan-sync-connection-grid,.lan-sync-options-grid { grid-template-columns: minmax(0,1fr); }
  .lan-sync-options-grid { gap: 10px; }
}
</style>

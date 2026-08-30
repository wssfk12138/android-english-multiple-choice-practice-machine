<script setup lang="ts">
import {
  ClipboardCopy,
  Download,
  FileWarning,
  PackageCheck,
  RefreshCw,
  Save,
  Send,
  Server,
  Trash2,
} from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post, put } from '../api'
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

const router = useRouter()
const settings = reactive({
  question_bank_catalog_url: '',
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)
const selectedPackages = ref<string[]>([])
const packageResults = ref<Record<string, { status: 'pending' | 'success' | 'failed', message: string }>>({})
const diagnosticLogs = ref<DiagnosticLogEntry[]>([])
const busy = ref('')
const notice = ref('')
const error = ref('')
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
  } catch (cause) {
    error.value = String(cause)
  }
  await refreshLogs()
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

async function installSelectedPackages() {
  const selected = (questionBankCatalog.value?.packages || [])
    .filter((item: any) => selectedPackages.value.includes(packageKey(item)))
  if (!selected.length) return
  busy.value = 'catalog-install'
  error.value = ''
  notice.value = ''
  packageResults.value = {}
  const importIds: number[] = []
  for (const item of selected) {
    const key = packageKey(item)
    packageResults.value[key] = { status: 'pending', message: '正在下载、校验并建立导入草稿' }
    try {
      const result: any = await post('/android/updates/question-banks/download', {
        package_id: item.packageId,
        content_version: item.contentVersion,
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

function formatFileSize(value: unknown) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 1) return ''
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KiB`
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

async function copyReportTemplate() {
  error.value = ''
  try {
    await copyIssueReportTemplate()
    notice.value = '问题报告模板已复制，请补充复现步骤后主动提交'
  } catch (cause) {
    error.value = `复制模板失败：${String(cause)}`
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

async function clearLogs() {
  if (!diagnosticLogs.value.length || !confirm('确认清空全部本地诊断日志吗？')) return
  await clearDiagnosticLogs()
  diagnosticLogs.value = []
  notice.value = '诊断日志已清空'
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

onMounted(load)
</script>

<template>
  <div class="page android-updates-page">
    <div class="page-head">
      <div>
        <h1>更新与远程题库</h1>
        <p class="lead">程序更新和题库更新相互独立。APK 下载后会校验 SHA-256，并由 Android 系统确认安装。</p>
      </div>
    </div>
    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="notice" class="settings-success" role="status"><PackageCheck :size="17" />{{ notice }}</div>

    <section class="card update-source-card">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Server :size="20" /></span>
        <div><h2>远程题库</h2><p class="lead">程序更新通道由系统在后台自动选择；此处只配置可选的远程 ESQ 题库目录。</p></div>
      </div>
      <div class="field">
        <label for="bank-update-url">远程题库目录 URL（可留空）</label>
        <input id="bank-update-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://.../catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存题库地址</button>
    </section>

    <div class="grid grid-2 update-check-grid">
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><Download :size="20" /></span>
          <div><h2>程序更新</h2><p class="lead">系统会在后台自动选择可用更新通道。不会静默安装，最终安装操作由你在系统界面确认。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
        <div v-if="appUpdate" class="update-result">
          <span>当前版本 {{ appUpdate.current_version }}</span>
          <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
          <small v-if="appUpdate.manifest.apkSize">安装包 {{ formatFileSize(appUpdate.manifest.apkSize) }} · 下载后校验 SHA-256</small>
          <p v-if="appUpdate.manifest.releaseNotes">{{ appUpdate.manifest.releaseNotes }}</p>
          <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
        </div>
      </section>
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><PackageCheck :size="20" /></span>
          <div><h2>远程题库源</h2><p class="lead">下载后会校验文件大小和 SHA-256，再进入 ESQ 预览；不会自动覆盖已有年份。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'banks' || busy === 'catalog-install'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
        <div v-if="questionBankCatalog?.configured" class="update-package-list">
          <div class="catalog-toolbar">
            <span>{{ questionBankCatalog.packages.length }} 个可用 · 已选 {{ selectedPackages.length }} 个</span>
            <div class="catalog-actions">
              <button class="button ghost compact" type="button" :disabled="busy === 'catalog-install'" @click="toggleAllPackages">{{ allPackagesSelected ? '清空选择' : '全选' }}</button>
              <button class="button compact" type="button" :disabled="busy === 'catalog-install' || !selectedPackages.length" @click="installSelectedPackages">
                <Download :size="15" />{{ busy === 'catalog-install' ? '正在处理…' : `安装选中题库（${selectedPackages.length}）` }}
              </button>
            </div>
          </div>
          <label v-for="item in questionBankCatalog.packages" :key="packageKey(item)" class="catalog-item">
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
      </section>
    </div>

    <section class="card diagnostic-card">
      <div class="diagnostic-heading">
        <div class="update-source-heading">
          <span class="api-profile-icon"><FileWarning :size="20" /></span>
          <div>
            <h2>诊断日志</h2>
            <p class="lead">导入或更新失败时自动保存在本机。仅记录事件、模块、版本、时间、错误类别和短症状。</p>
          </div>
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
          <Send :size="16" />导出并系统分享
        </button>
        <button class="button ghost diagnostic-clear" type="button" :disabled="!diagnosticLogs.length" @click="clearLogs">
          <Trash2 :size="16" />清空
        </button>
      </div>
      <p class="diagnostic-privacy">诊断最多保留 50 条且导出包不超过约 1 MiB。不会后台上传，只有你点击复制、导出或系统分享时才会离开本机。</p>
      <div class="diagnostic-actions">
        <button class="button secondary" type="button" @click="copyHistoryDiagnostics">
          <ClipboardCopy :size="16" />复制学习历史只读诊断
        </button>
        <button class="button secondary" type="button" @click="shareHistoryDiagnostics">
          <Send :size="16" />导出并系统分享
        </button>
      </div>
      <p class="diagnostic-privacy">学习历史诊断只执行本地只读汇总，包含数量和完整性类别，不含学习记录、题库名、题目、答案、词汇或任何同步标识。</p>
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
  </div>
</template>

<style scoped>
.catalog-toolbar, .catalog-actions { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; }
.catalog-item { display:flex; align-items:flex-start; gap:10px; padding:12px; border:1px solid var(--line); border-radius:8px; }
.catalog-item > span { display:grid; gap:4px; min-width:0; }
.catalog-item input { margin-top:3px; }
.catalog-success { color:var(--success); }
.catalog-failed { color:var(--danger); }
.catalog-pending { color:var(--muted); }
</style>

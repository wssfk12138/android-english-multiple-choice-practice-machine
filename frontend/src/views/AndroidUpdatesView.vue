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
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post, put } from '../api'
import {
  clearDiagnosticLogs,
  copyDiagnosticLogs,
  listDiagnosticLogs,
  shareDiagnosticLogs,
  type DiagnosticLogEntry,
} from '../platform/android/diagnostics'

const router = useRouter()
const settings = reactive({
  app_update_manifest_url: '',
  question_bank_catalog_url: '',
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)
const diagnosticLogs = ref<DiagnosticLogEntry[]>([])
const busy = ref('')
const notice = ref('')
const error = ref('')

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
    notice.value = '更新地址已保存'
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

async function downloadBank(item: any) {
  busy.value = `bank:${item.packageId}`; error.value = ''
  try {
    const result: any = await post('/android/updates/question-banks/download', { package: item })
    notice.value = '题库下载和 SHA-256 校验已完成，正在打开导入预览'
    await router.push({ path: '/imports', query: { esqImportId: String(result.id) } })
  } catch (cause) {
    error.value = String(cause)
    await refreshLogs()
  } finally {
    busy.value = ''
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

async function clearLogs() {
  if (!diagnosticLogs.value.length || !confirm('确认清空全部本地诊断日志吗？')) return
  await clearDiagnosticLogs()
  diagnosticLogs.value = []
  notice.value = '诊断日志已清空'
}

onMounted(load)
</script>

<template>
  <div class="page android-updates-page">
    <div class="page-head">
      <div>
        <span class="eyebrow">ANDROID DELIVERY</span>
        <h1>更新与远程题库</h1>
        <p class="lead">程序更新和题库更新相互独立。APK 下载后会校验 SHA-256，并由 Android 系统确认安装。</p>
      </div>
    </div>
    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="notice" class="settings-success" role="status"><PackageCheck :size="17" />{{ notice }}</div>

    <section class="card update-source-card">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Server :size="20" /></span>
        <div><h2>更新源</h2><p class="lead">正式版建议使用 GitHub Releases 的 HTTPS 清单；局域网地址主要用于调试。</p></div>
      </div>
      <div class="field">
        <label for="app-update-url">程序更新清单 URL</label>
        <input id="app-update-url" v-model.trim="settings.app_update_manifest_url" inputmode="url" placeholder="https://.../update.json">
      </div>
      <div class="field">
        <label for="bank-update-url">远程题库目录 URL（可留空）</label>
        <input id="bank-update-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://.../catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存更新源</button>
    </section>

    <div class="grid grid-2 update-check-grid">
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><Download :size="20" /></span>
          <div><h2>程序更新</h2><p class="lead">不会静默安装，最终安装操作由你在系统界面确认。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
        <div v-if="appUpdate" class="update-result">
          <span>当前版本 {{ appUpdate.current_version }}</span>
          <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
          <p v-if="appUpdate.manifest.releaseNotes">{{ appUpdate.manifest.releaseNotes }}</p>
          <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
        </div>
      </section>
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><PackageCheck :size="20" /></span>
          <div><h2>远程题库源</h2><p class="lead">下载后会校验文件大小和 SHA-256，再进入 ESQ 预览；不会自动覆盖已有年份。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'banks'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
        <div v-if="questionBankCatalog?.configured" class="update-package-list">
          <div v-for="item in questionBankCatalog.packages" :key="`${item.packageId}:${item.contentVersion}`">
            <strong>{{ item.title }}</strong>
            <small>{{ item.contentVersion }} · {{ item.fileName }}</small>
            <button
              class="button compact"
              type="button"
              :disabled="busy === `bank:${item.packageId}`"
              @click="downloadBank(item)"
            ><Download :size="15" />{{ busy === `bank:${item.packageId}` ? '下载校验中…' : '下载并导入' }}</button>
          </div>
        </div>
      </section>
    </div>

    <section class="card diagnostic-card">
      <div class="diagnostic-heading">
        <div class="update-source-heading">
          <span class="api-profile-icon"><FileWarning :size="20" /></span>
          <div>
            <h2>诊断日志</h2>
            <p class="lead">导入或更新失败时自动保存在本机。发送前会过滤 API Key、题库与答案正文、学习记录和完整文件路径。</p>
          </div>
        </div>
        <span class="pill">{{ diagnosticLogs.length }} 条</span>
      </div>
      <div class="diagnostic-actions">
        <button class="button secondary" type="button" :disabled="!diagnosticLogs.length" @click="copyLogs">
          <ClipboardCopy :size="16" />复制日志
        </button>
        <button class="button" type="button" :disabled="!diagnosticLogs.length" @click="shareLogs">
          <Send :size="16" />导出并发送
        </button>
        <button class="button ghost diagnostic-clear" type="button" :disabled="!diagnosticLogs.length" @click="clearLogs">
          <Trash2 :size="16" />清空
        </button>
      </div>
      <p class="diagnostic-privacy">日志不会自动上传。只有点击“导出并发送”后，Android 才会打开系统分享界面，由你决定发送给谁。</p>
      <div v-if="diagnosticLogs.length" class="diagnostic-list">
        <details v-for="item in diagnosticLogs" :key="item.id">
          <summary>
            <span>
              <strong>{{ categoryLabels[item.category] || item.category }}</strong>
              <small>{{ formatLogTime(item.createdAt) }} · {{ item.stage }}</small>
            </span>
            <span class="diagnostic-code">{{ item.errorCode }}</span>
          </summary>
          <div class="diagnostic-detail">
            <p>{{ item.message }}</p>
            <dl>
              <template v-if="item.fileName"><dt>文件</dt><dd>{{ item.fileName }}<span v-if="item.fileSize"> · {{ Math.ceil(item.fileSize / 1024) }} KiB</span></dd></template>
              <dt>应用</dt><dd>{{ item.appVersion }}（{{ item.appVersionCode }}）</dd>
              <template v-if="item.deviceModel"><dt>设备</dt><dd>{{ item.deviceModel }} · Android {{ item.androidVersion }}</dd></template>
              <dt>技术信息</dt><dd>{{ item.technicalMessage }}</dd>
            </dl>
          </div>
        </details>
      </div>
      <div v-else class="diagnostic-empty">目前没有导入或更新错误。</div>
    </section>
  </div>
</template>

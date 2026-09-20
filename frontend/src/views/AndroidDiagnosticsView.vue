<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ArrowLeft, ClipboardCopy, FileWarning, Save, Send, Trash2 } from 'lucide-vue-next'
import { confirmDialog } from '../platform/dialogs'
const busy = ref('')
const notice = ref('')
const error = ref('')
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
const diagnosticLogs = ref<DiagnosticLogEntry[]>([])
const databaseInfo = ref<DatabaseFileInfo | null>(null)
const databaseExport = ref<DatabaseExportResult | null>(null)
const databaseChannelEnabled = ref(false)
const categoryLabels: Record<string, string> = {
  question_bank_import: '本地题库导入',
  remote_question_bank: '远程题库',
  app_update: '程序更新',
  startup: '启动准备',
}

async function refreshLogs() {
  diagnosticLogs.value = await listDiagnosticLogs()
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


onMounted(async () => {
  try {
    await refreshLogs()
    databaseChannelEnabled.value = databaseExportAvailable()
    if (databaseChannelEnabled.value) await refreshDatabaseInfo()
  } catch (cause) { error.value = String(cause) }
})

</script>
<template>
<div class="page android-updates-page"><div class="page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>诊断日志</h1></div></div><p v-if="error" class="warning" role="alert">{{ error }}</p><p v-if="notice" class="settings-success" role="status">{{ notice }}</p><p v-if="busy" role="status" class="operation-status">正在处理，请稍候…</p>
    <section class="card diagnostic-card" data-update-section="diagnostics">
      <div class="diagnostic-heading">
        <div class="update-source-heading">
          <span class="api-profile-icon"><FileWarning :size="20" /></span>
          <div><h2>诊断日志</h2></div>
        </div>
        <span class="pill">{{ diagnosticLogs.length }} 条</span>
      </div>
      <div class="diagnostic-layout-grid">
      <div class="diagnostic-group"><h3>常用操作</h3><div class="diagnostic-actions">
        <button class="button secondary" type="button" @click="copyReportTemplate">
          <ClipboardCopy :size="16" />复制问题报告模板
        </button>
        <button class="button secondary" type="button" :disabled="!diagnosticLogs.length" @click="copyLogs">
          <ClipboardCopy :size="16" />复制日志
        </button>
        <button class="button" type="button" :disabled="!diagnosticLogs.length" @click="shareLogs">
          <Send :size="16" />分享诊断日志
        </button>
      </div></div>
      <div class="diagnostic-group"><h3>学习历史与数据导出</h3><p class="muted">数据库副本包含题库、学习记录和聊天内容。仅在你点击分享并选择接收方后发送，请只交给可信任的人。</p><div class="diagnostic-actions">
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
      </template></div></div>
      <div class="diagnostic-heading"><h3>日志列表</h3><button class="button ghost diagnostic-clear" type="button" :disabled="!diagnosticLogs.length" @click="clearLogs"><Trash2 :size="16" />清空日志</button></div>
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


</div></template>
<style scoped>
.update-source-heading > div { min-width: 0; }
.warning { overflow-wrap: anywhere; }
.diagnostic-meta { margin:10px 0 0; color:var(--muted); font-size:12px; line-height:1.5; overflow-wrap:anywhere; }
.diagnostic-layout-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-bottom:16px; }
.diagnostic-group { min-width:0; }
.diagnostic-group h3 { margin:0 0 8px; font-size:14px; }
@media (max-width:720px) { .diagnostic-layout-grid { grid-template-columns:minmax(0,1fr); } }
</style>

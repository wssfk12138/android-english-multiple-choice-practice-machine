<script setup lang="ts">
import { Download, FileArchive, FileCheck2, FileUp, RefreshCw, Sparkles } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { api, get, post, put } from '../api'
import { platformRuntime } from '../platform/runtime'

const jobs = ref<any[]>([])
const current = ref<any>(null)
const selectedFile = ref<File | null>(null)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const aiInstructions = ref('')
const aiSuggestion = ref<any>(null)
const esqJobs = ref<any[]>([])
const esqCurrent = ref<any>(null)
const selectedEsqFile = ref<File | null>(null)
const esqResolutions = ref<Record<string, 'keep_existing' | 'replace_with_imported'>>({})
const supportsDocumentImport = !platformRuntime.isAndroid
const supportsQuestionBankExport = !platformRuntime.isAndroid

async function loadJobs() { jobs.value = await get('/imports') }
async function loadEsqJobs() { esqJobs.value = await get('/question-banks/imports') }
onMounted(() => Promise.all([loadJobs(), loadEsqJobs()]).catch(e => error.value = String(e)))

async function upload() {
  if (!selectedFile.value) return
  busy.value = true; error.value = ''
  const form = new FormData(); form.append('file', selectedFile.value)
  try {
    current.value = await api('/imports', { method: 'POST', body: form })
    await loadJobs()
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}

async function openJob(id: number) {
  current.value = await get(`/imports/${id}`)
  current.value.draft = current.value.draft_data
}

async function saveDraft() {
  const result: any = await put(`/imports/${current.value.id}`, { draft_data: current.value.draft, reason: '用户编辑' })
  current.value.draft = result.draft; notice.value = '草稿已保存'
}

async function askAi() {
  busy.value = true
  try {
    aiSuggestion.value = await post(`/ai/imports/${current.value.id}/suggest-correction`, { scope: 'all', instructions: aiInstructions.value })
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}

async function acceptAi() {
  if (aiSuggestion.value.requires_answer_confirmation) {
    const changes = aiSuggestion.value.answer_changes
      .map((change: any) => `第${change.number}题：${change.old} → ${change.new}`)
      .join('\n')
    const typed = prompt(`模型建议修改标准答案：\n${changes}\n\n答案修改会影响判分。若已逐项核对，请输入“确认修改答案”：`)
    if (typed !== '确认修改答案') return
  }
  current.value.draft = aiSuggestion.value.suggested_draft
  await saveDraft(); aiSuggestion.value = null
}

async function publish() {
  try {
    if (current.value.draft.warnings?.length) return
    if (!confirm(`确认发布 ${current.value.draft.year} 年题库吗？发布后模型不能直接修改正式题库。`)) return
    await post(`/imports/${current.value.id}/publish`)
    notice.value = '题库已正式发布'; await loadJobs(); await openJob(current.value.id)
  } catch (e) { error.value = String(e) }
}

async function uploadEsq() {
  if (!selectedEsqFile.value) return
  busy.value = true; error.value = ''
  const form = new FormData(); form.append('file', selectedEsqFile.value)
  try {
    const result: any = await api('/question-banks/imports', { method: 'POST', body: form })
    esqCurrent.value = await get(`/question-banks/imports/${result.id}`)
    esqResolutions.value = {}
    await loadEsqJobs()
    notice.value = 'ESQ 题库包已完成校验，请检查冲突后发布'
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}

async function openEsqJob(id: number) {
  esqCurrent.value = await get(`/question-banks/imports/${id}`)
  esqResolutions.value = {}
}

function conflictAction(paperKey: string, action: 'keep_existing' | 'replace_with_imported') {
  esqResolutions.value = { ...esqResolutions.value, [paperKey]: action }
}

async function publishEsq() {
  if (!esqCurrent.value) return
  const conflicts = esqCurrent.value.preview?.conflicts?.filter((item: any) => item.existing) || []
  const missing = conflicts.filter((item: any) => !esqResolutions.value[item.paperKey])
  if (missing.length) {
    error.value = `请先决定冲突题库的处理方式：${missing.map((item: any) => item.year).join('、')} 年`
    return
  }
  busy.value = true; error.value = ''
  try {
    const resolutions = Object.entries(esqResolutions.value).map(([paper_key, action]) => ({ paper_key, action }))
    await post(`/question-banks/imports/${esqCurrent.value.id}/publish`, {
      resolutions,
      import_ai_labels: true,
    })
    notice.value = 'ESQ 题库已发布'
    await loadEsqJobs()
    await openEsqJob(esqCurrent.value.id)
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}

async function exportEsq(includeLabels = false) {
  busy.value = true; error.value = ''
  try {
    const response = await fetch(`/api/question-banks/export?include_answers=true&include_labels=${includeLabels}`)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'english-practice-question-bank.esq'
    anchor.click()
    URL.revokeObjectURL(url)
    notice.value = '题库包已导出'
  } catch (e) { error.value = String(e) }
  finally { busy.value = false }
}
</script>

<template>
  <div class="page">
    <div class="page-head"><div><span class="eyebrow">IMPORT & REVIEW</span><h1>导入题库</h1><p class="lead">先生成草稿，检查文章、题目、选项和标准答案，再批准入库。</p></div></div>
    <div v-if="error" class="warning">{{ error }}</div><div v-if="notice" class="card" style="margin-bottom:16px;color:var(--success)">{{ notice }}</div>
    <div class="grid" style="grid-template-columns:320px 1fr">
      <aside>
        <div v-if="supportsDocumentImport" class="card">
          <label class="field"><span>选择 Word 真题</span><input type="file" accept=".doc,.docx" @change="selectedFile=($event.target as HTMLInputElement).files?.[0] || null"></label>
          <button class="button" style="width:100%" :disabled="!selectedFile || busy" @click="upload"><FileUp :size="16" />{{ busy ? '正在分析…' : '上传并解析' }}</button>
        </div>
        <div v-if="supportsQuestionBankExport" class="card">
          <label class="field"><span>导入 ESQ 共享题库</span><input type="file" accept=".esq,.zip" @change="selectedEsqFile=($event.target as HTMLInputElement).files?.[0] || null"></label>
          <button class="button secondary" style="width:100%" :disabled="!selectedEsqFile || busy" @click="uploadEsq"><FileArchive :size="16" />{{ busy ? '正在校验…' : '上传 ESQ 题库包' }}</button>
          <div class="lead" style="font-size:12px;margin-top:10px">题库包会先进入预览，不会自动覆盖本地题库。</div>
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center"><h3>题库包导出</h3><Download :size="18" /></div>
          <p class="lead" style="font-size:12px;margin:10px 0 14px">默认导出全部正式题库和标准答案，不包含做题记录、单词本和 API 配置。</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="button secondary compact" :disabled="busy" @click="exportEsq(false)"><Download :size="15" />导出题库</button>
            <button class="button ghost compact" :disabled="busy" @click="exportEsq(true)"><Sparkles :size="15" />含 AI 标签</button>
          </div>
        </div>
        <div v-if="esqJobs.length">
          <div class="section-title"><h3>ESQ 导入记录</h3><button class="button ghost compact" @click="loadEsqJobs"><RefreshCw :size="14" />刷新</button></div>
          <button v-for="job in esqJobs" :key="job.id" class="card" style="width:100%;text-align:left;margin-bottom:10px" @click="openEsqJob(job.id)">
            <strong>{{ job.detected_year || '多年份' }}</strong><div class="lead" style="font-size:12px;margin-top:5px">{{ job.filename }}</div>
          </button>
        </div>
        <div v-if="supportsDocumentImport" class="section-title"><h3>导入记录</h3></div>
        <button v-for="job in supportsDocumentImport ? jobs : []" :key="job.id" class="card" style="width:100%;text-align:left;margin-bottom:10px" @click="openJob(job.id)">
          <strong>{{ job.detected_year || '未知年份' }}</strong><div class="lead" style="font-size:12px;margin-top:5px">{{ job.filename }}</div>
        </button>
      </aside>
      <section v-if="esqCurrent?.preview" class="grid">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div><span class="pill">ESQ {{ esqCurrent.draft_data?.manifest?.schemaVersion || '1.0' }}</span><h2 style="margin-top:12px">{{ esqCurrent.preview.title }}</h2><p class="lead" style="font-size:12px;margin-top:7px">发布者：{{ esqCurrent.preview.publisher }} · {{ esqCurrent.preview.contentVersion }}</p></div>
            <button class="button" :disabled="busy" @click="publishEsq"><FileCheck2 :size="17" />发布题库包</button>
          </div>
          <div class="grid grid-4" style="margin-top:18px">
            <div class="stat-card card"><span class="stat-label">年份</span><strong>{{ esqCurrent.preview.totals.papers }}</strong></div>
            <div class="stat-card card"><span class="stat-label">篇目</span><strong>{{ esqCurrent.preview.totals.units }}</strong></div>
            <div class="stat-card card"><span class="stat-label">题目</span><strong>{{ esqCurrent.preview.totals.questions }}</strong></div>
            <div class="stat-card card"><span class="stat-label">资源</span><strong>{{ esqCurrent.preview.totals.assets }}</strong></div>
          </div>
        </div>
        <div class="card">
          <h3>冲突处理</h3>
          <p class="lead" style="font-size:12px;margin:8px 0 14px">本地已存在的年份必须明确选择，程序不会自动替换。</p>
          <div v-for="item in esqCurrent.preview.conflicts" :key="item.paperKey" class="api-model-row">
            <div><strong>{{ item.year }} 年</strong><div class="lead" style="font-size:12px">{{ item.title }}</div></div>
            <div v-if="item.existing" style="display:flex;gap:6px">
              <button class="button compact" :class="{secondary:esqResolutions[item.paperKey] !== 'replace_with_imported'}" @click="conflictAction(item.paperKey,'replace_with_imported')">替换</button>
              <button class="button compact" :class="{secondary:esqResolutions[item.paperKey] !== 'keep_existing'}" @click="conflictAction(item.paperKey,'keep_existing')">保留本地</button>
            </div>
            <span v-else class="pill">新增</span>
          </div>
        </div>
      </section>
      <section v-if="current?.draft" class="grid">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center"><div><span class="pill">{{ current.draft.detected_format }}</span><h2 style="margin-top:12px">{{ current.draft.title }}</h2><p class="lead" style="font-size:12px;margin-top:7px">标准答案来源：{{ current.draft.answer_source || 'Word 文档' }}</p></div><button class="button" :disabled="current.draft.warnings?.length" @click="publish"><FileCheck2 :size="17" />批准入库</button></div>
          <div v-for="warning in current.draft.warnings" class="warning" :key="warning">{{ warning }}</div>
        </div>
        <div class="card">
          <h3>模型辅助校正</h3><p class="lead">模型只生成建议；正式应用前由你确认，答案变化会特别提示。</p>
          <div class="field" style="margin-top:15px"><textarea rows="3" v-model="aiInstructions" placeholder="例如：重点检查跨页断行和2024年阅读选项归属"></textarea></div>
          <button class="button secondary" :disabled="busy" @click="askAi"><Sparkles :size="16" />生成校正建议</button>
          <div v-if="aiSuggestion" style="margin-top:17px">
            <div class="lead">{{ aiSuggestion.summary }}</div>
            <div v-for="change in aiSuggestion.answer_changes" :key="change.number" class="warning">第{{ change.number }}题答案：{{ change.old }} → {{ change.new }}。{{ change.reason }}</div>
            <button class="button" @click="acceptAi">接受建议并保存草稿</button>
          </div>
        </div>
        <div class="card">
          <h3>结构化草稿</h3><p class="lead" style="margin-bottom:15px">第一版提供完整 JSON 编辑，后续会换成逐字段可视化校对器。</p>
          <textarea v-model="current.draftText" v-if="false"></textarea>
          <textarea style="width:100%;min-height:600px;font:13px Consolas;line-height:1.55;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-solid);color:var(--ink)" :value="JSON.stringify(current.draft,null,2)" @change="current.draft=JSON.parse(($event.target as HTMLTextAreaElement).value)"></textarea>
          <button class="button" style="margin-top:14px" @click="saveDraft">保存人工校正</button>
        </div>
      </section>
      <div v-else class="card empty illustrated-empty">
        <img src="/assets/quiet-study-empty.webp" alt="" />
        <strong>等待一份新试卷</strong>
        <p>上传或选择一条导入记录后，在这里校对题库。</p>
      </div>
    </div>
  </div>
</template>

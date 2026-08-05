<script setup lang="ts">
import {
  Check, FileArchive, FileCheck2, FileKey2, FileUp, Lock, Pause,
  Play, RefreshCw, Save, Search, Settings, Sparkles, Trash2,
} from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, del, get, patch, post, put } from '../api'
import QuestionBankSwitcher from '../components/QuestionBankSwitcher.vue'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'
import {
  type LabelScope,
  loadQuestionLabelingStatus,
  pauseQuestionLabeling,
  questionLabelingState,
  startQuestionLabeling,
} from '../services/questionLabeling'

type LabelRow = {
  question_id: number; number: number; year: number; unit_title: string
  primary_skill: string; secondary_skills: string[]; trap_types: string[]
  attention_points: string[]; vocabulary_demand: 'low' | 'medium' | 'high'
  context_dependency: 'low' | 'medium' | 'high'; grammar_dependency: 'low' | 'medium' | 'high'
  confidence: number; locked: boolean; user_edited: boolean; model_name: string
}

const route = useRoute()
const router = useRouter()
const jobs = ref<any[]>([])
const current = ref<any>(null)
const selectedFile = ref<File | null>(null)
const selectedAnswerFile = ref<File | null>(null)
const useModelAssist = ref(true)
const modelAssistRewrite = ref(false)
const busy = ref(false)
const uploadStage = ref('')
const error = ref('')
const notice = ref('')
const expandedUnits = ref<Record<number, boolean>>({})
const esqJobs = ref<any[]>([])
const esqCurrent = ref<any>(null)
const selectedEsqFile = ref<File | null>(null)
const esqResolutions = ref<Record<string, 'keep_existing' | 'replace_with_imported'>>({})
const labelPromptOpen = ref(false)
const labelScope = ref<LabelScope | null>(null)
const overwriteUnlocked = ref(false)
const labelRows = ref<LabelRow[]>([])
const labelSearch = ref('')
const labelManagerOpen = ref(false)
const editingLabel = ref<LabelRow | null>(null)
const laterButton = ref<HTMLButtonElement | null>(null)
const modelSelectorOpen = ref(false)
const selectorModels = ref<any[]>([])
const selectedModelKey = ref('')
const targetProfileId = ref(0)

const questions = computed(() =>
  current.value?.draft?.units?.flatMap((unit: any) => unit.questions || []) || [],
)
const answerProgress = computed(() => ({
  completed: questions.value.filter((question: any) =>
    String(current.value?.draft?.answers?.[question.number] || '').trim(),
  ).length,
  total: questions.value.length,
}))

async function loadJobs() { jobs.value = await get('/imports') }
async function loadEsqJobs() { esqJobs.value = await get('/question-banks/imports') }

onMounted(async () => {
  try {
    await loadQuestionBankProfiles()
    targetProfileId.value = questionBankProfilesState.activeId
    await Promise.all([loadJobs(), loadEsqJobs()])
    const remoteId = Number(route.query.esqImportId || 0)
    if (remoteId) await openEsqJob(remoteId)
  } catch (cause) { error.value = String(cause) }
})

async function handleProfileChanged() {
  targetProfileId.value = questionBankProfilesState.activeId
  current.value = null
  esqCurrent.value = null
  await Promise.all([loadJobs(), loadEsqJobs()])
}

async function upload() {
  if (!selectedFile.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  uploadStage.value = useModelAssist.value ? '正在提取文档并调用模型校对…' : '正在提取文档并生成本地草稿…'
  const form = new FormData()
  form.append('file', selectedFile.value)
  form.append('profile_id', String(targetProfileId.value))
  if (selectedAnswerFile.value) form.append('answer_file', selectedAnswerFile.value)
  form.append('use_model_assist', String(useModelAssist.value))
  form.append('model_assist_correct_structure', String(modelAssistRewrite.value))
  try {
    const result: any = await api('/imports', { method: 'POST', body: form })
    await openJob(result.id)
    await loadJobs()
    notice.value = result.model_assist?.status === 'failed'
      ? '本地草稿已生成，但模型辅助不可用；可人工校对或选择其他模型重试。'
      : '结构化草稿已生成，请逐字段核对后批准入库。'
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false; uploadStage.value = '' }
}

async function openJob(id: number) {
  const result: any = await get(`/imports/${id}`)
  current.value = { ...result, draft: result.draft_data }
  expandedUnits.value = Object.fromEntries(
    (current.value.draft?.units || []).map((_: any, index: number) => [index, index === 0]),
  )
}

async function saveDraft(showNotice = true) {
  if (!current.value) return
  busy.value = true
  try {
    const result: any = await put(`/imports/${current.value.id}`, {
      draft_data: current.value.draft,
      reason: '用户逐字段校对',
    })
    current.value.draft = result.draft
    if (showNotice) notice.value = '草稿已保存并重新校验'
    await loadJobs()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

async function saveAnswers() {
  const answers = Object.fromEntries(
    questions.value.map((question: any) => [
      String(question.number),
      String(current.value.draft.answers?.[question.number] || '').toUpperCase(),
    ]),
  )
  busy.value = true
  try {
    const result: any = await patch(`/imports/${current.value.id}/answers`, { answers })
    current.value.draft = result.draft
    notice.value = `已确认 ${answerProgress.value.completed}/${answerProgress.value.total} 道答案`
    await loadJobs()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

async function retryModelAssist(profileId?: number, model?: string) {
  busy.value = true
  error.value = ''
  uploadStage.value = '模型正在重新核对完整试卷与答案…'
  try {
    const result: any = await post(`/imports/${current.value.id}/model-assist`, {
      profile_id: profileId,
      model,
      correct_structure: modelAssistRewrite.value,
    })
    current.value.draft = result.draft
    notice.value = '模型辅助结果已写入草稿，并标注为“模型辅助”来源'
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false; uploadStage.value = '' }
}

async function openModelSelector() {
  try {
    const result: any = await get('/ai/selector-models')
    selectorModels.value = result.models || []
    selectedModelKey.value = selectorModels.value[0]
      ? `${selectorModels.value[0].profile_id}::${selectorModels.value[0].model_id}` : ''
    modelSelectorOpen.value = true
  } catch (cause) { error.value = String(cause) }
}

async function retryWithSelectedModel() {
  const [profileId, ...modelParts] = selectedModelKey.value.split('::')
  if (!profileId || !modelParts.length) return
  modelSelectorOpen.value = false
  await retryModelAssist(Number(profileId), modelParts.join('::'))
}

async function publishDocument() {
  if (!current.value) return
  await saveDraft(false)
  if (current.value.draft.warnings?.length) {
    error.value = '仍有校验问题，请按警告逐项修正后再批准入库。'
    return
  }
  if (!confirm(`确认发布 ${current.value.draft.year} 年题库吗？`)) return
  busy.value = true
  try {
    const result: any = await post(`/imports/${current.value.id}/publish`)
    notice.value = `题库已入库，共 ${result.question_count} 道客观题`
    await Promise.all([loadJobs(), openJob(current.value.id)])
    await promptLabeling({
      kind: 'papers',
      title: result.scope_title || current.value.draft.title,
      year: null,
      paperIds: result.paper_ids || [],
    })
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

async function promptLabeling(scope: LabelScope) {
  labelScope.value = scope
  labelPromptOpen.value = true
  await loadQuestionLabelingStatus(scope)
  await nextTick()
  laterButton.value?.focus()
}

function beginLabeling() {
  if (!labelScope.value) return
  labelPromptOpen.value = false
  void startQuestionLabeling(labelScope.value, overwriteUnlocked.value)
}

function selectedLabelScope(): LabelScope {
  return labelScope.value || { kind: 'all', title: '全部题库', year: null, paperIds: [] }
}

async function loadLabels() {
  const scope = selectedLabelScope()
  const query = new URLSearchParams()
  if (scope.year !== null) query.set('year', String(scope.year))
  if (scope.paperIds.length) query.set('paper_ids', scope.paperIds.join(','))
  if (labelSearch.value.trim()) query.set('search', labelSearch.value.trim())
  query.set('limit', '120')
  labelRows.value = await get(`/ai/question-labels?${query}`)
  labelManagerOpen.value = true
}

function editLabel(row: LabelRow) {
  editingLabel.value = JSON.parse(JSON.stringify({ ...row, locked: true }))
}

function tags(value: string) {
  return value.split(/[，,；;\n]/).map(item => item.trim()).filter(Boolean)
}

async function saveLabel() {
  if (!editingLabel.value) return
  const row = editingLabel.value
  await put(`/ai/question-labels/${row.question_id}`, row)
  editingLabel.value = null
  await loadLabels()
  notice.value = `已人工校正并${row.locked ? '锁定' : '解锁'}该题标签`
}

async function uploadEsq() {
  if (!selectedEsqFile.value) return
  busy.value = true
  const form = new FormData()
  form.append('file', selectedEsqFile.value)
  form.append('profile_id', String(targetProfileId.value))
  try {
    const result: any = await api('/question-banks/imports', { method: 'POST', body: form })
    await openEsqJob(result.id)
    await loadEsqJobs()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}

async function openEsqJob(id: number) {
  esqCurrent.value = await get(`/question-banks/imports/${id}`)
  esqResolutions.value = {}
}

async function publishEsq() {
  const conflicts = esqCurrent.value?.preview?.conflicts?.filter((item: any) => item.existing) || []
  if (conflicts.some((item: any) => !esqResolutions.value[item.paperKey])) {
    error.value = '请先选择每个冲突年份的处理方式'
    return
  }
  const resolutions = Object.entries(esqResolutions.value)
    .map(([paper_key, action]) => ({ paper_key, action }))
  const result: any = await post(`/question-banks/imports/${esqCurrent.value.id}/publish`, { resolutions })
  notice.value = 'ESQ 题库包已发布'
  await loadEsqJobs()
  if (result.paper_ids?.length) {
    await promptLabeling({ kind: 'papers', title: esqCurrent.value.preview.title, year: null, paperIds: result.paper_ids })
  }
}

async function removeImportJob(job: any, esq = false) {
  if (!confirm(`将未完成导入“${job.filename}”及原始文件移入回收站？`)) return
  try {
    await del(`${esq ? '/question-banks/imports' : '/imports'}/${job.id}`)
    if (esq) {
      if (esqCurrent.value?.id === job.id) esqCurrent.value = null
      await loadEsqJobs()
    } else {
      if (current.value?.id === job.id) current.value = null
      await loadJobs()
    }
  } catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <div class="page import-page">
    <div class="page-head">
      <div>
        <span class="eyebrow">IMPORT & REVIEW</span>
        <h1>导入题库</h1>
        <p class="lead">Word/PDF 提取、模型辅助校对、逐字段审核、批准入库与智能标注在一个页面完成。</p>
      </div>
      <button class="button secondary" type="button" @click="promptLabeling({kind:'all',title:'全部题库',year:null,paperIds:[]})">
        <Sparkles :size="17" />智能标注中心
      </button>
    </div>
    <QuestionBankSwitcher @changed="handleProfileChanged" />

    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="notice" class="success-note" aria-live="polite">{{ notice }}</div>
    <div v-if="uploadStage" class="import-progress" role="status"><RefreshCw class="spin" :size="18" />{{ uploadStage }}</div>

    <section class="import-source-grid">
      <article class="card import-source-card">
        <div class="source-heading"><FileUp :size="22" /><div><h2>Word / PDF 辅助导入</h2><p>试卷支持 DOC、DOCX；答案支持 DOC、DOCX、文本型 PDF。</p></div></div>
        <label class="field">
          <span>导入到题库配置</span>
          <select v-model.number="targetProfileId">
            <option v-for="profile in questionBankProfilesState.items" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
          </select>
        </label>
        <label class="field"><span>试卷文件</span><input type="file" accept=".doc,.docx" @change="selectedFile=($event.target as HTMLInputElement).files?.[0]||null"></label>
        <label class="field"><span>答案文件（可选）</span><input type="file" accept=".doc,.docx,.pdf" @change="selectedAnswerFile=($event.target as HTMLInputElement).files?.[0]||null"></label>
        <label class="check-row"><input v-model="useModelAssist" type="checkbox"><span><b>上传时使用模型辅助定位题目与答案</b><small>默认全量核对；失败时保留本地草稿。</small></span></label>
        <label class="check-row"><input v-model="modelAssistRewrite" type="checkbox"><span><b>允许模型修正题干和选项归属</b><small>默认关闭，仅在材料能明确证明错位时修改。</small></span></label>
        <button class="button" type="button" :disabled="busy || !selectedFile" @click="upload">
          <Sparkles v-if="useModelAssist" :size="17" /><FileUp v-else :size="17" />{{ busy ? '正在处理…' : '生成结构化草稿' }}
        </button>
        <small>扫描版或水印严重且没有文字层的答案 PDF 会提示人工录入。</small>
      </article>

      <article class="card import-source-card">
        <div class="source-heading"><FileArchive :size="22" /><div><h2>ESQ 分享题库</h2><p>保留跨设备分享与远程题库更新能力。</p></div></div>
        <label class="field"><span>ESQ 文件</span><input type="file" accept=".esq" @change="selectedEsqFile=($event.target as HTMLInputElement).files?.[0]||null"></label>
        <button class="button secondary" type="button" :disabled="busy || !selectedEsqFile" @click="uploadEsq"><FileArchive :size="17" />校验题库包</button>
        <div class="history-mini">
          <div v-for="job in esqJobs.slice(0,4)" :key="job.id" style="display:flex;gap:6px">
            <button type="button" style="flex:1" @click="openEsqJob(job.id)">
              <span>{{ job.filename }}</span><small>{{ job.status }}</small>
            </button>
            <button v-if="job.status!=='published'" class="button ghost danger compact" type="button" @click="removeImportJob(job,true)"><Trash2 :size="14" /></button>
          </div>
        </div>
      </article>
    </section>

    <section v-if="esqCurrent" class="card review-card">
      <div class="review-head"><div><span class="pill">ESQ 1.0</span><h2>{{ esqCurrent.preview.title }}</h2><p>{{ esqCurrent.preview.totals.questions }} 道题 · {{ esqCurrent.preview.totals.units }} 篇</p></div><button class="button" @click="publishEsq"><FileCheck2 :size="17" />发布题库包</button></div>
      <div v-for="conflict in esqCurrent.preview.conflicts.filter((item:any)=>item.existing)" :key="conflict.paperKey" class="conflict-row">
        <b>{{ conflict.year }} 年已存在</b>
        <label><input v-model="esqResolutions[conflict.paperKey]" type="radio" value="keep_existing">保留现有</label>
        <label><input v-model="esqResolutions[conflict.paperKey]" type="radio" value="replace_with_imported">使用导入版替换</label>
      </div>
    </section>

    <section class="workspace-grid">
      <aside class="card history-panel">
        <div class="section-title"><h3>Word 导入记录</h3><RefreshCw :size="16" /></div>
        <div v-for="job in jobs" :key="job.id" style="display:flex;gap:6px">
          <button type="button" style="flex:1" :class="{active:current?.id===job.id}" @click="openJob(job.id)">
            <span><b>{{ job.detected_year || '待识别' }} 年</b>{{ job.filename }}</span>
            <small>{{ job.status === 'published' ? '已入库' : `${job.warnings?.length || 0} 项待处理` }}</small>
          </button>
          <button v-if="job.status!=='published'" class="button ghost danger compact" type="button" @click="removeImportJob(job)"><Trash2 :size="14" /></button>
        </div>
        <p v-if="!jobs.length" class="empty-copy">上传后会在这里保留草稿记录。</p>
      </aside>

      <main v-if="current?.draft" class="review-stack">
        <article class="card review-card">
          <div class="review-head">
            <div><span class="pill">{{ current.draft.detected_format }}</span><h2>{{ current.draft.title }}</h2><p>答案来源：{{ current.draft.answer_source }}</p></div>
            <button class="button" :disabled="busy || current.status==='published'" @click="publishDocument"><FileCheck2 :size="17" />批准入库</button>
          </div>
          <div class="draft-meta-grid">
            <label class="field"><span>年份</span><input v-model.number="current.draft.year" type="number"></label>
            <label class="field"><span>科目</span><input v-model="current.draft.subject"></label>
            <label class="field wide"><span>题库标题</span><input v-model="current.draft.title"></label>
          </div>
          <div v-if="current.draft.model_assist" class="assist-summary" :class="{failed:current.draft.model_assist.status==='failed'}">
            <Sparkles :size="18" />
            <span v-if="current.draft.model_assist.status==='failed'">模型辅助不可用：{{ current.draft.model_assist.error }}</span>
            <span v-else>模型 {{ current.draft.model_assist.model_name }} 已核对；写入 {{ current.draft.model_assist.applied_answers }} 个答案，修正 {{ current.draft.model_assist.applied_fixes }} 题。</span>
            <button class="button secondary" type="button" :disabled="busy" @click="retryModelAssist()">重新调用</button>
            <button class="button ghost" type="button" @click="openModelSelector"><Settings :size="15" />选择其他模型</button>
          </div>
          <div v-for="warning in current.draft.warnings" :key="warning" class="warning" role="alert">{{ warning }}</div>
          <div class="review-actions">
            <button class="button secondary" type="button" @click="saveDraft()"><Save :size="16" />保存草稿</button>
            <button class="button secondary" type="button" @click="saveAnswers"><FileKey2 :size="16" />确认答案 {{ answerProgress.completed }}/{{ answerProgress.total }}</button>
          </div>
        </article>

        <article v-for="(unit,unitIndex) in current.draft.units" :key="unitIndex" class="card unit-editor">
          <button class="unit-editor-head" type="button" @click="expandedUnits[unitIndex]=!expandedUnits[unitIndex]">
            <span><small>第 {{ unit.sequence }} 篇 · {{ unit.unit_type }}</small><b>{{ unit.title }}</b></span>
            <span>{{ unit.questions.length }} 题 · {{ expandedUnits[unitIndex] ? '收起' : '展开校对' }}</span>
          </button>
          <div v-if="expandedUnits[unitIndex]" class="unit-editor-body">
            <div class="draft-meta-grid">
              <label class="field"><span>篇目名称</span><input v-model="unit.title"></label>
              <label class="field"><span>题型</span><input v-model="unit.unit_type"></label>
            </div>
            <label class="field"><span>文章正文</span><textarea v-model="unit.passage" rows="10"></textarea></label>
            <section v-for="question in unit.questions" :key="question.number" class="question-editor">
              <div class="question-editor-head">
                <label class="compact-field"><span>题号</span><input v-model.number="question.number" type="number"></label>
                <label class="compact-field"><span>答案</span><select v-model="current.draft.answers[question.number]"><option value="">未填写</option><option v-for="option in question.options" :key="option.key" :value="option.key">{{ option.key }}</option></select></label>
              </div>
              <label class="field"><span>题干</span><textarea v-model="question.stem" rows="2"></textarea></label>
              <div class="option-editor-grid">
                <label v-for="option in question.options" :key="option.key" class="option-editor"><b>{{ option.key }}</b><textarea v-model="option.content" rows="2"></textarea></label>
              </div>
            </section>
          </div>
        </article>
      </main>
      <div v-else class="card empty-workspace"><FileUp :size="34" /><h2>选择导入记录开始校对</h2><p>逐字段编辑能直观看到文章、题干、选项与答案的归属。</p></div>
    </section>

    <section class="card label-center">
      <div class="review-head"><div><span class="eyebrow">AI LABELING</span><h2>题库智能标注</h2><p>{{ questionLabelingState.status?.labeled || 0 }} / {{ questionLabelingState.status?.total || 0 }} 道已完成</p></div><div class="review-actions"><button v-if="questionLabelingState.isRunning" class="button secondary" @click="pauseQuestionLabeling"><Pause :size="16" />当前篇后暂停</button><button v-else class="button" @click="promptLabeling(selectedLabelScope())"><Play :size="16" />开始标注</button><button class="button secondary" @click="loadLabels"><Search :size="16" />查看与人工校正</button></div></div>
      <div class="label-progress" role="progressbar" :aria-valuenow="questionLabelingState.status?.percentage||0" aria-valuemin="0" aria-valuemax="100"><span :style="{width:`${questionLabelingState.status?.percentage||0}%`}"></span></div>
      <p v-if="questionLabelingState.message">{{ questionLabelingState.message }}</p>
      <div v-if="questionLabelingState.error" class="warning" role="alert">{{ questionLabelingState.error }}</div>
      <div v-if="labelManagerOpen" class="label-list">
        <div class="label-search"><input v-model="labelSearch" placeholder="按年份、篇目、题号或考点搜索"><button class="button secondary" @click="loadLabels"><Search :size="15" />搜索</button></div>
        <button v-for="row in labelRows" :key="row.question_id" type="button" @click="editLabel(row)"><span><b>{{ row.year }} · {{ row.unit_title }} · 第 {{ row.number }} 题</b><small>{{ row.primary_skill || '尚未标注' }} · {{ row.model_name }}</small></span><Lock v-if="row.locked" :size="15" /></button>
      </div>
    </section>

    <section v-if="labelPromptOpen" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="label-prompt-title">
      <div class="card modal-card">
        <Sparkles :size="28" />
        <h2 id="label-prompt-title">立即智能标注本次题库吗？</h2>
        <p>模型会读取完整篇章、题干、选项和答案，生成考点与注意事项。此操作会消耗 API Token，可在当前篇完成后暂停。</p>
        <label class="check-row"><input v-model="overwriteUnlocked" type="checkbox"><span><b>覆盖未锁定的旧标签</b><small>人工锁定标签不会被覆盖。</small></span></label>
        <div class="review-actions"><button ref="laterButton" class="button secondary" @click="labelPromptOpen=false">稍后再说</button><button class="button" @click="beginLabeling"><Sparkles :size="16" />立即开始</button></div>
      </div>
    </section>

    <section v-if="editingLabel" class="modal-overlay" role="dialog" aria-modal="true">
      <div class="card modal-card label-editor-modal">
        <h2>人工校正 {{ editingLabel.year }} 年第 {{ editingLabel.number }} 题标签</h2>
        <label class="field"><span>主要考点</span><input v-model="editingLabel.primary_skill"></label>
        <label class="field"><span>次要考点</span><textarea :value="editingLabel.secondary_skills.join('，')" @input="editingLabel!.secondary_skills=tags(($event.target as HTMLTextAreaElement).value)"></textarea></label>
        <label class="field"><span>干扰项类型</span><textarea :value="editingLabel.trap_types.join('，')" @input="editingLabel!.trap_types=tags(($event.target as HTMLTextAreaElement).value)"></textarea></label>
        <label class="field"><span>注意事项</span><textarea :value="editingLabel.attention_points.join('，')" @input="editingLabel!.attention_points=tags(($event.target as HTMLTextAreaElement).value)"></textarea></label>
        <div class="draft-meta-grid">
          <label class="field"><span>词汇要求</span><select v-model="editingLabel.vocabulary_demand"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label class="field"><span>上下文依赖</span><select v-model="editingLabel.context_dependency"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label class="field"><span>语法依赖</span><select v-model="editingLabel.grammar_dependency"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        </div>
        <label class="check-row"><input v-model="editingLabel.locked" type="checkbox"><span><b>锁定人工校正结果</b><small>后续批量标注不会覆盖。</small></span></label>
        <div class="review-actions"><button class="button secondary" @click="editingLabel=null">取消</button><button class="button" @click="saveLabel"><Check :size="16" />保存并锁定</button></div>
      </div>
    </section>

    <section v-if="modelSelectorOpen" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="model-selector-title">
      <div class="card modal-card">
        <h2 id="model-selector-title">选择其他模型重新校对</h2>
        <p>将重新向所选模型提供完整试卷、答案附件和当前草稿。本地解析结果会保留到模型成功返回为止。</p>
        <label class="field"><span>可用模型</span>
          <select v-model="selectedModelKey">
            <option v-for="item in selectorModels" :key="`${item.profile_id}:${item.model_id}`" :value="`${item.profile_id}::${item.model_id}`">
              {{ item.profile_name }} / {{ item.display_name || item.model_id }}
            </option>
          </select>
        </label>
        <div v-if="!selectorModels.length" class="warning" role="alert">当前没有可用模型，请先到模型与设置中启用配置并刷新模型列表。</div>
        <div class="review-actions">
          <button class="button secondary" @click="modelSelectorOpen=false">取消</button>
          <button class="button ghost" @click="modelSelectorOpen=false;router.push('/settings')"><Settings :size="15" />模型与设置</button>
          <button class="button" :disabled="!selectedModelKey" @click="retryWithSelectedModel"><Sparkles :size="16" />重新校对</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.import-page{padding-bottom:48px}.import-source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:18px}.import-source-card{display:flex;flex-direction:column;gap:14px}.source-heading,.review-head,.review-actions,.question-editor-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.source-heading{justify-content:flex-start;align-items:flex-start}.source-heading h2,.review-head h2{margin:0}.source-heading p,.review-head p{margin:4px 0 0;color:var(--muted)}.field{display:flex;flex-direction:column;gap:7px}.field span,.compact-field span{font-size:12px;color:var(--muted);font-weight:700}.field input,.field textarea,.field select,.compact-field input,.compact-field select,.label-search input{width:100%;border:1px solid var(--line);border-radius:10px;background:var(--surface-solid);color:var(--ink);padding:11px 12px;font:inherit}.check-row{display:flex;gap:10px;align-items:flex-start;padding:11px;border:1px solid var(--line);border-radius:12px}.check-row input{margin-top:4px;min-width:20px;min-height:20px}.check-row span{display:flex;flex-direction:column;gap:3px}.check-row small{color:var(--muted)}.history-mini,.history-panel,.label-list{display:flex;flex-direction:column;gap:8px}.history-mini button,.history-panel>button,.label-list>button{min-height:48px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-solid);color:var(--ink);display:flex;justify-content:space-between;text-align:left}.history-mini span,.history-panel span,.label-list span{display:flex;flex-direction:column;gap:3px}.history-mini small,.history-panel small,.label-list small{color:var(--muted)}.workspace-grid{display:grid;grid-template-columns:240px minmax(0,1fr);gap:18px;align-items:start}.history-panel{position:sticky;top:18px}.history-panel>button.active{border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 18%,transparent)}.review-stack{display:flex;flex-direction:column;gap:16px}.review-card,.unit-editor{overflow:hidden}.draft-meta-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0}.draft-meta-grid .wide{grid-column:span 2}.assist-summary,.import-progress,.success-note{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;margin:12px 0;background:color-mix(in srgb,var(--accent) 12%,var(--surface-solid));color:var(--ink)}.assist-summary.failed{background:color-mix(in srgb,var(--danger) 10%,var(--surface-solid))}.assist-summary span{flex:1}.unit-editor-head{width:100%;min-height:64px;padding:14px 16px;border:0;background:transparent;color:var(--ink);display:flex;justify-content:space-between;text-align:left}.unit-editor-head span:first-child{display:flex;flex-direction:column;gap:4px}.unit-editor-head small{color:var(--muted)}.unit-editor-body{border-top:1px solid var(--line);padding:16px}.question-editor{padding:16px 0;border-top:1px solid var(--line)}.compact-field{display:flex;align-items:center;gap:7px}.compact-field input,.compact-field select{width:90px}.option-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.option-editor{display:grid;grid-template-columns:28px 1fr;gap:8px;align-items:start}.option-editor b{width:28px;height:28px;border-radius:8px;background:var(--accent-soft);display:grid;place-items:center}.option-editor textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--surface-solid);color:var(--ink);font:inherit}.empty-workspace{text-align:center;padding:52px 24px}.label-center{margin-top:18px}.label-progress{height:9px;border-radius:999px;background:var(--line);overflow:hidden;margin:16px 0}.label-progress span{display:block;height:100%;background:var(--accent);transition:width .2s}.label-search{display:flex;gap:8px}.label-search input{flex:1}.modal-overlay{position:fixed;inset:0;z-index:1000;background:rgba(12,20,17,.55);display:grid;place-items:center;padding:24px}.modal-card{width:min(620px,100%);max-height:90vh;overflow:auto}.label-editor-modal{display:flex;flex-direction:column;gap:13px}.conflict-row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--line)}.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:900px){.import-source-grid,.workspace-grid{grid-template-columns:1fr}.history-panel{position:static}.draft-meta-grid,.option-editor-grid{grid-template-columns:1fr}.draft-meta-grid .wide{grid-column:auto}.review-head{align-items:flex-start;flex-direction:column}}@media(prefers-reduced-motion:reduce){.spin{animation:none}.label-progress span{transition:none}}
</style>

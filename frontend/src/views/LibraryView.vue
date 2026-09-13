<script setup lang="ts">
import { BookOpen, CheckSquare, MoveRight, Play, Trash2, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { del, get, post } from '../api'
import { confirmDialog } from '../platform/dialogs'
import { platformRuntime } from '../platform/runtime'
import OptionSheet from '../components/OptionSheet.vue'
import QuestionBankSwitcher from '../components/QuestionBankSwitcher.vue'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'

const router = useRouter()
const papers = ref<any[]>([])
const error = ref('')
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const moveDialogOpen = ref(false)
const moveTargetId = ref<number>(0)
let holdTimer: number | null = null
const emptyHint = platformRuntime.isAndroid
  ? '请先到“导入题库”选择 ESQ 题库包。'
  : '请先到“导入题库”上传 Word 真题。'

const moveTargets = () => questionBankProfilesState.items.filter(
  item => Number(item.id) !== questionBankProfilesState.activeId,
)

async function loadPapers() {
  selectedIds.value = new Set()
  try { papers.value = await get('/papers') } catch (e) { error.value = String(e) }
}

onMounted(async () => {
  await Promise.all([loadPapers(), loadQuestionBankProfiles()])
})

async function startPaper(id: number) {
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'paper', paper_id: id, shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (e) { error.value = String(e) }
}

async function restartPaper(id: number) {
  const confirmed = await confirmDialog({
    title: '重新开始这套试卷？',
    message: [
      '重新开始会作废上一次未完成的练习进度。',
      '已提交判分的历史成绩保留不变。',
    ],
    confirmLabel: '重新开始',
  })
  if (!confirmed) return
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'paper', paper_id: id, shuffle_options: true, force_new: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (e) { error.value = String(e) }
}

function scoreText(paper: any) {
  const fmt = (value: number) => (Number.isFinite(value) && Number.isInteger(value) ? String(value) : value.toFixed(1))
  return `${fmt(Number(paper.last_score) || 0)}/${fmt(Number(paper.last_max_score) || 0)}`
}

function togglePaper(id: number) {
  if (!batchMode.value) return
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}

function beginHold(id: number) {
  if (holdTimer !== null) window.clearTimeout(holdTimer)
  holdTimer = window.setTimeout(() => {
    batchMode.value = true
    togglePaper(id)
  }, 520)
}

function cancelHold() {
  if (holdTimer !== null) window.clearTimeout(holdTimer)
  holdTimer = null
}

function leaveBatch() {
  batchMode.value = false
  selectedIds.value = new Set()
}

async function moveSelected() {
  const targets = moveTargets()
  if (!targets.length) {
    error.value = '请先新建另一个题库配置'
    return
  }
  moveTargetId.value = Number(targets[0].id)
  moveDialogOpen.value = true
}

async function confirmMoveSelected() {
  const targetId = Number(moveTargetId.value)
  if (!moveTargets().some(item => Number(item.id) === targetId)) return
  moveDialogOpen.value = false
  try {
    await post('/papers/batch-move', {
      paper_ids: [...selectedIds.value],
      target_profile_id: targetId,
    })
    leaveBatch()
    await loadPapers()
  } catch (cause) { error.value = String(cause) }
}

async function deleteSelected() {
  if (!selectedIds.value.size) return
  const confirmed = await confirmDialog({
    title: `将选中的 ${selectedIds.value.size} 套试卷移入回收站？`,
    message: [
      '移动后这些试卷不再出现在当前题库练习列表。',
      '内容将在回收站保留七天，期间可以恢复。',
    ],
    confirmLabel: '移入回收站',
    danger: true,
  })
  if (!confirmed) return
  try {
    for (const id of selectedIds.value) await del(`/papers/${id}`)
    leaveBatch()
    await loadPapers()
  } catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <div class="page">
    <div class="page-head"><div><h1>按年份练习</h1></div></div>
    <QuestionBankSwitcher :show-library-link="true" class="library-bank-switcher" @changed="loadPapers">
      <template #actions>
        <span v-if="batchMode" class="bank-batch-status">已选 {{ selectedIds.size }} 套</span>
        <button v-if="!batchMode" class="button secondary compact" type="button" @click="batchMode=true"><CheckSquare :size="16" />批量管理</button>
        <template v-else>
          <button class="button secondary compact" type="button" :disabled="!selectedIds.size" @click="moveSelected"><MoveRight :size="16" />移动</button>
          <button class="button ghost danger compact" type="button" :disabled="!selectedIds.size" @click="deleteSelected"><Trash2 :size="16" />移入回收站</button>
          <button class="button ghost compact" type="button" @click="leaveBatch"><X :size="16" />取消</button>
        </template>
      </template>
    </QuestionBankSwitcher>
    <div v-if="error" class="warning">{{ error }}</div>
    <div v-if="papers.length" class="grid grid-3">
      <article
        class="card paper-card selectable"
        :class="{ selected: selectedIds.has(paper.id) }"
        v-for="paper in papers"
        :key="paper.id"
        @pointerdown="beginHold(paper.id)"
        @pointerup="cancelHold"
        @pointerleave="cancelHold"
        @click="togglePaper(paper.id)"
      >
        <label v-if="batchMode" class="selection-option" @click.stop @pointerdown.stop><input type="checkbox" :checked="selectedIds.has(paper.id)" aria-label="选择题库" @change="togglePaper(paper.id)"><span>选择题库</span></label>
        <div class="paper-card-head"><span v-if="paper.active_session_id" class="pill">进行中 · 已做 {{ paper.active_done }}/{{ paper.unit_count }} 篇</span><span v-else-if="paper.last_score != null" class="pill">{{ scoreText(paper) }}</span><span v-else></span><BookOpen :size="20" /></div>
        <h3>{{ paper.title }}</h3>
        <p class="lead">{{ paper.subject }} · {{ paper.unit_count }}篇 · {{ paper.question_count }}题</p>
        <div class="paper-actions">
          <button class="button paper-primary-action" :disabled="paper.status !== 'published' || batchMode" @click.stop="startPaper(paper.id)"><Play :size="16" />{{ paper.active_session_id ? '继续练习' : '开始整卷' }}</button>
          <button v-if="paper.active_session_id" class="button ghost paper-restart-action" :disabled="batchMode" @click.stop="restartPaper(paper.id)">重新开始</button>
        </div>
      </article>
    </div>
    <div v-else class="card empty illustrated-empty">
      <img src="/assets/quiet-study-empty.webp" alt="" />
      <strong>题库还是空的</strong>
      <p>{{ emptyHint }}</p>
    </div>

    <section v-if="moveDialogOpen" class="app-overlay" role="presentation" @click.self="moveDialogOpen=false">
      <div class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="move-dialog-title">
        <header class="app-dialog-head"><h2 id="move-dialog-title">移动到哪个题库配置？</h2></header>
        <div class="app-dialog-body">
          <p>将选中的 {{ selectedIds.size }} 套试卷移动到目标配置；移动后可在该配置下继续练习。</p>
          <OptionSheet v-model="moveTargetId" :items="moveTargets().map(item => ({ value: Number(item.id), label: item.name }))" title="选择目标题库配置" />
        </div>
        <footer class="app-dialog-actions">
          <button class="button secondary" type="button" @click="moveDialogOpen=false">取消</button>
          <button class="button" type="button" @click="confirmMoveSelected">移动</button>
        </footer>
      </div>
    </section>
  </div>
</template>

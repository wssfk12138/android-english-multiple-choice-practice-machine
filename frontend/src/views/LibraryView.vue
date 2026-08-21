<script setup lang="ts">
import { BookOpen, CheckSquare, MoveRight, Play, Trash2, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { del, get, post } from '../api'
import { platformRuntime } from '../platform/runtime'
import QuestionBankSwitcher from '../components/QuestionBankSwitcher.vue'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'

const router = useRouter()
const papers = ref<any[]>([])
const error = ref('')
const batchMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
let holdTimer: number | null = null
const emptyHint = platformRuntime.isAndroid
  ? '请先到“导入题库”选择 ESQ 题库包。'
  : '请先到“导入题库”上传 Word 真题。'

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
  if (!window.confirm('重新开始会作废上一次未完成的练习，确定吗？')) return
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
  const targets = questionBankProfilesState.items.filter(
    item => Number(item.id) !== questionBankProfilesState.activeId,
  )
  if (!targets.length) {
    error.value = '请先新建另一个题库配置'
    return
  }
  const answer = window.prompt(
    `输入目标题库配置编号：\n${targets.map(item => `${item.id}：${item.name}`).join('\n')}`,
    String(targets[0].id),
  )
  const targetId = Number(answer)
  if (!targets.some(item => Number(item.id) === targetId)) return
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
  if (!window.confirm(`将选中的 ${selectedIds.value.size} 套试卷移入回收站？`)) return
  try {
    for (const id of selectedIds.value) await del(`/papers/${id}`)
    leaveBatch()
    await loadPapers()
  } catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <div class="page">
    <div class="page-head"><div><span class="eyebrow">QUESTION LIBRARY</span><h1>按年份练习</h1><p class="lead">完成整年45道客观题后统一判分，中途自动保存。</p></div></div>
    <QuestionBankSwitcher @changed="loadPapers" />
    <div class="batch-toolbar">
      <span class="lead">{{ batchMode ? `已选择 ${selectedIds.size} 套试卷` : '长按试卷或点击“批量管理”可移动、删除多套试卷。' }}</span>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        <button v-if="!batchMode" class="button secondary compact" type="button" @click="batchMode=true"><CheckSquare :size="16" />批量管理</button>
        <template v-else>
          <button class="button secondary compact" type="button" :disabled="!selectedIds.size" @click="moveSelected"><MoveRight :size="16" />移动</button>
          <button class="button ghost danger compact" type="button" :disabled="!selectedIds.size" @click="deleteSelected"><Trash2 :size="16" />移入回收站</button>
          <button class="button ghost compact" type="button" @click="leaveBatch"><X :size="16" />取消</button>
        </template>
      </span>
    </div>
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
        <div class="paper-card-head"><span v-if="paper.active_session_id" class="pill">进行中 · 已做 {{ paper.active_done }}/{{ paper.unit_count }} 篇</span><span v-else-if="paper.last_score != null" class="pill">{{ scoreText(paper) }}</span><span v-else></span><BookOpen :size="20" /></div>
        <h3>{{ paper.title }}</h3>
        <p class="lead">{{ paper.subject }} · {{ paper.unit_count }}篇 · {{ paper.question_count }}题</p>
        <div class="paper-actions">
  <button class="button" style="flex:1" :disabled="paper.status !== 'published' || batchMode" @click.stop="startPaper(paper.id)"><Play :size="16" />{{ paper.active_session_id ? '继续练习' : '开始整卷' }}</button>
  <button v-if="paper.active_session_id" class="button ghost" :disabled="batchMode" @click.stop="restartPaper(paper.id)">重新开始</button>
</div>
      </article>
    </div>
    <div v-else class="card empty illustrated-empty">
      <img src="/assets/quiet-study-empty.webp" alt="" />
      <strong>题库还是空的</strong>
      <p>{{ emptyHint }}</p>
    </div>
  </div>
</template>

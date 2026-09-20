<script setup lang="ts">
import { ArrowRight, BookOpen, ListChecks, Play, RotateCcw } from 'lucide-vue-next'

type StudyTodos = { profile_id: number; resume_session: { id: number; mode: string; title: string } | null; review_count: number; frequent_count: number }
defineProps<{ tasks: StudyTodos | null; failed?: boolean }>()
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <section class="study-todos" aria-labelledby="study-todos-title">
    <div class="todos-heading"><h1 id="study-todos-title">学习待办</h1></div>
    <div v-if="failed" class="todos-status" role="status">学习待办暂时无法加载<button class="button ghost compact" type="button" @click="emit('retry')"><RotateCcw :size="15" />重试</button></div>
    <div v-else-if="!tasks" class="todos-status" role="status">正在加载学习待办…</div>
    <div v-else class="todos-grid" :class="{ 'has-resume': tasks.resume_session }">
      <RouterLink v-if="tasks.resume_session" :to="`/practice/${tasks.resume_session.id}`" class="todo-item resume-task"><Play :size="20" /><span class="todo-copy"><strong>继续练习</strong><span>{{ tasks.resume_session.title || '未完成练习' }}</span></span><ArrowRight :size="18" /></RouterLink>
      <RouterLink to="/vocabulary?review=scheduled&scope=current" class="todo-item"><BookOpen :size="20" /><span class="todo-copy"><strong>待复习词汇 <b>{{ tasks.review_count }}</b></strong><span>{{ tasks.review_count ? '开始复习' : '暂无到期词汇' }}</span></span><ArrowRight :size="18" /></RouterLink>
      <RouterLink to="/wrong?view=frequent" class="todo-item"><ListChecks :size="20" /><span class="todo-copy"><strong>高频错题 <b>{{ tasks.frequent_count }}</b></strong><span>{{ tasks.frequent_count ? '查看错题' : '暂无高频错题' }}</span></span><ArrowRight :size="18" /></RouterLink>
    </div>
  </section>
</template>

<style scoped>
.study-todos{display:grid;gap:12px;padding:0;background:none}.todos-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.todos-heading h1{margin:0;font-size:1.35rem;line-height:1.4;letter-spacing:0}.todos-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.todos-grid.has-resume{grid-template-columns:repeat(3,minmax(0,1fr))}.todo-item{display:flex;align-items:center;gap:12px;min-width:0;min-height:84px;padding:16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);text-decoration:none}.todo-item:hover{border-color:var(--primary)}.todo-item>svg{flex-shrink:0;color:var(--primary)}.todo-item>svg:last-child{margin-left:auto}.todo-copy{display:grid;gap:6px;min-width:0}.todo-copy strong{font-size:1rem;line-height:1.5;overflow-wrap:anywhere}.todo-copy b{font-size:1.15rem;margin-left:6px;color:var(--primary)}.todo-copy>span{font-size:.85rem;line-height:1.5;color:var(--muted);overflow-wrap:anywhere}.todos-status{display:flex;align-items:center;gap:12px;min-height:84px;color:var(--muted)}@media(max-width:760px){.todos-grid.has-resume{grid-template-columns:repeat(2,minmax(0,1fr))}.resume-task{grid-column:1/-1}.todo-item{padding:12px;gap:8px}}@media(max-width:420px){.todos-grid,.todos-grid.has-resume{grid-template-columns:1fr}}
</style>

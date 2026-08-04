<script setup lang="ts">
import { BookOpen, Play } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, post } from '../api'
import { platformRuntime } from '../platform/runtime'

const router = useRouter()
const papers = ref<any[]>([])
const error = ref('')
const emptyHint = platformRuntime.isAndroid
  ? '请先到“导入题库”选择 ESQ 题库包。'
  : '请先到“导入题库”上传 Word 真题。'

onMounted(async () => {
  try { papers.value = await get('/papers') } catch (e) { error.value = String(e) }
})

async function startPaper(id: number) {
  try {
    const session: any = await post('/practice/sessions', {
      mode: 'paper', paper_id: id, shuffle_options: true,
    })
    router.push(`/practice/${session.id}`)
  } catch (e) { error.value = String(e) }
}
</script>

<template>
  <div class="page">
    <div class="page-head"><div><span class="eyebrow">QUESTION LIBRARY</span><h1>按年份练习</h1><p class="lead">完成整年45道客观题后统一判分，中途自动保存。</p></div></div>
    <div v-if="error" class="warning">{{ error }}</div>
    <div v-if="papers.length" class="grid grid-3">
      <article class="card paper-card" v-for="paper in papers" :key="paper.id">
        <div style="display:flex;justify-content:space-between"><span class="pill">{{ paper.status === 'published' ? '已发布' : '草稿' }}</span><BookOpen :size="20" /></div>
        <h2 class="paper-year">{{ paper.year }}</h2>
        <p class="lead">{{ paper.subject }} · {{ paper.unit_count }}篇 · {{ paper.question_count }}题</p>
        <button class="button" style="width:100%;margin-top:22px" :disabled="paper.status !== 'published'" @click="startPaper(paper.id)"><Play :size="16" />开始整卷</button>
      </article>
    </div>
    <div v-else class="card empty illustrated-empty">
      <img src="/assets/quiet-study-empty.webp" alt="" />
      <strong>题库还是空的</strong>
      <p>{{ emptyHint }}</p>
    </div>
  </div>
</template>

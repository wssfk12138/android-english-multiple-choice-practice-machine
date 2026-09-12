<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { get } from '../api'

const wrongCount = ref<number | null>(null)
const vocabTotal = ref<number | null>(null)
const vocabReview = ref<number | null>(null)

const wrongSubtitle = computed(() =>
  wrongCount.value == null ? '错题回顾与重做' : `当前 ${wrongCount.value} 道错题`)
const vocabSubtitle = computed(() =>
  vocabTotal.value == null ? '生词收集与复习' : `共 ${vocabTotal.value} 词 · ${vocabReview.value ?? 0} 词待复习`)

onMounted(async () => {
  try {
    const units = await get<any[]>('/wrong?view=current')
    wrongCount.value = (Array.isArray(units) ? units : [])
      .reduce((sum, unit) => sum + Number(unit?.current_count || 0), 0)
  } catch {
    wrongCount.value = null
  }
  try {
    const result = await get<any>('/vocabulary?status=all&search=')
    const counts: any = result?.counts || {}
    vocabTotal.value = Number(counts.total || 0)
    vocabReview.value = Number(counts.review || 0)
  } catch {
    vocabTotal.value = null
    vocabReview.value = null
  }
})
</script>

<template>
  <div class="page mobile-hub notes-hub">
    <div class="page-head compact-page-head">
      <div><h1>笔记</h1></div>
    </div>
    <div class="mobile-hub-list">
      <RouterLink class="card mobile-hub-item" to="/wrong">
        <img src="/assets/icons/wrong-book.png" alt="">
        <span><strong>错题本</strong><small>{{ wrongSubtitle }}</small></span>
        <b aria-hidden="true">›</b>
      </RouterLink>
      <RouterLink class="card mobile-hub-item" to="/vocabulary">
        <img src="/assets/icons/vocabulary.png" alt="">
        <span><strong>单词本</strong><small>{{ vocabSubtitle }}</small></span>
        <b aria-hidden="true">›</b>
      </RouterLink>
    </div>
  </div>
</template>

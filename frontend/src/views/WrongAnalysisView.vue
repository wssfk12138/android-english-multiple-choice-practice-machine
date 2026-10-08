<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, RefreshCw } from 'lucide-vue-next'
import { get, post } from '../api'
import { wrongAnalysisSession } from '../services/wrongAnalysisSessions'
const route = useRoute(), router = useRouter()
const unitId = Number(route.params.unitId)
const reports = ref<any[]>([]), selected = ref(0), unit = ref<any>(null)
const locked = ref(true), loading = ref(true)
const session = wrongAnalysisSession(unitId)
const { busy, error } = toRefs(session)
const report = computed(() => reports.value.find(r => r.id === selected.value))
const title = computed(() => unit.value ? `${unit.value.year} 年 ${unit.value.unit_title}分析` : '分析记录')
function time(value: string) { const text=value.replace(' ','T'); const d=new Date(/Z|[+-]\d\d:\d\d$/.test(text) ? text : text+'Z'); return Number.isNaN(+d) ? value : d.toLocaleString() }
async function load() {
  const [history, statuses, units] = await Promise.all([
    get<any[]>(`/ai/wrong-analysis-history?unit_id=${unitId}`), get<any>('/ai/wrong-analysis-status'), get<any[]>('/wrong?view=all'),
  ])
  reports.value = history
  if (!history.some(r => r.id === selected.value)) selected.value = history[0]?.id || 0
  unit.value = units.find(u => u.unit_id === unitId)
  locked.value = Boolean(statuses.units?.find((s:any) => s.unit_id === unitId)?.locked)
}
async function generate() {
  if (busy.value || locked.value || !unit.value?.current_question_ids.length) return
  busy.value = true; error.value = ''
  try {
    const result:any = await post('/ai/analyze-wrong', { question_ids:unit.value.current_question_ids, scope_title:title.value })
    session.completed = result.report_id
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
watch(() => session.completed, async id => {
  if (!id) return
  try { await load(); selected.value = id } catch (cause) { error.value = String(cause) }
})
onMounted(async () => {
  try { await load() } catch(cause) { error.value=String(cause) }
  finally { loading.value=false }
})
</script>
<template>
  <div class="page analysis-page">
    <div class="page-head"><h1>分析记录</h1><div class="analysis-header-actions"><button class="button" :disabled="busy || loading || locked || !unit?.current_count" @click="generate"><RefreshCw :size="16" />{{ busy ? '分析中…' : reports.length ? '重新分析' : '开始分析' }}</button><button class="button secondary" @click="router.push('/wrong')"><ArrowLeft :size="17" />返回错题本</button></div></div>
    <p v-if="loading" role="status">正在读取本地分析记录…</p>
    <section v-else class="card analysis-record">
      <h2>{{ unit ? unit.year + ' 年 · ' + unit.unit_title : '错题分析' }}</h2>
      <div class="analysis-toolbar">
        <label v-if="reports.length">分析时间<select v-model="selected" aria-label="选择历史分析"><option v-for="item in reports" :key="item.id" :value="item.id">{{ time(item.created_at) }} · {{ item.model_name }}</option></select></label>
      </div>
      <p v-if="busy" role="status">正在生成分析，已保存的历史仍可查看。</p>
      <p v-if="error" class="warning" role="alert">{{ error }}<button class="button secondary" @click="load().catch(cause => error=String(cause))">重新读取</button></p>
      <p v-if="!report && !error">尚无分析记录。点击“开始分析”生成并保存报告。</p>
      <p class="muted" v-if="locked">完成这篇错题的下一次正式重做后，才能重新分析。历史记录可随时查看。</p>
    </section>
    <section v-if="report" class="card analysis-record analysis-report"><h2>{{ report.scope_title || '完整分析报告' }}</h2><small>{{ time(report.created_at) }} · {{ report.model_name }}</small><div v-if="report.aggregate?.categories?.length" class="analysis-categories"><div v-for="category in report.aggregate.categories" :key="category.code"><span>{{ category.label }}</span><strong>{{ category.count }} 道 · {{ category.percentage }}%</strong></div></div><div class="analysis-full-report">{{ report.report }}</div></section>
  </div>
</template>
<style scoped>
.analysis-toolbar { display:flex; justify-content:space-between; align-items:center; gap:16px; flex-wrap:wrap; }
.analysis-toolbar label { display:flex; align-items:center; gap:12px; min-width:0; }
.analysis-toolbar select { max-width:100%; }
.analysis-record { padding:24px; }
.analysis-report { margin-top:20px; }
.analysis-header-actions { display:flex; gap:10px; flex-wrap:wrap; }
.analysis-full-report { white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.85; margin:20px 0; }
.analysis-categories { display:grid; gap:8px; margin-top:16px; }
.analysis-categories > div { display:flex; justify-content:space-between; gap:16px; }
</style>

<script setup lang="ts">
import { ref } from 'vue'
import { Download, RefreshCw } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { checkLanQuestionBanks, downloadLanQuestionBank, type LanBank } from '../platform/android/lan-question-banks'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'

const router = useRouter()
const catalog = ref<{ hostId: string; packages: LanBank[] } | null>(null)
const selected = ref<string[]>([])
const busy = ref(false)
const error = ref('')
const results = ref<Record<string, string>>({})
const destination = ref(0)
async function refresh() {
  busy.value = true
  error.value = ''
  catalog.value = null
  selected.value = []
  results.value = {}
  try {
    await loadQuestionBankProfiles()
    catalog.value = await checkLanQuestionBanks()
  } catch (cause) { error.value = String(cause) }
  finally { busy.value = false }
}
async function download() {
  const snapshot = catalog.value
  if (!snapshot) return
  busy.value = true
  error.value = ''
  let firstDraft = 0
  try {
    for (const item of snapshot.packages.filter(p => selected.value.includes(p.packageId))) {
      results.value[item.packageId] = '正在下载与校验'
      try {
        const result = await downloadLanQuestionBank(snapshot.hostId, item, destination.value
          ? { profileId: destination.value } : { newProfileName: item.title.trim().slice(0, 80) })
        results.value[item.packageId] = result.skipped ? '相同内容已存在，已跳过' : '待导入预览确认'
        if (result.status === 'draft' && !firstDraft) firstDraft = result.id
      } catch (cause) { results.value[item.packageId] = String(cause) }
    }
    await loadQuestionBankProfiles()
    if (firstDraft) await router.push({ path: '/imports', query: { esqImportId: String(firstDraft) } })
  } finally { busy.value = false }
}
</script>

<template>
  <section class="lan-question-banks" aria-labelledby="lan-question-banks-title">
    <div class="heading">
      <h2 id="lan-question-banks-title">已绑定电脑的题库</h2>
      <button class="icon-button" :disabled="busy" title="检查电脑共享题库" aria-label="检查电脑共享题库" @click="refresh"><RefreshCw :size="18" /></button>
    </div>
    <p v-if="error" class="warning" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">正在处理，请稍候…</p>
    <template v-if="catalog">
      <label v-for="item in catalog.packages" :key="item.packageId" class="bank selection-option">
        <input v-model="selected" type="checkbox" :value="item.packageId" :disabled="busy">
        <span><strong>{{ item.title }}</strong><small>{{ item.years.join('、') }} · {{ Math.ceil(item.size / 1024) }} KiB</small><small>{{ results[item.packageId] || item.license }}</small></span>
      </label>
      <p v-if="!catalog.packages.length">电脑当前没有共享题库</p>
      <label class="field"><span>导入位置</span>
        <select v-model.number="destination" :disabled="busy">
          <option :value="0">按包名新建题库配置</option>
          <option v-for="profile in questionBankProfilesState.items" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
        </select>
      </label>
      <button class="button" :disabled="busy || !selected.length" @click="download"><Download :size="16" />下载所选题库 ({{ selected.length }})</button>
    </template>
  </section>
</template>

<style scoped>
.lan-question-banks { padding: 20px 0; border-block: 1px solid var(--line); }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
h2 { font-size: 18px; }
.bank { display: flex; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line); align-items: flex-start; }
.bank input { width: 18px; height: 18px; flex: 0 0 18px; }
.bank span { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
small { color: var(--muted); }
</style>

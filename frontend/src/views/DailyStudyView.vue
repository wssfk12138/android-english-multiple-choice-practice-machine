<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, RotateCw, AlertCircle } from 'lucide-vue-next'
import { get } from '../api'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import VocabularyMemoryContent from '../components/VocabularyMemoryContent.vue'
import VocabularyTerm from '../components/VocabularyTerm.vue'
import { DailyStudySession, studyNavigationWindow, studySwipe, type StudyCatalog } from '../services/dailyStudy'
import { VOCAB_DISPLAY_OPTIONS, type VocabDisplayConfig, type VocabDisplayKey } from '../services/vocabularyDisplayConfig'

const route = useRoute(), router = useRouter(), landscape = useAndroidLandscape()
const params = new URLSearchParams({ status: String(route.query.status || 'all'), search: String(route.query.search || '').trim() })
if (route.query.scope === 'current') params.set('scope', 'current')
const labels: Record<string, string> = { all: '全部单词', frequent: '高频词', review: '待背单词', learning: '学习中', mastered: '已掌握', pending: '等待翻译' }
const scopeLabel = [route.query.scope === 'current' ? '当前题库' : '', labels[params.get('status')!] || '全部单词', params.get('search')].filter(Boolean).join(' · ')
const state = ref<DailyStudySession['state']>()
const session = new DailyStudySession({
  catalog: () => get<StudyCatalog>('/vocabulary/daily-study/catalog?' + params),
  status: () => get('/vocabulary/daily-study/status?' + params),
  detail: id => get('/vocabulary/' + id),
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  changed: () => { state.value = { ...session.state } },
})
state.value = { ...session.state }
const current = computed(() => state.value!.entry)
const root = ref<HTMLElement>(), scroller = ref<HTMLElement>(), nav = ref<HTMLElement>()
const direction = ref('right'), switching = ref(false)
const windowRange = computed(() => studyNavigationWindow(state.value!.index, state.value!.items.length))
const navItems = computed(() => state.value!.items.slice(windowRange.value.start, windowRange.value.end))
const columns: VocabDisplayKey[][] = [['common_meaning', 'contextual', 'source_sentence', 'model_sentence'], ['synonyms', 'antonyms', 'similar_forms', 'morphology', 'memory_hint', 'note']]
const configs = Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(option => [option.key, Object.fromEntries(VOCAB_DISPLAY_OPTIONS.map(item => [item.key, item.key === option.key]))])) as Record<VocabDisplayKey, VocabDisplayConfig>
function has(key: VocabDisplayKey) {
  const word = current.value
  if (!word) return false
  if (key === 'common_meaning') return Boolean(word.common_meaning)
  if (key === 'contextual') return Boolean(word.contextual_meaning)
  if (key === 'source_sentence') return Boolean(word.latest_sentence)
  if (key === 'model_sentence') return Boolean(word.generated_example?.sentence)
  if (key === 'morphology') return Boolean(word.morphology?.forms?.length || word.morphology?.note || (word.morphology?.currentForm && word.morphology.currentForm !== '词形待确认'))
  if (key === 'similar_forms') return Boolean(word.similar_forms?.length || word.local_similar?.length)
  return Boolean(Array.isArray(word[key]) ? word[key].length : word[key])
}
const hasContent = computed(() => columns.some(column => column.some(has)))
let saveTimer: ReturnType<typeof setTimeout> | undefined, unlockTimer: ReturnType<typeof setTimeout> | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined, disposed = false
const expanded = new Map<string, Record<string, boolean>>()
function capture() {
  // During out-in transitions the previous DOM can outlive the new entry.
  if (!current.value || !scroller.value || scroller.value.dataset.identity !== current.value.sync_id) return
  expanded.set(current.value.sync_id, Object.fromEntries([...scroller.value.querySelectorAll('details')].map(detail => [detail.closest<HTMLElement>('[data-study-section]')!.dataset.studySection!, detail.open])))
  session.save(scroller.value.scrollTop)
}
function saveScroll() {
  cancelGesture()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(capture, 140)
}
async function restore() {
  await nextTick()
  if (disposed || !landscape.value || !current.value || !scroller.value) return
  const saved = expanded.get(current.value.sync_id)
  scroller.value.querySelectorAll('details').forEach(detail => { detail.open = saved?.[detail.closest<HTMLElement>('[data-study-section]')!.dataset.studySection!] ?? true })
  scroller.value.scrollTop = Math.min(session.scrollTop, Math.max(0, scroller.value.scrollHeight - scroller.value.clientHeight))
  nav.value?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
}
function unlock() { clearTimeout(unlockTimer); switching.value = false }
async function entered() { await restore(); unlock() }
async function go(index: number) {
  const value = state.value!
  if (!landscape.value || value.busy || switching.value || index === value.index || index < 0 || index >= value.items.length) return
  clearTimeout(saveTimer); capture(); cancelGesture()
  direction.value = index < value.index ? 'left' : 'right'
  switching.value = true
  const old = current.value?.sync_id
  await session.select(index)
  if (disposed) return
  if (state.value!.phase !== 'ready' || current.value?.sync_id === old || !landscape.value) unlock()
  else unlockTimer = setTimeout(unlock, 1500) // Also release if the WebView interrupts a transition.
}
async function retry() {
  if (state.value!.busy) return
  capture(); unlock(); await session.retry(); await restore()
}
function expandAll() {
  scroller.value?.querySelectorAll('details').forEach(detail => { detail.open = true })
  capture()
}
function leave() {
  capture(); unlock()
  void router.push({ path: '/vocabulary', query: { ...(route.query.scope === 'current' ? { scope: 'current' } : {}), studyStatus: params.get('status'), studySearch: params.get('search') } })
}
function keys(event: KeyboardEvent) {
  if (!landscape.value || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]') || String(getSelection()).trim()) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); void go(state.value!.index + (event.key === 'ArrowLeft' ? -1 : 1))
  } else if (event.key === 'Escape') leave()
}
const pointers = new Set<number>()
let down: { id: number; x: number; y: number } | null = null
function cancelGesture() { down = null }
function releasePointer(event: PointerEvent) { pointers.delete(event.pointerId); cancelGesture() }
function pointerDown(event: PointerEvent) {
  pointers.add(event.pointerId)
  if (pointers.size > 1 || !event.isPrimary) { cancelGesture(); return }
  if (event.button > 0 || state.value!.busy || switching.value || String(getSelection()).trim()
    || (event.target as HTMLElement).closest('button,input,textarea,select,summary,a,[contenteditable="true"]')) return
  down = { id: event.pointerId, x: event.clientX, y: event.clientY }
}
function pointerMove(event: PointerEvent) {
  if (down?.id === event.pointerId && Math.abs(event.clientY - down.y) > 24 && Math.abs(event.clientY - down.y) > Math.abs(event.clientX - down.x)) cancelGesture()
}
function pointerEnd(event: PointerEvent) {
  const start = down; pointers.delete(event.pointerId); cancelGesture()
  if (event.type === 'pointercancel' || !start || event.pointerId !== start.id || pointers.size || String(getSelection()).trim()) return
  const step = studySwipe(event.clientX - start.x, event.clientY - start.y)
  if (step) void go(state.value!.index + step)
}
async function refresh() {
  if (!disposed && document.visibilityState === 'visible' && !switching.value) { capture(); await session.refresh() }
}
function visibility() { if (document.visibilityState !== 'visible') capture(); else void refresh() }
watch(landscape, async active => {
  capture(); cancelGesture(); pointers.clear(); unlock()
  if (active) await restore()
}, { flush: 'pre' })
onBeforeRouteLeave(() => { capture(); unlock() })
onMounted(async () => {
  document.addEventListener('keydown', keys); document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', capture)
  window.addEventListener('pointerup', releasePointer); window.addEventListener('pointercancel', releasePointer)
  refreshTimer = setInterval(() => { void refresh() }, 5000)
  await session.open(); await restore(); root.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  capture(); disposed = true; session.dispose(); unlock(); clearTimeout(saveTimer); clearInterval(refreshTimer)
  document.removeEventListener('keydown', keys); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', capture)
  window.removeEventListener('pointerup', releasePointer); window.removeEventListener('pointercancel', releasePointer)
})
</script>

<template>
  <section ref="root" class="daily-study-shell" tabindex="-1" aria-label="每日一学" :data-switching="switching">
    <header class="study-top">
      <button class="button ghost back" @click="leave"><ArrowLeft :size="18" />单词本</button>
      <strong>每日一学</strong><span class="study-scope" :title="scopeLabel">{{ scopeLabel }}</span>
      <span class="study-count" aria-live="polite">{{ state!.items.length ? state!.index + 1 : 0 }} / {{ state!.items.length }}</span>
      <span v-if="state!.saveFailed" class="save-warning" role="status">续看未保存</span>
      <button class="button ghost exit" @click="leave">退出学习</button>
    </header>
    <div v-if="!landscape" class="rotation-cover">
      <RotateCw :size="42" /><h2>请横屏继续学习</h2>
      <button class="button secondary" @click="leave">返回单词本</button>
    </div>
    <div v-else class="study-workspace">
      <nav v-if="state!.items.length" ref="nav" class="word-nav" aria-label="学习单词导航">
        <button v-if="windowRange.start > 0" class="nav-group" aria-label="前一组单词" :disabled="state!.busy || switching" @click="go(windowRange.start - 1)"><ChevronLeft :size="18" /></button>
        <div class="word-nav-list">
          <button v-for="(word, offset) in navItems" :key="word.identity" :aria-current="windowRange.start + offset === state!.index ? 'true' : undefined" :disabled="state!.busy || switching" @click="go(windowRange.start + offset)">
            <span class="nav-number">{{ windowRange.start + offset + 1 }}</span><span>{{ word.term }}</span>
          </button>
        </div>
        <button v-if="windowRange.end < state!.items.length" class="nav-group" aria-label="后一组单词" :disabled="state!.busy || switching" @click="go(windowRange.end)"><ChevronRight :size="18" /></button>
      </nav>
      <Transition :name="'study-slide-' + direction" mode="out-in" @enter="restore" @after-enter="entered" @enter-cancelled="unlock" @leave-cancelled="unlock">
        <article v-if="state!.phase === 'ready' && current" :key="current.sync_id" class="study-card card" :aria-busy="state!.busy" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerEnd" @pointercancel="pointerEnd" @lostpointercapture="cancelGesture">
          <header class="word-heading"><div><h1><VocabularyTerm :term="current.term" :frequent="current.is_frequent" /></h1><p v-if="current.phonetic || current.part_of_speech"><span>{{ current.phonetic }}</span><span v-if="current.part_of_speech" class="pos-badge">{{ current.part_of_speech }}</span></p></div><button class="button ghost expand-all" @click="expandAll">展开全部<ChevronDown :size="15" /></button></header>
          <div ref="scroller" class="study-scroll content-scroll" :data-identity="current.sync_id" @scroll.passive="saveScroll">
            <div class="reading-columns">
              <div v-for="(column, index) in columns" :key="index" class="reading-column">
                <template v-for="key in column" :key="key">
                  <section v-if="key === 'contextual' && has(key)" class="context-meaning"><h4>语境释义</h4><p>{{ current.contextual_meaning }}</p></section>
                  <VocabularyMemoryContent v-else-if="has(key)" :data-study-section="key" :entry="current" :config="configs[key]" :expanded="true" />
                </template>
              </div>
            </div>
            <p v-if="!hasContent" class="missing-content">此词暂无学习内容</p>
          </div>
          <p v-if="state!.error" class="read-warning" role="alert">{{ state!.error }}<button class="button ghost" @click="retry">重新读取</button></p>
          <footer class="study-footer"><button class="button secondary previous" :disabled="state!.index === 0 || state!.busy || switching" @click="go(state!.index - 1)"><ArrowLeft :size="17" />上一词</button><span role="status">{{ state!.busy ? '正在读取单词详情…' : state!.index === state!.items.length - 1 ? '已到最后一个单词' : current.term }}</span><button class="button next" :disabled="state!.index === state!.items.length - 1 || state!.busy || switching" @click="go(state!.index + 1)">下一词<ArrowRight :size="17" /></button></footer>
        </article>
        <div v-else :key="state!.phase" class="state-card card" :aria-busy="state!.busy" role="status">
          <template v-if="state!.phase === 'loading'"><div class="skeleton title"></div><div v-for="n in 5" :key="n" class="skeleton line"></div><p>正在读取单词详情…</p></template>
          <template v-else-if="state!.phase === 'error'"><AlertCircle :size="36" /><h2>{{ state!.error }}</h2><button class="button" :disabled="state!.busy" @click="retry">重新读取</button><button class="button ghost" @click="leave">返回单词本</button></template>
          <template v-else><BookOpen :size="40" /><h2>当前范围没有可学习的单词</h2><button class="button" @click="leave">返回单词本</button></template>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.daily-study-shell{position:fixed;inset:0;z-index:60;background:var(--bg);display:flex;flex-direction:column;padding:env(safe-area-inset-top) max(24px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));color:var(--ink);font-size:1rem;overflow:hidden;outline:none}
.study-top{min-height:66px;flex:none;display:flex;gap:16px;align-items:center;border-bottom:1px solid var(--line);margin-bottom:14px}.study-top>strong{font-size:1.25rem;white-space:nowrap}.study-top .back{padding-left:0;color:var(--muted)}.study-scope{color:var(--muted);font-size:.8125rem;border-left:1px solid var(--line);padding-left:16px;max-width:340px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.study-count{margin-left:auto;white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}.save-warning{color:var(--danger,#b54708);font-size:.8125rem}.study-top button{flex:none;white-space:nowrap}
.study-workspace{display:flex;flex-direction:column;gap:12px;min-height:0;flex:1}.word-nav{display:flex;gap:8px;min-width:0;flex:none}.word-nav-list{display:flex;gap:8px;overflow-x:auto;padding:0 0 6px;scrollbar-width:thin;min-width:0;flex:1}.word-nav button{display:flex;align-items:center;gap:8px;min-height:44px;flex:none;white-space:nowrap;padding:8px 15px;color:var(--muted);border:1px solid var(--line);border-radius:12px;background:var(--surface-solid);font-size:.875rem;font-weight:600;cursor:pointer}.word-nav button[aria-current=true]{background:var(--primary-soft);color:var(--primary);border-color:var(--primary);box-shadow:inset 0 -2px var(--primary)}.word-nav .nav-group{padding:8px;min-width:40px;align-self:flex-start}.nav-number{font-size:.6875rem;font-variant-numeric:tabular-nums}
.study-card.card{border-radius:24px;padding:0;min-height:0;flex:1;display:flex;flex-direction:column;background:var(--surface-solid);box-shadow:var(--shadow-sm);overflow:hidden;border:1px solid var(--line);touch-action:pan-y}.word-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px 28px 16px;border-bottom:1px solid var(--line);flex:none}.word-heading>div{min-width:0;flex:1}.word-heading h1{font-family:Georgia,'Noto Serif',serif;font-size:2.375rem;line-height:1.2;letter-spacing:-.6px;margin:0;font-weight:700;max-width:800px}.word-heading p{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:6px 0 0;color:var(--muted);font-size:.9375rem;overflow-wrap:anywhere}.pos-badge{font-size:.75rem;padding:2px 8px;background:var(--primary-soft);border-radius:6px;color:var(--primary)}.expand-all{font-size:.8125rem;color:var(--muted);flex:none;white-space:nowrap}
.content-scroll{overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain;scrollbar-width:thin}.reading-columns{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);padding:22px 28px;gap:32px;align-items:start}.reading-column{min-width:0}.reading-column+.reading-column{border-left:1px solid var(--line);padding-left:28px}.study-card :deep(.review-meaning-block){padding:0 0 16px;margin:0}.study-card :deep(.review-meaning-heading){margin-bottom:8px}.study-card :deep(.review-meaning-heading small){font-size:.8125rem;color:var(--muted)}.study-card :deep(.review-meaning-block strong){font-size:1.3125rem;line-height:1.65;color:var(--ink);font-weight:650}.study-card :deep(.memory-layer){margin:0;padding:12px 0;border-top:1px solid var(--line)}.study-card :deep(.memory-layer summary){font-size:.875rem;font-weight:650;line-height:1.5;min-height:44px;cursor:pointer}.study-card :deep(.memory-layer h4),.context-meaning h4{font-size:.875rem;margin:0 0 10px;font-weight:650}.study-card :deep(.memory-layer p),.context-meaning p{font-size:1rem;line-height:1.8;margin:8px 0;white-space:pre-line;overflow-wrap:anywhere}.study-card :deep(.memory-layer-static p){font-family:Georgia,'Times New Roman',serif;font-size:1.3125rem;line-height:1.75}.study-card :deep(.memory-layer-static small){color:var(--muted);font-size:.8125rem}.study-card :deep(.discrimination-list){padding:0;list-style:none;margin:8px 0}.study-card :deep(.discrimination-list li){display:grid;grid-template-columns:minmax(70px,.35fr) minmax(0,1fr);gap:12px;padding:9px 0;line-height:1.7}.study-card :deep(.discrimination-list span){color:var(--muted)}.context-meaning{padding-bottom:16px}.missing-content{padding:0 28px;color:var(--muted)}
.study-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:14px 28px;flex:none}.study-footer>span{color:var(--muted);font-size:.8125rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.study-footer button{flex:none;min-height:44px}.state-card.card{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;overflow-y:auto;text-align:center}.state-card h2{font-size:1.25rem}.rotation-cover{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;overflow:auto}.rotation-cover h2{font-size:1.4rem}.skeleton{border-radius:8px;background:var(--primary-soft);height:16px;width:65%;flex:none}.skeleton.title{height:34px;width:35%;margin-bottom:16px}.read-warning{margin:0;padding:8px 28px;color:var(--danger,#b54708)}
.study-slide-left-enter-active,.study-slide-left-leave-active,.study-slide-right-enter-active,.study-slide-right-leave-active{transition:transform 260ms cubic-bezier(.22,.61,.36,1),opacity 220ms ease}.study-slide-left-enter-from{opacity:0;transform:translate3d(-32px,0,0)}.study-slide-left-leave-to{opacity:0;transform:translate3d(32px,0,0)}.study-slide-right-enter-from{opacity:0;transform:translate3d(32px,0,0)}.study-slide-right-leave-to{opacity:0;transform:translate3d(-32px,0,0)}
button:focus-visible{outline:3px solid var(--primary);outline-offset:3px}button:disabled{cursor:default}
@media(max-width:900px){.daily-study-shell{padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));padding-bottom:max(10px,env(safe-area-inset-bottom))}.study-top{gap:10px;min-height:54px;margin-bottom:8px}.study-scope{max-width:170px;padding-left:10px}.word-heading{padding:12px 18px}.word-heading h1{font-size:2rem}.reading-columns{gap:18px;padding:18px}.reading-column+.reading-column{padding-left:18px}.study-footer{padding:10px 18px}.study-workspace{gap:8px}}
@media(max-width:600px){.study-scope,.study-top .exit{display:none}.study-top{flex-wrap:wrap;gap:8px}.study-top>strong{font-size:1.125rem}.word-heading h1{font-size:1.625rem}.reading-columns{gap:12px;padding:12px}.reading-column+.reading-column{padding-left:12px}.expand-all{padding:8px}.study-footer{padding:8px 12px;gap:8px}.study-footer>span{display:none}.word-heading{padding:10px 12px}.study-card.card{border-radius:16px}}
@media(max-height:420px){.study-top{min-height:44px;margin-bottom:6px}.word-heading{padding:8px 14px}.word-heading h1{font-size:1.625rem}.word-heading p{margin-top:2px}.study-footer{padding:6px 14px}.study-workspace{gap:4px}.daily-study-shell{padding-bottom:max(6px,env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){.study-slide-left-enter-active,.study-slide-left-leave-active,.study-slide-right-enter-active,.study-slide-right-leave-active{transition:opacity 60ms ease}.study-slide-left-enter-from,.study-slide-left-leave-to,.study-slide-right-enter-from,.study-slide-right-leave-to{transform:none}}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, RotateCw, AlertCircle } from 'lucide-vue-next'
import { get } from '../api'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { useDailyStudySwipe } from '../composables/useDailyStudySwipe'
import { useReducedMotion } from '../composables/useReducedMotion'
import DailyStudyContent from '../components/DailyStudyContent.vue'
import VocabularyTerm from '../components/VocabularyTerm.vue'
import PronunciationButtons from '../components/PronunciationButtons.vue'
import StudyFilter from '../components/StudyFilter.vue'
import { DailyStudySession, studyNavigationWindow, type StudyCatalog } from '../services/dailyStudy'
const route = useRoute(), router = useRouter(), landscape = useAndroidLandscape()
const selectedStatus = ref(String(route.query.status || 'new'))
const selectedSearch = ref(String(route.query.search || '').trim())
function queryParams() {
  const params = new URLSearchParams({ status: selectedStatus.value, search: selectedSearch.value })
  if (route.query.scope === 'current') params.set('scope', 'current')
  return params
}
const state = ref<DailyStudySession['state']>()
const session = new DailyStudySession({
  catalog: () => get<StudyCatalog>('/vocabulary/daily-study/catalog?' + queryParams()),
  status: () => get('/vocabulary/daily-study/status?' + queryParams()), detail: id => get('/vocabulary/' + id),
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  changed: () => { state.value = { ...session.state } },
})
state.value = { ...session.state }
const frozen = ref<Record<string, any> | null>(null)
const current = computed(() => frozen.value || state.value!.entry)
const root = ref<HTMLElement>(), scroller = ref<HTMLElement>(), nav = ref<HTMLElement>(), deck = ref<HTMLElement>()
const width = ref(1), switching = ref(false), settling = ref(false), destination = ref<number | null>(null)
const reducedMotion = useReducedMotion()
const windowRange = computed(() => studyNavigationWindow(state.value!.index, state.value!.items.length))
const navItems = computed(() => state.value!.items.slice(windowRange.value.start, windowRange.value.end))
const swipe = useDailyStudySwipe({ width, enabled: () => landscape.value && document.documentElement.dataset.orientation === 'landscape' && !state.value!.busy && !switching.value,
  canMove: step => state.value!.index + step >= 0 && state.value!.index + step < state.value!.items.length,
  navigate: step => go(state.value!.index + step),
  reducedMotion: () => reducedMotion.value,
})
const { offset, phase: gesturePhase } = swipe
const neighborIndex = computed(() => destination.value ?? (offset.value ? state.value!.index + (offset.value < 0 ? 1 : -1) : -1))
const neighbor = computed(() => neighborIndex.value >= 0 ? session.peek(neighborIndex.value) : null)
const neighborMember = computed(() => state.value!.items[neighborIndex.value])
const neighborOffset = computed(() => offset.value + (destination.value !== null ? destination.value > state.value!.index ? width.value : -width.value : offset.value < 0 ? width.value : -width.value))
// During committed navigation index already refers to the destination; preserve its side.
const navigationSign = ref(1)
const adjacentTransform = computed(() => switching.value ? offset.value - navigationSign.value * width.value : neighborOffset.value)
let saveTimer: ReturnType<typeof setTimeout> | undefined, refreshTimer: ReturnType<typeof setInterval> | undefined
let disposed = false, navFrame = 0, navigationToken = 0
let finishAnimation: (() => void) | undefined
function revealNavigation() {
  cancelAnimationFrame(navFrame)
  navFrame = requestAnimationFrame(() => nav.value?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }))
}
const navObserver = new ResizeObserver(revealNavigation)
const deckObserver = new ResizeObserver(entries => { width.value = entries[0]?.contentRect.width || 1; interrupt() })
watch(nav, (element, previous) => { if (previous) navObserver.unobserve(previous); if (element) navObserver.observe(element) }, { flush: 'post' })
watch(deck, (element, previous) => { if (previous) deckObserver.unobserve(previous); if (element) deckObserver.observe(element) }, { flush: 'post' })
// Rotation unmounts and recreates the landscape card. The scroll container can
// therefore appear after the first restore tick; retry when that ref lands.
watch(scroller, (element, previous) => { if (element && element !== previous) void restore() }, { flush: 'post' })
function capture() {
  if (!current.value || !scroller.value || scroller.value.dataset.identity !== current.value.daily_study_identity
    || state.value!.entry?.daily_study_identity !== current.value.daily_study_identity) return
  session.save(scroller.value.scrollTop)
}
function saveScroll() {
  if (gesturePhase.value === 'tracking' || gesturePhase.value === 'dragging') swipe.cancel()
  clearTimeout(saveTimer); saveTimer = setTimeout(capture, 140)
}
async function restore() {
  await nextTick()
  if (disposed || !landscape.value || !current.value || !scroller.value) return
  const element = scroller.value, identity = current.value.daily_study_identity, wanted = session.scrollTop
  const apply = () => {
    if (disposed || !landscape.value || scroller.value !== element || current.value?.daily_study_identity !== identity) return
    element.scrollTop = Math.min(wanted, Math.max(0, element.scrollHeight - element.clientHeight))
  }
  apply()
  revealNavigation()
}
function interrupt() {
  navigationToken++; finishAnimation?.(); finishAnimation = undefined
  frozen.value = null; destination.value = null; settling.value = false; switching.value = false; swipe.reset()
  void restore()
}
async function animateTo(value: number) {
  settling.value = true
  await nextTick()
  offset.value = value
  if (reducedMotion.value) return
  await new Promise<void>(resolve => {
    const timer = setTimeout(done, 260)
    function done() { clearTimeout(timer); if (finishAnimation === done) finishAnimation = undefined; resolve() }
    finishAnimation = done
  })
}
async function go(index: number) {
  const value = state.value!
  if (!landscape.value || value.busy || switching.value || index === value.index || index < 0 || index >= value.items.length) return
  clearTimeout(saveTimer); capture(); swipe.hold()
  const token = ++navigationToken, old = current.value?.daily_study_identity
  navigationSign.value = index < value.index ? 1 : -1
  destination.value = index; frozen.value = current.value; switching.value = true
  // Hold the visible old card while loading. A requested index is never a loaded identity.
  await session.select(index)
  if (disposed) return
  if (token !== navigationToken) { await restore(); return }
  if (state.value!.phase === 'ready' && !state.value!.error && state.value!.entry?.daily_study_identity !== old) {
    destination.value = state.value!.index
    await animateTo(navigationSign.value * width.value)
  } else await animateTo(0)
  if (disposed || token !== navigationToken) return
  frozen.value = null; destination.value = null; settling.value = false; switching.value = false; swipe.cancel()
  await restore()
}
async function retry() { if (state.value!.busy || switching.value) return; capture(); interrupt(); await session.retry(); await restore() }
function leave() {
  capture(); interrupt()
  const homeStatus = selectedStatus.value === 'new' ? 'all' : selectedStatus.value
  void router.push({ path: '/vocabulary', query: { ...(route.query.scope === 'current' ? { scope: 'current' } : {}), studyStatus: homeStatus, studySearch: selectedSearch.value } })
}
async function changeStatus(value: string) {
  if (!value || value === selectedStatus.value) return
  capture(); interrupt()
  selectedStatus.value = value
  selectedSearch.value = ''
  await router.replace({ path: route.path, query: { ...route.query, status: value, search: '' } })
  if (disposed) return
  await session.open()
  await restore()
}
watch(() => [route.query.status, route.query.search], values => {
  const nextStatus = String(values[0] || 'new')
  const nextSearch = String(values[1] || '').trim()
  if (nextStatus === selectedStatus.value && nextSearch === selectedSearch.value) return
  capture(); interrupt()
  selectedStatus.value = nextStatus
  selectedSearch.value = nextSearch
  void session.open().then(restore)
}, { flush: 'pre' })
function keys(event: KeyboardEvent) {
  if (!landscape.value || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || String(getSelection()).trim()) return
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); void go(state.value!.index + (event.key === 'ArrowLeft' ? -1 : 1))
  } else if (event.key === 'Escape') leave()
}
async function refresh() {
  if (!disposed && document.visibilityState === 'visible' && !switching.value && gesturePhase.value === 'idle') { capture(); await session.refresh(); await restore() }
}
function visibility() { if (document.visibilityState !== 'visible') { capture(); interrupt() } else { interrupt(); void refresh() } }
function blur() { capture(); interrupt() }
watch(landscape, () => { capture(); interrupt() }, { flush: 'pre' })
onBeforeRouteLeave(() => { capture(); interrupt() })
onMounted(async () => {
  document.addEventListener('keydown', keys); document.addEventListener('visibilitychange', visibility)
  window.addEventListener('pagehide', blur); window.addEventListener('blur', blur)
  window.addEventListener('pointerup', swipe.pointerEnd); window.addEventListener('pointercancel', swipe.pointerEnd)
  refreshTimer = setInterval(() => { void refresh() }, 5000)
  await session.open(); await restore(); root.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  capture(); disposed = true; session.dispose(); interrupt(); clearTimeout(saveTimer); clearInterval(refreshTimer)
  navObserver.disconnect(); deckObserver.disconnect(); cancelAnimationFrame(navFrame)
  document.removeEventListener('keydown', keys); document.removeEventListener('visibilitychange', visibility)
  window.removeEventListener('pagehide', blur); window.removeEventListener('blur', blur)
  window.removeEventListener('pointerup', swipe.pointerEnd); window.removeEventListener('pointercancel', swipe.pointerEnd)
})
</script>

<template>
  <section ref="root" class="daily-study-shell" :class="{ 'motion-reduced': reducedMotion }" tabindex="-1" aria-label="每日一学" :data-switching="switching">
    <header class="study-top">
      <button class="button ghost back" @click="leave"><ArrowLeft :size="18" />单词本</button>
      <strong>每日一学</strong><StudyFilter :value="selectedStatus" @change="changeStatus" />
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
      <div ref="deck" class="study-deck" :class="{ settling: settling || gesturePhase === 'settling', dragging: gesturePhase === 'dragging' }" :data-gesture="gesturePhase" :data-offset="offset">
        <article v-if="current" :key="current.daily_study_identity" class="study-card card" :aria-busy="state!.busy" :style="{ transform: `translate3d(${offset}px,0,0)` }" @pointerdown="swipe.pointerDown" @pointermove="swipe.pointerMove" @lostpointercapture="swipe.lostCapture">
          <header class="word-heading"><div><h1><VocabularyTerm :term="current.term" :frequent="current.is_frequent" /></h1><p class="tts-phonetic-line"><span v-if="current.phonetic">{{ current.phonetic }}</span><PronunciationButtons :text="current.term" :owner-id="'study-' + current.daily_study_identity" :disabled="switching || state!.busy" /><span v-if="current.part_of_speech" class="pos-badge">{{ current.part_of_speech }}</span></p></div></header>
          <div ref="scroller" class="study-scroll content-scroll" :data-identity="current.daily_study_identity" @scroll.passive="saveScroll">
            <DailyStudyContent :entry="current" />
          </div>
          <p v-if="state!.error" class="read-warning" role="alert">{{ state!.error }}<button class="button ghost" :disabled="state!.busy || switching" @click="retry">重新读取</button></p>
          <footer class="study-footer"><button class="button secondary previous" :disabled="state!.index === 0 || state!.busy || switching" @click="go(state!.index - 1)"><ArrowLeft :size="17" />上一词</button><span role="status">{{ state!.busy ? '正在读取单词详情…' : state!.index === state!.items.length - 1 ? '已到最后一个单词' : current.term }}</span><button class="button next" :disabled="state!.index === state!.items.length - 1 || state!.busy || switching" @click="go(state!.index + 1)">下一词<ArrowRight :size="17" /></button></footer>
        </article>
        <article v-if="current && neighborMember && (offset || switching)" class="study-card card adjacent-card" aria-hidden="true" inert :style="{transform: 'translate3d(' + adjacentTransform + 'px,0,0)'}">
          <header class="word-heading"><div><h1>{{ neighbor?.term || neighborMember.term }}</h1><p v-if="neighbor">{{ neighbor.phonetic }} {{ neighbor.part_of_speech }}</p></div></header>
          <div class="study-scroll content-scroll"><DailyStudyContent v-if="neighbor" :entry="neighbor" /><p v-else class="missing-content">正在读取单词详情…</p></div>
          <footer class="study-footer"><span>{{ neighborMember.term }}</span></footer>
        </article>

        <div v-if="!current" :key="state!.phase" class="state-card card" :aria-busy="state!.busy" role="status">
          <template v-if="state!.phase === 'loading'"><div class="skeleton title"></div><div v-for="n in 5" :key="n" class="skeleton line"></div><p>正在读取单词详情…</p></template>
          <template v-else-if="state!.phase === 'error'"><AlertCircle :size="36" /><h2>{{ state!.error }}</h2><button class="button" :disabled="state!.busy" @click="retry">重新读取</button><button class="button ghost" @click="leave">返回单词本</button></template>
          <template v-else><BookOpen :size="40" /><h2>{{ selectedStatus === 'new' ? '暂无未学习单词' : '当前范围没有可学习的单词' }}</h2><p v-if="selectedStatus === 'new'" class="muted">可通过筛选查看其他单词。</p><button v-if="selectedStatus === 'new'" class="button" @click="changeStatus('all')">查看全部单词</button><button class="button" :class="{ secondary: selectedStatus === 'new' }" @click="leave">返回单词本</button></template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.daily-study-shell.motion-reduced .study-card{transition:none!important}
.daily-study-shell{position:fixed;inset:0;z-index:60;background:var(--bg);display:flex;flex-direction:column;padding:env(safe-area-inset-top) max(24px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left));color:var(--ink);font-size:1rem;overflow:hidden;outline:none}
.study-top{min-height:66px;flex:none;display:flex;gap:16px;align-items:center;border-bottom:1px solid var(--line);margin-bottom:14px}.study-top>strong{font-size:1.25rem;white-space:nowrap}.study-top .back{padding-left:0;color:var(--muted)}.study-scope{color:var(--muted);font-size:.8125rem;border-left:1px solid var(--line);padding-left:16px;max-width:340px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.study-count{margin-left:auto;white-space:nowrap;color:var(--muted);font-variant-numeric:tabular-nums}.save-warning{color:var(--danger,#b54708);font-size:.8125rem}.study-top button{flex:none;white-space:nowrap}
.study-workspace{display:flex;flex-direction:column;gap:12px;min-height:0;flex:1}.word-nav{display:flex;gap:8px;min-width:0;flex:none}.word-nav-list{display:flex;gap:8px;overflow-x:auto;padding:0 0 6px;scrollbar-width:thin;min-width:0;flex:1}.word-nav button{display:flex;align-items:center;gap:8px;min-height:44px;flex:none;white-space:nowrap;padding:8px 15px;color:var(--muted);border:1px solid var(--line);border-radius:12px;background:var(--surface-solid);font-size:.875rem;font-weight:600;cursor:pointer}.word-nav button[aria-current=true]{background:var(--primary-soft);color:var(--primary);border-color:var(--primary);box-shadow:inset 0 -2px var(--primary)}.word-nav .nav-group{padding:8px;min-width:40px;align-self:flex-start}.nav-number{font-size:.6875rem;font-variant-numeric:tabular-nums}
.study-card.card{border-radius:24px;padding:0;min-height:0;flex:1;display:flex;flex-direction:column;background:var(--surface-solid);box-shadow:var(--shadow-sm);overflow:hidden;border:1px solid var(--line);touch-action:pan-y}.word-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px 12px;border-bottom:1px solid var(--line);flex:none}.word-heading>div{min-width:0;flex:1}.word-heading h1{font-family:Georgia,'Noto Serif',serif;font-size:2.375rem;line-height:1.2;letter-spacing:-.6px;margin:0;font-weight:700;max-width:800px}.word-heading p{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:6px 0 0;color:var(--muted);font-size:.9375rem;overflow-wrap:anywhere}.pos-badge{font-size:.75rem;padding:2px 8px;background:var(--primary-soft);border-radius:6px;color:var(--primary)}
.study-deck{position:relative;flex:1;min-height:0;display:flex;overflow:hidden;container-type:inline-size}.study-deck>.study-card{width:100%;min-width:0;will-change:transform}.study-deck.dragging{user-select:none}.adjacent-card{position:absolute;inset:0;pointer-events:none}.settling>.study-card{transition:transform 240ms cubic-bezier(.22,.61,.36,1)}
.content-scroll{overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain;scrollbar-width:thin;touch-action:pan-y}.word-heading :deep(.vocabulary-term-fit){touch-action:pan-y}.missing-content{padding:14px 22px;color:var(--muted)}
.study-footer{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--line);padding:10px 22px;flex:none}.study-footer>span{color:var(--muted);font-size:.8125rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.study-footer button{flex:none;min-height:44px}.state-card.card{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;overflow-y:auto;text-align:center}.state-card h2{font-size:1.25rem}.rotation-cover{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;overflow:auto}.rotation-cover h2{font-size:1.4rem}.skeleton{border-radius:8px;background:var(--primary-soft);height:16px;width:65%;flex:none}.skeleton.title{height:34px;width:35%;margin-bottom:16px}.read-warning{margin:0;padding:8px 28px;color:var(--danger,#b54708)}
.study-top .exit:hover:not(:disabled){color:var(--ink);background:var(--primary-soft)}
button:focus-visible{outline:3px solid var(--primary);outline-offset:3px}button:disabled{cursor:default}
@media(max-width:900px){.daily-study-shell{padding-left:max(12px,env(safe-area-inset-left));padding-right:max(12px,env(safe-area-inset-right));padding-bottom:max(10px,env(safe-area-inset-bottom))}.study-top{gap:10px;min-height:54px;margin-bottom:8px}.study-scope{max-width:170px;padding-left:10px}.word-heading{padding:12px 18px}.word-heading h1{font-size:2rem}.study-footer{padding:10px 18px}.study-workspace{gap:8px}}
@media(max-width:600px){.study-scope,.study-top .exit{display:none}.study-top{flex-wrap:wrap;gap:8px}.study-top>strong{font-size:1.125rem}.word-heading h1{font-size:1.625rem}.study-footer{padding:8px 12px;gap:8px}.study-footer>span{display:none}.word-heading{padding:10px 12px}.study-card.card{border-radius:16px}}
@media(max-height:420px){.study-top{min-height:44px;margin-bottom:6px}.word-heading{padding:8px 14px}.word-heading h1{font-size:1.625rem}.word-heading p{margin-top:2px}.study-footer{padding:6px 14px}.study-workspace{gap:4px}.daily-study-shell{padding-bottom:max(6px,env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){.settling>.study-card{transition:none}}
</style>

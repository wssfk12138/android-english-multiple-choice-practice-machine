<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Star } from 'lucide-vue-next'
const props = defineProps<{ term: string; frequent?: boolean }>()
const root = ref<HTMLElement>()
const text = ref<HTMLElement>()
let observer: ResizeObserver | undefined
let frame = 0
function fit() {
  const container = root.value
  const label = text.value
  if (!container || !label || !container.clientWidth) return
  const base = parseFloat(getComputedStyle(container).fontSize)
  label.style.fontSize = `${base}px`
  const width = label.getBoundingClientRect().width
  if (width > container.clientWidth) label.style.fontSize = `${Math.max(14, base * (container.clientWidth - 2) / width)}px`
}
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) }
onMounted(() => {
  observer = new ResizeObserver(schedule)
  if (root.value) observer.observe(root.value)
  window.addEventListener('resize', schedule)
  document.fonts?.ready.then(schedule)
  schedule()
})
watch(() => [props.term, props.frequent], () => nextTick(schedule))
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule) })
</script>
<template><span ref="root" class="vocabulary-term-fit"><span ref="text" class="vocabulary-term-text"><Star v-if="frequent" :size="18" aria-label="高频词" />{{ term }}</span></span></template>
<style scoped>
.vocabulary-term-fit { display:block; max-width:100%; min-width:0; overflow-x:auto; }
.vocabulary-term-text { display:inline-block; white-space:nowrap; line-height:1.25; vertical-align:top; }
.vocabulary-term-text svg { margin-right:6px; vertical-align:middle; }
</style>

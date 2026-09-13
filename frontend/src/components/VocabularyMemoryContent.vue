<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import VocabularyEnrichment from './VocabularyEnrichment.vue'
import type { VocabDisplayConfig } from '../services/vocabularyDisplayConfig'
const props = defineProps<{ entry: any; config: VocabDisplayConfig; expanded?: boolean }>()
const root = ref<HTMLElement>()
const groups = computed(() => [
  { key: 'contextual', label: '本句语境', text: props.entry.contextual_meaning !== props.entry.common_meaning ? props.entry.contextual_meaning : '' },
  { key: 'sentence', label: props.entry.latest_sentence ? '真题原句' : '模型例句', text: props.entry.latest_sentence || props.entry.generated_example?.sentence, translation: props.entry.latest_sentence ? '' : props.entry.generated_example?.translation },
  { key: 'morphology', label: '词形变化', text: props.entry.morphology?.currentForm },
  { key: 'synonyms', label: '同义词辨析', list: props.entry.synonyms },
  { key: 'antonyms', label: '反义词辨析', list: props.entry.antonyms },
  { key: 'similar_forms', label: '形近词辨析', list: [...(props.entry.local_similar || []).map((item: any) => ({ ...item, local: true })), ...(props.entry.similar_forms || [])] },
  { key: 'memory_hint', label: '记忆提示', text: props.entry.memory_hint },
  { key: 'note', label: '我的笔记', text: props.entry.note },
].filter(group => (group.key === 'note' || props.expanded || props.config[group.key as keyof VocabDisplayConfig]) && (group.text || group.list?.length)))
function narrow() { return matchMedia('(max-width: 900px), (orientation: portrait)').matches }
function toggle(event: Event) {
  const target = event.target as HTMLDetailsElement
  if (target.open && narrow()) root.value?.querySelectorAll('details[open]').forEach(item => { if (item !== target) (item as HTMLDetailsElement).open = false })
}
function collapseForNarrow() {
  if (narrow()) root.value?.querySelectorAll('details[open]').forEach((item, index) => { if (index) (item as HTMLDetailsElement).open = false })
}
onMounted(() => window.addEventListener('resize', collapseForNarrow))
onBeforeUnmount(() => window.removeEventListener('resize', collapseForNarrow))
watch(() => props.entry.id, () => root.value?.querySelectorAll('details').forEach(item => { item.open = false }))
</script>
<template>
  <div ref="root" class="vocab-memory-content">
    <section class="review-meaning-block detail-section">
      <div class="review-meaning-heading"><small>常用释义</small><span v-if="entry.part_of_speech" class="review-part-of-speech">{{ entry.part_of_speech }}</span></div>
      <strong>{{ entry.common_meaning || entry.contextual_meaning || '释义待补充' }}</strong>
    </section>
    <details v-for="group in groups" :key="group.key" class="memory-layer" @toggle="toggle">
      <summary>{{ group.label }}</summary>
      <VocabularyEnrichment v-if="group.key === 'morphology'" :entry="entry" :show-morphology="true" :show-sentence="false" />
      <ul v-else-if="group.list" class="discrimination-list"><li v-for="(item, index) in group.list" :key="index"><strong>{{ item.word }}</strong><span>{{ item.note }}<em v-if="item.local" class="source-tag">本地</em></span></li></ul>
      <template v-else><p>{{ group.text }}</p><p v-if="group.translation">{{ group.translation }}</p><small v-if="group.key === 'sentence' && entry.latest_sentence && entry.occurrences?.length">{{ entry.occurrences[0].year || '未知年份' }} · {{ entry.occurrences[0].unit_title || entry.occurrences[0].unit_type || '' }}</small></template>
    </details>
  </div>
</template>
<style scoped>
.vocab-memory-content { min-width:0; }
.review-meaning-block strong { display:block; line-height:1.65; }
.memory-layer { border-top:1px solid var(--line); padding:8px 0; }
.memory-layer summary { cursor:pointer; min-height:36px; align-content:center; font-weight:600; }
.memory-layer p,.memory-layer li,.review-meaning-block { overflow-wrap:anywhere; }
</style>

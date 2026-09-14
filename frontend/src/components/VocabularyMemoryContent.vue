<script setup lang="ts">
import { computed, ref } from 'vue'
import VocabularyEnrichment from './VocabularyEnrichment.vue'
import type { VocabDisplayConfig } from '../services/vocabularyDisplayConfig'
const props = defineProps<{ entry: any; config: VocabDisplayConfig; expanded?: boolean }>()
const root = ref<HTMLElement>()
const groups = computed(() => [
  { key: 'source_sentence', label: '真题原句', text: props.entry.latest_sentence, source: true },
  { key: 'model_sentence', label: '模型例句', text: props.entry.generated_example?.sentence, translation: props.entry.generated_example?.translation },
  { key: 'morphology', label: '词形变化', text: props.entry.morphology?.currentForm },
  { key: 'synonyms', label: '同义词辨析', list: props.entry.synonyms },
  { key: 'antonyms', label: '反义词辨析', list: props.entry.antonyms },
  { key: 'similar_forms', label: '形近词辨析', list: [...(props.entry.local_similar || []).map((item: any) => ({ ...item, local: true })), ...(props.entry.similar_forms || [])] },
  { key: 'memory_hint', label: '记忆提示', text: props.entry.memory_hint },
  { key: 'note', label: '我的笔记', text: props.entry.note },
  ].filter(group => (group.key === 'source_sentence' || group.key === 'note' || props.config[group.key as keyof VocabDisplayConfig]) && (group.text || group.list?.length)))
</script>
<template>
  <div ref="root" class="vocab-memory-content">
    <section class="review-meaning-block detail-section">
      <div class="review-meaning-heading"><small>常用释义</small><span v-if="entry.part_of_speech" class="review-part-of-speech">{{ entry.part_of_speech }}</span></div>
      <strong>{{ entry.common_meaning || entry.contextual_meaning || '释义待补充' }}</strong>
    </section>
    <details v-for="group in groups" v-if="!group.source" :key="group.key" class="memory-layer">
      <summary>{{ group.label }}</summary>
      <VocabularyEnrichment v-if="group.key === 'morphology'" :entry="entry" :show-morphology="true" :show-sentence="false" />
      <ul v-else-if="group.list" class="discrimination-list"><li v-for="(item, index) in group.list" :key="index"><strong>{{ item.word }}</strong><span>{{ item.note }}<em v-if="item.local" class="source-tag">本地</em></span></li></ul>
      <template v-else><p>{{ group.text }}</p><p v-if="group.translation">{{ group.translation }}</p></template>
    </details>
    <section v-for="group in groups" v-else :key="group.key" class="memory-layer memory-layer-static">
      <h4>{{ group.label }}</h4>
      <p>{{ group.text }}</p><small v-if="entry.occurrences?.length">{{ entry.occurrences[0].year || '未知年份' }} · {{ entry.occurrences[0].unit_title || entry.occurrences[0].unit_type || '' }}</small>
    </section>
  </div>
</template>
<style scoped>
.vocab-memory-content { min-width:0; }
.review-meaning-block strong { display:block; line-height:1.65; }
.memory-layer { border-top:1px solid var(--line); padding:8px 0; }
.memory-layer summary { cursor:pointer; min-height:36px; align-content:center; font-weight:600; }
.memory-layer p,.memory-layer li,.review-meaning-block { overflow-wrap:anywhere; }
</style>

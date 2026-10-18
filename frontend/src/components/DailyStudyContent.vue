<script setup lang="ts">
import { computed } from 'vue'
import VocabularyMemoryContent from './VocabularyMemoryContent.vue'
import { hasStudyField, STUDY_CONTENT_ORDER, STUDY_FIELD_CONFIGS } from '../services/dailyStudyContent'
import { VOCAB_DISPLAY_OPTIONS, type VocabDisplayConfig } from '../services/vocabularyDisplayConfig'
const props = defineProps<{ entry: Record<string, any> }>()
const keys = computed(() => STUDY_CONTENT_ORDER.filter(key => hasStudyField(props.entry, key)))
const bodyKeys = computed(() => keys.value.filter(key => key !== 'memory_hint'))
const shortMeaning = computed(() => bodyKeys.value.length === 1 && bodyKeys.value[0] === 'common_meaning' && props.entry.common_meaning.length < 120)
const hintLabel = VOCAB_DISPLAY_OPTIONS.find(option => option.key === 'memory_hint')!.label
</script>
<template>
  <div class="study-content">
    <section v-if="keys.includes('memory_hint')" data-study-section="memory_hint" class="featured-hint">
      <h4>{{ hintLabel }}</h4><p class="hint-text">{{ entry.memory_hint }}</p>
    </section>
    <div v-if="bodyKeys.length" class="reading-flow" :class="{ 'single-short': shortMeaning }">
      <div v-for="key in bodyKeys" :key="key" :data-study-section="key" class="layout-block">
        <VocabularyMemoryContent :entry="entry" :config="STUDY_FIELD_CONFIGS[key] as VocabDisplayConfig" static-content />
      </div>
    </div>
    <p v-if="!keys.length" class="missing-content">此词暂无学习内容</p>
  </div>
</template>
<style scoped>
.study-content{padding:14px 22px 8px;min-width:0;container-type:inline-size}
.reading-flow:not(.single-short){column-count:2;column-fill:balance;column-gap:28px;column-rule:1px solid var(--line)}
.layout-block,.reading-flow :deep(.vocab-memory-content),.reading-flow :deep(.memory-layer){display:contents}
.reading-flow :deep(p),.reading-flow :deep(li){orphans:1;widows:1;break-inside:auto;overflow-wrap:anywhere}
.reading-flow :deep(h4),.reading-flow :deep(.review-meaning-heading){break-after:avoid;break-inside:avoid}
.reading-flow :deep(h4){margin:10px 0 5px;padding-top:9px;border-top:1px solid var(--line);font-size:.875rem;line-height:1.5}
.reading-flow :deep(p){margin:5px 0;font-size:1rem;line-height:1.7;white-space:pre-line}
.reading-flow :deep(.review-meaning-block){padding:2px 0 8px;margin:0;border-bottom:0}
.reading-flow :deep(.review-meaning-heading){margin-bottom:4px}
.reading-flow :deep(.review-meaning-heading small){font-size:.8125rem;color:var(--muted)}
.reading-flow :deep(.review-meaning-block strong){font-size:1.3125rem;line-height:1.65;color:var(--ink);font-weight:650;overflow-wrap:anywhere;white-space:pre-line}
.reading-flow :deep(.memory-layer-static small){color:var(--muted);font-size:.8125rem;overflow-wrap:anywhere}
.reading-flow :deep(.discrimination-list),.reading-flow :deep(.morphology-section ul){display:block;list-style:none;padding:0;margin:4px 0}
.reading-flow :deep(.discrimination-list li){display:block;padding:5px 0;line-height:1.65;white-space:pre-line}
.reading-flow :deep(.discrimination-list strong){font-size:1rem;margin-right:12px;overflow-wrap:anywhere}
.reading-flow :deep(.discrimination-list span){font-size:1rem;line-height:1.65;color:var(--muted)}
.reading-flow :deep(.morphology-section){padding:0;border:0}
.reading-flow :deep(.morphology-section label){font-size:.8125rem;margin:2px 0;break-after:auto}
.reading-flow :deep(.morphology-section li){display:inline;margin-right:16px;font-size:1rem;line-height:1.7}
.featured-hint{padding:12px 16px;margin:0 0 14px;border:1px solid var(--line);border-left:4px solid var(--primary);border-radius:12px;background:var(--primary-soft);color:var(--ink)}
.featured-hint h4{font-size:.9375rem;line-height:1.5;margin:0 0 6px;color:var(--primary);font-weight:700}
.hint-text{column-count:2;column-fill:balance;column-gap:28px;font-size:1.0625rem;line-height:1.7;margin:0;white-space:pre-line;overflow-wrap:anywhere;orphans:1;widows:1}
.missing-content{color:var(--muted)}
@container(max-width:650px){.reading-flow:not(.single-short),.hint-text{column-count:1}}
</style>

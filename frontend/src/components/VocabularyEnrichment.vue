<script setup lang="ts">
import { morphologyLabel } from '../vocabulary-context'

defineProps<{ entry: any; showMorphology: boolean; showSentence: boolean }>()
</script>
<template>
  <section v-if="showMorphology && entry.morphology?.currentForm" class="detail-section morphology-section">
    <label>单词词形</label>
    <p>{{ entry.term }} → {{ entry.morphology.lemma || entry.lemma || entry.term }} · {{ morphologyLabel(entry.morphology.currentForm) }}</p>
    <p v-if="entry.morphology.ambiguous">可能有多种形态：{{ entry.morphology.note }}</p>
    <ul v-if="entry.morphology.forms?.length"><li v-for="(form, index) in entry.morphology.forms" :key="index">{{ morphologyLabel(form.label) }}：{{ form.word }}</li></ul>
  </section>
  <section v-if="showSentence && !entry.latest_sentence && entry.generated_example?.sentence" class="detail-section model-example">
    <label>模型例句</label><blockquote>{{ entry.generated_example.sentence }}</blockquote><p>{{ entry.generated_example.translation }}</p>
  </section>
</template>
<style scoped>
p, blockquote, li { overflow-wrap: anywhere; }
blockquote { margin: .5em 0; }
ul { padding-left: 1.4em; }
</style>

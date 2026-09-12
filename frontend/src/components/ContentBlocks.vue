<script setup lang="ts">
import { computed } from 'vue'
import { splitPassageBlanks } from '../passage-blanks'
import PassageBlank from './PassageBlank.vue'

const props = withDefaults(defineProps<{
  blocks?: any[]
  packageId?: string
  contentVersion?: string
  blankNumbers?: number[]
}>(), {
  blocks: () => [],
  packageId: '',
  contentVersion: '',
  blankNumbers: () => [],
})

const hasBlocks = computed(() => props.blocks.length > 0)

function assetUrl(assetId: string) {
  if (!props.packageId || !props.contentVersion || !assetId) return ''
  return `/api/question-banks/assets/${encodeURIComponent(props.packageId)}/${encodeURIComponent(props.contentVersion)}/${encodeURIComponent(assetId)}`
}

function textParts(text: string) {
  return splitPassageBlanks(text, props.blankNumbers)
}
</script>

<template>
  <div v-if="hasBlocks" class="content-blocks">
    <template v-for="block in blocks" :key="block.blockKey">
      <p v-if="block.type === 'paragraph' || block.type === 'quote'" class="content-block-text" :class="{quote:block.type === 'quote'}">
        <template v-for="(part, index) in textParts(block.text || '')" :key="`${block.blockKey}-${index}`">
          <PassageBlank v-if="part.type === 'blank'" :number="part.number" />
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <figure v-else-if="block.type === 'image' && assetUrl(block.assetId)" class="content-block-media">
        <img :src="assetUrl(block.assetId)" :alt="block.alt || '题库图片'" />
        <figcaption v-if="block.caption">{{ block.caption }}</figcaption>
      </figure>
      <div v-else-if="block.type === 'table'" class="content-block-table">
        <div v-if="block.caption" class="content-block-caption">{{ block.caption }}</div>
        <table><tbody><tr v-for="(row, rowIndex) in block.rows || []" :key="`${block.blockKey}-${rowIndex}`"><td v-for="(cell, cellIndex) in row" :key="`${block.blockKey}-${rowIndex}-${cellIndex}`">
          <template v-for="(part, partIndex) in textParts(String(cell ?? ''))" :key="partIndex">
            <PassageBlank v-if="part.type === 'blank'" :number="part.number" />
            <template v-else>{{ part.text }}</template>
          </template>
        </td></tr></tbody></table>
      </div>
      <div v-else-if="block.type === 'audio' && assetUrl(block.assetId)" class="content-block-audio">
        <audio controls :src="assetUrl(block.assetId)"></audio>
        <p v-if="block.transcript" class="lead">{{ block.transcript }}</p>
      </div>
      <hr v-else-if="block.type === 'separator'" />
    </template>
  </div>
</template>

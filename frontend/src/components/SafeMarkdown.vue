<script setup lang="ts">
import { computed } from 'vue'
import { renderSafeMarkdown } from '../services/safe-markdown'

const props = defineProps<{ text: string }>()

const html = computed(() => renderSafeMarkdown(props.text))
</script>

<template>
  <div v-if="html" class="safe-markdown" v-html="html"></div>
  <!-- 净化失败时回退纯文本，原始报告内容不丢。 -->
  <div v-else class="safe-markdown safe-markdown-plain">{{ text }}</div>
</template>

<style>
.safe-markdown { line-height: 1.85; overflow-wrap: anywhere; }
.safe-markdown h1, .safe-markdown h2, .safe-markdown h3, .safe-markdown h4 { margin: .8em 0 .4em; font-size: 1.05em; }
.safe-markdown h1:first-child, .safe-markdown h2:first-child, .safe-markdown h3:first-child { margin-top: 0; }
.safe-markdown p { margin: .5em 0; }
.safe-markdown ul, .safe-markdown ol { margin: .5em 0; padding-left: 1.4em; }
.safe-markdown code { padding: 1px 5px; border-radius: 4px; background: var(--primary-faint, rgba(0, 0, 0, .07)); font-size: .92em; }
.safe-markdown pre { overflow: auto; padding: 10px; border-radius: 8px; background: var(--primary-faint, rgba(0, 0, 0, .07)); }
.safe-markdown pre code { padding: 0; background: transparent; }
.safe-markdown blockquote { margin: .5em 0; padding: .2em .9em; border-left: 3px solid var(--border, var(--line)); color: var(--muted); }
.safe-markdown table { border-collapse: collapse; }
.safe-markdown td, .safe-markdown th { border: 1px solid var(--border, var(--line)); padding: 4px 8px; }
.safe-markdown a { word-break: break-all; }
.safe-markdown-plain { white-space: pre-wrap; }
</style>

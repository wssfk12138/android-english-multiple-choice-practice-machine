<script setup lang="ts">
import DOMPurify from 'dompurify'
import { ArrowLeft, BookOpen, ExternalLink, List, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onMounted, ref } from 'vue'
import { marked } from 'marked'
import { useRouter } from 'vue-router'
import { platformRuntime } from '../platform/runtime'
import helpMarkdown from '../../../docs/帮助文档.md?raw'

type Section = { id: string; title: string; level: number; text: string }

const router = useRouter()
const query = ref('')
const mobileTocOpen = ref(false)
const content = ref<HTMLElement | null>(null)

function slugify(value: string, index: number) {
  const slug = value.toLowerCase().trim().replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, '-').replace(/^-|-$/g, '')
  return slug || `section-${index}`
}

const sections = computed<Section[]>(() => {
  const rows: Section[] = []
  const seen = new Set<string>()
  helpMarkdown.split(/\r?\n/).forEach(line => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (!match) return
    const title = match[2].replace(/[*_`]/g, '').trim()
    let id = slugify(title, rows.length)
    while (seen.has(id)) id = `${id}-${rows.length}`
    seen.add(id)
    rows.push({ id, title, level: match[1].length, text: title.toLowerCase() })
  })
  return rows
})

const rendered = computed(() => {
  const html = marked.parse(helpMarkdown, { gfm: true, breaks: true }) as string
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] })
})

const filteredSections = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return needle ? sections.value.filter(section => section.text.includes(needle)) : sections.value
})

function closeAndBack() {
  if (window.history.length > 1) router.back()
  else {
    const isCompactAndroid = platformRuntime.isAndroid && document.documentElement.dataset.windowMode === 'compact'
    router.replace(isCompactAndroid ? '/mobile-settings' : '/settings')
  }
}

function openSection(id: string) {
  mobileTocOpen.value = false
  nextTick(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function enhanceHeadings() {
  if (!content.value) return
  const headingMap = sections.value
  content.value.querySelectorAll('h1,h2,h3').forEach((heading, index) => {
    const section = headingMap[index]
    if (section) heading.id = section.id
  })
  content.value.querySelectorAll('a').forEach(link => {
    if (link.getAttribute('href')?.startsWith('http')) {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    }
  })
}

onMounted(enhanceHeadings)
</script>

<template>
  <main class="page help-page">
    <header class="help-toolbar">
      <button class="icon-button" type="button" aria-label="返回" @click="closeAndBack"><ArrowLeft :size="20" /></button>
      <div class="help-title"><BookOpen :size="20" /><div><span class="eyebrow">DOCUMENTATION</span><h1>使用帮助</h1></div></div>
      <div class="help-toolbar-actions">
        <label class="help-search"><Search :size="16" /><span class="sr-only">搜索帮助内容</span><input v-model="query" type="search" placeholder="搜索帮助内容" aria-label="搜索帮助内容"></label>
        <button class="icon-button help-toc-toggle" type="button" aria-label="打开目录" :aria-expanded="mobileTocOpen" @click="mobileTocOpen=!mobileTocOpen"><List :size="20" /></button>
      </div>
    </header>

    <div class="help-layout">
      <aside class="help-toc" :class="{ open: mobileTocOpen }" aria-label="帮助目录">
        <div class="help-toc-head"><strong>目录</strong><button class="icon-button help-toc-close" type="button" aria-label="关闭目录" @click="mobileTocOpen=false"><X :size="18" /></button></div>
        <button v-for="section in filteredSections" :key="section.id" class="help-toc-item" :class="[`level-${section.level}`]" type="button" @click="openSection(section.id)">{{ section.title }}</button>
        <p v-if="!filteredSections.length" class="help-empty">没有匹配的章节</p>
      </aside>
      <div v-if="mobileTocOpen" class="help-toc-backdrop" aria-hidden="true" @click="mobileTocOpen=false" />
      <article ref="content" class="help-content markdown-body" v-html="rendered" />
    </div>

    <a class="help-feedback" href="https://xiaoheihe.cn/creator/content_management/detail/187311918" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />问题反馈</a>
  </main>
</template>

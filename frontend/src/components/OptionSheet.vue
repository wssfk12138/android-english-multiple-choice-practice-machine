<script setup lang="ts">
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { pushOverlayHistory } from '../platform/overlay-history'

export type OptionSheetItem = {
  value: string | number
  label: string
  hint?: string
  disabled?: boolean
  /** 明确的不可用语义（如“本次同步未发现”），区别于普通禁用。 */
  unavailableNote?: string
}

const props = withDefaults(defineProps<{
  modelValue: string | number
  items: OptionSheetItem[]
  title: string
  placeholder?: string
  searchable?: boolean
  disabled?: boolean
}>(), { placeholder: '请选择', searchable: false, disabled: false })

const emit = defineEmits<{ (event: 'update:modelValue', value: string | number): void }>()

const open = ref(false)
const search = ref('')
const sheetTitleId = 'option-sheet-title'
let overlayHandle: { close: () => void; dispose: () => void } | null = null

const current = computed(() => props.items.find(item => item.value === props.modelValue))
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return props.items
  return props.items.filter(item =>
    item.label.toLowerCase().includes(keyword) || String(item.hint || '').toLowerCase().includes(keyword))
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    open.value = false
  }
}

watch(open, async (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    search.value = ''
    overlayHandle = pushOverlayHistory(() => { open.value = false })
    window.addEventListener('keydown', onKeydown)
  } else if (!isOpen && wasOpen) {
    overlayHandle?.dispose()
    overlayHandle = null
    window.removeEventListener('keydown', onKeydown)
  }
})

function choose(item: OptionSheetItem) {
  if (item.disabled) return
  emit('update:modelValue', item.value)
  open.value = false
}
</script>

<template>
  <button
    class="option-sheet-trigger"
    type="button"
    :disabled="disabled"
    :aria-haspopup="searchable ? 'dialog' : 'listbox'"
    :aria-expanded="open"
    @click="open = true"
  >
    <span v-if="current" class="option-sheet-value">{{ current.label }}</span>
    <span v-else class="option-sheet-value option-sheet-placeholder">{{ placeholder }}</span>
    <ChevronDown :size="18" />
  </button>

  <Teleport to="body">
    <section
      v-if="open"
      class="app-sheet-overlay"
      role="presentation"
      @click.self="open = false"
    >
      <section class="app-sheet" role="dialog" aria-modal="true" :aria-labelledby="sheetTitleId">
        <header class="app-sheet-head">
          <h3 :id="sheetTitleId">{{ title }}</h3>
          <button class="app-sheet-close" type="button" aria-label="关闭" @click="open = false"><X :size="20" /></button>
        </header>
        <div v-if="searchable" class="app-sheet-search">
          <Search :size="16" />
          <input v-model="search" type="search" placeholder="搜索" :aria-label="`搜索${title}`">
        </div>
        <div class="app-sheet-list" role="listbox">
          <button
            v-for="item in filtered"
            :key="item.value"
            class="app-sheet-option"
            :class="{ selected: item.value === modelValue }"
            type="button"
            role="option"
            :aria-selected="item.value === modelValue"
            :disabled="item.disabled"
            @click="choose(item)"
          >
            <span class="app-sheet-option-copy">
              <strong>{{ item.label }}</strong>
              <small v-if="item.unavailableNote">{{ item.unavailableNote }}</small>
              <small v-else-if="item.hint">{{ item.hint }}</small>
            </span>
            <Check v-if="item.value === modelValue" class="app-sheet-option-mark" :size="18" />
          </button>
          <div v-if="!filtered.length" class="app-sheet-empty">
            {{ search.trim() ? '没有匹配的结果，换个关键词试试。' : '当前没有可选项。' }}
          </div>
        </div>
      </section>
    </section>
  </Teleport>
</template>

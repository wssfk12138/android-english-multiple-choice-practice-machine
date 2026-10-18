<script setup lang="ts">
import { ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

defineProps<{ value: string }>()
const emit = defineEmits<{ change: [value: string] }>()
const open = ref(false)
const options = [
  ['new', '新词（尚未学习）'],
  ['all', '全部单词'],
  ['review', '每日一背'],
  ['frequent', '高频词'],
  ['learning', '学习中'],
  ['mastered', '已掌握'],
  ['pending', '等待翻译'],
] as const
</script>

<template>
  <div class="study-filter">
    <button class="button ghost study-filter-trigger" type="button" :aria-expanded="open" @click="open = !open">
      <span>筛选：<strong>{{ options.find(option => option[0] === value)?.[1] || '新词（尚未学习）' }}</strong></span>
      <ChevronDown :size="16" />
    </button>
    <template v-if="open">
      <button class="filter-dismiss" type="button" aria-label="关闭筛选" @click="open = false"></button>
      <div class="study-filter-panel" role="group" aria-label="每日一学单词筛选">
        <button
          v-for="option in options"
          :key="option[0]"
          type="button"
          :class="{ chosen: option[0] === value }"
          @click="open = false; emit('change', option[0])"
        >
          <span>{{ option[1] }}</span>
          <Check v-if="option[0] === value" :size="17" />
        </button>
        <p>按加入时间从新到旧</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.study-filter {
  position: relative;
  flex: none;
  z-index: 5;
}
.study-filter-trigger {
  min-height: 40px;
  color: var(--muted) !important;
  border: 1px solid var(--line) !important;
  background: var(--surface-solid) !important;
  font-size: 13px;
}
.study-filter-trigger strong {
  color: var(--ink);
  font-weight: 600;
}
.filter-dismiss {
  position: fixed;
  inset: 0;
  z-index: 1;
  border: 0;
  background: transparent;
}
.study-filter-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 2;
  width: 245px;
  padding: 7px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface-solid);
  box-shadow: var(--shadow);
}
.study-filter-panel button {
  display: flex;
  width: 100%;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.study-filter-panel button:hover,
.study-filter-panel .chosen {
  background: var(--primary-soft);
  color: var(--primary);
}
.study-filter-panel p {
  margin: 5px 10px 3px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 900px) {
  .study-filter-trigger { font-size: 12px; }
}
</style>

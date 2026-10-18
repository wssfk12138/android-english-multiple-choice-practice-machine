<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { LoaderCircle, Square, Volume2 } from 'lucide-vue-next'
import { speak, speech, stop, type SpeechAccent } from '../services/pronunciation'

const props = defineProps<{
  text: string
  ownerId: string
  disabled?: boolean
}>()

const active = computed(() => speech.ownerId === props.ownerId
  && (speech.state === 'loading' || speech.state === 'playing'))
const error = computed(() => speech.ownerId === props.ownerId && speech.state === 'error' ? speech.error : '')

function toggle(accent: SpeechAccent) {
  if (props.disabled || !props.text.trim()) return
  if (active.value && speech.accent === accent) {
    void stop(props.ownerId)
    return
  }
  void speak(props.text, accent, props.ownerId)
}

watch(() => props.text, () => { void stop(props.ownerId) })
onBeforeUnmount(() => { void stop(props.ownerId) })
</script>

<template>
  <span class="pronunciation" role="group" :aria-label="text + '的发音'">
    <button
      v-for="accent in (['us', 'gb'] as SpeechAccent[])"
      :key="accent"
      type="button"
      class="voice-button"
      :class="{ speaking: active && speech.accent === accent }"
      :disabled="disabled || !text.trim()"
      :aria-label="(accent === 'us' ? '美式' : '英式') + '发音：' + text"
      :aria-pressed="active && speech.accent === accent"
      @click.stop.prevent="toggle(accent)"
    >
      <LoaderCircle v-if="active && speech.accent === accent && speech.state === 'loading'" :size="16" class="spin" />
      <Square v-else-if="active && speech.accent === accent" :size="14" />
      <Volume2 v-else :size="16" />
      <span>{{ accent === 'us' ? '美音' : '英音' }}</span>
    </button>
    <span v-if="error" class="voice-error" role="alert">{{ error }}</span>
  </span>
</template>

<style scoped>
.pronunciation {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.voice-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 64px;
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-solid);
  color: var(--primary);
  font: 600 13px/1.2 inherit;
  white-space: nowrap;
  cursor: pointer;
}
.voice-button:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.voice-button.speaking {
  border-color: var(--primary);
  background: var(--primary);
  color: white;
}
.voice-button:disabled {
  opacity: .45;
  cursor: default;
}
.voice-button:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 3px;
}
.voice-error {
  color: var(--danger, #b54708);
  font-size: 12px;
  white-space: normal;
}
.spin { animation: voice-spin 1s linear infinite; }
@keyframes voice-spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .voice-button { min-width: 58px; padding-inline: 8px; }
}
</style>

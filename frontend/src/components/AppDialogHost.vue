<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { nextTick, ref, watch } from 'vue'
import { dialogActions, dialogState } from '../platform/dialogs'
import { pushOverlayHistory } from '../platform/overlay-history'

const confirmButton = ref<HTMLButtonElement | null>(null)
const inputField = ref<HTMLInputElement | null>(null)
let overlayHandle: { close: () => void; dispose: () => void } | null = null

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    dialogActions.cancel()
  }
}

watch(
  () => dialogState.current,
  async (current, previous) => {
    if (current && !previous) {
      overlayHandle = pushOverlayHistory(() => dialogActions.cancel())
      window.addEventListener('keydown', onKeydown)
      await nextTick()
      if (current.input) inputField.value?.focus()
      else confirmButton.value?.focus()
    } else if (!current && previous) {
      overlayHandle?.dispose()
      overlayHandle = null
      window.removeEventListener('keydown', onKeydown)
    }
  },
)

function paragraphs(message: string | string[]) {
  return Array.isArray(message) ? message : [message]
}
</script>

<template>
  <Teleport to="body">
    <section
      v-if="dialogState.current"
      class="app-overlay"
      role="presentation"
      @click.self="dialogActions.cancel()"
    >
      <section
        class="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
      >
        <header class="app-dialog-head">
          <span v-if="dialogState.current.danger" class="app-dialog-icon danger"><TriangleAlert :size="22" /></span>
          <h2 id="app-dialog-title">{{ dialogState.current.title }}</h2>
        </header>
        <div class="app-dialog-body">
          <p v-for="(line, index) in paragraphs(dialogState.current.message)" :key="index">{{ line }}</p>
          <div v-if="dialogState.current.input" class="field">
            <label v-if="dialogState.current.input.label" for="app-dialog-input">{{ dialogState.current.input.label }}</label>
            <input
              id="app-dialog-input"
              ref="inputField"
              :value="dialogState.current.inputValue"
              :placeholder="dialogState.current.input.placeholder || ''"
              @input="dialogActions.setInput(($event.target as HTMLInputElement).value)"
              @keyup.enter="dialogActions.confirm()"
            >
          </div>
          <p v-if="dialogState.current.error" class="warning" role="alert">{{ dialogState.current.error }}</p>
        </div>
        <footer class="app-dialog-actions">
          <button class="button secondary" type="button" :disabled="dialogState.current.busy" @click="dialogActions.cancel()">
            {{ dialogState.current.cancelLabel || '取消' }}
          </button>
          <button
            ref="confirmButton"
            class="button"
            :class="{ danger: dialogState.current.danger }"
            type="button"
            :disabled="dialogState.current.busy"
            @click="dialogActions.confirm()"
          >
            {{ dialogState.current.busy ? '正在处理…' : dialogState.current.confirmLabel || '确定' }}
          </button>
        </footer>
      </section>
    </section>
  </Teleport>
</template>

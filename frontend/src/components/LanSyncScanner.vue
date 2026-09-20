<script setup lang="ts">
import { Flashlight, FlashlightOff, X } from 'lucide-vue-next'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { scanLanSyncQr, type LanSyncQrPayload } from '../platform/android/lan-sync-qr'

const emit = defineEmits<{
  scanned: [payload: LanSyncQrPayload]
  failed: [message: string]
  closed: []
}>()
const controller = new AbortController()
const closeButton = ref<HTMLButtonElement | null>(null)
const torchAvailable = ref(false)
const torchEnabled = ref(false)
const ready = ref(false)
const torchBusy = ref(false)
const scannerError = ref('')
let mounted = true
let torchOperation: Promise<void> | null = null
let previousFocus: HTMLElement | null = null
let ownsPreview = false

function hidePreview() {
  if (!ownsPreview) return
  ownsPreview = false
  document.documentElement.classList.remove('lan-scanner-active')
}

function cancel() { controller.abort() }
function visibilityChanged() { if (document.hidden) cancel() }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); cancel() }
  if (event.key === 'Tab') {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lan-scanner button:not(:disabled)'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
async function toggleTorch() {
  if (!ready.value || torchBusy.value || controller.signal.aborted) return
  torchBusy.value = true
  torchOperation = (async () => {
    try {
      if (torchEnabled.value) await BarcodeScanner.disableTorch()
      else await BarcodeScanner.enableTorch()
      torchEnabled.value = !torchEnabled.value
    } catch { scannerError.value = '闪光灯暂不可用' }
    finally { torchBusy.value = false }
  })()
  await torchOperation
}

onMounted(async () => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('visibilitychange', visibilityChanged)
  document.addEventListener('keydown', keydown)
  await nextTick()
  closeButton.value?.focus()
  let payload: LanSyncQrPayload | undefined
  let failure = ''
  try {
    payload = await scanLanSyncQr({
      signal: controller.signal,
      async showPreview() {
        // ML Kit renders behind the WebView; reveal it only while this overlay owns the camera.
        // https://github.com/capawesome-team/capacitor-mlkit/tree/main/packages/barcode-scanning#usage
        document.documentElement.classList.add('lan-scanner-active')
        ownsPreview = true
        await nextTick()
      },
      onStarted() {
        ready.value = true
        void BarcodeScanner.isTorchAvailable().then(({ available }) => {
          if (mounted && !controller.signal.aborted) torchAvailable.value = available
        }).catch(() => undefined)
      },
      async cleanup() {
        ready.value = false
        await torchOperation
        if (torchEnabled.value) await BarcodeScanner.disableTorch().catch(() => undefined)
        hidePreview()
      },
    })
  } catch (cause) {
    if (!controller.signal.aborted && !(cause instanceof Error && cause.name === 'AbortError')) {
      failure = cause instanceof Error ? cause.message : '无法打开相机，请重试'
    }
  } finally {
    controller.abort()
    hidePreview()
    document.removeEventListener('visibilitychange', visibilityChanged)
    document.removeEventListener('keydown', keydown)
    if (mounted) {
      previousFocus?.focus()
      if (payload) emit('scanned', payload)
      else if (failure) emit('failed', failure)
      emit('closed')
    }
  }
})
onBeforeUnmount(() => {
  mounted = false
  cancel()
  hidePreview()
  document.removeEventListener('visibilitychange', visibilityChanged)
  document.removeEventListener('keydown', keydown)
})
</script>

<template>
  <Teleport to="body">
    <section class="lan-scanner" role="dialog" aria-modal="true" aria-labelledby="lan-scanner-title">
      <header class="lan-scanner-toolbar">
        <h2 id="lan-scanner-title">扫码绑定</h2>
        <button ref="closeButton" class="icon-button" type="button" aria-label="关闭扫描" title="关闭扫描" @click="cancel"><X :size="24" /></button>
      </header>
      <div class="lan-scanner-stage" aria-hidden="true"><div class="lan-scanner-viewfinder"></div></div>
      <footer class="lan-scanner-controls">
        <div v-if="scannerError" role="alert">{{ scannerError }}</div>
        <button v-if="ready && torchAvailable" class="icon-button" type="button" :disabled="torchBusy" :aria-pressed="torchEnabled" :aria-label="torchEnabled ? '关闭闪光灯' : '打开闪光灯'" :title="torchEnabled ? '关闭闪光灯' : '打开闪光灯'" @click="toggleTorch">
          <FlashlightOff v-if="torchEnabled" :size="24" /><Flashlight v-else :size="24" />
        </button>
      </footer>
    </section>
  </Teleport>
</template>

<style>
html.lan-scanner-active, html.lan-scanner-active body { background: transparent !important; }
html.lan-scanner-active body > :not(.lan-scanner) { visibility: hidden !important; }
html.lan-scanner-active body > :not(.lan-scanner) * { visibility: hidden !important; }
html.lan-scanner-active body::before, html.lan-scanner-active body::after { display: none !important; }
.lan-scanner {
  position: fixed; inset: 0; z-index: 100000; visibility: visible;
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto; align-items: center; justify-items: center;
  gap: 12px; padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  color: #fff; background: #202226; isolation: isolate; overflow: hidden;
}
html.lan-scanner-active .lan-scanner { background: transparent; }
.lan-scanner-toolbar { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.lan-scanner-toolbar h2 { font-size: 20px; margin: 0; color: #fff; text-shadow: 0 1px 4px #000; }
.lan-scanner .icon-button { width: 48px; height: 48px; min-width: 48px; padding: 0; flex: 0 0 48px; display: grid; place-items: center; color: #fff; background: #25282de6; border: 1px solid #ffffff80; border-radius: 8px; }
.lan-scanner-stage { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; container-type: size; z-index: -1; }
.lan-scanner-viewfinder { width: min(360px, 78vw, calc(100dvh - 180px)); width: min(360px, 90cqw, 100cqh); aspect-ratio: 1; box-sizing: border-box; border: 3px solid #fff; border-radius: 8px; box-shadow: 0 0 0 200vmax #0006; pointer-events: none; }
.lan-scanner-controls { min-height: 48px; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px; font-size: 16px; }
</style>

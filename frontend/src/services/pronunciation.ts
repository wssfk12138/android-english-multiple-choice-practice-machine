import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { reactive } from 'vue'

export type SpeechAccent = 'us' | 'gb'
export type SpeechPhase = 'idle' | 'loading' | 'playing' | 'error'

type NativeSpeechState = {
  state: 'idle' | 'loading' | 'playing' | 'error'
  ownerId?: string
  requestId?: string
  accent?: SpeechAccent
  errorCode?: string
}

const native = registerPlugin<{
  speak(options: { text: string; accent: SpeechAccent; ownerId: string; requestId: string }): Promise<{ accepted: boolean; requestId: string }>
  stop(options: { ownerId: string }): Promise<void>
  getStatus(): Promise<{ ready: boolean; bundled: boolean; engine: string; us: boolean; gb: boolean }>
  addListener(event: 'speechState', listener: (state: NativeSpeechState) => void): Promise<PluginListenerHandle>
}>('OfflineSpeech')

export const speech = reactive({
  ownerId: '',
  requestId: '',
  accent: '' as SpeechAccent | '',
  state: 'idle' as SpeechPhase,
  error: '',
})

let listenerPromise: Promise<PluginListenerHandle> | null = null
let requestSerial = 0

function isAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

function newRequestId() {
  requestSerial += 1
  return 'speech-' + Date.now().toString(36) + '-' + requestSerial.toString(36)
}

async function ensureListener() {
  if (!isAndroid()) return
  listenerPromise ||= native.addListener('speechState', event => {
    if (!speech.ownerId || event.ownerId !== speech.ownerId) return
    if (event.requestId && event.requestId !== speech.requestId) return
    if (event.accent) speech.accent = event.accent
    if (event.state === 'idle') {
      speech.state = 'idle'
      speech.error = ''
      return
    }
    speech.state = event.state
    if (event.state === 'error') {
      speech.error = event.errorCode === 'AUDIO_FOCUS_DENIED'
        ? '音频被其他应用占用'
        : '离线发音失败，请稍后重试'
    }
  })
  await listenerPromise
}

export async function speak(text: string, accent: SpeechAccent, ownerId: string) {
  const value = text.trim()
  if (!value || !ownerId) return
  if (!isAndroid()) {
    speech.ownerId = ownerId
    speech.accent = accent
    speech.state = 'error'
    speech.error = '离线发音仅支持 Android 应用'
    return
  }
  try {
    await ensureListener()
    speech.ownerId = ownerId
    speech.requestId = newRequestId()
    speech.accent = accent
    speech.state = 'loading'
    speech.error = ''
    await native.speak({ text: value, accent, ownerId, requestId: speech.requestId })
  } catch {
    if (speech.ownerId === ownerId) {
      speech.state = 'error'
      speech.error = '无法启动离线发音'
    }
  }
}

export async function stop(ownerId: string) {
  if (!ownerId || speech.ownerId !== ownerId) return
  const requestOwner = speech.ownerId
  speech.state = 'idle'
  speech.error = ''
  if (!isAndroid()) return
  try { await native.stop({ ownerId: requestOwner }) } catch { /* A disposed page must not surface a stop failure. */ }
}

export async function speechStatus() {
  if (!isAndroid()) return { ready: false, bundled: false, engine: 'web', us: false, gb: false }
  return await native.getStatus()
}

export function disposeSpeechListener() {
  if (!listenerPromise) return
  void listenerPromise.then(handle => handle.remove()).catch(() => undefined)
  listenerPromise = null
}

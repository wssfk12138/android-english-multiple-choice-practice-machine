import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

type MotionPreferences = { reducedMotion: boolean }
const native = registerPlugin<{
  getPreferences(): Promise<MotionPreferences>
  addListener(event: 'changed', listener: (preferences: MotionPreferences) => void): Promise<PluginListenerHandle>
}>('MotionPreferences')

export function useReducedMotion() {
  const media = matchMedia('(prefers-reduced-motion: reduce)')
  const webReduced = ref(media.matches), androidReduced = ref(false)
  const changed = () => { webReduced.value = media.matches }
  let listener: PluginListenerHandle | undefined, disposed = false
  onMounted(async () => {
    media.addEventListener('change', changed)
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      try {
        listener = await native.addListener('changed', value => { androidReduced.value = value.reducedMotion })
        if (disposed) { await listener.remove(); return }
        androidReduced.value = (await native.getPreferences()).reducedMotion
      } catch { /* Keep the standard media preference if the native bridge is unavailable. */ }
    }
  })
  onBeforeUnmount(() => {
    disposed = true; media.removeEventListener('change', changed)
    void listener?.remove().catch(() => undefined)
  })
  return computed(() => webReduced.value || androidReduced.value)
}

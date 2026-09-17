import { onBeforeUnmount, onMounted, ref } from 'vue'

// Follow the native-orientation marker maintained by App, including rotation.
export function useAndroidLandscape() {
  const read = () => document.documentElement.dataset.platform === 'android'
    && document.documentElement.dataset.orientation === 'landscape'
  const landscape = ref(read())
  const observer = new MutationObserver(() => { landscape.value = read() })
  onMounted(() => {
    landscape.value = read()
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-platform', 'data-orientation'] })
  })
  onBeforeUnmount(() => observer.disconnect())
  return landscape
}

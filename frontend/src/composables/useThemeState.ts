import { onBeforeUnmount, onMounted, ref } from 'vue'
export function useThemeState() {
  const dark = ref(document.documentElement.classList.contains('dark'))
  const observer = new MutationObserver(() => { dark.value = document.documentElement.classList.contains('dark') })
  onMounted(() => observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }))
  onBeforeUnmount(() => observer.disconnect())
  return dark
}

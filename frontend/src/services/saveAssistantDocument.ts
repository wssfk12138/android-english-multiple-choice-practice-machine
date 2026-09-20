import { Capacitor, registerPlugin } from '@capacitor/core'
export async function saveAssistantDocument(buffer: ArrayBuffer, name: string) {
  if (Capacitor.isNativePlatform()) {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    const plugin = registerPlugin<{ shareDocument(options: { data: string; fileName: string }): Promise<void> }>('DocumentExtractor')
    await plugin.shareDocument({ data: btoa(binary), fileName: name })
    return
  }
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

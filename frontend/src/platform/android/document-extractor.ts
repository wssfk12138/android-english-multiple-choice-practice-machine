import { registerPlugin } from '@capacitor/core'

export type ExtractedDocument = {
  format: 'legacy_doc' | 'docx' | 'pdf'
  blocks: string[]
  text: string
  hasTextLayer: boolean
}

type DocumentExtractorPlugin = {
  extract(options: { data: string; fileName: string }): Promise<ExtractedDocument>
}

const NativeDocumentExtractor = registerPlugin<DocumentExtractorPlugin>('DocumentExtractor')

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  return NativeDocumentExtractor.extract({
    data: arrayBufferToBase64(await file.arrayBuffer()),
    fileName: file.name,
  })
}

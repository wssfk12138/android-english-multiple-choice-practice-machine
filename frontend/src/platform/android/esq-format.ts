export type EsqRecord = Record<string, any>

const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0', '1.1'])
const SUPPORTED_EXAM_TYPES = new Set([
  '',
  'cet4',
  'cet6',
  'postgraduate_english1',
  'postgraduate_english2',
])

export function validateEsqManifest(manifest: EsqRecord): void {
  if (manifest?.format !== 'esq' || !SUPPORTED_SCHEMA_VERSIONS.has(manifest?.schemaVersion)) {
    throw new Error('只支持 ESQ 1.0 / 1.1 题库包')
  }
  if (!manifest.packageId || !manifest.contentVersion || !Array.isArray(manifest.papers)) {
    throw new Error('ESQ 清单缺少稳定标识、内容版本或试卷列表')
  }
  if (manifest.papers.length < 1 || manifest.papers.length > 100) {
    throw new Error('ESQ 题库包的试卷数量无效')
  }
  if (manifest.schemaVersion !== '1.1') return

  for (const descriptor of manifest.papers) {
    const examType = descriptor?.examType
    if (typeof examType === 'string' && !SUPPORTED_EXAM_TYPES.has(examType)) {
      throw new Error(`ESQ 1.1 包含不支持的考试类型：${examType}`)
    }
    if (descriptor?.examMonth != null && !Number.isInteger(descriptor.examMonth)) {
      throw new Error('ESQ 1.1 的考试月份必须是整数')
    }
    if (descriptor?.setNumber != null && !Number.isInteger(descriptor.setNumber)) {
      throw new Error('ESQ 1.1 的套次必须是整数')
    }
    if (descriptor?.listeningTracks != null && !Array.isArray(descriptor.listeningTracks)) {
      throw new Error('ESQ 1.1 的听力轨道必须是数组')
    }
  }
}

export function esqFormatName(manifest: EsqRecord): string {
  return `esq-${manifest.schemaVersion || '1.0'}`
}

export function paperExamMetadata(
  descriptor: EsqRecord,
  paper: EsqRecord,
): { examType: string; examMonth: number; setNumber: number } {
  const examType = String(paper.examType || descriptor.examType || '')
  if (!SUPPORTED_EXAM_TYPES.has(examType)) {
    throw new Error(`ESQ 1.1 包含不支持的考试类型：${examType}`)
  }
  const examMonth = paper.examMonth ?? descriptor.examMonth ?? 0
  const setNumber = paper.setNumber ?? descriptor.setNumber ?? 1
  if (!Number.isInteger(examMonth)) throw new Error('ESQ 1.1 的考试月份必须是整数')
  if (!Number.isInteger(setNumber)) throw new Error('ESQ 1.1 的套次必须是整数')
  return { examType, examMonth, setNumber }
}

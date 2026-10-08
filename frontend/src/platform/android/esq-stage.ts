import { registerPlugin } from '@capacitor/core'

type RecordValue = Record<string, any>

/** One staged ESQ task reported by the native staging store. pending() never parses the archive. */
export interface StagedEsqTask {
  stageId: string
  filename: string
  profileId?: number
  newProfileName?: string
  /** ready.json exists: the archive was parsed once and can be reused without re-parsing. */
  ready?: boolean
  /** Last recorded parse phase: unknown | parsing | ready | failed. */
  phase?: string
  archiveBytes?: number
  /** Source archive mtime (epoch ms); used to age out abandoned failures. */
  stagedAt?: number
}

interface EsqImportPlugin {
  stageSelected(options: { name: string; size: number; profileId?: number; newProfileName?: string }): Promise<RecordValue>
  pending(): Promise<{ tasks: StagedEsqTask[] }>
  resume(options: { stageId: string }): Promise<RecordValue>
  acknowledge(options: { stageId: string }): Promise<void>
  discard(options: { stageId: string }): Promise<void>
  read(options: { stageId: string; paper: number; unit: number; question?: number }): Promise<RecordValue>
}
export const nativeEsqStage = registerPlugin<EsqImportPlugin>('EsqImport')


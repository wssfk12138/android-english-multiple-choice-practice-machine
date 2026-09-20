import { registerPlugin } from '@capacitor/core'

type RecordValue = Record<string, any>
interface EsqImportPlugin {
  stageSelected(options: { name: string; size: number; profileId?: number; newProfileName?: string }): Promise<RecordValue>
  pending(): Promise<{ tasks: Array<{ stageId: string; filename: string; profileId?: number; newProfileName?: string }> }>
  resume(options: { stageId: string }): Promise<RecordValue>
  acknowledge(options: { stageId: string }): Promise<void>
  read(options: { stageId: string; paper: number; unit: number; question?: number }): Promise<RecordValue>
}
export const nativeEsqStage = registerPlugin<EsqImportPlugin>('EsqImport')

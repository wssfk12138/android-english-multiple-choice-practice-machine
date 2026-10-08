import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

export type VocabularyTask = 'translation' | 'enrichment'
export type VocabularyFailure = 'configuration' | 'http' | 'unknown' | 'parse' | 'validation' | 'save'
export interface VocabularyBatchResult {
  requestedIds: number[]
  modelValidIds: number[]
  writtenIds: number[]
  invalid: Record<number, string>
  skipped: Record<number, 'edited_or_context_changed' | 'deleted' | 'superseded'>
  failure?: VocabularyFailure
  metadata: { httpStatus?: number; requestId?: string; finishReason?: string; usage?: Record<string, number> }
}
export interface VocabularyExecution {
  result?(result: VocabularyBatchResult): void
  saving?(): void
  beforeSend(configHash: string): Promise<void>
  response(metadata: VocabularyBatchResult['metadata']): void
  current(db: SQLiteDBConnection): Promise<boolean>
  commit(db: SQLiteDBConnection, result: VocabularyBatchResult): Promise<void>
}
export function vocabularyBatchResult(ids: number[]): VocabularyBatchResult {
  return { requestedIds: [...ids], modelValidIds: [], writtenIds: [], invalid: {}, skipped: {}, metadata: {} }
}

export const VOCABULARY_SNAPSHOT_SCHEMA = 2

type SnapshotKind = 'list' | 'scheduled' | 'reinforcement'

function storageKey(kind: SnapshotKind, scope: string, filter = '', search = '') {
  return `vocab-snapshot:v${VOCABULARY_SNAPSHOT_SCHEMA}:${kind}:${scope}:${filter}:${search.trim().toLowerCase()}`
}

function read<T>(key: string): T | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null')
    return value && typeof value === 'object' ? value as T : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

export type VocabularyListSnapshot = {
  schemaVersion: number
  revision: string
  savedAt: number
  scope: string
  filter: string
  search: string
  items: any[]
  counts: any
  hasMore: boolean
  selectedId: number | null
  selected: any | null
  scrollTop?: number
}

export function loadVocabularyListSnapshot(scope: string, filter: string, search: string) {
  const value = read<VocabularyListSnapshot>(storageKey('list', scope, filter, search))
  if (!value || value.schemaVersion !== VOCABULARY_SNAPSHOT_SCHEMA || !Array.isArray(value.items)) return null
  return value
}

export function saveVocabularyListSnapshot(snapshot: Omit<VocabularyListSnapshot, 'schemaVersion' | 'savedAt'>) {
  return write(storageKey('list', snapshot.scope, snapshot.filter, snapshot.search), {
    ...snapshot, schemaVersion: VOCABULARY_SNAPSHOT_SCHEMA, savedAt: Date.now(),
  })
}

export type VocabularyReviewSnapshot = {
  schemaVersion: number
  savedAt: number
  revision: string
  scope: string
  kind: SnapshotKind
  items: any[]
  reviewIndex: number
  reviewDetails: Record<string, any>
  counts: any
  dueQueue?: {
    version: 1
    main: string[]
    relearning: string[]
    ordinarySinceRelearning: number
  }
}

export function loadVocabularyReviewSnapshot(scope: string, kind: Exclude<SnapshotKind, 'list'>) {
  const value = read<VocabularyReviewSnapshot>(storageKey(kind, scope))
  if (!value || value.schemaVersion !== VOCABULARY_SNAPSHOT_SCHEMA || value.kind !== kind || !Array.isArray(value.items)) return null
  return value
}

export function saveVocabularyReviewSnapshot(snapshot: Omit<VocabularyReviewSnapshot, 'schemaVersion' | 'savedAt'>) {
  return write(storageKey(snapshot.kind, snapshot.scope), {
    ...snapshot, schemaVersion: VOCABULARY_SNAPSHOT_SCHEMA, savedAt: Date.now(),
  })
}

export function clearVocabularySnapshots(scope: string) {
  try {
    for (const kind of ['scheduled', 'reinforcement'] as const) localStorage.removeItem(storageKey(kind, scope))
  } catch { /* storage is optional */ }
}

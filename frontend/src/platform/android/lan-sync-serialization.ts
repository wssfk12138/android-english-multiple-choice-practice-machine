export type SyncReferenceKind = 'paper' | 'unit' | 'question' | 'session' | 'round' | 'entry'

export type SerializationReferenceRow = {
  id: number
  stable_key?: string
  profile_name?: string
}
export type SerializationLookup = {
  stableKeys: Record<SyncReferenceKind, Map<number, string>>
  profiles: Record<'paper' | 'unit' | 'question', Map<number, string>>
}

function referenceMap(rows: SerializationReferenceRow[]): Map<number, string> {
  return new Map(rows.map(item => [Number(item.id), String(item.stable_key || '')]))
}

function profileMap(rows: SerializationReferenceRow[]): Map<number, string> {
  return new Map(rows.map(item => [Number(item.id), String(item.profile_name || '')]))
}

export function buildSerializationLookup(
  source: Record<SyncReferenceKind, SerializationReferenceRow[]>,
): SerializationLookup {
  return {
    stableKeys: {
      paper: referenceMap(source.paper),
      unit: referenceMap(source.unit),
      question: referenceMap(source.question),
      session: referenceMap(source.session),
      round: referenceMap(source.round),
      entry: referenceMap(source.entry),
    },
    profiles: {
      paper: profileMap(source.paper),
      unit: profileMap(source.unit),
      question: profileMap(source.question),
    },
  }
}

export function lookupStableKey(
  lookup: SerializationLookup,
  kind: SyncReferenceKind,
  localId: number | null,
): string {
  return localId == null ? '' : lookup.stableKeys[kind].get(localId) || ''
}

export function lookupProfile(
  lookup: SerializationLookup,
  kind: 'paper' | 'unit' | 'question',
  localId: number | null,
): string {
  return localId == null ? '' : lookup.profiles[kind].get(localId) || ''
}

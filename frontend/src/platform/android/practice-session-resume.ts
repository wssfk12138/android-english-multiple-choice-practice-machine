export interface WrongSessionCandidate {
  id: number
  mode: string
  unit_ids: unknown
  question_ids: unknown
  answered_rows: number
  started_at?: unknown
  updated_at?: unknown
}
function normalizedIds(value: unknown): number[] {
  let source = value
  if (typeof source === 'string') {
    const serialized = source
    try {
      source = JSON.parse(serialized)
    } catch {
      source = serialized.split(',')
    }
  }
  if (!Array.isArray(source)) return []
  return [...new Set(source.map(Number).filter(Number.isFinite))].sort((left, right) => left - right)
}

function sameIds(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedIds(left)
  const normalizedRight = normalizedIds(right)
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index])
}

/** Selects an active retry only when its mode, units and questions are identical. */
export function selectResumableWrongSession(
  candidates: WrongSessionCandidate[],
  mode: string,
  unitIds: number[],
  questionIds: number[],
): WrongSessionCandidate | null {
  return candidates
    .filter(candidate => candidate.mode === mode
      && sameIds(candidate.unit_ids, unitIds)
      && sameIds(candidate.question_ids, questionIds))
    .sort((left, right) => {
      const answeredDifference = Number(right.answered_rows || 0) - Number(left.answered_rows || 0)
      if (answeredDifference) return answeredDifference
      const rightTime = String(right.updated_at || right.started_at || '')
      const leftTime = String(left.updated_at || left.started_at || '')
      const timeDifference = rightTime.localeCompare(leftTime)
      return timeDifference || Number(right.id) - Number(left.id)
    })[0] || null
}

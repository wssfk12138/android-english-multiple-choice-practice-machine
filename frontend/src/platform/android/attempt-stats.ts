type Row = Record<string, any>
type Base = { attempt_count: number; wrong_count: number; recent_results: boolean[]; consecutive_correct: number; last_wrong_at: string | null; last_attempt_at: string | null }
type Ledger = { v: 1; base: Base; attempts: Record<string, [string, boolean]> }

function ledger(row: Row): Ledger {
  const value = row.attempt_ledger ? JSON.parse(row.attempt_ledger) : {
    v: 1, attempts: {}, base: {
      attempt_count: row.attempt_count ?? 0, wrong_count: row.wrong_count ?? 0,
      recent_results: JSON.parse(row.recent_results || '[]'),
      consecutive_correct: row.consecutive_correct ?? 0,
      last_wrong_at: row.last_wrong_at ?? null, last_attempt_at: row.last_attempt_at ?? null,
    },
  }
  const object = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
  if (!object(value) || value.v !== 1 || !object(value.base) || !object(value.attempts)) throw new Error('Invalid attempt ledger')
  const base = value.base
  const fields = ['attempt_count', 'wrong_count', 'recent_results', 'consecutive_correct', 'last_wrong_at', 'last_attempt_at']
  if (Object.keys(base).length !== fields.length || fields.some(name => !Object.hasOwn(base, name))) throw new Error('Invalid attempt baseline fields')
  for (const name of ['attempt_count', 'wrong_count', 'consecutive_correct']) {
    if (!Number.isSafeInteger(base[name]) || base[name] < 0) throw new Error('Invalid legacy attempt count')
  }
  if (base.wrong_count > base.attempt_count || base.consecutive_correct > base.attempt_count) throw new Error('Invalid legacy attempt totals')
  if (!Array.isArray(base.recent_results) || base.recent_results.length > 10 || base.recent_results.some((item: unknown) => typeof item !== 'boolean')) throw new Error('Invalid recent attempt results')
  for (const name of ['last_wrong_at', 'last_attempt_at']) {
    if (base[name] !== null && (typeof base[name] !== 'string' || base[name].length > 64)) throw new Error('Invalid attempt timestamp')
  }
  for (const [key, item] of Object.entries(value.attempts)) {
    if (!key || key.length > 256 || !Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || item[0].length > 64 || typeof item[1] !== 'boolean') throw new Error('Invalid graded attempt')
  }
  return value
}

function baseKey(base: Base): (number | string)[] {
  return [base.attempt_count, base.wrong_count, base.last_attempt_at || '', base.consecutive_correct,
    base.last_wrong_at || '', base.recent_results.map(item => item ? '1' : '0').join('')]
}
function compare(left: (number | string | boolean)[], right: (number | string | boolean)[]): number {
  for (let i = 0; i < left.length; i++) {
    if (left[i] < right[i]) return -1
    if (left[i] > right[i]) return 1
  }
  return 0
}

export function aggregateAttempts(left: Row, right?: Row, attempt?: [string, string, boolean]): Row {
  const value = ledger(left)
  if (right) {
    const other = ledger(right)
    if (compare(baseKey(other.base), baseKey(value.base)) > 0) value.base = other.base
    for (const [key, item] of Object.entries(other.attempts)) {
      if (!Object.hasOwn(value.attempts, key) || compare(item, value.attempts[key]) > 0) {
        Object.defineProperty(value.attempts, key, { value: item, enumerable: true, configurable: true, writable: true })
      }
    }
  }
  if (attempt) Object.defineProperty(value.attempts, attempt[0], { value: attempt.slice(1), enumerable: true, configurable: true, writable: true })
  if (!Number.isSafeInteger(value.base.attempt_count + Object.keys(value.attempts).length)) throw new Error('Attempt count exceeds safe integer range')
  const result: Row = { ...value.base }
  const recent = [...value.base.recent_results]
  for (const [, [timestamp, correct]] of Object.entries(value.attempts).sort((a, b) => compare([a[1][0], a[0]], [b[1][0], b[0]]))) {
    result.attempt_count++
    result.wrong_count += correct ? 0 : 1
    result.consecutive_correct = correct ? result.consecutive_correct + 1 : 0
    if (!correct) result.last_wrong_at = timestamp
    result.last_attempt_at = timestamp
    recent.push(correct)
  }
  result.recent_results = JSON.stringify(recent.slice(-10))
  // Explicit encoding keeps numeric-looking session IDs in canonical key order.
  const attempts = Object.entries(value.attempts).sort(([a], [b]) => compare([a], [b]))
    .map(([key, item]) => JSON.stringify(key) + ':' + JSON.stringify(item)).join(',')
  const base = Object.fromEntries(Object.entries(value.base).sort(([a], [b]) => compare([a], [b])))
  result.attempt_ledger = '{"attempts":{' + attempts + '},"base":' + JSON.stringify(base) + ',"v":1}'
  return result
}

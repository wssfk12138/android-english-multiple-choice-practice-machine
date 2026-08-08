export type OrderingFixedSlot =
  | { type: 'question'; number: number }
  | { type: 'fixed'; label: string }

type JsonRecord = Record<string, any>

// The Word source stores these positions as floating text boxes. The current
// ESQ format has no coordinate field, so this small registry preserves only
// positions verified against the original English I source documents.
const ENGLISH_ONE_ORDERING_FIXED_SLOTS: Record<number, Array<number | string>> = {
  2010: [41, 42, 43, 44, 'E', 45],
  2011: ['G', 41, 42, 'E', 43, 44, 45],
  2014: [41, 'A', 42, 'E', 43, 44, 45],
  2017: ['D', 41, 42, 43, 44, 'B', 45],
  2018: [41, 'C', 42, 43, 'F', 44, 45],
  2019: [41, 42, 'F', 43, 44, 'C', 45],
  2023: [41, 'A', 42, 'E', 43, 'H', 44, 45],
}

function isEnglishOne(paper: JsonRecord): boolean {
  const subject = String(paper.subject || paper.examType || paper.exam_type || '')
  const title = String(paper.title || '')
  const key = String(paper.paperKey || paper.paper_key || paper.externalKey || paper.external_key || '')
  return subject.includes('英语一') || title.includes('英语一')
    || /(?:english[-_ ]one|english[-_ ]practice)/i.test(key)
}

export function fixedSlotsFromOrder(order: Array<number | string>): OrderingFixedSlot[] {
  return order.map(item => typeof item === 'number'
    ? { type: 'question', number: item }
    : { type: 'fixed', label: String(item).toUpperCase() })
}

export function orderingFixedSlotsForPaperUnit(
  paper: JsonRecord,
  unit: JsonRecord,
): OrderingFixedSlot[] {
  const unitType = String(unit.type || unit.unit_type || '')
  if (!isEnglishOne(paper) || unitType !== 'part_b' || unit.subtype !== 'paragraph_reordering') return []
  const year = Number(paper.year)
  return fixedSlotsFromOrder(ENGLISH_ONE_ORDERING_FIXED_SLOTS[year] || [])
}

/**
 * Extract a fixed-position chain from a document importer tail when the
 * source has preserved its text-box labels. Malformed/ambiguous tails are
 * deliberately ignored instead of producing a misleading hint.
 */
export function extractOrderingFixedSlots(
  direction: string,
  section: string[],
): OrderingFixedSlot[] {
  const labels = [...String(direction).matchAll(/paragraphs?\s+([A-H](?:\s*(?:and|,)\s*[A-H])*)\s+have\s+been\s+correctly\s+placed/i)]
    .flatMap(match => (match[1].match(/[A-H]/gi) || []).map(label => label.toUpperCase()))
  if (!labels.length) return []
  const allowed = new Set(labels)
  const tokens: Array<number | string> = []
  for (const block of section) {
    const text = String(block || '').trim()
    const matches = [...text.matchAll(/(?:^|[\s.→-])((?:4[1-5])|[A-H])(?=[\s.→-]|$)/gi)]
    for (const match of matches) {
      const value = match[1].toUpperCase()
      if (/^4[1-5]$/.test(value)) tokens.push(Number(value))
      else if (allowed.has(value)) tokens.push(value)
    }
  }
  const expected = [41, 42, 43, 44, 45, ...labels]
  const valid = (candidate: Array<number | string>) => {
    const normalized = candidate.map(value => String(value))
    return expected.every(value => normalized.filter(item => item === String(value)).length === 1)
      && normalized.length === expected.length
  }
  if (valid(tokens)) return fixedSlotsFromOrder(tokens)
  const reversed = [...tokens].reverse()
  return valid(reversed) ? fixedSlotsFromOrder(reversed) : []
}

export const confirmedEnglishOneOrderingYears = Object.freeze(
  Object.keys(ENGLISH_ONE_ORDERING_FIXED_SLOTS).map(Number),
)

// Shape-similar pairs are a display aid for the existing review queue. They
// never add, remove, or reorder due words, and the pairing only considers a
// bounded look-ahead window within the same priority band.
export type ReviewGroupWord = {
  id?: number
  term: string
  normalized_term?: string
  phonetic?: string
  last_reviewed_at?: string
  next_review_at?: string
}

export type ReviewGroup = {
  id: string
  keys: string[]
  terms: string[]
}

export type SpellingDiff = { left: { char: string; changed: boolean }[]; right: { char: string; changed: boolean }[] }

export const reviewGroupKey = (word: ReviewGroupWord): string => word.normalized_term || word.term.toLowerCase()

function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '')
}

function priorityBand(word: ReviewGroupWord): string {
  if (!word.last_reviewed_at) return 'new'
  const due = String(word.next_review_at || '').slice(0, 10)
  return 'due:' + (due || 'none')
}

// Optimal-string-alignment distance: an adjacent swap (quiet/quite) counts as
// one edit, matching what adult learners actually confuse when reading.
function editDistance(left: string, right: string): number {
  if (left === right) return 0
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const beforePrevious = Array.from({ length: right.length + 1 }, () => 0)
  for (let i = 1; i <= left.length; i++) {
    const current = [i]
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1)
      }
      current.push(value)
    }
    beforePrevious.splice(0, beforePrevious.length, ...previous)
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]
}

export function similarReviewTerms(left: string, right: string): boolean {
  const a = letters(left), b = letters(right)
  if (a === b || a.length < 3 || b.length < 3 || Math.max(a.length, b.length) > 24) return false
  const threshold = Math.min(a.length, b.length) <= 6 ? 1 : 2
  if (a[0] !== b[0] && a[a.length - 1] !== b[b.length - 1]) return false
  return editDistance(a, b) <= threshold
}

export function planReviewGroups(words: ReviewGroupWord[], lookahead = 8): ReviewGroup[] {
  const groups: ReviewGroup[] = []
  const used = new Set<string>()
  for (let i = 0; i < words.length; i++) {
    const first = words[i], firstKey = reviewGroupKey(first)
    if (used.has(firstKey)) continue
    const firstBand = priorityBand(first)
    for (let j = i + 1; j < Math.min(words.length, i + 1 + lookahead); j++) {
      const second = words[j], secondKey = reviewGroupKey(second)
      if (used.has(secondKey) || priorityBand(second) !== firstBand) continue
      if (!similarReviewTerms(first.term, second.term)) continue
      used.add(firstKey); used.add(secondKey)
      groups.push({ id: [firstKey, secondKey].sort().join('|'), keys: [firstKey, secondKey], terms: [first.term, second.term] })
      break
    }
  }
  return groups
}

// Mark characters outside the longest common subsequence so the comparison
// highlights the spelling difference instead of coloring the whole word.
export function spellingDiff(left: string, right: string): SpellingDiff {
  const a = [...left], b = [...right]
  const table = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    table[i][j] = a[i - 1].toLowerCase() === b[j - 1].toLowerCase()
      ? table[i - 1][j - 1] + 1
      : Math.max(table[i - 1][j], table[i][j - 1])
  }
  const leftChars: { char: string; changed: boolean }[] = []
  const rightChars: { char: string; changed: boolean }[] = []
  let i = a.length, j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
      leftChars.unshift({ char: a[i - 1], changed: false })
      rightChars.unshift({ char: b[j - 1], changed: false })
      i--; j--
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      rightChars.unshift({ char: b[j - 1], changed: true }); j--
    } else {
      leftChars.unshift({ char: a[i - 1], changed: true }); i--
    }
  }
  return { left: leftChars, right: rightChars }
}

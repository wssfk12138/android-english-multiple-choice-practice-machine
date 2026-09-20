export type PassagePart = { type: 'text' | 'blank'; text: string; number?: number }

// Legacy recognition is opt-in and requires an explicit underline or brackets.
// Bare numbers can be dates/counts and must never be guessed into answer slots.
export function splitPassageBlanks(text: string, legacyNumbers: readonly number[] = []): PassagePart[] {
  const allowed = new Set(legacyNumbers)
  const pattern = /\{\{blank:(\d+)\}\}|(?<![\w\d])(?:\(\s*(\d{1,2})\s*\)\s*[_＿]{2,}|(\d{1,2})\s*[_＿]{2,}|[_＿]{2,}\s*\(\s*(\d{1,2})\s*\)\s*[_＿]*)(?!\d)/g
  const parts: PassagePart[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const number = Number(match[1] || match[2] || match[3] || match[4])
    if (!match[1] && !allowed.has(number)) continue
    const start = match.index!
    if (start > cursor) parts.push({ type: 'text', text: text.slice(cursor, start) })
    parts.push({ type: 'blank', text: String(number), number })
    cursor = start + match[0].length
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) })
  return parts
}

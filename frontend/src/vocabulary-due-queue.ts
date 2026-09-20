type Word = { normalized_term?: string; term: string; translation_status: string; next_review_at?: string; last_reviewed_at?: string; created_at?: string; last_result?: string }
export type DueQueue = { version: 1; main: string[]; relearning: string[]; ordinarySinceRelearning: number }
export const wordKey = (word: Word): string => word.normalized_term || word.term.toLowerCase()
const time = (value?: string): number => value ? Date.parse(value.includes('T') ? value : value.replace(' ', 'T')+'Z') || 0 : 0
// pending 为真表示 words 只是队首的若干页（分页读取中）：还没取到的已存键必须原样
// 保留，否则每取一页都会先把没取到的词删掉、再按到期时间把它们排到队尾去。
export function reconcileDueQueue(saved: Partial<DueQueue> | null, words: Word[], now = Date.now(), pending = false): DueQueue {
  const due = words.filter(w => w.translation_status === 'ready' && (!w.next_review_at || time(w.next_review_at) <= now))
  const byKey = new Map(due.map(w => [wordKey(w),w]))
  const seen = new Set<string>()
  const keep = (keys: unknown, again: boolean): string[] => Array.isArray(keys) ? keys.filter(key => {
    const word = byKey.get(key)
    if (!word) { if (!pending || seen.has(key)) return false; seen.add(key); return true }
    if (seen.has(key) || (word.last_result === 'again') !== again) return false
    seen.add(key); return true
  }) : []
  const main = keep(saved?.main,false), relearning = keep(saved?.relearning,true)
  due.sort((a,b) => Number(Boolean(a.last_reviewed_at))-Number(Boolean(b.last_reviewed_at))
    || time(a.last_reviewed_at)-time(b.last_reviewed_at)
    || time(a.next_review_at || a.created_at)-time(b.next_review_at || b.created_at)
    || wordKey(a).localeCompare(wordKey(b)))
  for (const word of due) { const key=wordKey(word); if (!seen.has(key)) { (word.last_result === 'again' ? relearning : main).push(key); seen.add(key) } }
  return { version:1, main, relearning, ordinarySinceRelearning: Math.min(4,Math.max(0,Number(saved?.ordinarySinceRelearning)||0)) }
}
export function orderedDueKeys(queue: DueQueue): string[] {
  const main=[...queue.main], again=[...queue.relearning], ordered:string[]=[]
  let credit=queue.ordinarySinceRelearning
  while (main.length || again.length) {
    if (again.length && (credit>=4 || !main.length)) { ordered.push(again.shift()!); credit=0 }
    else { ordered.push(main.shift()!); credit=Math.min(4,credit+1) }
  }
  return ordered
}
export function completeDueWord(queue: DueQueue, key: string): DueQueue {
  const wasOrdinary=queue.main.includes(key)
  return { ...queue, main:queue.main.filter(k=>k!==key), relearning:queue.relearning.filter(k=>k!==key),
    ordinarySinceRelearning:wasOrdinary ? Math.min(4,queue.ordinarySinceRelearning+1) : 0 }
}

type OrderingUnit = { unit_type?: string; subtype?: string; passage?: string }

// 共享候选题型：整篇共用同一组候选，展示字母必须指向同一内容。
export const SHARED_CANDIDATE_UNIT_TYPES = ['part_b', 'word_bank', 'paragraph_matching'] as const

export function usesSharedCandidates(unitType: unknown): boolean {
  return SHARED_CANDIDATE_UNIT_TYPES.includes(String(unitType || '') as never)
}

export function preservesCandidateOrder(unit: OrderingUnit, sharedData: Record<string, any>): boolean {
  if (unit.unit_type !== 'part_b') return false
  if (unit.subtype === 'paragraph_reordering') return true
  if (unit.subtype !== 'paragraph_insertion') return false
  const fixed = sharedData.fixed_slots || sharedData.fixedSlots
  const directions = [unit.passage, sharedData.direction, sharedData.directions, sharedData.instructions].filter(Boolean).join(' ')
  return (Array.isArray(fixed) && fixed.some(slot => slot?.type === 'fixed'))
    || /(?:has|have)\s+been\s+(?:correctly\s+)?placed/i.test(directions)
}

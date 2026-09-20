export function resumeTitle(mode: string, identity: { year?: unknown; paper?: unknown; unit?: unknown }): string {
  const year = String(identity.year || '').trim()
  const paper = String(identity.paper || '').trim()
  const unit = String(identity.unit || '').trim()
  const yearPattern = /^\d{4}$/.test(year) ? new RegExp('(^|[^0-9])' + year + '(?![0-9])(?:\\s*年)?', 'g') : null
  // Remove only the exact structured year, preserving suite labels and other numbers.
  const clean = (value: string) => (yearPattern ? value.replace(yearPattern, '$1') : value).replace(/^[\s·—:：-]+|[\s·—:：-]+$/g, '').trim()
  const parts = [year ? year + ' 年' : '', clean(paper)]
  if (mode !== 'paper' && clean(unit) && clean(unit) !== clean(paper)) parts.push(clean(unit))
  return parts.filter(Boolean).join(' · ') || '继续练习'
}

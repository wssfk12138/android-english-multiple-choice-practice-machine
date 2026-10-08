export type StudyMember = { id: number; term: string; identity: string }
export type StudyCatalog = { scope_key: string; revision: string; items: StudyMember[] }
type StudyStatus = Pick<StudyCatalog, 'scope_key' | 'revision'>
type Reading = { id: number; identity: string; index: number; positions: Record<string, number> }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
type Detail = Record<string, any>
export const DAILY_STUDY_STORAGE = 'daily-study:v1'

export function loadStudyReading(storage: Storage, scope: string): Reading | null {
  try {
    const saved = JSON.parse(storage.getItem(DAILY_STUDY_STORAGE) || '{}')[scope]
    if (!saved || !Number.isSafeInteger(saved.id) || typeof saved.identity !== 'string' || !Number.isSafeInteger(saved.index)) return null
    const positions = Object.fromEntries(Object.entries(saved.positions || {}).filter(([identity, top]) => identity && typeof top === 'number' && Number.isFinite(top) && top >= 0).slice(-200))
    return { ...saved, positions }
  } catch { return null }
}

export function saveStudyReading(storage: Storage, scope: string, reading: Reading): boolean {
  try {
    const raw = JSON.parse(storage.getItem(DAILY_STUDY_STORAGE) || '{}')
    const records = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    delete records[scope]
    const recent = Object.fromEntries(Object.entries(records).slice(-7))
    storage.setItem(DAILY_STUDY_STORAGE, JSON.stringify({ ...recent, [scope]: reading }))
    return true
  } catch { return false }
}

export function restoredStudyIndex(items: StudyMember[], saved: Reading | null): number {
  if (!items.length) return 0
  const found = saved ? items.findIndex(item => item.id === saved.id && item.identity === saved.identity) : -1
  return found >= 0 ? found : Math.max(0, Math.min(items.length - 1, saved?.index || 0))
}

export function studyNavigationWindow(index: number, count: number, size = 41) {
  const start = Math.max(0, Math.min(count - size, index - Math.floor(size / 2)))
  return { start, end: Math.min(count, start + size) }
}

export function studySwipe(dx: number, dy: number): number {
  return Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.6 ? (dx < 0 ? -1 : 1) : 0
}

// The directory is frozen for this visit. Content revisions invalidate only the
// bounded details; a review/content update never rebuilds or sorts membership.
export class DailyStudySession {
  state = { items: [] as StudyMember[], index: 0, entry: null as Detail | null,
    phase: 'loading' as 'loading' | 'ready' | 'empty' | 'error', busy: false, saveFailed: false, error: '' }
  private catalog: StudyStatus | null = null
  private positions: Record<string, number> = {}
  private stable: StudyMember | null = null
  private stableIndex = 0
  private cache = new Map<string, Detail>()
  private generation = 0
  private epoch = 0
  private disposed = false
  private refreshing = false
  private prefetching = new Set<string>()
  constructor(private dependencies: {
    catalog: () => Promise<StudyCatalog>; status: () => Promise<StudyStatus>;
    detail: (id: number) => Promise<Detail>; storage: Storage; changed: () => void;
  }) {}
  private changed() { this.dependencies.changed() }
  get scopeKey() { return this.catalog?.scope_key || '' }
  get cacheSize() { return this.cache.size }
  get scrollTop() { return this.state.entry ? this.positions[String(this.state.entry.sync_id)] || 0 : 0 }
  save(top?: number) {
    if (top !== undefined && this.state.entry && Number.isFinite(top)) {
      const identity = String(this.state.entry.sync_id)
      delete this.positions[identity]
      this.positions[identity] = Math.max(0, top)
      this.positions = Object.fromEntries(Object.entries(this.positions).slice(-200))
    }
    if (!this.catalog || !this.stable) return
    this.state.saveFailed = !saveStudyReading(this.dependencies.storage, this.catalog.scope_key, {
      id: this.stable.id, identity: this.stable.identity, index: this.stableIndex, positions: this.positions,
    })
    this.changed()
  }
  async open() {
    const token = ++this.generation
    this.state.busy = true; this.state.phase = 'loading'; this.state.error = ''; this.changed()
    try {
      const catalog = await this.dependencies.catalog()
      if (this.disposed || token !== this.generation) return
      // Missing legacy identities must never match an unrelated reused numeric ID.
      if (catalog.items.some(item => !Number.isSafeInteger(item.id) || typeof item.identity !== 'string' || !item.identity)) throw Error('Invalid entry identity')
      this.catalog = catalog; this.cache.clear(); this.epoch++
      this.state.items = catalog.items
      const saved = loadStudyReading(this.dependencies.storage, catalog.scope_key)
      this.positions = saved?.positions || {}; this.stable = null
      this.state.index = restoredStudyIndex(this.state.items, saved)
      this.state.entry = null; this.state.busy = false
      await this.select(this.state.index, true)
    } catch {
      if (token === this.generation && !this.disposed) {
        this.catalog = null
        this.state.busy = false; this.state.phase = 'error'; this.state.error = '单词目录读取失败'; this.changed()
      }
    }
  }
  private remember(identity: string, entry: Detail) {
    this.cache.delete(identity); this.cache.set(identity, entry)
    while (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value!)
  }
  async select(index: number, force = false) {
    if (this.disposed || this.state.busy || (!force && index === this.state.index)
      || index < 0 || index >= this.state.items.length) {
      if (!this.state.items.length && !this.disposed) { this.state.phase = 'empty'; this.state.entry = null; this.state.busy = false; this.changed() }
      return
    }
    const token = ++this.generation
    this.state.index = index; this.state.busy = true; this.state.error = ''; this.changed()
    try {
      while (this.state.items.length) {
        const member = this.state.items[this.state.index]!
        let entry: Detail | null = null
        try { entry = this.cache.get(member.identity) || await this.dependencies.detail(member.id) }
        catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause }
        if (this.disposed || token !== this.generation) return
        if (!entry || entry.sync_id !== member.identity) {
          this.cache.delete(member.identity); delete this.positions[member.identity]
          this.state.items = this.state.items.filter(item => item.identity !== member.identity)
          this.state.index = Math.min(this.state.index, Math.max(0, this.state.items.length - 1))
          continue
        }
        this.remember(member.identity, entry)
        this.state.entry = entry; this.state.phase = 'ready'
        this.stable = member; this.stableIndex = this.state.index; this.save()
        this.prefetch(token)
        return
      }
      this.state.entry = null; this.state.phase = 'empty'
    } catch {
      if (token === this.generation && !this.disposed) { this.state.phase = 'error'; this.state.error = '单词详情读取失败' }
    } finally {
      if (token === this.generation && !this.disposed) { this.state.busy = false; this.changed() }
    }
  }
  private prefetch(token: number) {
    const epoch = this.epoch
    for (const index of [this.state.index - 1, this.state.index + 1]) {
      const member = this.state.items[index]
      if (!member || this.cache.has(member.identity) || this.prefetching.has(member.identity) || this.prefetching.size >= 2) continue
      this.prefetching.add(member.identity)
      void this.dependencies.detail(member.id).then(entry => {
        if (!this.disposed && token === this.generation && epoch === this.epoch && entry.sync_id === member.identity) this.remember(member.identity, entry)
      }).catch(() => { /* Optional adjacent reads cannot block navigation. */ }).finally(() => this.prefetching.delete(member.identity))
    }
  }
  async refresh() {
    if (this.disposed || !this.catalog || this.state.busy || this.refreshing) return
    this.refreshing = true
    const token = this.generation
    try {
      const status = await this.dependencies.status()
      if (this.disposed || token !== this.generation) return
      if (status.scope_key !== this.catalog.scope_key) { this.save(); await this.open(); return }
      if (status.revision !== this.catalog.revision) {
        this.catalog = status; this.cache.clear(); this.epoch++
        await this.select(this.state.index, true)
      }
    } catch {
      if (!this.disposed && token === this.generation) { this.state.error = '内容更新读取失败，可重新读取'; this.changed() }
    } finally { this.refreshing = false }
  }
  retry() { return this.catalog ? this.select(this.state.index, true) : this.open() }
  dispose() { this.save(); this.disposed = true; this.generation++; this.cache.clear() }
}

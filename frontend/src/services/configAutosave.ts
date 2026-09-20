/** A session-owned queue survives page unmounts; responses never replace drafts. */
export function createAutosave<T>(write: (value: T) => Promise<unknown>, notify: (state: string) => void, delay = 500) {
  let pending: T | undefined
  let running: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let saved = ''
  let failed = false
  let invalid = false
  function schedule(value: T, immediate = false) {
    pending = structuredClone(value)
    invalid = false
    failed = false
    clearTimeout(timer)
    notify('等待保存')
    if (immediate) void flush()
    else timer = setTimeout(() => { void flush() }, delay)
  }
  async function drain() {
    while (pending !== undefined) {
      const value = pending
      pending = undefined
      const fingerprint = JSON.stringify(value)
      if (fingerprint === saved) continue
      notify('保存中…')
      try { await write(value); saved = fingerprint }
      catch {
        if (invalid) return
        if (pending === undefined) pending = value
        failed = true
        notify('保存失败，点击重试')
        return
      }
    }
    failed = false
    if (!invalid) notify('已保存')
  }
  async function flush() {
    clearTimeout(timer)
    if (!running) running = drain().finally(() => { running = undefined })
    await running
    return !failed && !invalid
  }
  function invalidate(message: string) {
    clearTimeout(timer)
    pending = undefined
    invalid = true
    notify(message)
  }
  return { schedule, flush, invalidate, resetSaved() { saved = '' }, get pending() { return invalid || pending !== undefined || !!running } }
}

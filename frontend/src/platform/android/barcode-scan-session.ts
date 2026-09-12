type Listener = { remove(): Promise<void> }

export type BarcodeScanRuntime = {
  prepare(): Promise<void>
  listenScan(callback: (raw: string) => void): Promise<Listener>
  listenError(callback: () => void): Promise<Listener>
  listenBackground(callback: () => void): Promise<Listener>
  listenBack(callback: () => void): Promise<Listener>
  start(): Promise<void>
  stop(): Promise<void>
}

export function scanCancelled(): Error {
  return Object.assign(new Error('Scan cancelled'), { name: 'AbortError' })
}

// Own only this session's listeners, including handles delivered after cancellation.
export async function runBarcodeScan(
  runtime: BarcodeScanRuntime,
  signal: AbortSignal,
  showPreview: () => Promise<void>,
  onStarted: () => void = () => undefined,
): Promise<string> {
  const listeners: Listener[] = []
  let settle!: (result: { raw?: string; error?: Error }) => void
  let finished = false
  let startAttempted = false
  const result = new Promise<{ raw?: string; error?: Error }>(resolve => { settle = resolve })
  const finish = (value: { raw?: string; error?: Error }) => {
    if (finished) return
    finished = true
    settle(value)
  }
  const cancel = () => {
    finish({ error: scanCancelled() })
    if (startAttempted) void runtime.stop().catch(() => undefined)
  }
  const checkCancelled = () => {
    if (signal.aborted || finished) throw scanCancelled()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    checkCancelled()
    await runtime.prepare()
    checkCancelled()
    listeners.push(await runtime.listenBackground(cancel))
    checkCancelled()
    listeners.push(await runtime.listenBack(cancel))
    checkCancelled()
    listeners.push(await runtime.listenScan(raw => { if (raw) finish({ raw }) }))
    checkCancelled()
    listeners.push(await runtime.listenError(() => finish({ error: new Error('相机扫描失败，请重试') })))
    checkCancelled()
    await showPreview()
    checkCancelled()
    startAttempted = true
    await runtime.start()
    if (!finished && !signal.aborted) onStarted()
    const value = await result
    if (value.error) throw value.error
    return value.raw!
  } finally {
    signal.removeEventListener('abort', cancel)
    // A late native start must also be stopped before another session can begin.
    try {
      if (startAttempted) await runtime.stop()
    } finally {
      for (const listener of listeners) {
        try { await listener.remove() } catch { /* Release the remaining handles too. */ }
      }
    }
  }
}

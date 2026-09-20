export type SyncCoordinator<T> = {
  runNow: () => Promise<T>
  requestAuto: (followUpAfterActive?: boolean) => void
  resetPending: () => void
}
export function createSyncCoordinator<T>(run: () => Promise<T>, onAutoError?: (cause: unknown) => void): SyncCoordinator<T> {
  let active: Promise<T> | null = null
  let followUpPending = false

  const runNow = async (): Promise<T> => {
    if (active) return active
    const current = run()
    active = current
    try {
      return await current
    } finally {
      if (active === current) active = null
      if (followUpPending) {
        followUpPending = false
        queueMicrotask(() => void runNow().catch((cause) => onAutoError?.(cause)))
      }
    }
  }

  return {
    runNow,
    requestAuto(followUpAfterActive = false): void {
      if (active) {
        if (followUpAfterActive) followUpPending = true
        return
      }
      void runNow().catch((cause) => onAutoError?.(cause))
    },
    resetPending(): void {
      followUpPending = false
    },
  }
}

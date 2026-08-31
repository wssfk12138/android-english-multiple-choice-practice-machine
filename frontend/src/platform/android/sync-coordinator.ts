export type SyncCoordinator<T> = {
  runNow: () => Promise<T>
  requestAuto: (followUpAfterActive?: boolean) => void
  resetPending: () => void
}
export function createSyncCoordinator<T>(run: () => Promise<T>): SyncCoordinator<T> {
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
        queueMicrotask(() => void runNow().catch(() => undefined))
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
      void runNow().catch(() => undefined)
    },
    resetPending(): void {
      followUpPending = false
    },
  }
}

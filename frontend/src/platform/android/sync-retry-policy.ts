export const LAN_SYNC_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const

export function getLanSyncRetryDelayMs(attempt: number): number {
  const index = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0
  return LAN_SYNC_RETRY_DELAYS_MS[Math.min(index, LAN_SYNC_RETRY_DELAYS_MS.length - 1)]
}

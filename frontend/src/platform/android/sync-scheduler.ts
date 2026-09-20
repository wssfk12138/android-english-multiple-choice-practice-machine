import { App as CapacitorApp } from '@capacitor/app'
import { Network } from '@capacitor/network'
import type { PluginListenerHandle } from '@capacitor/core'
import { lanSyncStatus, runLanSync } from './lan-sync'
import { createSyncCoordinator } from './sync-coordinator'
import { classifyLanSyncError, type LanSyncErrorCode } from './lan-sync-errors'
import { getLanSyncRetryDelayMs } from './sync-retry-policy'

export type SyncState = {
  configured: boolean
  enabled: boolean
  running: boolean
  online: boolean
  lastSyncAt: string
  lastError: string
  errorCode: LanSyncErrorCode | ''
  autoPaused: boolean
  nextRetryAt: string
}

let state: SyncState = {
  configured: false,
  enabled: false,
  running: false,
  online: true,
  lastSyncAt: '',
  lastError: '',
  errorCode: '',
  autoPaused: false,
  nextRetryAt: '',
}

const listeners = new Set<(s: SyncState) => void>()

export function syncState(): SyncState {
  return { ...state }
}

export function subscribeSync(listener: (s: SyncState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  const snapshot = syncState()
  for (const listener of listeners) listener(snapshot)
}

async function isOnline(): Promise<boolean> {
  try {
    const status = await Network.getStatus()
    return Boolean(status.connected)
  } catch {
    return true
  }
}

export async function refreshSyncState(): Promise<SyncState> {
  try {
    const status = await lanSyncStatus()
    const configured = Boolean(status.configured)
    const enabled = configured && Boolean(status.auto)
    setState({
      configured,
      enabled,
      lastSyncAt: String(status.last_sync_at || state.lastSyncAt || ''),
    })
  } catch {
    setState({ configured: false, enabled: false })
  }
  try {
    setState({ online: await isOnline() })
  } catch {
    // keep the previous online flag
  }
  return syncState()
}

async function performSync(): Promise<any> {
  setState({ running: true, lastError: '', errorCode: '' })
  try {
    const online = await isOnline()
    setState({ online })
    if (!online) throw new Error('设备当前离线，恢复网络后再同步')
    const result = await runLanSync()
    const at = String(result?.last_sync_at || new Date().toISOString())
    setState({ lastSyncAt: at, lastError: '', errorCode: '', autoPaused: false, nextRetryAt: '' })
    retryAttempt = 0
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    return result
  } catch (cause) {
    const classified = classifyLanSyncError(cause)
    if (classified.pauseAuto) {
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = null
      coordinator.resetPending()
      setState({ autoPaused: true, nextRetryAt: '' })
    }
    setState({ lastError: classified.message, errorCode: classified.code })
    throw classified
  } finally {
    setState({ running: false })
  }
}

let retryAttempt = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoRetry(cause: unknown): void {
  const error = classifyLanSyncError(cause)
  if (error.pauseAuto || !error.retryable) {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    setState({ autoPaused: error.pauseAuto, nextRetryAt: '', lastError: error.message, errorCode: error.code })
    return
  }
  if (!state.enabled || state.autoPaused || retryTimer) return
  const delay = getLanSyncRetryDelayMs(retryAttempt)
  retryAttempt += 1
  const nextRetryAt = new Date(Date.now() + delay).toISOString()
  setState({ nextRetryAt, lastError: error.message, errorCode: error.code })
  retryTimer = setTimeout(() => {
    retryTimer = null
    setState({ nextRetryAt: '' })
    requestAutoSync()
  }, delay)
}

const coordinator = createSyncCoordinator(performSync, scheduleAutoRetry)

export async function syncNow(): Promise<any> {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  retryAttempt = 0
  setState({ autoPaused: false, nextRetryAt: '' })
  return coordinator.runNow()
}

function requestAutoSync(localChange = false): void {
  if (!state.enabled || state.autoPaused) return
  coordinator.requestAuto(localChange)
}

let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setInterval> | null = null
let appListener: PluginListenerHandle | null = null
let networkListener: PluginListenerHandle | null = null
let started = false

/** Called after a local learning-data mutation (add/delete word, finish a
 * practice, etc.).  Pushes with a 3-second debounce. */
export function notifyLocalChange(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    requestAutoSync(true)
  }, 3000)
}

export async function startAutoSync(): Promise<void> {
  if (started) return
  started = true
  await refreshSyncState()
  requestAutoSync()

  appListener = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return
    void refreshSyncState().then(() => {
      requestAutoSync()
    })
  })
  try {
    networkListener = await Network.addListener('networkStatusChange', (status) => {
      setState({ online: Boolean(status.connected) })
      if (status.connected) requestAutoSync()
    })
  } catch {
    // Network listener is best-effort; polling still covers connectivity.
  }
  pullTimer = setInterval(() => {
    void refreshSyncState().then(() => {
      requestAutoSync()
    })
  }, 60000)
}

export function stopAutoSync(): void {
  started = false
  coordinator.resetPending()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = null
  if (pullTimer) clearInterval(pullTimer)
  pullTimer = null
  void appListener?.remove()
  void networkListener?.remove()
  appListener = null
  networkListener = null
}

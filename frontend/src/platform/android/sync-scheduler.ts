import { App as CapacitorApp } from '@capacitor/app'
import { Network } from '@capacitor/network'
import type { PluginListenerHandle } from '@capacitor/core'
import { lanSyncStatus, runLanSync } from './lan-sync'
import { createSyncCoordinator } from './sync-coordinator'

export type SyncState = {
  configured: boolean
  enabled: boolean
  running: boolean
  online: boolean
  lastSyncAt: string
  lastError: string
}
let state: SyncState = {
  configured: false,
  enabled: false,
  running: false,
  online: true,
  lastSyncAt: '',
  lastError: '',
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
  setState({ running: true, lastError: '' })
  try {
    const online = await isOnline()
    setState({ online })
    if (!online) throw new Error('设备当前离线，恢复网络后再同步')
    const result = await runLanSync()
    const at = String(result?.last_sync_at || new Date().toISOString())
    setState({ lastSyncAt: at, lastError: '' })
    return result
  } catch (cause) {
    setState({ lastError: String(cause) })
    throw cause
  } finally {
    setState({ running: false })
  }
}

const coordinator = createSyncCoordinator(performSync)

export async function syncNow(): Promise<any> {
  return coordinator.runNow()
}

function requestAutoSync(localChange = false): void {
  if (!state.enabled) return
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
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = null
  if (pullTimer) clearInterval(pullTimer)
  pullTimer = null
  void appListener?.remove()
  void networkListener?.remove()
  appListener = null
  networkListener = null
}

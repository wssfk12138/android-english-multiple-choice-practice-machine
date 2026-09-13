import { Capacitor, registerPlugin } from '@capacitor/core'

export interface DatabaseFileInfo {
  expectedFileName: string
  exists: boolean
  fileName?: string
  size?: number
  modifiedAt?: string
  walBytes?: number
  shmBytes?: number
  journalMode?: string
  tableCount?: number
  databases?: string[]
  maxKeptExports: number
}

export interface DatabaseExportResult {
  directory: string
  path: string
  fileName: string
  size: number
  sha256: string
  snapshot: 'vacuum-into' | 'file-copy'
  integrityCheck: string
  /** 副本是否已放宽到 0644；为 false 时 shell 读不到文件，只能走应用内系统分享。 */
  adbReadable: boolean
  walCopied: boolean
  walBytes: number
  shmBytes: number
  copiedAt: string
  prunedCount: number
}

interface DatabaseExportNativePlugin {
  getDatabaseInfo(): Promise<DatabaseFileInfo>
  exportDatabase(): Promise<DatabaseExportResult>
  shareDatabase(options: { path?: string, title?: string }): Promise<{ launched: boolean, fileName: string }>
}

const DatabaseExportNative = registerPlugin<DatabaseExportNativePlugin>('DatabaseExport')

/**
 * 私有数据库读取通道只在 Android 原生壳内可用。
 * 导出的副本落在应用外部私有目录 Android/data/<包名>/files/db-export，可用 adb pull 取走或用系统分享发送。
 */
export function databaseExportAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export function formatDatabaseSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

export async function readDatabaseInfo(): Promise<DatabaseFileInfo> {
  if (!databaseExportAvailable()) throw new Error('数据库读取通道仅在 Android 应用内可用')
  const info = await DatabaseExportNative.getDatabaseInfo()
  if (!info || typeof info.exists !== 'boolean') throw new Error('读取数据库信息失败')
  return info
}

export async function exportDatabaseSnapshot(): Promise<DatabaseExportResult> {
  if (!databaseExportAvailable()) throw new Error('数据库读取通道仅在 Android 应用内可用')
  const result = await DatabaseExportNative.exportDatabase()
  if (!result?.path) throw new Error('导出未返回副本路径')
  return result
}

export async function shareDatabaseSnapshot(path?: string): Promise<void> {
  if (!databaseExportAvailable()) throw new Error('数据库读取通道仅在 Android 应用内可用')
  await DatabaseExportNative.shareDatabase(path ? { path } : {})
}

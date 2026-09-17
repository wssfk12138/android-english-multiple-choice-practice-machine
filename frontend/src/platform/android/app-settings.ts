import { rows, run } from './database'

// 更新地址、同步开关、活跃题库、翻译暂停位这些小键在启动期与首屏会被反复读取，
// 而每次读取都要跨一次 SQLite→JS 桥（平板上单次约 10ms，一次冷启动里这类读取接近二十次）。
// app_settings 的写入点全部集中在 platform/android 下（app-update、lan-sync、
// question-bank-profiles、vocabulary-enrichment-runner），都经由本模块写回并同步缓存，
// 因此进程内缓存不会读到过期值。
let cache: Map<string, string> | null = null
let pending: Promise<Map<string, string>> | null = null

async function loadAll(): Promise<Map<string, string>> {
  const result = await rows<{ key: string; value: string }>('SELECT key, value FROM app_settings')
  const map = new Map<string, string>()
  for (const item of result) map.set(String(item.key), String(item.value ?? ''))
  cache = map
  return map
}

export async function appSettings(): Promise<Map<string, string>> {
  if (cache) return cache
  // 并发读取共用同一次加载，避免同一屏的多个区块各查一遍。
  if (!pending) pending = loadAll().finally(() => { pending = null })
  return pending
}

export async function readAppSetting(key: string): Promise<string> {
  return (await appSettings()).get(key) ?? ''
}

/** 区分「键不存在」与「键存在但为空」，更新地址的构建期覆盖逻辑依赖这个区别。 */
export async function optionalAppSetting(key: string): Promise<string | undefined> {
  return (await appSettings()).get(key)
}

export async function writeAppSetting(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO app_settings(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  )
  cache?.set(key, value)
}

/** 事务内或原生连接上直接写入后调用，丢弃缓存以免后续读到旧值。 */
export function invalidateAppSettings(): void {
  cache = null
  pending = null
}

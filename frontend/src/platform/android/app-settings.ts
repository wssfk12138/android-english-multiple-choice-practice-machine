import { rows, run } from './database'

// 缓存供 LAN 同步与词汇后台任务使用的设置。其他模块仍可能直接访问数据库；
// 新增缓存消费者时必须同时迁移其写入点，事务直接写入后需主动失效缓存。
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

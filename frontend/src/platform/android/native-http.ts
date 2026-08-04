import { CapacitorHttp, type HttpOptions } from '@capacitor/core'
import { LocalApiError } from './errors'

export async function nativeJson<T>(
  options: HttpOptions,
  label = '网络请求',
): Promise<T> {
  const response = await CapacitorHttp.request({
    responseType: 'json',
    connectTimeout: 15000,
    readTimeout: 60000,
    ...options,
  })
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data || {})
    throw new LocalApiError(
      400,
      `${label}失败：${response.status} ${detail.slice(0, 600)}`,
    )
  }
  return response.data as T
}

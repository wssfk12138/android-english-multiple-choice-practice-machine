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

async function nativeRaw(
  options: HttpOptions,
  responseType: 'text' | 'arraybuffer',
  label: string,
): Promise<unknown> {
  const response = await CapacitorHttp.request({
    responseType,
    connectTimeout: 15000,
    readTimeout: 60000,
    ...options,
  })
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data || {})
    throw new LocalApiError(400, label + '失败：' + response.status + ' ' + detail.slice(0, 600))
  }
  return response.data
}

export async function nativeText(options: HttpOptions, label = '网络请求'): Promise<string> {
  const data = await nativeRaw(options, 'text', label)
  return typeof data === 'string' ? data : String(data ?? '')
}

export async function nativeBytes(options: HttpOptions, label = '网络请求'): Promise<Uint8Array> {
  const data = await nativeRaw(options, 'arraybuffer', label)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (typeof data !== 'string') throw new LocalApiError(400, label + '失败：响应不是二进制数据')
  try {
    const binary = atob(data.replace(/\s+/g, ''))
    return Uint8Array.from(binary, char => char.charCodeAt(0))
  } catch {
    throw new LocalApiError(400, label + '失败：二进制响应编码无效')
  }
}

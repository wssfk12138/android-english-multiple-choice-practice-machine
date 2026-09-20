import { registerPlugin } from '@capacitor/core'

export function validateLanBaseUrl(raw: string): string {
  const url = new URL(raw.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/' || url.hostname === 'lan-sync.invalid'
    || url.port === '0') throw new Error('同步地址必须为不含路径、凭据或查询参数的 HTTP/HTTPS 地址')
  if (url.protocol === 'http:') {
    const parts = url.hostname.split('.').map(Number)
    if (parts.length !== 4 || !(parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168))) throw new Error('HTTP 同步仅支持私网 IPv4 地址')
  }
  return url.origin
}

export type LanTlsIdentity = {
  hostId: string
  certificatePem: string
  certificatePin: string
}

export const LanTransport = registerPlugin<{
  discover(options: { hostId: string }): Promise<{ urls: string[] }>
  post(options: { url: string, data: Record<string, unknown>, tls?: LanTlsIdentity }): Promise<{ status: number, data: unknown }>
}>('LanSync')

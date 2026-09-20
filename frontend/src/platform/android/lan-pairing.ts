import type { LanTlsIdentity } from './lan-transport'

export type TlsPairing = {
  host: string
  tls: LanTlsIdentity
  pairingCode: string
  expiresAt: number
}

export function validateTlsIdentity(value: unknown): LanTlsIdentity {
  const identity = value as LanTlsIdentity
  if (!identity || typeof identity.hostId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identity.hostId)
    || typeof identity.certificatePem !== 'string' || identity.certificatePem.length > 8192
    || !/^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*$/.test(identity.certificatePem)
    || typeof identity.certificatePin !== 'string' || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(identity.certificatePin)) {
    throw new Error('安全同步主机身份无效')
  }
  return { hostId: identity.hostId, certificatePem: identity.certificatePem, certificatePin: identity.certificatePin }
}

export function validateTlsAddress(raw: string): string {
  const url = new URL(raw)
  const parts = url.hostname.split('.').map(Number)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || !url.port || url.port === '0' || parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)
    || !(parts[0] === 10 || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31)
      || (parts[0] === 192 && parts[1] === 168))) throw new Error('安全同步地址必须为 HTTPS 私网 IPv4')
  return url.origin
}

export function validateTlsPairing(value: unknown): TlsPairing {
  const pairing = value as TlsPairing
  if (!pairing || typeof pairing.host !== 'string'
    || typeof pairing.pairingCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.pairingCode)
    || !Number.isSafeInteger(pairing.expiresAt) || pairing.expiresAt * 1000 <= Date.now()) {
    throw new Error('安全配对码无效或已过期，请重新扫码')
  }
  return { host: validateTlsAddress(pairing.host), tls: validateTlsIdentity(pairing.tls),
    pairingCode: pairing.pairingCode, expiresAt: pairing.expiresAt }
}

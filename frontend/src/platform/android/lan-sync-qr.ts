import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import { App } from '@capacitor/app'
import { runBarcodeScan, scanCancelled } from './barcode-scan-session'
import { validateTlsPairing, type TlsPairing } from './lan-pairing'

export type LanSyncQrPayload = {
  host: string
  passcode: string
  pairing?: TlsPairing
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

export function parseLanSyncQrPayload(raw: string): LanSyncQrPayload {
  if (typeof raw !== 'string' || raw.length > 16000) throw new Error('同步二维码过大或格式无效')
  let value: any
  try {
    if (raw.startsWith('EPM2:')) {
      const fields = JSON.parse(raw.slice(5))
      if (!Array.isArray(fields) || fields.length !== 6 || typeof fields[2] !== 'string'
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(fields[2])) throw new Error('Invalid compact certificate')
      value = { type: 'english-practice-lan-sync', version: 2, host: fields[0], host_id: fields[1],
        certificate_pem: '-----BEGIN CERTIFICATE-----\n' + fields[2] + '\n-----END CERTIFICATE-----\n',
        certificate_pin: fields[3], pairing_code: fields[4], expires_at: fields[5] }
    } else value = JSON.parse(raw)
  } catch {
    throw new Error('二维码内容不是有效的同步配置')
  }
  if (!value || value.type !== 'english-practice-lan-sync' || ![1, 2].includes(value.version)) {
    throw new Error('二维码不是英语刷题机局域网同步码')
  }
  if (value.version === 2) {
    const pairing = validateTlsPairing({ host: value.host, pairingCode: value.pairing_code,
      expiresAt: value.expires_at, tls: { hostId: value.host_id,
        certificatePem: value.certificate_pem, certificatePin: value.certificate_pin } })
    return { host: pairing.host, passcode: '', pairing }
  }
  const host = String(value.host || '').trim()
  const passcode = String(value.passcode || '').trim()
  let url: URL
  try { url = new URL(host) } catch { throw new Error('二维码中的电脑地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash || !url.port || url.port === '0') {
    throw new Error('二维码中的电脑地址格式不正确')
  }
  if (url.protocol === 'http:' && !isPrivateIpv4(url.hostname)) {
    throw new Error('HTTP 同步地址必须是局域网私网 IPv4')
  }
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(passcode)) {
    throw new Error('二维码中的配对口令格式不正确')
  }
  return { host: url.origin, passcode }
}

let scanning = false

export async function scanLanSyncQr(options: {
  signal: AbortSignal
  showPreview: () => Promise<void>
  onStarted: () => void
  cleanup: () => Promise<void>
}): Promise<LanSyncQrPayload> {
  if (scanning) throw new Error('扫描仍在结束，请稍后重试')
  scanning = true
  try {
    const raw = await runBarcodeScan({
      async prepare() {
        const supported = await BarcodeScanner.isSupported()
        if (!supported.supported) throw new Error('当前设备不支持二维码扫描')
        const permissions = await BarcodeScanner.checkPermissions()
        if (permissions.camera !== 'granted') {
          if (options.signal.aborted) return
          const requested = await BarcodeScanner.requestPermissions()
          if (requested.camera !== 'granted') throw new Error('需要允许相机权限后才能扫描二维码')
        }
      },
      listenScan: callback => BarcodeScanner.addListener('barcodesScanned', event => {
        callback(event.barcodes.find(item => item.rawValue)?.rawValue || '')
      }),
      listenError: callback => BarcodeScanner.addListener('scanError', callback),
      listenBackground: callback => App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) callback()
      }),
      listenBack: callback => App.addListener('backButton', callback),
      start: () => BarcodeScanner.startScan({ formats: [BarcodeFormat.QrCode] }),
      stop: () => BarcodeScanner.stopScan(),
    }, options.signal, options.showPreview, options.onStarted)
    if (options.signal.aborted) throw scanCancelled()
    return parseLanSyncQrPayload(raw)
  } finally {
    try { await options.cleanup() } finally { scanning = false }
  }
}

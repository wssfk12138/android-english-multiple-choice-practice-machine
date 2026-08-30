import {
  projectDiagnosticEntries,
  sanitizeDiagnosticValue,
  serializeDiagnosticPayload,
  safeErrorCategory,
} from '../src/platform/android/diagnostics.ts'

const installerFailures = new Map([
  ['APK 校验失败，文件可能不完整或已被替换', 'APK_HASH_MISMATCH'],
  ['APK 文件大小与清单声明不一致', 'APK_SIZE_MISMATCH'],
  ['APK 下载失败：503', 'APK_DOWNLOAD_FAILED'],
  ['应用缓存目录不可用', 'CACHE_UNAVAILABLE'],
  ['无法保存安装包清理状态', 'CLEANUP_STATE_WRITE_FAILED'],
  ['无法打开系统安装界面', 'INSTALLER_LAUNCH_FAILED'],
])
for (const [message, expected] of installerFailures) {
  if (safeErrorCategory(new Error(message)) !== expected) {
    throw new Error(`Unexpected installer category for ${expected}`)
  }
}

const samples = [
  {
    raw: 'Authorization: Bearer test-token-123456',
    forbidden: ['test-token-123456'],
  },
  {
    raw: 'api_key=sk-private-key-12345678',
    forbidden: ['sk-private-key-12345678'],
  },
  {
    raw: 'https://example.com/update.json?token=private-token#section',
    forbidden: ['private-token', '#section'],
  },
  {
    raw: 'C:\\Users\\example\\Documents\\private\\paper.esq',
    forbidden: ['Users\\example', 'Documents\\private'],
  },
  {
    raw: '/storage/emulated/0/Download/private.esq',
    forbidden: ['/storage/emulated/0/Download'],
  },
  {
    raw: 'server=192.168.1.12 device_id=abcdef123 answer: private answer',
    forbidden: ['192.168.1.12', 'abcdef123', 'private answer'],
  },
]

for (const sample of samples) {
  const sanitized = sanitizeDiagnosticValue(sample.raw)
  for (const forbidden of sample.forbidden) {
    if (sanitized.includes(forbidden)) {
      throw new Error(`Diagnostic sanitizer leaked: ${forbidden}`)
    }
  }
}

const projected = projectDiagnosticEntries([{
  createdAt: '2026-08-29T00:00:00.000Z',
  category: 'app_update',
  stage: 'private free text',
  appVersion: '0.1.0 private-version',
  appVersionCode: '12',
  errorCode: 'NETWORK_ERROR private-category',
  message: 'failed at C:\\Users\\example\\private.log from 10.0.0.2',
  symptom: 'unlabeled private question and answer content',
  technicalMessage: 'Bearer private-token',
  deviceModel: 'private-device',
  stack: 'private-stack',
  fileName: 'private.esq',
}])

const allowedKeys = ['appVersion', 'createdAt', 'errorCategory', 'event', 'module', 'symptom']
if (Object.keys(projected[0]).sort().join(',') !== allowedKeys.sort().join(',')) {
  throw new Error(`Unexpected diagnostic fields: ${Object.keys(projected[0]).join(',')}`)
}
const payload = serializeDiagnosticPayload(projected)
for (const forbidden of ['private-token', 'private-device', 'private-stack', 'private.esq', '10.0.0.2', 'Users', 'unlabeled private', 'private free text', 'private-version', 'private-category']) {
  if (payload.includes(forbidden)) throw new Error(`Diagnostic payload leaked: ${forbidden}`)
}
if (new TextEncoder().encode(payload).byteLength > 1024 * 1024) {
  throw new Error('Diagnostic payload exceeded 1 MiB')
}

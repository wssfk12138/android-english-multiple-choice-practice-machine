import { sanitizeDiagnosticValue } from '../src/platform/android/diagnostics.ts'

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
    raw: 'C:\\Users\\MEC\\Documents\\private\\paper.esq',
    forbidden: ['Users\\MEC', 'Documents\\private'],
  },
  {
    raw: '/storage/emulated/0/Download/private.esq',
    forbidden: ['/storage/emulated/0/Download'],
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

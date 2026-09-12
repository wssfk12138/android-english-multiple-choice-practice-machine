import assert from 'node:assert/strict'
import { resolveUpdateSetting } from '../src/platform/android/update-settings.ts'

const currentLanCatalog = 'http://192.168.50.10:8877/question-bank-catalog.json'

assert.equal(
  resolveUpdateSetting(currentLanCatalog, 'http://192.168.50.8:8877/old-catalog.json'),
  currentLanCatalog,
  'an internal build override must replace a stale setting left by an earlier APK',
)
assert.equal(
  resolveUpdateSetting(currentLanCatalog, ''),
  currentLanCatalog,
  'an empty stored value must not disable an explicit internal build source',
)
assert.equal(
  resolveUpdateSetting('', 'https://example.com/custom-catalog.json'),
  'https://example.com/custom-catalog.json',
  'a public build must keep a user-configured source',
)
assert.equal(
  resolveUpdateSetting('', '', 'https://example.com/default.json'),
  '',
  'an explicit empty public setting remains disabled',
)
assert.equal(
  resolveUpdateSetting('', undefined, 'https://example.com/default.json'),
  'https://example.com/default.json',
  'a fresh install uses the public fallback when no setting exists',
)

console.log('Android update-source precedence verified')

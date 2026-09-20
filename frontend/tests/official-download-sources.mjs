import assert from 'node:assert/strict'
import { officialDownloadSources, OFFICIAL_CATALOG } from '../src/platform/official-download-sources.ts'

const base = 'https://github.com/wssfk12138/english-question-banks/releases/download/'
const bank = base + 'question-banks-2026-09-20/bank.esq'
const old = 'https://github.com/wssfk12138/english-multiple-choice-practice-machine/releases/download/question-banks-v1.2.0/bank.esq'
for (const url of [OFFICIAL_CATALOG, bank, old]) {
  assert.equal(officialDownloadSources(url, true).length, 3)
  assert.deepEqual(officialDownloadSources(url, false), [url])
}
for (const url of [
  bank + '?token=private', bank + '#fragment', bank.replace('github.com/', 'github.com.evil.invalid/'),
  bank.replace('github.com/', 'user:secret@github.com/'), bank.replace('/bank.esq', '/../../private.esq'),
  bank.replace('/bank.esq', '/%2e%2e/private.esq'), bank.replace('/bank.esq', '/folder/bank.esq'),
  bank.replace('english-question-banks/', 'other-repository/'), bank.replace('https:', 'http:'),
  bank.replace('.esq', '.apk'), base + 'other-tag/bank.esq', OFFICIAL_CATALOG + '?key=private',
]) assert.deepEqual(officialDownloadSources(url, true), [url], url)
console.log('Official proxy allowlist: new/old bank assets, opt-out and hostile/custom URLs passed')

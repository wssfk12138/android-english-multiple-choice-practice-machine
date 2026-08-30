import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const limits = await readFile(new URL('../src/platform/question-bank-limits.ts', import.meta.url), 'utf8')
const java = await readFile(new URL('../android/app/src/main/java/com/wssfk/englishpracticemachine/EsqArchive.java', import.meta.url), 'utf8')
const questionBank = await readFile(new URL('../src/platform/android/question-bank.ts', import.meta.url), 'utf8')
const doc = await readFile(new URL('../../docs/question-bank-format.md', import.meta.url), 'utf8')

const limitExpressions = new Map()
for (const match of limits.matchAll(/export const (\w+) = ([^\n]+)/g)) {
  limitExpressions.set(match[1], match[2])
}

function tsNumber(name) {
  assert.ok(limitExpressions.has(name), `question-bank-limits.ts 缺少 ${name}`)
  let expr = limitExpressions.get(name)
  for (let round = 0; round < 5 && /[A-Z][A-Z_]+/.test(expr); round++) {
    for (const [key, value] of limitExpressions) expr = expr.replaceAll(key, `(${value})`)
  }
  return Number(Function(`"use strict"; return (${expr})`)())
}

function javaNumber(pattern, label) {
  const match = java.match(pattern)
  assert.ok(match, `EsqArchive.java 缺少 ${label}`)
  return Number(Function(`"use strict"; return (${match[1].replaceAll(/(\d+)L/g, '$1')})`)())
}

assert.equal(tsNumber('MAX_ESQ_MIB'), 2048)
assert.equal(
  tsNumber('MAX_ESQ_BYTES'),
  javaNumber(/MAX_ARCHIVE_BYTES = ([\dL* ]+);/, 'MAX_ARCHIVE_BYTES'),
)
assert.equal(tsNumber('MAX_ESQ_ENTRIES'), javaNumber(/MAX_ENTRIES = ([\d_]+);/, 'MAX_ENTRIES'))
assert.equal(
  tsNumber('MAX_SINGLE_JSON_BYTES'),
  javaNumber(/MAX_JSON_BYTES = ([\dL* ]+);/, 'MAX_JSON_BYTES'),
)
assert.equal(
  tsNumber('MAX_TOTAL_JSON_BYTES'),
  javaNumber(/MAX_TOTAL_JSON_BYTES = ([\dL* ]+);/, 'MAX_TOTAL_JSON_BYTES'),
)
assert.equal(
  tsNumber('MAX_ZIP_COMPRESSION_RATIO'),
  javaNumber(/MAX_COMPRESSION_RATIO = (\d+)L;/, 'MAX_COMPRESSION_RATIO'),
)

// TS 导入路径必须真正使用这些限制，而不是只声明常量。
assert.ok(questionBank.includes('MAX_ESQ_ENTRIES'))
assert.ok(questionBank.includes('MAX_ZIP_COMPRESSION_RATIO'))
assert.ok(questionBank.includes('MAX_TOTAL_JSON_BYTES'))
assert.ok(questionBank.includes('MAX_SINGLE_JSON_BYTES'))

// 格式文档必须与实现的限制一致，并声明跨平台互导安全区间。
assert.ok(doc.includes('最大 2 GiB'))
assert.ok(doc.includes('10,000'))
assert.ok(doc.includes('250:1'))
assert.ok(doc.includes('64 MiB'))
assert.ok(doc.includes('跨平台互导安全区间'))
assert.ok(doc.includes('100 MiB'))
assert.ok(doc.includes('size'))
assert.ok(doc.includes('bytes'))
assert.match(doc, /ESQ 1\.0\/1\.1 题库格式/)

console.log('PASS question-bank limits contract')

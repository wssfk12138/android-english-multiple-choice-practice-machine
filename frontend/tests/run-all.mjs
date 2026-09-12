// One-command gate runner: executes every frontend/tests/*.mjs with the
// runner variant each file needs, prints a readable summary, and exits
// non-zero when any runnable test fails. Tests that require external
// prerequisites (PLAYWRIGHT_MODULE, CONTENT_MANIFEST_R2) are reported as
// PREREQ, never as passing.
import { execSync, spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const stripTypes = new Set([
  'content-remediation.mjs',
  'document-draft-persistence.mjs',
  'lan-categories.mjs',
  'lan-sync-pairing.mjs',
  'practice-snapshots.mjs',
  'vocabulary-identity.mjs',
])
const prereq = new Set([
  'assistant-agent.mjs',
  'barcode-scanner-layout.mjs',
  'lan-s6-ui.mjs',
  'vocabulary-layout.mjs',
])
const env = {
  ...process.env,
  CONTENT_MANIFEST: process.env.CONTENT_MANIFEST || path.join(here, '..', 'public', 'content-remediation.json'),
}
const only = process.argv[2]
const tests = readdirSync(here).filter(f => f.endsWith('.mjs') && f !== 'run-all.mjs').sort()
const rows = []
for (const test of tests) {
  if (only && !test.includes(only)) continue
  if (prereq.has(test) && !process.env.PLAYWRIGHT_MODULE) {
    rows.push({ test, status: 'PREREQ', note: 'needs PLAYWRIGHT_MODULE' })
    continue
  }
  const runner = stripTypes.has(test) ? ['node', '--experimental-strip-types', test] : ['node', test]
  const result = spawnSync(runner[0], [...runner.slice(1)], { cwd: here, encoding: 'utf8', timeout: 300000, env })
  const failed = result.status !== 0
  rows.push({
    test,
    status: failed ? 'FAIL' : 'PASS',
    note: failed ? (String(result.stderr || result.stdout || '').split('\n').filter(l => l.trim()).slice(-2).join(' | ').slice(0, 200)) : '',
  })
  process.stdout.write(`${rows.at(-1).status.padEnd(7)} ${test}\n`)
}
console.log('\n==== summary ====')
for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.test}${r.note ? '  — ' + r.note : ''}`)
const fail = rows.filter(r => r.status === 'FAIL').length
const pass = rows.filter(r => r.status === 'PASS').length
const pre = rows.filter(r => r.status === 'PREREQ').length
console.log(`==== ${pass} passed, ${fail} failed, ${pre} prereq-skipped, ${rows.length} total`)
process.exit(fail ? 1 : 0)

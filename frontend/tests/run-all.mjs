// One-command gate runner: executes every frontend/tests/*.mjs with the
// runner variant each file needs, prints a readable summary, and exits
// non-zero when any runnable test fails. Tests that require external
// prerequisites (PLAYWRIGHT_MODULE, CONTENT_MANIFEST_R2) are reported as
// PREREQ, never as passing.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'

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
  'option-sheet-layout.mjs',
  'settings-layout.mjs',
])
const env = {
  ...process.env,
  CONTENT_MANIFEST: process.env.CONTENT_MANIFEST || path.join(here, '..', 'public', 'content-remediation.json'),
}
// Playwright ships with the repo as a devDependency; resolve it so the
// browser tests run by default. An explicitly set PLAYWRIGHT_MODULE wins.
if (!env.PLAYWRIGHT_MODULE) {
  try {
    env.PLAYWRIGHT_MODULE = createRequire(import.meta.url).resolve('playwright')
  } catch {
    // playwright not installed — browser tests stay PREREQ
  }
}
// --strict must be stripped before the filter argument is parsed, otherwise
// it would be treated as a test-name filter and run nothing. pnpm also
// forwards the literal `--` separator, so strip that too.
const rawArgs = process.argv.slice(2)
const strict = rawArgs.includes('--strict') || process.env.PLAYWRIGHT_STRICT === '1'
// The external test starts an unpublished sibling Windows backend. Keep it
// in the default full gate; standalone CI reports it outside its scope.
const standalone = rawArgs.includes('--standalone')
const external = new Set(['lan-sync-candidate-integration.mjs'])
const only = rawArgs.filter(a => !['--strict', '--standalone', '--'].includes(a))
const tests = readdirSync(here).filter(f => f.endsWith('.mjs') && f !== 'run-all.mjs').sort()
const rows = []
const startedAt = Date.now()
for (const test of tests) {
  if (only.length && !only.some(pattern => test.includes(pattern))) continue
  if (standalone && external.has(test)) {
    rows.push({ test, status: 'EXTERNAL', note: 'separate Windows candidate checkout required; not tested by standalone gate', ms: 0 })
    continue
  }
  if (prereq.has(test) && !env.PLAYWRIGHT_MODULE) {
    rows.push({ test, status: 'PREREQ', note: 'needs PLAYWRIGHT_MODULE', ms: 0 })
    continue
  }
  // The child runs with cwd=tests, so pass the file name relative to that cwd.
  // Passing the caller-side path (tests/foo.mjs) made every test fail with
  // MODULE_NOT_FOUND when this aggregate runner itself was launched from
  // frontend.
  const testPath = path.join(here, test)
  const runner = stripTypes.has(test) ? [process.execPath, '--experimental-strip-types', testPath] : [process.execPath, testPath]
  const t0 = Date.now()
  const result = spawnSync(runner[0], [...runner.slice(1)], { cwd: here, encoding: 'utf8', timeout: 300000, env })
  const ms = Date.now() - t0
  const failed = result.status !== 0
  if (failed) process.stderr.write(String(result.stderr || result.stdout || result.error || 'No child output'))
  rows.push({
    test,
    status: failed ? 'FAIL' : 'PASS',
    note: failed ? (String(result.stderr || result.stdout || '').split('\n').filter(l => l.trim()).slice(-2).join(' | ').slice(0, 200)) : '',
    ms,
  })
  process.stdout.write(`${rows.at(-1).status.padEnd(7)} ${(ms / 1000).toFixed(1).padStart(6)}s  ${test}\n`)
}
console.log('\n==== summary ====')
for (const r of rows) console.log(`${r.status.padEnd(7)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.test}${r.note ? '  — ' + r.note : ''}`)
const fail = rows.filter(r => r.status === 'FAIL').length
const pass = rows.filter(r => r.status === 'PASS').length
const pre = rows.filter(r => r.status === 'PREREQ').length
const ext = rows.filter(r => r.status === 'EXTERNAL').length
if (ext) console.log('External integration tests excluded from standalone scope: ' + ext)
const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1)
console.log(`==== ${pass} passed, ${fail} failed, ${pre} prereq-skipped, ${rows.length} total, ${totalSec}s${strict ? ' (strict)' : ''}`)
process.exit(fail || (strict && pre) || rows.length === 0 ? 1 : 0)

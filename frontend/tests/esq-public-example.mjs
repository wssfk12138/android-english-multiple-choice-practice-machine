import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import JSZip from 'jszip'
import * as format from '../src/platform/android/esq-format.ts'
import * as errors from '../src/platform/android/errors.ts'
import * as limits from '../src/platform/question-bank-limits.ts'

const example = new URL('../../examples/demo-bank/', import.meta.url)
const artifact = new URL('../../examples/demo-bank.esq', import.meta.url)
const zip = new JSZip()
async function addDirectory(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  for (const entry of entries) {
    const name = prefix + entry.name
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) await addDirectory(url, name + '/')
    else zip.file(name, await readFile(url), {
      date: new Date(2026, 0, 1), createFolders: false,
    })
  }
}
await addDirectory(example)
const generated = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
const source = await readFile(new URL('../src/platform/android/question-bank.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const dependencies = {
  jszip: JSZip, './esq-format': format, './errors': errors,
  '../question-bank-limits.ts': limits,
}
const context = { exports: {}, TextDecoder, TextEncoder, require: name => dependencies[name] || {} }
vm.runInNewContext(compiled, context)
const parsed = await context.exports.parseEsqBytes(generated)
assert.equal(parsed.papers.length, 1)
assert.ok(parsed.papers[0].paper.units.length > 0)
for (const descriptor of parsed.manifest.papers) {
  for (const field of ['path', 'answerPath', 'labelPath']) {
    if (descriptor[field]) assert.ok(zip.file(descriptor[field]), field)
  }
}
if (process.argv.includes('--write')) {
  await writeFile(artifact, generated)
}
const current = await readFile(artifact)
await context.exports.parseEsqBytes(current)
assert.deepEqual(current, generated, 'Public example must match the reproducible source package')
console.log('Public ESQ source, deterministic ZIP and production parser verified')

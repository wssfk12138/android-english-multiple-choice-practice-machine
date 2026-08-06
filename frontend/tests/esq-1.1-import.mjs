import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import {
  esqFormatName,
  paperExamMetadata,
  validateEsqManifest,
} from '../src/platform/android/esq-format.ts'

const packagePath = resolve(
  '..',
  'work',
  'internal-channel',
  'postgraduate-english-two-2010-2025-v1.0.0.esq',
)
const zip = await JSZip.loadAsync(await readFile(packagePath), { checkCRC32: true })
const manifest = JSON.parse(await zip.file('manifest.json').async('text'))
const firstDescriptor = manifest.papers[0]
const firstPaper = JSON.parse(await zip.file(firstDescriptor.path).async('text'))

assert.doesNotThrow(() => validateEsqManifest(manifest))
assert.equal(esqFormatName(manifest), 'esq-1.1')
assert.deepEqual(paperExamMetadata(firstDescriptor, firstPaper), {
  examType: 'postgraduate_english2',
  examMonth: 0,
  setNumber: 1,
})

assert.doesNotThrow(() => validateEsqManifest({
  format: 'esq',
  schemaVersion: '1.0',
  packageId: 'test.esq-1.0',
  contentVersion: '1.0.0',
  papers: [{}],
}))
assert.throws(
  () => validateEsqManifest({ ...manifest, schemaVersion: '2.0' }),
  /只支持 ESQ 1\.0 \/ 1\.1/,
)

console.log('ESQ 1.0/1.1 manifest and exam metadata compatibility verified')

import assert from 'node:assert/strict'
import {
  esqFormatName,
  paperExamMetadata,
  validateEsqManifest,
} from '../src/platform/android/esq-format.ts'

const manifest = {
  format: 'esq',
  schemaVersion: '1.1',
  packageId: 'org.example.public-compatibility-fixture',
  contentVersion: '1.0.0',
  papers: [
    {
      id: 'paper-2025-01',
      path: 'papers/paper-2025-01.json',
      examType: 'postgraduate_english2',
      examMonth: 0,
      setNumber: 1,
      listeningTracks: [],
    },
  ],
}
const firstDescriptor = manifest.papers[0]
const firstPaper = {
  id: firstDescriptor.id,
  title: 'Public compatibility fixture',
}

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

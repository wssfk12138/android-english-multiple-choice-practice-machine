import { androidDatabase, isMigrationApplied, recordMigration, row, rows, run, transaction } from './database'
import { captureSession } from './practice-snapshots'

type RecordValue = Record<string, any>
export type ContentManifest = {version: number; revision: string; units: RecordValue[]}
declare const __CONTENT_REMEDIATION_HEADER__: { revision:string; units:RecordValue[]; digest:string } | null
const unitFields = ['unit_type', 'subtype', 'title', 'sequence', 'passage']
const questionFields = ['number', 'stem', 'question_type', 'answer', 'score', 'sequence']
const canonical = (value: any): string => value && typeof value === 'object'
  ? (Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}')
  : JSON.stringify(value)
const same = (a: any, b: any) => canonical(a) === canonical(b)
const pick = (value: RecordValue, keys: string[]) => Object.fromEntries(keys.map(key => [key, value[key]]))

export async function contentDigest(value: any): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}

export function validateContentManifest(manifest: ContentManifest): void {
  if (manifest?.version !== 1 || !/^[a-zA-Z0-9._-]{1,80}$/.test(manifest.revision)
    || !Array.isArray(manifest.units) || manifest.units.length > 1000) throw new Error('题库修正清单格式无效')
  const keys = new Set<string>()
  for (const change of manifest.units) {
    if (typeof change.unitKey !== 'string' || !change.unitKey || keys.has(change.unitKey)) throw new Error('题库修正清单含重复或无效篇目')
    keys.add(change.unitKey)
    if (change.reviewedBefore !== undefined && (!Array.isArray(change.reviewedBefore) || change.reviewedBefore.length > 10)) throw new Error('题库修正历史基线无效')
    const identities: RecordValue[] = []
    for (const unit of [change.before, change.after, ...(change.reviewedBefore || [])]) {
      const required = [...unitFields, 'shared.content_blocks', 'shared.directions', 'shared.candidates', 'questions']
      if (!unit || required.some(key => !(key in unit)) || Object.keys(unit).some(key => ![...required, 'shared.fixed_slots'].includes(key))) throw new Error('题库修正清单字段无效')
      if (!Array.isArray(unit.questions) || !unit.questions.length) throw new Error('题库修正清单题目无效')
      const ids: RecordValue = {}
      for (const q of unit.questions) {
        if (!same(Object.keys(q).sort(), [...questionFields, 'key', 'metadata', 'options'].sort()) || Object.hasOwn(ids, q.key)) throw new Error('题库修正清单题目身份无效')
        const labels = q.options.map((o: RecordValue) => o.key)
        if (!labels.length || new Set(labels).size !== labels.length || !labels.includes(q.answer)) throw new Error('题库修正清单选项或答案无效')
        Object.defineProperty(ids, q.key, {value: labels.sort(), enumerable: true})
      }
      identities.push(ids)
    }
    if (identities.some(ids => !same(identities[0], ids))) throw new Error('题库修正不得增删题目或选项身份')
    if (!same(Object.keys(change.questionHashes || {}).sort(), Object.keys(identities[1]).sort())
      || Object.values(change.questionHashes).some(h => typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h))) throw new Error('题库修正清单题目指纹无效')
  }
}

const QUERY_CHUNK = 400
const marks = (count: number) => Array.from({length: count}, () => '?').join(',')

/**
 * Projects the remediable fields of several units at once. The single-unit
 * form costs three statements per unit, which added up to ~195 queries for the
 * 65-unit bundled manifest on every cold start.
 */
export async function readContentUnits(units: RecordValue[]): Promise<Map<number, RecordValue>> {
  const views = new Map<number, RecordValue>()
  for (const unit of units) {
    const shared = JSON.parse(unit.shared_data || '{}')
    const result = pick(unit, unitFields)
    result.subtype ||= ''
    for (const [key, fallback] of [['content_blocks', []], ['directions', ''], ['candidates', {}]] as const) result['shared.' + key] = shared[key] ?? fallback
    if ('fixed_slots' in shared) result['shared.fixed_slots'] = shared.fixed_slots
    result.questions = []
    views.set(Number(unit.id), result)
  }
  const ids = [...views.keys()]
  const optionsByQuestion = new Map<number, RecordValue[]>()
  const questionRows: RecordValue[] = []
  for (let offset = 0; offset < ids.length; offset += QUERY_CHUNK) {
    const chunk = ids.slice(offset, offset + QUERY_CHUNK)
    const list = marks(chunk.length)
    questionRows.push(...await rows<RecordValue>(`SELECT * FROM questions WHERE unit_id IN (${list}) ORDER BY sequence,id`, chunk))
    for (const option of await rows<RecordValue>(`SELECT o.* FROM options o JOIN questions q ON q.id=o.question_id WHERE q.unit_id IN (${list}) ORDER BY o.sequence,o.id`, chunk)) {
      const options = optionsByQuestion.get(Number(option.question_id)) || []
      options.push(option)
      optionsByQuestion.set(Number(option.question_id), options)
    }
  }
  for (const q of questionRows) {
    const result = views.get(Number(q.unit_id))
    if (!result) continue
    const question = {...pick(q, questionFields), key: q.external_key, metadata: JSON.parse(q.metadata || '{}'), options: [] as RecordValue[]}
    for (const o of optionsByQuestion.get(Number(q.id)) || []) {
      question.options.push({key: o.stable_key, original_label: o.original_label, content: o.content, sequence: o.sequence, metadata: JSON.parse(o.metadata || '{}')})
    }
    result.questions.push(question)
  }
  return views
}

export async function readContentUnit(unit: RecordValue): Promise<RecordValue> {
  return (await readContentUnits([unit])).get(Number(unit.id))!
}

export function contentConflicts(actual: RecordValue, before: RecordValue, after: RecordValue): string[] {
  return [...new Set([...Object.keys(actual), ...Object.keys(before), ...Object.keys(after)])].filter(key => {
    if (same(actual[key], before[key]) || same(actual[key], after[key])) return false
    if (key === 'shared.content_blocks' && same(actual[key], []) && [before.passage, after.passage].includes(actual.passage)) return false
    return true
  })
}

export async function preflightContent(manifest: ContentManifest): Promise<RecordValue[]> {
  validateContentManifest(manifest)
  const unitsByKey = new Map<string, RecordValue[]>()
  const keys = manifest.units.map(change => change.unitKey)
  for (let offset = 0; offset < keys.length; offset += QUERY_CHUNK) {
    const chunk = keys.slice(offset, offset + QUERY_CHUNK)
    const found = await rows<RecordValue>(
      `SELECT u.* FROM units u JOIN papers p ON p.id=u.paper_id WHERE u.external_key IN (${marks(chunk.length)}) AND p.deleted_at IS NULL`,
      chunk,
    )
    for (const unit of found) {
      const list = unitsByKey.get(String(unit.external_key)) || []
      list.push(unit)
      unitsByKey.set(String(unit.external_key), list)
    }
  }
  const contents = await readContentUnits([...unitsByKey.values()].flat())
  const records: RecordValue[] = []
  for (const change of manifest.units) {
    for (const unit of unitsByKey.get(change.unitKey) || []) {
      const actual = contents.get(Number(unit.id))!
      const contentChanged = !same(actual, change.after)
      records.push({unitId: unit.id, unitKey: change.unitKey, actual, change, contentChanged,
        conflicts: [change.before, ...(change.reviewedBefore || [])].some(baseline => !contentConflicts(actual, baseline, change.after).length)
          ? [] : contentConflicts(actual, change.before, change.after),
        needed: contentChanged || JSON.parse(unit.shared_data || '{}').content_revision !== manifest.revision})
    }
  }
  return records
}

// Call only inside transaction(), after a verified backup has completed.
export async function applyContent(manifest: ContentManifest): Promise<RecordValue> {
  if (!(await (await androidDatabase()).isTransactionActive()).result) throw new Error('题库修正必须在显式事务中执行')
  const records = await preflightContent(manifest)
  if (records.some(r => r.conflicts.length)) throw new Error('题库内容存在未审查差异，修正已停止')
  const pending = records.filter(r => r.needed)
  const sessionIds = new Set<number>()
  const sessions = await rows<RecordValue>('SELECT id,unit_ids FROM practice_sessions')
  for (const record of pending.filter(r => r.contentChanged)) {
    for (const session of sessions) if (JSON.parse(session.unit_ids || '[]').includes(record.unitId)) sessionIds.add(session.id)
    for (const s of await rows<RecordValue>('SELECT DISTINCT session_id FROM practice_answers WHERE question_id IN (SELECT id FROM questions WHERE unit_id=?)', [record.unitId])) sessionIds.add(s.session_id)
  }
  for (const id of [...sessionIds].sort((a, b) => a-b)) await captureSession(id, manifest.revision)
  await run('CREATE TABLE IF NOT EXISTS content_remediation_receipts (unit_id INTEGER, revision TEXT, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, historical_wrong_stats TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(unit_id,revision))')
  for (const record of pending) {
    const uid = record.unitId, target = record.change.after
    const targetHash = await contentDigest(target)
    const receipt = await row<RecordValue>('SELECT after_hash FROM content_remediation_receipts WHERE unit_id=? AND revision=?', [uid, manifest.revision])
    if (receipt && receipt.after_hash !== targetHash) throw new Error('同一题库修订号的内容指纹发生变化')
    const unit = await row<RecordValue>('SELECT * FROM units WHERE id=?', [uid])
    const shared = JSON.parse(unit!.shared_data || '{}')
    for (const [key, value] of Object.entries(target)) if (key.startsWith('shared.')) shared[key.slice(7)] = value
    if (record.contentChanged) {
      const labels = await rows<RecordValue>('SELECT q.external_key,l.label_version FROM question_ai_labels l JOIN questions q ON q.id=l.question_id WHERE q.unit_id=?', [uid])
      shared.label_review_versions = Object.fromEntries(labels.map(label => [label.external_key, label.label_version]))
    }
    shared.content_revision = manifest.revision
    await run('UPDATE units SET unit_type=?,subtype=?,title=?,sequence=?,passage=?,shared_data=? WHERE id=?', [...unitFields.map(k => target[k]), JSON.stringify(shared), uid])
    const historical = await rows<RecordValue>('SELECT w.* FROM wrong_stats w JOIN questions q ON q.id=w.question_id WHERE q.unit_id=?', [uid])
    for (const q of target.questions) {
      const original = await row<RecordValue>('SELECT id FROM questions WHERE unit_id=? AND external_key=?', [uid, q.key])
      await run('UPDATE questions SET number=?,stem=?,question_type=?,answer=?,score=?,sequence=?,metadata=?,content_hash=? WHERE id=?', [...questionFields.map(k => q[k]), JSON.stringify(q.metadata), record.change.questionHashes[q.key], original!.id])
      for (const o of q.options) await run('UPDATE options SET original_label=?,content=?,sequence=?,metadata=? WHERE question_id=? AND stable_key=?', [o.original_label, o.content, o.sequence, JSON.stringify(o.metadata), original!.id, o.key])
    }
    await run('INSERT INTO content_remediation_receipts(unit_id,revision,before_hash,after_hash,historical_wrong_stats) VALUES(?,?,?,?,?) ON CONFLICT(unit_id,revision) DO NOTHING', [uid, manifest.revision, await contentDigest(record.actual), targetHash, JSON.stringify(historical)])
    if (!same(await readContentUnit((await row<RecordValue>('SELECT * FROM units WHERE id=?', [uid]))!), target)) throw new Error('题库修正写入校验失败')
  }
  return {revision: manifest.revision, units: pending.length, sessions: sessionIds.size}
}

export async function applyContentWithBackup(manifest: ContentManifest): Promise<RecordValue> {
  const records = await preflightContent(manifest)
  if (records.some(r => r.conflicts.length)) throw new Error('题库内容存在未审查差异，修正已停止')
  if (!records.some(r => r.needed)) {
    await markRemediationApplied(manifest.revision)
    return {revision: manifest.revision, units: 0, sessions: 0}
  }
  const {Filesystem, Directory, Encoding} = await import('@capacitor/filesystem')
  const backup = await (await androidDatabase()).exportToJson('full')
  if (!backup.export?.tables?.length) throw new Error('题库修正备份为空')
  const data = JSON.stringify(backup.export)
  const path = `content-backups/${manifest.revision}-${crypto.randomUUID()}.json`
  await Filesystem.writeFile({path, directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true})
  const saved = await Filesystem.readFile({path, directory: Directory.Data, encoding: Encoding.UTF8})
  if (saved.data !== data) throw new Error('题库修正备份校验失败')
  const result = await transaction(() => applyContent(manifest))
  await markRemediationApplied(manifest.revision)
  return result
}

const remediationMarker = (revision: string) => `content-remediation:${revision}`

async function remediationApplied(revision: string): Promise<boolean> {
  return isMigrationApplied(remediationMarker(revision))
}

async function markRemediationApplied(revision: string): Promise<void> {
  await recordMigration(remediationMarker(revision))
}

let bundledManifest: Promise<ContentManifest | null> | undefined
export function loadBundledContentManifest(): Promise<ContentManifest | null> {
  bundledManifest ||= (async () => {
    const response = await fetch('/content-remediation.json')
    if (response.status === 404) return null
    if (!response.ok) throw new Error('无法读取题库修正清单')
    // Vite and Capacitor may serve the SPA shell for an absent optional asset.
    if (response.headers.get('content-type')?.includes('text/html')) return null
    const manifest = await response.json() as ContentManifest
    validateContentManifest(manifest)
    return manifest
  })()
  return bundledManifest
}

let startupPreparation: Promise<boolean> | undefined
export function ensureContentRemediation(): Promise<boolean> {
  startupPreparation ||= (async () => {
    await androidDatabase()
    const header = typeof __CONTENT_REMEDIATION_HEADER__ !== 'undefined' ? __CONTENT_REMEDIATION_HEADER__ : null
    const marker = header ? `content-remediation-bundle:${header.digest}` : ''
    if (header && await isMigrationApplied(marker) && await remediationSettled(header)) return false
    const manifest = await loadBundledContentManifest()
    if (!manifest) return false
    // Applying one revision is a one-time repair. Once every packaged unit
    // carries this revision, later launches skip the per-unit preflight (and
    // its question/option queries and digests) and only pay for reading the
    // manifest. Import paths are guarded separately by validateRemediatedImport,
    // and the revision flag is written only by a verified pass or a validated
    // package install.
    let changed = false
    if (!await remediationSettled(manifest)) changed = Number((await applyContentWithBackup(manifest)).units) > 0
    if (marker) await recordMigration(marker)
    return changed
  })()
  return startupPreparation
}

async function remediationSettled(manifest: Pick<ContentManifest, 'revision' | 'units'>): Promise<boolean> {
  if (!(await remediationApplied(manifest.revision))) return false
  const keys = manifest.units.map(change => change.unitKey)
  let present = 0
  let settled = 0
  for (let offset = 0; offset < keys.length; offset += QUERY_CHUNK) {
    const chunk = keys.slice(offset, offset + QUERY_CHUNK)
    const list = marks(chunk.length)
    const scope = `FROM units u JOIN papers p ON p.id=u.paper_id
      WHERE u.external_key IN (${list}) AND p.deleted_at IS NULL`
    present += Number((await row<RecordValue>(`SELECT COUNT(*) AS total ${scope}`, chunk))?.total || 0)
    settled += Number((await row<RecordValue>(
      `SELECT COUNT(*) AS total ${scope} AND json_extract(u.shared_data, '$.content_revision') = ?`,
      [...chunk, manifest.revision],
    ))?.total || 0)
  }
  return present === settled
}

// Imports (including LAN packages) must never restore a reviewed corrupt unit.
export async function validateRemediatedImport(paper: RecordValue, answers: RecordValue, deferredQuestionHashes = false): Promise<void> {
  const manifest = await loadBundledContentManifest()
  if (!manifest) return
  const {questionContentHash} = await import('./question-bank')
  for (const unit of paper.units) {
    const change = manifest.units.find(item => item.unitKey === unit.unitKey)
    if (!change) continue
    const target = change.after
    const blocks = unit.passage?.blocks || []
    const shared = {'shared.content_blocks': blocks, 'shared.directions': unit.instructions || '',
      'shared.candidates': Object.fromEntries((unit.candidates || []).map((o: RecordValue) => [o.key, o.content]))}
    if (!same(blocks, target['shared.content_blocks'])
      || !same(shared['shared.candidates'], target['shared.candidates'])
      || shared['shared.directions'] !== target['shared.directions']
      || !same(unit.fixed_slots ?? unit.fixedSlots, target['shared.fixed_slots'])
      || !same(unit.questions.map((q: RecordValue) => q.questionKey), target.questions.map((q: RecordValue) => q.key))) {
      throw new Error('此题库包含已修正的旧内容，请使用新版题库包；现有学习记录未修改')
    }
    // Staged imports validate the complete key list here, then each full question
    // hash in upsertPaper before writing it. Never skip the structural check.
    if (deferredQuestionHashes) continue
    for (const q of unit.questions) {
      if (await questionContentHash(unit, q, answers[q.questionKey]) !== change.questionHashes[q.questionKey])
        throw new Error('此题库包含已修正的旧题目，请使用新版题库包；现有学习记录未修改')
    }
  }
}

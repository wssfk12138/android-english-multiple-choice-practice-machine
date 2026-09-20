import JSZip from 'jszip'
import { androidDatabase, row, rows, run, transaction } from './database'
import { esqFormatName, paperExamMetadata, validateEsqManifest } from './esq-format'
import { LocalApiError } from './errors'
import { activeQuestionBankProfileId } from './question-bank-profiles'
import { saveImportDraft } from './import-destination'
import { createSerialQueue } from './serial-queue'
import { orderingFixedSlotsForPaperUnit, validateOrderingFixedSlots } from './ordering-fixed-slots'
import { MAX_ESQ_BYTES, MAX_ESQ_ENTRIES, MAX_ESQ_MIB, MAX_SINGLE_JSON_BYTES, MAX_TOTAL_JSON_BYTES, MAX_ZIP_COMPRESSION_RATIO } from '../question-bank-limits.ts'
import { rebindLearningHistory } from './learning-history-rebind'

type JsonRecord = Record<string, any>
let esqDraftQueue: ReturnType<typeof createSerialQueue> | undefined
function serializeEsqDrafts<T>(operation: () => Promise<T>): Promise<T> {
  esqDraftQueue ||= createSerialQueue()
  return esqDraftQueue(operation)
}

type ImportedPackage = {
  legacyJobId?: number
  stageId?: string
  stageVersion?: number
  manifest: JsonRecord
  assets?: Array<{
    assetId: string
    mediaType: string
    originalName?: string
    label?: string
    size: number
    sha256: string
    storedPath: string
  }>
  papers: Array<{
    descriptor: JsonRecord
    paper: JsonRecord
    answers: JsonRecord
    labels: JsonRecord | null
    unitCount?: number
    questionCount?: number
  }>
}

function plainText(blocks: any[]): string {
  return blocks
    .filter(block => ['paragraph', 'quote'].includes(String(block?.type)))
    .map(block => String(block?.text || ''))
    .join('\n\n')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function questionContentHash(
  unit: JsonRecord,
  question: JsonRecord,
  answer: JsonRecord,
): Promise<string> {
  const canonical = {
    passage: unit.passage || {},
    question: Object.fromEntries(
      ['questionKey', 'number', 'type', 'stem', 'stemBlocks', 'options', 'score', 'metadata']
        .map(key => [key, question[key] ?? null]),
    ),
    answer,
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(stableJson(canonical)),
  )
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function jsonFile(zip: JSZip, path: string, required = true): Promise<JsonRecord | null> {
  const entry = zip.file(path.replaceAll('\\', '/'))
  if (!entry) {
    if (required) throw new LocalApiError(422, `题库包缺少 ${path}`)
    return null
  }
  if ((entry as any).dir) throw new LocalApiError(422, `${path} 不能是目录`)
  const payload = await entry.async('uint8array')
  if (payload.byteLength > MAX_SINGLE_JSON_BYTES) {
    throw new LocalApiError(422, `${path} 超过单个 JSON 64 MiB 限制`)
  }
  try {
    return JSON.parse(new TextDecoder().decode(payload))
  } catch {
    throw new LocalApiError(422, `${path} 不是有效的 UTF-8 JSON`)
  }
}

function validateManifest(manifest: JsonRecord) {
  try {
    validateEsqManifest(manifest)
  } catch (error) {
    throw new LocalApiError(422, error instanceof Error ? error.message : 'ESQ 清单无效')
  }
}

// Bundled banks are re-checked on every launch. Reading only manifest.json out
// of the ZIP skips the full CRC32 verification and JSON parse of every paper, so
// the already-installed case can return without paying for the whole package.
// Any probe failure falls back to parseEsqBytes so error reporting stays unchanged.
async function probeBundledManifest(data: ArrayBuffer | Uint8Array): Promise<{ packageId: string; contentVersion: string } | null> {
  try {
    if (data.byteLength > MAX_ESQ_BYTES) return null
    const zip = await JSZip.loadAsync(data, { createFolders: false })
    const manifest = await jsonFile(zip, 'manifest.json', false)
    if (!manifest) return null
    const packageId = String(manifest.packageId || '')
    const contentVersion = String(manifest.contentVersion || '')
    if (!packageId || !contentVersion) return null
    return { packageId, contentVersion }
  } catch {
    return null
  }
}

export async function parseEsqBytes(data: ArrayBuffer | Uint8Array): Promise<ImportedPackage> {
  if (data.byteLength > MAX_ESQ_BYTES) {
    throw new LocalApiError(422, `ESQ 文件不能超过 ${MAX_ESQ_MIB} MiB`)
  }
  const zip = await JSZip.loadAsync(data, {
    checkCRC32: true,
    createFolders: false,
  })
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ESQ_ENTRIES) throw new LocalApiError(422, '题库包文件数量超过限制')
  let totalJsonBytes = 0
  for (const entry of entries) {
    const name = entry.name.replaceAll('\\', '/')
    if (name.startsWith('/') || name.split('/').includes('..')) {
      throw new LocalApiError(422, '题库包包含不安全路径')
    }
    if (/\.(?:exe|dll|bat|cmd|ps1|js|html|htm|apk)$/i.test(name)) {
      throw new LocalApiError(422, `题库包包含不允许的文件：${name}`)
    }
    const sizes = (entry as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data
    if (sizes?.compressedSize && sizes.compressedSize > 0 && typeof sizes.uncompressedSize === 'number') {
      const ratio = Math.ceil(sizes.uncompressedSize / sizes.compressedSize)
      if (ratio > MAX_ZIP_COMPRESSION_RATIO) {
        throw new LocalApiError(422, '题库包压缩比超过安全限制')
      }
    }
    if (name.toLowerCase().endsWith('.json')) totalJsonBytes += sizes?.uncompressedSize ?? 0
  }
  if (totalJsonBytes > MAX_TOTAL_JSON_BYTES) {
    throw new LocalApiError(422, '题库包 JSON 总大小超过限制')
  }
  const manifest = (await jsonFile(zip, 'manifest.json'))!
  validateManifest(manifest)
  const papers = []
  for (const descriptor of manifest.papers) {
    if (!descriptor?.paperKey || !descriptor?.path || !descriptor?.answerPath) {
      throw new LocalApiError(422, '试卷清单缺少 paperKey、path 或 answerPath')
    }
    const paper = (await jsonFile(zip, descriptor.path))!
    const answers = (await jsonFile(zip, descriptor.answerPath))!
    const labels = descriptor.labelPath
      ? await jsonFile(zip, descriptor.labelPath, false)
      : null
    if (paper.paperKey !== descriptor.paperKey || answers.paperKey !== descriptor.paperKey) {
      throw new LocalApiError(422, `${descriptor.paperKey} 的正文与答案标识不一致`)
    }
    if (!Number.isInteger(paper.year) || !Array.isArray(paper.units)) {
      throw new LocalApiError(422, `${descriptor.paperKey} 的年份或篇目格式无效`)
    }
    try {
      paperExamMetadata(descriptor, paper)
    } catch (error) {
      throw new LocalApiError(422, error instanceof Error ? error.message : 'ESQ 试卷元数据无效')
    }
    papers.push({ descriptor, paper, answers, labels })
  }
  return { manifest, papers, assets: [] }
}

export async function parseEsqFile(file: File): Promise<ImportedPackage> {
  return parseEsqBytes(await file.arrayBuffer())
}

async function buildPreview(pkg: ImportedPackage, profileId: number): Promise<JsonRecord> {
  const conflicts = []
  let units = 0
  let questions = 0
  for (const item of pkg.papers) {
    units += item.unitCount ?? item.paper.units.length
    questions += item.questionCount ?? item.paper.units.reduce(
      (total: number, unit: JsonRecord) => total + (unit.questions?.length || 0),
      0,
    )
    const existing = await row<any>(
      `SELECT id, year, title, external_key FROM papers
       WHERE profile_id = ? AND external_key = ? AND deleted_at IS NULL LIMIT 1`,
      [profileId, item.paper.paperKey],
    )
    conflicts.push({
      paperKey: item.paper.paperKey,
      year: item.paper.year,
      title: item.paper.title,
      existing: existing || null,
    })
  }
  return {
    title: pkg.manifest.title || 'ESQ 题库',
    publisher: pkg.manifest.publisher || '',
    contentVersion: pkg.manifest.contentVersion,
    totals: { papers: pkg.papers.length, units, questions, assets: pkg.assets?.length || 0 },
    conflicts,
  }
}

async function createParsedEsqImport(
  filename: string,
  pkg: ImportedPackage,
  _rawData: Uint8Array | null,
  profileId: number,
  newProfileName?: string,
): Promise<JsonRecord> {
  const preview = await buildPreview(pkg, profileId)
  const saved = await saveImportDraft(profileId || undefined, newProfileName, async (db, targetId) => {
    if (pkg.stageId) {
      const existing = await db.query(
        "SELECT id FROM esq_import_jobs WHERE profile_id = ? AND json_extract(package_data, '$.stageId') = ? AND deleted_at IS NULL AND status = 'draft' LIMIT 1",
        [targetId, pkg.stageId],
      )
      if (existing.values?.length) return { id: Number(existing.values[0].id), profile_id: targetId, filename, format: esqFormatName(pkg.manifest), preview, warnings: [] }
    }
    const created = await db.run(
      `INSERT INTO esq_import_jobs
        (profile_id, filename, package_data, raw_file_base64, preview_data, status)
       VALUES (?, ?, ?, ?, ?, 'draft')`,
      [targetId, filename, JSON.stringify(pkg), '', JSON.stringify(preview)], false,
    )
    return {
      id: Number(created.changes?.lastId),
      profile_id: targetId,
      filename,
      format: esqFormatName(pkg.manifest),
      preview,
      warnings: [],
    }
  })
  if (pkg.stageId) {
    const { nativeEsqStage } = await import('./esq-stage')
    // A failed receipt acknowledgement must not misreport a committed draft as lost.
    await nativeEsqStage.acknowledge({ stageId: pkg.stageId }).catch(() => {})
  }
  return saved
}

export async function createEsqImport(file: File, profileId?: number, newProfileName?: string): Promise<JsonRecord> {
  return serializeEsqDrafts(async () => {
  if (file.size < 1 || file.size > MAX_ESQ_BYTES) throw new LocalApiError(422, `ESQ 文件不能超过 ${MAX_ESQ_MIB} MiB`)
  const { nativeEsqStage } = await import('./esq-stage')
  const targetId = profileId || (newProfileName !== undefined ? undefined : await activeQuestionBankProfileId())
  const staged = await nativeEsqStage.stageSelected({ name: file.name, size: file.size, profileId: targetId, newProfileName })
  return saveNativeEsqPackage(file.name, staged, targetId, newProfileName)
  })
}

export async function createEsqImportFromBytes(
  filename: string,
  data: Uint8Array,
  profileId?: number,
): Promise<JsonRecord> {
  return createParsedEsqImport(
    filename,
    await parseEsqBytes(data),
    data,
    profileId || await activeQuestionBankProfileId(),
  )
}

export async function createEsqImportFromNativePackage(
  filename: string, value: JsonRecord, profileId?: number, newProfileName?: string,
): Promise<JsonRecord> {
  return serializeEsqDrafts(() => saveNativeEsqPackage(filename, value, profileId, newProfileName))
}

async function saveNativeEsqPackage(
  filename: string,
  value: JsonRecord,
  profileId?: number,
  newProfileName?: string,
): Promise<JsonRecord> {
  const pkg = value as ImportedPackage
  if (pkg.stageId && (!/^[a-f0-9]{64}$/.test(pkg.stageId) || pkg.stageVersion !== 1)) throw new LocalApiError(422, '暂存任务版本无效')
  validateManifest(pkg.manifest)
  if (!Array.isArray(pkg.papers) || !Array.isArray(pkg.assets)) {
    throw new LocalApiError(422, '原生题库数据缺少试卷或资产清单')
  }
  for (const item of pkg.papers) {
    if (!item?.descriptor?.paperKey || !item?.paper || (!pkg.stageId && !item?.answers)) {
      throw new LocalApiError(422, '原生题库数据包含无效试卷')
    }
    if (item.paper.paperKey !== item.descriptor.paperKey
      || (!pkg.stageId && item.answers.paperKey !== item.descriptor.paperKey)) {
      throw new LocalApiError(422, `${item.descriptor.paperKey} 的正文与答案标识不一致`)
    }
    if (!Number.isInteger(item.paper.year) || (pkg.stageId &&
      (![item.unitCount, item.questionCount].every(value => Number.isSafeInteger(value) && Number(value) >= 0)))) {
      throw new LocalApiError(422, '原生题库年份或计数无效')
    }
    try {
      paperExamMetadata(item.descriptor, item.paper)
    } catch (error) {
      const message = error instanceof Error ? error.message : '考试元数据无效'
      throw new LocalApiError(422, `${item.descriptor.paperKey}：${message}`)
    }
  }
  return createParsedEsqImport(
    filename,
    pkg,
    null,
    profileId || (newProfileName !== undefined ? 0 : await activeQuestionBankProfileId()),
    newProfileName,
  )
}

async function bundledProfileId(subject: string): Promise<number> {
  const name = subject.includes('英语二') ? '考研英语二' : '考研英语一'
  const existing = await row<{ id: number }>(
    'SELECT id FROM question_bank_profiles WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1',
    [name],
  )
  if (existing) return Number(existing.id)
  const created = await run(
    'INSERT INTO question_bank_profiles(name, description, is_default) VALUES (?, ?, 0)',
    [name, `公测版内置${name}题库`],
  )
  return Number(created.lastId)
}

export async function installBundledQuestionBank(
  assetPath = 'internal-question-bank.esq',
  profileId?: number,
): Promise<JsonRecord> {
  const response = await fetch(`/${assetPath.replace(/^\/+/, '')}`, { cache: 'no-store' })
  if (response.status === 404) return { available: false, installed: false }
  if (!response.ok) throw new LocalApiError(400, `内置题库读取失败：${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const bundled = await probeBundledManifest(data)
  if (bundled) {
    const upToDate = await row<{ id: number }>(
      `SELECT id FROM question_bank_packages
       WHERE package_id = ? AND content_version = ? AND status = 'published'
       LIMIT 1`,
      [bundled.packageId, bundled.contentVersion],
    )
    if (upToDate) return { available: true, installed: false, alreadyInstalled: true }
  }
  const pkg = await parseEsqBytes(data)
  const packageId = String(pkg.manifest.packageId || '')
  const contentVersion = String(pkg.manifest.contentVersion || '')
  const installed = await row<{ id: number }>(
    `SELECT id FROM question_bank_packages
     WHERE package_id = ? AND content_version = ? AND status = 'published'
     LIMIT 1`,
    [packageId, contentVersion],
  )
  if (installed) return { available: true, installed: false, alreadyInstalled: true }
  const targetProfileId = profileId || await activeQuestionBankProfileId()
  const preview = await buildPreview(pkg, targetProfileId)
  if (preview.conflicts.some((item: JsonRecord) => item.existing)) {
    return { available: true, installed: false, conflicts: true }
  }
  const created = await createParsedEsqImport(assetPath, pkg, data, targetProfileId)
  await publishEsqImport(created.id, { resolutions: [] })
  return {
    available: true,
    installed: true,
    packageId,
    contentVersion,
    totals: preview.totals,
  }
}

export async function installBundledQuestionBanks(): Promise<JsonRecord> {
  const assets = [
    { path: 'internal-question-bank.esq', subject: '考研英语一' },
    { path: 'internal-question-bank-english-two.esq', subject: '考研英语二' },
  ]
  const results: JsonRecord[] = []
  for (const asset of assets) {
    const profileId = await bundledProfileId(asset.subject)
    results.push({ asset: asset.path, ...(await installBundledQuestionBank(asset.path, profileId)) })
  }
  return { available: results.some(item => item.available), results }
}

let recoverPendingPromise: Promise<void> | undefined
async function recoverPendingImports(): Promise<void> {
  const { nativeEsqStage } = await import('./esq-stage')
  const { tasks } = await nativeEsqStage.pending()
  for (const task of tasks) {
    const existing = await row<JsonRecord>(
      `SELECT j.id FROM esq_import_jobs j JOIN question_bank_profiles p ON p.id = j.profile_id
       WHERE json_extract(j.package_data, '$.stageId') = ?
         AND ((? IS NOT NULL AND j.profile_id = ?) OR (? IS NOT NULL AND p.name = ? COLLATE NOCASE)) LIMIT 1`,
      [task.stageId, task.profileId ?? null, task.profileId ?? null, task.newProfileName ?? null, task.newProfileName ?? null],
    )
    if (existing) {
      await nativeEsqStage.acknowledge({ stageId: task.stageId })
      continue
    }
    // Keep the original destination; a deleted destination is not silently replaced.
    if (task.profileId && !await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [task.profileId])) continue
    try {
      const summary = await nativeEsqStage.resume({ stageId: task.stageId })
      await saveNativeEsqPackage(task.filename, summary, task.profileId, task.newProfileName)
    } catch { /* retain invalid/incomplete tasks for explicit re-selection and retry */ }
  }
}

export async function listEsqImports(): Promise<JsonRecord[]> {
  recoverPendingPromise ||= serializeEsqDrafts(recoverPendingImports).catch(() => { recoverPendingPromise = undefined })
  await recoverPendingPromise
  const profileId = await activeQuestionBankProfileId()
  const jobs = await rows<JsonRecord>(
    `SELECT id, profile_id, filename,
       json_extract(package_data, '$.manifest') AS manifest_data,
       json_extract(package_data, '$.papers[0].paper.year') AS detected_year,
       status, created_at, updated_at
     FROM esq_import_jobs
     WHERE profile_id = ? AND deleted_at IS NULL
     ORDER BY id DESC`,
    [profileId],
  )
  return jobs.map(job => {
    const manifest = JSON.parse(job.manifest_data || '{}')
    return {
      id: job.id,
      profile_id: job.profile_id,
      filename: job.filename,
      display_name: manifest.title || job.filename,
      detected_year: job.detected_year ?? null,
      detected_format: esqFormatName(manifest),
      status: job.status,
      warnings: [],
      created_at: job.created_at,
      updated_at: job.updated_at,
    }
  })
}

export async function readEsqImport(id: number): Promise<JsonRecord> {
  const job = await row<JsonRecord>(
    `SELECT id, profile_id, filename, status, preview_data,
       json_extract(package_data, '$.manifest') AS manifest_data,
       json_extract(package_data, '$.papers[0].paper.year') AS detected_year
     FROM esq_import_jobs WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  const manifest = JSON.parse(job.manifest_data || '{}')
  const preview = JSON.parse(job.preview_data || '{}') as JsonRecord
  await refreshPreviewConflicts(preview, job.profile_id)
  return {
    id: job.id,
    profile_id: job.profile_id,
    filename: job.filename,
    detected_year: job.detected_year ?? null,
    detected_format: esqFormatName(manifest),
    status: job.status,
    warnings: [],
    draft_data: { manifest },
    preview,
  }
}

async function refreshPreviewConflicts(preview: JsonRecord, profileId: unknown): Promise<void> {
  const conflicts = Array.isArray(preview?.conflicts) ? preview.conflicts as JsonRecord[] : []
  if (!conflicts.length) return
  const keys = conflicts.map(item => String(item.paperKey || '')).filter(Boolean)
  if (!keys.length) return
  const placeholders = keys.map(() => '?').join(',')
  const existingRows = await rows<{ external_key: string; id: number; year: number; title: string }>(
    `SELECT external_key, id, year, title FROM papers
     WHERE profile_id = ? AND external_key IN (${placeholders}) AND deleted_at IS NULL`,
    [Number(profileId), ...keys],
  )
  const existingByKey = new Map(existingRows.map(item => [item.external_key, item]))
  for (const conflict of conflicts) {
    const found = existingByKey.get(String(conflict.paperKey || ''))
    conflict.existing = found ? { id: found.id, year: found.year, title: found.title } : null
  }
}

// Older drafts stay in SQLite: project one bounded record at a time over the bridge.
async function legacyPackageSummary(id: number, job: JsonRecord): Promise<ImportedPackage> {
  const pkg: ImportedPackage = { legacyJobId: id, manifest: JSON.parse(job.manifest_data), assets: JSON.parse(job.assets_data || '[]'), papers: [] }
  validateManifest(pkg.manifest)
  for (let p = 0; p < Number(job.paper_count); p++) {
    const path = `$.papers[${p}]`
    const record = await row<JsonRecord>(
      `SELECT json_extract(package_data, ?) AS descriptor,
         json_remove(json_extract(package_data, ?), '$.units') AS paper,
         json_array_length(package_data, ?) AS unit_count
       FROM esq_import_jobs WHERE id = ?`,
      [`${path}.descriptor`, `${path}.paper`, `${path}.paper.units`, id],
    )
    const count = await row<JsonRecord>(
      `SELECT COALESCE(SUM(json_array_length(value, '$.questions')), 0) AS count
       FROM esq_import_jobs, json_each(package_data, ?) WHERE esq_import_jobs.id = ?`,
      [`${path}.paper.units`, id],
    )
    pkg.papers.push({ descriptor: JSON.parse(record!.descriptor), paper: JSON.parse(record!.paper),
      unitCount: Number(record!.unit_count), questionCount: Number(count!.count), answers: {}, labels: null })
  }
  return pkg
}

async function readLegacyRecord(
  db: Awaited<ReturnType<typeof androidDatabase>>, id: number,
  location: { paper: number; unit: number; question?: number },
): Promise<JsonRecord> {
  const paperPath = `$.papers[${location.paper}]`
  const unitPath = `${paperPath}.paper.units[${location.unit}]`
  const result = await db.query(
    `SELECT ${location.question === undefined ? "json_remove(json_extract(package_data, ?), '$.questions')" : 'json_extract(package_data, ?)'} AS data
     FROM esq_import_jobs WHERE id = ?`,
    [location.question === undefined ? unitPath : `${unitPath}.questions[${location.question}]`, id],
  )
  const value = JSON.parse(result.values![0].data)
  if (location.question === undefined) {
    const questions = await db.query(
      `SELECT json_extract(value, '$.questionKey') AS questionKey, json_extract(value, '$.number') AS number
       FROM esq_import_jobs, json_each(package_data, ?) WHERE esq_import_jobs.id = ?`,
      [`${unitPath}.questions`, id],
    )
    value.questions = questions.values || []
    const audio = await db.query(
      `SELECT DISTINCT json_extract(block.value, '$.assetId') AS assetId
       FROM esq_import_jobs AS job, json_tree(job.package_data, ?) AS block
       WHERE job.id = ? AND block.type = 'object'
         AND json_extract(block.value, '$.type') = 'audio'`,
      [`${unitPath}.questions`, id],
    )
    value.questionAudioBlocks = (audio.values || []).map(block => ({ type: 'audio', assetId: block.assetId }))
    return value
  }
  const key = JSON.stringify(value.questionKey)
  const related = await db.query(
    'SELECT json_extract(package_data, ?) AS answer, json_extract(package_data, ?) AS label FROM esq_import_jobs WHERE id = ?',
    [`${paperPath}.answers.answers.${key}`, `${paperPath}.labels.labels.${key}`, id],
  )
  return { question: value, answer: JSON.parse(related.values![0].answer || 'null'), label: JSON.parse(related.values![0].label || 'null') }
}

async function upsertPaper(
  db: Awaited<ReturnType<typeof androidDatabase>>,
  pkg: ImportedPackage,
  item: ImportedPackage['papers'][number],
  profileId: number,
  existingPaperId = 0,
  stagedPaperIndex = -1,
): Promise<number> {
  const paper = item.paper
  const manifest = pkg.manifest
  const exam = paperExamMetadata(item.descriptor, paper)
  let paperId = existingPaperId
  if (paperId) {
    await db.run(
      `UPDATE papers SET
         profile_id = ?, external_key = ?, package_id = ?, content_version = ?, year = ?,
         subject = ?, title = ?, exam_type = ?, exam_month = ?, set_number = ?,
         status = 'published', deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        profileId,
        paper.paperKey,
        manifest.packageId,
        manifest.contentVersion,
        paper.year,
        paper.subject || manifest.subject || '英语一',
        paper.title || `${paper.year} 年英语试卷`,
        exam.examType,
        exam.examMonth,
        exam.setNumber,
        paperId,
      ],
      false,
    )
  } else {
    const inserted = await db.run(
      `INSERT INTO papers
        (profile_id, external_key, package_id, content_version, year, subject, title,
         exam_type, exam_month, set_number, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published')`,
      [
        profileId,
        paper.paperKey,
        manifest.packageId,
        manifest.contentVersion,
        paper.year,
        paper.subject || manifest.subject || '英语一',
        paper.title || `${paper.year} 年英语试卷`,
        exam.examType,
        exam.examMonth,
        exam.setNumber,
      ],
      false,
    )
    paperId = Number(inserted.changes?.lastId)
  }
  const {loadBundledContentManifest} = await import('./content-remediation')
  const contentManifest = await loadBundledContentManifest()
  const answers = item.answers?.answers || {}
  const assets = new Map((pkg.assets || []).map(asset => [asset.assetId, asset]))
  const staged = pkg.stageId ? (await import('./esq-stage')).nativeEsqStage
    : pkg.legacyJobId ? { read: (location: { paper: number; unit: number; question?: number }) => readLegacyRecord(db, pkg.legacyJobId!, location) } : null
  for (let unitIndex = 0; unitIndex < (item.unitCount ?? paper.units.length); unitIndex++) {
    const unit = staged
      ? await staged.read({ stageId: pkg.stageId!, paper: stagedPaperIndex, unit: unitIndex })
      : paper.units[unitIndex]
    validateOrderingFixedSlots(unit)
    const { validateRemediatedImport } = await import('./content-remediation')
    await validateRemediatedImport({ ...paper, units: [unit] }, answers, Boolean(staged))
    const blocks = unit.passage?.blocks || []
    const fixedSlots = orderingFixedSlotsForPaperUnit(paper, unit)
    const existingUnit = await db.query(
      `SELECT id, shared_data FROM units
       WHERE paper_id = ? AND (external_key = ? OR sequence = ?)
       LIMIT 1`,
      [paperId, unit.unitKey, Number(unit.sequence || unitIndex + 1)],
    )
    let unitId = Number(existingUnit.values?.[0]?.id || 0)
    const contentBlocks = [
      ...blocks,
      ...(unit.questionAudioBlocks || []),
      ...(unit.questions || []).flatMap((question: JsonRecord) => [
        ...(question.stemBlocks || []),
        ...(question.options || []).flatMap((option: JsonRecord) => option.contentBlocks || []),
      ]),
    ]
    const unitAssetIds = [...new Set(contentBlocks
      .filter((block: JsonRecord) => block?.type === 'audio' && block.assetId)
      .map((block: JsonRecord) => String(block.assetId)))]
    const audioTracks = unitAssetIds
      .map((assetId: string) => assets.get(assetId))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
      .map(asset => ({
      asset_id: asset!.assetId,
      label: asset!.label || asset!.originalName || asset!.assetId,
      media_type: asset!.mediaType,
      path: asset!.storedPath,
      package_id: manifest.packageId,
      content_version: manifest.contentVersion,
      }))
    const unitValues = [
      unit.unitKey,
      unit.type,
      unit.subtype || '',
      unit.title,
      Number(unit.sequence || unitIndex + 1),
      plainText(blocks),
      JSON.stringify({
        ...(contentManifest?.units.some(change => change.unitKey === unit.unitKey)
          ? {content_revision: contentManifest.revision} : {}),
        ...(JSON.parse(String(existingUnit.values?.[0]?.shared_data || '{}')).label_review_versions
          ? {label_review_versions: JSON.parse(String(existingUnit.values?.[0]?.shared_data || '{}')).label_review_versions} : {}),
        content_blocks: blocks,
        directions: unit.instructions || '',
        candidates: Object.fromEntries(
          (unit.candidates || []).map((candidate: JsonRecord) => [
            candidate.key,
            candidate.content,
          ]),
        ),
        ...((fixedSlots.length || Array.isArray(unit.fixed_slots) || Array.isArray(unit.fixedSlots))
          ? { fixed_slots: fixedSlots } : {}),
        ...(audioTracks.length ? {
          audio_tracks: audioTracks,
          audio_mode: audioTracks.length === 1 ? 'continuous' : 'playlist',
        } : {}),
      }),
    ]
    if (unitId) {
      await db.run(
        `UPDATE units SET
           external_key = ?, unit_type = ?, subtype = ?, title = ?,
           sequence = ?, passage = ?, shared_data = ?
         WHERE id = ?`,
        [...unitValues, unitId],
        false,
      )
    } else {
      const insertedUnit = await db.run(
        `INSERT INTO units
          (paper_id, external_key, unit_type, subtype, title, sequence, passage, shared_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [paperId, ...unitValues],
        false,
      )
      unitId = Number(insertedUnit.changes?.lastId)
    }
    for (let questionIndex = 0; questionIndex < (unit.questions || []).length; questionIndex++) {
      const record = staged ? await staged.read({ stageId: pkg.stageId!, paper: stagedPaperIndex, unit: unitIndex, question: questionIndex }) : null
      const question = record ? record.question : unit.questions[questionIndex]
      const answer = record ? record.answer : answers[question.questionKey]
      if (!answer?.correctOption) {
        throw new LocalApiError(422, `${paper.year} 年第 ${question.number} 题缺少标准答案`)
      }
      const stemBlocks = question.stemBlocks || []
      const contentHash = await questionContentHash(unit, question, answer)
      const reviewed = contentManifest?.units.find(change => change.unitKey === unit.unitKey)
      if (reviewed && reviewed.questionHashes[question.questionKey] !== contentHash) throw new LocalApiError(422, '此题库包含已修正的旧题目，请使用新版题库包；现有学习记录未修改')
      const existingQuestion = await db.query(
        `SELECT id, content_hash FROM questions
         WHERE unit_id = ? AND (external_key = ? OR number = ?)
         LIMIT 1`,
        [unitId, question.questionKey, Number(question.number)],
      )
      const oldQuestion = existingQuestion.values?.[0]
      let questionId = Number(oldQuestion?.id || 0)
      const questionValues = [
        question.questionKey,
        Number(question.number),
        String(question.stem || ''),
        question.type || 'single_choice',
        String(answer.correctOption).toUpperCase(),
        Number(answer.score ?? question.score ?? 1),
        questionIndex + 1,
        JSON.stringify({
          ...(question.metadata || {}),
          ...(stemBlocks.length ? { content_blocks: stemBlocks } : {}),
        }),
        contentHash,
      ]
      if (questionId) {
        if (oldQuestion?.content_hash && oldQuestion.content_hash !== contentHash) {
          await db.run('DELETE FROM question_ai_labels WHERE question_id = ?', [questionId], false)
        }
        await db.run(
          `UPDATE questions SET
             external_key = ?, number = ?, stem = ?, question_type = ?,
             answer = ?, score = ?, sequence = ?, metadata = ?, content_hash = ?
           WHERE id = ?`,
          [...questionValues, questionId],
          false,
        )
      } else {
        const insertedQuestion = await db.run(
          `INSERT INTO questions
            (unit_id, external_key, number, stem, question_type, answer,
             score, sequence, metadata, content_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [unitId, ...questionValues],
          false,
        )
        questionId = Number(insertedQuestion.changes?.lastId)
      }
      const importedOptionKeys: string[] = []
      for (let optionIndex = 0; optionIndex < (question.options || []).length; optionIndex++) {
        const option = question.options[optionIndex]
        importedOptionKeys.push(option.key)
        await db.run(
          `INSERT INTO options
            (question_id, stable_key, original_label, content, sequence, metadata)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(question_id, stable_key) DO UPDATE SET
             original_label = excluded.original_label,
             content = excluded.content,
             sequence = excluded.sequence,
             metadata = excluded.metadata`,
          [
            questionId,
            option.key,
            option.key,
            String(option.content || ''),
            optionIndex + 1,
            JSON.stringify(
              option.contentBlocks?.length
                ? { content_blocks: option.contentBlocks }
                : {},
            ),
          ],
          false,
        )
      }
      if (importedOptionKeys.length) {
        await db.run(
          `DELETE FROM options
           WHERE question_id = ?
             AND stable_key NOT IN (${importedOptionKeys.map(() => '?').join(',')})`,
          [questionId, ...importedOptionKeys],
          false,
        )
      }
      const label = record ? record.label : item.labels?.labels?.[question.questionKey]
      if (label?.questionContentHash === contentHash) {
        await db.run(
          `INSERT OR REPLACE INTO question_ai_labels
            (question_id, primary_skill, secondary_skills, trap_types,
             attention_points, vocabulary_demand, context_dependency,
             grammar_dependency, confidence, locked, model_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            questionId,
            label.primarySkill || '',
            JSON.stringify(label.secondarySkills || []),
            JSON.stringify(label.trapTypes || []),
            JSON.stringify(label.attentionPoints || []),
            label.vocabularyDemand || 'medium',
            label.contextDependency || 'medium',
            label.grammarDependency || 'medium',
            Number(label.confidence || 0),
            label.source || 'esq',
          ],
          false,
        )
      }
    }
  }
  return paperId
}

export async function publishEsqImport(
  id: number,
  body: { resolutions?: Array<{ paper_key: string; action: string }> },
): Promise<JsonRecord> {
  const job = await row<JsonRecord>(
    `SELECT id, profile_id, status,
       json_extract(package_data, '$.stageId') AS stage_id,
       json_extract(package_data, '$.manifest') AS manifest_data,
       json_extract(package_data, '$.assets') AS assets_data,
       json_array_length(package_data, '$.papers') AS paper_count
     FROM esq_import_jobs WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  const pkg = job.stage_id
    ? await (await import('./esq-stage')).nativeEsqStage.resume({ stageId: job.stage_id }) as ImportedPackage
    : await legacyPackageSummary(id, job)
  const { ensureContentRemediation } = await import('./content-remediation')
  await ensureContentRemediation()
  const profileId = Number(job.profile_id)
  const resolutions = new Map(
    (body.resolutions || []).map(item => [item.paper_key, item.action]),
  )
  const publishedPaperIds: number[] = []
  const preview = await buildPreview(pkg, profileId)
  await transaction(async db => {
    const current = await db.query('SELECT status FROM esq_import_jobs WHERE id = ? AND deleted_at IS NULL', [id])
    if (!current.values?.length) throw new LocalApiError(404, '题库导入记录不存在')
    if (current.values[0].status === 'published') throw new LocalApiError(409, '此题库已完成入库')
    for (let paperIndex = 0; paperIndex < pkg.papers.length; paperIndex++) {
      const item = pkg.papers[paperIndex]
      const matches = await db.query(
        `SELECT id, deleted_at FROM papers
         WHERE profile_id = ? AND external_key = ?
         ORDER BY deleted_at IS NULL DESC, id`,
        [profileId, item.paper.paperKey],
      )
      const activeMatches = (matches.values || []).filter(row => row.deleted_at == null)
      const deletedMatches = (matches.values || []).filter(row => row.deleted_at != null)
      if (activeMatches.length > 1) {
        throw new LocalApiError(409, `${item.paper.year} 年题库存在多个活动版本，无法安全导入`)
      }
      if (!activeMatches.length && deletedMatches.length > 1) {
        throw new LocalApiError(409, `${item.paper.year} 年题库存在多个已删除版本，无法确定应复用哪一个`)
      }
      const existingId = Number(activeMatches[0]?.id || deletedMatches[0]?.id || 0)
      const reusingDeleted = !activeMatches.length && deletedMatches.length === 1
      if (existingId) {
        if (!reusingDeleted) {
          const action = resolutions.get(item.paper.paperKey)
          if (!action) throw new LocalApiError(409, `请先决定 ${item.paper.year} 年题库的处理方式`)
          if (action === 'keep_existing') {
            publishedPaperIds.push(existingId)
            continue
          }
          if (action !== 'replace_with_imported') throw new LocalApiError(422, '未知的题库冲突处理方式')
        }
      }
      publishedPaperIds.push(await upsertPaper(db, pkg, item, profileId, existingId, paperIndex))
      if (reusingDeleted) {
        await db.run(
          `UPDATE trash_entries SET restored_at = CURRENT_TIMESTAMP
           WHERE resource_type = 'paper' AND resource_id = ? AND restored_at IS NULL`,
          [existingId],
          false,
        )
      }
    }
    await rebindLearningHistory(db, {
      paperKeys: pkg.papers.map(item => String(item.paper.paperKey || '')).filter(Boolean),
    })
    await db.run(
      `INSERT OR REPLACE INTO question_bank_packages
        (package_id, content_version, title, publisher, manifest_data, status)
       VALUES (?, ?, ?, ?, ?, 'published')`,
      [
        pkg.manifest.packageId,
        pkg.manifest.contentVersion,
        pkg.manifest.title || '',
        pkg.manifest.publisher || '',
        JSON.stringify(pkg.manifest),
      ],
      false,
    )
    await db.run(
    `UPDATE esq_import_jobs
     SET status = 'published', preview_data = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
      [JSON.stringify(preview), id], false,
    )
  }, { exclusive: true })
  return {
    published: true,
    packageId: pkg.manifest.packageId,
    paper_ids: publishedPaperIds,
    scope_title: preview.title,
  }
}

// 空会话清扫是维护动作，不是读取的一部分：挂在请求边界每次启动执行一次即可。
// 原先每次 /papers 都无条件执行这条 UPDATE，把一个写事务塞进纯读路径，既拖慢
// 首页与试卷库首屏，又把 updated_at 刷成新值，让 LAN 同步看到无意义的行变更。
// 清扫结果不影响 listPapers 本身（进行中会话本来就要求有作答或整篇提交），
// 它的作用是让首页“最近练习”和续练不再看到早就放弃的空会话。
let emptySessionSweepStarted = false

export async function sweepEmptyPaperSessions(): Promise<void> {
  // 先立标记再写库：并发请求同时命中也只放行一个，一次启动只尝试一次。
  if (emptySessionSweepStarted) return
  emptySessionSweepStarted = true
  await run(
    `UPDATE practice_sessions SET status = 'abandoned', updated_at = CURRENT_TIMESTAMP
     WHERE mode = 'paper' AND status = 'active'
       AND NOT EXISTS (SELECT 1 FROM practice_answers pa
         WHERE pa.session_id = practice_sessions.id AND TRIM(COALESCE(pa.user_answer, '')) <> '')
       AND NOT EXISTS (SELECT 1 FROM practice_unit_submissions pus
         WHERE pus.session_id = practice_sessions.id)
       AND COALESCE(practice_sessions.updated_at, practice_sessions.started_at) < datetime('now', '-7 days')`,
  )
}

export async function listPapers(): Promise<JsonRecord[]> {
  const profileId = await activeQuestionBankProfileId()
  return rows(
    `SELECT p.id, p.year, p.subject, p.title, p.status,
       COUNT(DISTINCT u.id) AS unit_count,
       COUNT(q.id) AS question_count,
       (SELECT ps.id FROM practice_sessions ps
        WHERE ps.paper_id = p.id AND ps.status = 'active' AND ps.mode = 'paper'
          AND (EXISTS (SELECT 1 FROM practice_answers pa_progress
               WHERE pa_progress.session_id = ps.id AND TRIM(COALESCE(pa_progress.user_answer, '')) <> '')
            OR EXISTS (SELECT 1 FROM practice_unit_submissions pus_progress
               WHERE pus_progress.session_id = ps.id))
        ORDER BY
          (SELECT COUNT(*) FROM practice_unit_submissions pus WHERE pus.session_id = ps.id) DESC,
          (SELECT COUNT(*) FROM practice_answers pa
           WHERE pa.session_id = ps.id AND TRIM(COALESCE(pa.user_answer, '')) <> '') DESC,
          COALESCE(ps.updated_at, ps.started_at) DESC, ps.id DESC
        LIMIT 1) AS active_session_id,
       (SELECT COUNT(*) FROM practice_unit_submissions pus
        WHERE pus.session_id = (
          SELECT ps.id FROM practice_sessions ps
          WHERE ps.paper_id = p.id AND ps.status = 'active' AND ps.mode = 'paper'
            AND (EXISTS (SELECT 1 FROM practice_answers pa_progress
                 WHERE pa_progress.session_id = ps.id AND TRIM(COALESCE(pa_progress.user_answer, '')) <> '')
              OR EXISTS (SELECT 1 FROM practice_unit_submissions pus_progress
                 WHERE pus_progress.session_id = ps.id))
          ORDER BY
            (SELECT COUNT(*) FROM practice_unit_submissions ranked_pus WHERE ranked_pus.session_id = ps.id) DESC,
            (SELECT COUNT(*) FROM practice_answers pa
             WHERE pa.session_id = ps.id AND TRIM(COALESCE(pa.user_answer, '')) <> '') DESC,
            COALESCE(ps.updated_at, ps.started_at) DESC, ps.id DESC
          LIMIT 1
        )) AS active_done,
       (SELECT ps.score FROM practice_sessions ps
        WHERE ps.paper_id = p.id AND ps.status = 'submitted' AND ps.mode = 'paper'
        ORDER BY ps.id DESC LIMIT 1) AS last_score,
       (SELECT ps.max_score FROM practice_sessions ps
        WHERE ps.paper_id = p.id AND ps.status = 'submitted' AND ps.mode = 'paper'
        ORDER BY ps.id DESC LIMIT 1) AS last_max_score
     FROM papers p
     LEFT JOIN units u ON u.paper_id = p.id
     LEFT JOIN questions q ON q.unit_id = u.id
     WHERE p.profile_id = ? AND p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY p.year DESC, p.title`,
    [profileId],
  )
}

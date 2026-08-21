import { row, rows, run, transaction } from './database'
import { LocalApiError } from './errors'

type JsonRecord = Record<string, any>

function sqlTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function newBatch() {
  return {
    batchId: crypto.randomUUID(),
    purgeAfter: sqlTimestamp(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  }
}

export async function activeQuestionBankProfileId(): Promise<number> {
  const setting = await row<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'active_question_bank_profile_id'",
  )
  const requested = Number(setting?.value || 0)
  if (requested) {
    const exists = await row(
      'SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL',
      [requested],
    )
    if (exists) return requested
  }
  let fallback = await row<{ id: number }>(
    'SELECT id FROM question_bank_profiles WHERE deleted_at IS NULL ORDER BY is_default DESC, id LIMIT 1',
  )
  if (!fallback) {
    const created = await run(
      "INSERT INTO question_bank_profiles(name, is_default) VALUES ('默认题库', 1)",
    )
    fallback = { id: Number(created.lastId) }
  }
  await run(
    `INSERT INTO app_settings(key, value)
     VALUES ('active_question_bank_profile_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(fallback.id)],
  )
  return Number(fallback.id)
}

export async function listQuestionBankProfiles(): Promise<JsonRecord[]> {
  const activeId = await activeQuestionBankProfileId()
  const result = await rows<JsonRecord>(
    `SELECT p.*,
       COUNT(DISTINCT papers.id) AS paper_count,
       COUNT(DISTINCT units.id) AS unit_count,
       COUNT(DISTINCT questions.id) AS question_count,
       MAX(papers.updated_at) AS last_used_at
     FROM question_bank_profiles p
     LEFT JOIN papers ON papers.profile_id = p.id AND papers.deleted_at IS NULL
     LEFT JOIN units ON units.paper_id = papers.id
     LEFT JOIN questions ON questions.unit_id = units.id
     WHERE p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY (p.id = ?) DESC, p.is_default DESC, p.updated_at DESC, p.id`,
    [activeId],
  )
  return result.map(item => ({ ...item, is_active: Number(item.id) === activeId }))
}

export async function createQuestionBankProfile(body: JsonRecord): Promise<JsonRecord> {
  const name = String(body.name || '').trim()
  if (!name) throw new LocalApiError(422, '题库配置名称不能为空')
  try {
    const created = await run(
      'INSERT INTO question_bank_profiles(name, description) VALUES (?, ?)',
      [name, String(body.description || '').trim()],
    )
    return (await row('SELECT * FROM question_bank_profiles WHERE id = ?', [created.lastId]))!
  } catch {
    throw new LocalApiError(409, '已经存在同名题库配置')
  }
}

export async function updateQuestionBankProfile(id: number, body: JsonRecord): Promise<JsonRecord> {
  const existing = await row<JsonRecord>(
    'SELECT * FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!existing) throw new LocalApiError(404, '题库配置不存在')
  const name = body.name == null ? existing.name : String(body.name).trim()
  if (!name) throw new LocalApiError(422, '题库配置名称不能为空')
  try {
    await run(
      `UPDATE question_bank_profiles
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, body.description == null ? existing.description : String(body.description).trim(), id],
    )
  } catch {
    throw new LocalApiError(409, '已经存在同名题库配置')
  }
  return (await row('SELECT * FROM question_bank_profiles WHERE id = ?', [id]))!
}

export async function activateQuestionBankProfile(id: number): Promise<JsonRecord> {
  if (!await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [id])) {
    throw new LocalApiError(404, '题库配置不存在')
  }
  await run(
    `INSERT INTO app_settings(key, value)
     VALUES ('active_question_bank_profile_id', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(id)],
  )
  await run('UPDATE question_bank_profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
  return { activated: true, profile_id: id }
}

async function addTrash(
  db: any,
  batchId: string,
  type: string,
  id: number,
  name: string,
  profileId: number | null,
  purgeAfter: string,
  metadata: JsonRecord = {},
) {
  await db.run(
    `INSERT INTO trash_entries
      (deletion_batch_id, resource_type, resource_id, resource_name,
       profile_id, metadata, purge_after)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [batchId, type, id, name, profileId, JSON.stringify(metadata), purgeAfter],
    false,
  )
}

export async function deleteQuestionBankProfile(id: number): Promise<JsonRecord> {
  const profile = await row<JsonRecord>(
    'SELECT * FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!profile) throw new LocalApiError(404, '题库配置不存在')
  let candidates = await rows<{ id: number }>(
    'SELECT id FROM question_bank_profiles WHERE deleted_at IS NULL AND id <> ? ORDER BY is_default DESC, updated_at DESC, id',
    [id],
  )
  if (!candidates.length) {
    let name = '默认题库'
    let suffix = 2
    while (await row(
      'SELECT id FROM question_bank_profiles WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL',
      [name],
    )) {
      name = `默认题库（${suffix}）`
      suffix += 1
    }
    const created = await createQuestionBankProfile({ name })
    candidates = [{ id: Number(created.id) }]
  }
  const activeId = await activeQuestionBankProfileId()
  const { batchId, purgeAfter } = newBatch()
  await transaction(async db => {
    const papers = (await db.query(
      'SELECT id, year, title, status FROM papers WHERE profile_id = ? AND deleted_at IS NULL',
      [id],
    )).values || []
    const documentJobs = (await db.query(
      `SELECT id, filename, status FROM document_import_jobs
       WHERE profile_id = ? AND deleted_at IS NULL`,
      [id],
    )).values || []
    const esqJobs = (await db.query(
      `SELECT id, filename, status FROM esq_import_jobs
       WHERE profile_id = ? AND deleted_at IS NULL`,
      [id],
    )).values || []
    await db.run(
      'UPDATE question_bank_profiles SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id], false,
    )
    for (const paper of papers) {
      await db.run(
        "UPDATE papers SET deleted_at = CURRENT_TIMESTAMP, status = 'trashed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [paper.id], false,
      )
      await addTrash(db, batchId, 'paper', Number(paper.id), `${paper.year} 年 ${paper.title}`, id, purgeAfter, {
        parent_profile_id: id,
        previous_status: paper.status,
      })
    }
    for (const job of documentJobs) {
      await db.run(
        "UPDATE document_import_jobs SET deleted_at = CURRENT_TIMESTAMP, status = 'trashed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [job.id], false,
      )
      await addTrash(db, batchId, 'document_import', Number(job.id), String(job.filename), id, purgeAfter, {
        parent_profile_id: id,
        previous_status: job.status,
      })
    }
    for (const job of esqJobs) {
      await db.run(
        "UPDATE esq_import_jobs SET deleted_at = CURRENT_TIMESTAMP, status = 'trashed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [job.id], false,
      )
      await addTrash(db, batchId, 'esq_import', Number(job.id), String(job.filename), id, purgeAfter, {
        parent_profile_id: id,
        previous_status: job.status,
      })
    }
    await addTrash(db, batchId, 'profile', id, String(profile.name), id, purgeAfter, { active_profile: activeId === id })
    if (activeId === id) {
      await db.run(
        `INSERT INTO app_settings(key, value)
         VALUES ('active_question_bank_profile_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [String(candidates[0].id)], false,
      )
    }
  })
  return { trashed: true, batch_id: batchId, purge_after: purgeAfter }
}

export async function deletePaper(id: number): Promise<JsonRecord> {
  const paper = await row<JsonRecord>(
    'SELECT id, profile_id, year, title, status FROM papers WHERE id = ? AND deleted_at IS NULL',
    [id],
  )
  if (!paper) throw new LocalApiError(404, '试卷不存在或已经在回收站')
  const { batchId, purgeAfter } = newBatch()
  await transaction(async db => {
    await db.run(
      "UPDATE papers SET deleted_at = CURRENT_TIMESTAMP, status = 'trashed', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id], false,
    )
    await addTrash(db, batchId, 'paper', id, `${paper.year} 年 ${paper.title}`, Number(paper.profile_id), purgeAfter, {
      previous_status: paper.status,
    })
  })
  return { trashed: true, batch_id: batchId, purge_after: purgeAfter }
}

export async function deleteImportDraft(
  kind: 'document_import' | 'esq_import',
  id: number,
): Promise<JsonRecord> {
  const table = kind === 'document_import' ? 'document_import_jobs' : 'esq_import_jobs'
  const job = await row<JsonRecord>(
    `SELECT id, profile_id, filename, status FROM ${table}
     WHERE id = ? AND deleted_at IS NULL`,
    [id],
  )
  if (!job) throw new LocalApiError(404, '导入草稿不存在或已经在回收站')
  if (job.status === 'published') throw new LocalApiError(409, '已发布记录不能按草稿删除')
  const { batchId, purgeAfter } = newBatch()
  await transaction(async db => {
    await db.run(
      `UPDATE ${table}
       SET deleted_at = CURRENT_TIMESTAMP, status = 'trashed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id], false,
    )
    await addTrash(
      db, batchId, kind, id, String(job.filename),
      Number(job.profile_id), purgeAfter, { previous_status: job.status },
    )
  })
  return { trashed: true, batch_id: batchId, purge_after: purgeAfter }
}

export async function movePapers(body: JsonRecord): Promise<JsonRecord> {
  const ids = [...new Set((body.paper_ids || []).map(Number).filter(Boolean))]
  const targetId = Number(body.target_profile_id)
  if (!ids.length) throw new LocalApiError(422, '请选择试卷')
  if (!await row('SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL', [targetId])) {
    throw new LocalApiError(404, '目标题库配置不存在')
  }
  const renamed: JsonRecord[] = []
  await transaction(async db => {
    for (const id of ids) {
      const result = await db.query(
        'SELECT id, title, external_key FROM papers WHERE id = ? AND deleted_at IS NULL',
        [id],
      )
      const paper = result.values?.[0]
      if (!paper) throw new LocalApiError(404, '部分试卷不存在或已在回收站')
      let title = String(paper.title)
      let externalKey = String(paper.external_key)
      const duplicate = await db.query(
        `SELECT id FROM papers
         WHERE profile_id = ? AND external_key = ? AND deleted_at IS NULL AND id <> ? LIMIT 1`,
        [targetId, externalKey, id],
      )
      if (duplicate.values?.length) {
        const base = title
        let suffix = 2
        while ((await db.query(
          'SELECT id FROM papers WHERE profile_id = ? AND title = ? COLLATE NOCASE AND deleted_at IS NULL LIMIT 1',
          [targetId, `${base}（${suffix}）`],
        )).values?.length) suffix += 1
        title = `${base}（${suffix}）`
        externalKey = `${externalKey}:copy:${id}`
        renamed.push({ paper_id: id, title })
      }
      await db.run(
        `UPDATE papers SET profile_id = ?, title = ?, external_key = ?,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [targetId, title, externalKey, id], false,
      )
    }
  })
  return { moved: ids.length, target_profile_id: targetId, renamed }
}

export async function listTrash(): Promise<JsonRecord[]> {
  return rows(
    `SELECT t.*, p.name AS profile_name
     FROM trash_entries t
     LEFT JOIN question_bank_profiles p ON p.id = t.profile_id
     WHERE t.restored_at IS NULL
       AND (
         t.resource_type = 'profile'
         OR NOT EXISTS (
           SELECT 1 FROM trash_entries root
           WHERE root.deletion_batch_id = t.deletion_batch_id
             AND root.resource_type = 'profile'
             AND root.restored_at IS NULL
         )
       )
     ORDER BY t.purge_after, t.deleted_at DESC, t.id DESC`,
  )
}

export async function restoreTrash(id: number, body: JsonRecord = {}): Promise<JsonRecord> {
  const entry = await row<JsonRecord>(
    'SELECT * FROM trash_entries WHERE id = ? AND restored_at IS NULL',
    [id],
  )
  if (!entry) throw new LocalApiError(404, '回收站项目不存在')
  const group = await rows<JsonRecord>(
    `SELECT * FROM trash_entries
     WHERE deletion_batch_id = ? AND restored_at IS NULL
     ORDER BY CASE resource_type WHEN 'profile' THEN 0 ELSE 1 END, id`,
    [entry.deletion_batch_id],
  )
  const containsProfile = group.some(item => item.resource_type === 'profile')
  const requestedTargetId = containsProfile ? 0 : Number(body.target_profile_id || 0)
  const fallbackProfileId = await activeQuestionBankProfileId()
  await transaction(async db => {
    for (const item of group) {
      const preferredProfileId = requestedTargetId || Number(item.profile_id)
      const preferredProfile = preferredProfileId
        ? await db.query(
            'SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL',
            [preferredProfileId],
          )
        : null
      const profileId = preferredProfile?.values?.length
        ? preferredProfileId
        : fallbackProfileId
      const metadata = JSON.parse(item.metadata || '{}')
      const previousStatus = String(metadata.previous_status || (
        item.resource_type === 'paper' ? 'published' : 'draft'
      ))
      if (item.resource_type === 'profile') {
        const profileResult = await db.query(
          'SELECT name FROM question_bank_profiles WHERE id = ?',
          [item.resource_id],
        )
        const profile = profileResult.values?.[0]
        if (!profile) throw new LocalApiError(404, '待恢复的题库配置已不存在')
        const baseName = String(profile.name)
        let restoredName = baseName
        let suffix = 1
        while ((await db.query(
          `SELECT id FROM question_bank_profiles
           WHERE name = ? COLLATE NOCASE
             AND deleted_at IS NULL
             AND id <> ?
           LIMIT 1`,
          [restoredName, item.resource_id],
        )).values?.length) {
          suffix += 1
          restoredName = suffix === 2
            ? `${baseName}（恢复）`
            : `${baseName}（恢复 ${suffix}）`
        }
        await db.run(
          `UPDATE question_bank_profiles
           SET name = ?, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [restoredName, item.resource_id], false,
        )
      } else if (item.resource_type === 'paper') {
        const paperResult = await db.query(
          'SELECT title, external_key FROM papers WHERE id = ?',
          [item.resource_id],
        )
        const paper = paperResult.values?.[0]
        if (!paper) throw new LocalApiError(404, '待恢复的试卷已不存在')
        let title = String(paper.title)
        let externalKey = String(paper.external_key || '')
        const duplicate = await db.query(
          `SELECT id FROM papers
           WHERE profile_id = ?
             AND deleted_at IS NULL
             AND id <> ?
             AND (
               title = ? COLLATE NOCASE
               OR (? <> '' AND external_key = ?)
             )
           LIMIT 1`,
          [profileId, item.resource_id, title, externalKey, externalKey],
        )
        if (duplicate.values?.length) {
          const baseTitle = title
          let suffix = 2
          let candidate = `${baseTitle}（恢复）`
          while ((await db.query(
            `SELECT id FROM papers
             WHERE profile_id = ? AND title = ? COLLATE NOCASE
               AND deleted_at IS NULL AND id <> ?
             LIMIT 1`,
            [profileId, candidate, item.resource_id],
          )).values?.length) {
            suffix += 1
            candidate = `${baseTitle}（恢复 ${suffix}）`
          }
          title = candidate
          if (externalKey) externalKey = `${externalKey}:restored:${item.resource_id}:${suffix}`
        }
        await db.run(
          `UPDATE papers
           SET profile_id = ?, title = ?, external_key = ?,
               deleted_at = NULL, status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [profileId, title, externalKey, previousStatus, item.resource_id], false,
        )
      } else if (item.resource_type === 'document_import') {
        await db.run(
          'UPDATE document_import_jobs SET profile_id = ?, deleted_at = NULL, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [profileId, previousStatus, item.resource_id], false,
        )
      } else if (item.resource_type === 'esq_import') {
        await db.run(
          'UPDATE esq_import_jobs SET profile_id = ?, deleted_at = NULL, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [profileId, previousStatus, item.resource_id], false,
        )
      } else if (item.resource_type === 'wrong_archive') {
        for (const retryRound of metadata.rounds || []) {
          await db.run(
            `INSERT OR REPLACE INTO wrong_retry_rounds
              (id, unit_id, session_id, round_number, question_count,
               correct_count, wrong_count, submitted_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              retryRound.id, retryRound.unit_id, retryRound.session_id,
              retryRound.round_number, retryRound.question_count,
              retryRound.correct_count, retryRound.wrong_count,
              retryRound.submitted_at, retryRound.deleted_at,
            ], false,
          )
        }
        for (const question of metadata.round_questions || []) {
          await db.run(
            `INSERT OR REPLACE INTO wrong_retry_round_questions
              (round_id, question_id, user_answer, is_correct)
             VALUES (?, ?, ?, ?)`,
            [question.round_id, question.question_id, question.user_answer || '', question.is_correct || 0],
            false,
          )
        }
        for (const question of metadata.current || []) {
          await db.run(
            `INSERT OR REPLACE INTO wrong_current_questions
              (unit_id, question_id, since_round_id, deleted_at)
             VALUES (?, ?, ?, ?)`,
            [question.unit_id, question.question_id, question.since_round_id, question.deleted_at],
            false,
          )
        }
        if (metadata.state) {
          const state = metadata.state
          await db.run(
            `INSERT OR REPLACE INTO wrong_analysis_states
              (unit_id, report_id, analyzed_session_id, analyzed_at)
             VALUES (?, ?, ?, ?)`,
            [state.unit_id, state.report_id, state.analyzed_session_id || 0, state.analyzed_at],
            false,
          )
        }
      }
    }
    await db.run(
      'UPDATE trash_entries SET restored_at = CURRENT_TIMESTAMP WHERE deletion_batch_id = ? AND restored_at IS NULL',
      [entry.deletion_batch_id], false,
    )
  })
  return { restored: true, batch_id: entry.deletion_batch_id, count: group.length }
}

export async function purgeTrash(id: number): Promise<JsonRecord> {
  const entry = await row<JsonRecord>(
    'SELECT * FROM trash_entries WHERE id = ? AND restored_at IS NULL',
    [id],
  )
  if (!entry) throw new LocalApiError(404, '回收站项目不存在')
  const group = await rows<JsonRecord>(
    `SELECT * FROM trash_entries
     WHERE deletion_batch_id = ? AND restored_at IS NULL
     ORDER BY CASE resource_type
       WHEN 'paper' THEN 0
       WHEN 'document_import' THEN 1
       WHEN 'esq_import' THEN 1
       WHEN 'profile' THEN 2
       ELSE 1 END`,
    [entry.deletion_batch_id],
  )
  await transaction(async db => {
    for (const item of group) {
      if (item.resource_type === 'paper') await db.run('DELETE FROM papers WHERE id = ?', [item.resource_id], false)
      if (item.resource_type === 'document_import') await db.run('DELETE FROM document_import_jobs WHERE id = ?', [item.resource_id], false)
      if (item.resource_type === 'esq_import') await db.run('DELETE FROM esq_import_jobs WHERE id = ?', [item.resource_id], false)
    }
    for (const item of group.filter(item => item.resource_type === 'profile')) {
      await db.run('DELETE FROM question_bank_profiles WHERE id = ?', [item.resource_id], false)
    }
    await db.run('DELETE FROM trash_entries WHERE deletion_batch_id = ?', [entry.deletion_batch_id], false)
  })
  return { purged: true, batch_id: entry.deletion_batch_id, count: group.length }
}

export async function purgeExpiredTrash() {
  const expired = await rows<{ id: number }>(
    'SELECT id FROM trash_entries WHERE restored_at IS NULL AND purge_after <= CURRENT_TIMESTAMP ORDER BY id',
  )
  const handled = new Set<string>()
  for (const item of expired) {
    const entry = await row<{ deletion_batch_id: string }>('SELECT deletion_batch_id FROM trash_entries WHERE id = ?', [item.id])
    if (!entry || handled.has(entry.deletion_batch_id)) continue
    handled.add(entry.deletion_batch_id)
    await purgeTrash(item.id)
  }
}

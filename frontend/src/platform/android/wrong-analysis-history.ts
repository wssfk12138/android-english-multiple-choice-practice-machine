import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { rows } from './database'

type RecordRow = Record<string, any>
function ids(value: unknown): number[] {
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(Number).filter(id => id > 0) : [] } catch { return [] }
}
export function reportUnitIds(report: RecordRow, states: RecordRow[] = []) {
  return [...new Set([...ids(report.unit_ids), ...states.filter(s => +s.report_id === +report.id).map(s => +s.unit_id)])]
}
export async function wrongAnalysisHistory(unitId: number) {
  const active = await rows<RecordRow>(
    `SELECT u.id FROM units u JOIN papers p ON p.id=u.paper_id
     JOIN question_bank_profiles b ON b.id=p.profile_id
     WHERE u.id=? AND p.deleted_at IS NULL AND b.deleted_at IS NULL
       AND (EXISTS(SELECT 1 FROM wrong_current_questions w WHERE w.unit_id=u.id AND w.deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM wrong_retry_rounds w WHERE w.unit_id=u.id AND w.deleted_at IS NULL)
         OR EXISTS(SELECT 1 FROM wrong_analysis_states w WHERE w.unit_id=u.id))`, [unitId])
  if (!active.length) return []
  const reportIndex = await rows<RecordRow>('SELECT id, unit_ids, scope_title, model_name, aggregate_data, created_at FROM wrong_analysis_reports ORDER BY created_at DESC, id DESC')
  const states = await rows<RecordRow>('SELECT unit_id, report_id FROM wrong_analysis_states WHERE unit_id=?', [unitId])
  const selectedIds = reportIndex.filter(r => reportUnitIds(r, states).includes(unitId)).map(r => Number(r.id))
  if (!selectedIds.length) return []
  const placeholders = selectedIds.map(() => '?').join(',')
  const reports = await rows<RecordRow>(
    'SELECT id, scope_title, report, model_name, aggregate_data, created_at FROM wrong_analysis_reports WHERE id IN (' + placeholders + ') ORDER BY created_at DESC, id DESC',
    selectedIds,
  )
  return reports.map(r => ({
    id: r.id, scope_title: r.scope_title, report: r.report, model_name: r.model_name, created_at: r.created_at,
    aggregate: (() => { try { return JSON.parse(r.aggregate_data) } catch { return null } })(),
  }))
}
/** Move this unit's membership and reports into the existing recycle-bin payload. */
export async function archiveAnalysis(db: SQLiteDBConnection, unitId: number, legacyState?: RecordRow, cutoff?: string) {
  const reports = (await db.query('SELECT * FROM wrong_analysis_reports')).values || []
  const states = (await db.query('SELECT unit_id, report_id FROM wrong_analysis_states')).values || []
  if (legacyState) states.push(legacyState)
  const archived: RecordRow[] = []
  for (const report of reports) {
    // An old archive must not absorb reports created after that deletion.
    if (cutoff && String(report.created_at).replace('T',' ').slice(0,19) > cutoff.replace('T',' ').slice(0,19)) continue
    if (cutoff && legacyState?.report_id && +report.id > +legacyState.report_id) continue
    const members = reportUnitIds(report, states)
    if (!members.includes(unitId)) continue
    archived.push({ ...report, unit_ids: JSON.stringify([unitId]) })
    const remaining = members.filter(id => id !== unitId)
    if (remaining.length) await db.run('UPDATE wrong_analysis_reports SET unit_ids = ? WHERE id = ?', [JSON.stringify(remaining), report.id], false)
    else await db.run('DELETE FROM wrong_analysis_reports WHERE id = ?', [report.id], false)
  }
  return archived
}
/** Upgrade old recycle-bin payloads once, before expiry can discard their associations. */
export async function reconcileArchivedAnalysis(db: SQLiteDBConnection) {
  const entries = (await db.query("SELECT id, resource_id, metadata, deleted_at FROM trash_entries WHERE resource_type = 'wrong_archive' AND restored_at IS NULL ORDER BY deleted_at, id")).values || []
  for (const entry of entries) {
    let metadata: RecordRow
    try { metadata = JSON.parse(entry.metadata || '{}') } catch { continue }
    if (Array.isArray(metadata.reports)) continue
    metadata.reports = await archiveAnalysis(db, Number(entry.resource_id), metadata.state, entry.deleted_at)
    await db.run('UPDATE trash_entries SET metadata = ? WHERE id = ?', [JSON.stringify(metadata), entry.id], false)
  }
}
export async function restoreAnalysis(db: SQLiteDBConnection, reports: RecordRow[]) {
  for (const report of reports) {
    const existing = (await db.query('SELECT * FROM wrong_analysis_reports WHERE id = ?', [report.id])).values?.[0]
    if (existing) {
      const members = [...new Set([...reportUnitIds(existing), ...reportUnitIds(report)])]
      await db.run('UPDATE wrong_analysis_reports SET unit_ids = ? WHERE id = ?', [JSON.stringify(members), report.id], false)
    } else {
      await db.run(
        'INSERT INTO wrong_analysis_reports (id, scope_key, unit_ids, input_snapshot, scope_title, question_count, aggregate_data, report, model_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [report.id, report.scope_key, report.unit_ids, report.input_snapshot, report.scope_title, report.question_count, report.aggregate_data, report.report, report.model_name, report.created_at], false)
    }
  }
}
/** Paper/profile deletion can remove units without going through the wrong-book. */
export async function pruneAnalysis(db: SQLiteDBConnection) {
  const units = new Set(((await db.query('SELECT id FROM units')).values || []).map(u => +u.id))
  const states = (await db.query('SELECT unit_id, report_id FROM wrong_analysis_states')).values || []
  const reports = (await db.query('SELECT * FROM wrong_analysis_reports')).values || []
  for (const report of reports) {
    const members = reportUnitIds(report, states).filter(id => units.has(id))
    if (!members.length) await db.run('DELETE FROM wrong_analysis_reports WHERE id = ?', [report.id], false)
    else await db.run('UPDATE wrong_analysis_reports SET unit_ids = ? WHERE id = ?', [JSON.stringify(members), report.id], false)
  }
  await db.run('DELETE FROM wrong_analysis_states WHERE unit_id NOT IN (SELECT id FROM units) OR report_id NOT IN (SELECT id FROM wrong_analysis_reports)', [], false)
}

import type { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { transaction } from './database'
import { LocalApiError } from './errors'
import { activeQuestionBankProfileId } from './question-bank-profiles'

// Call only after parsing/model work: the profile and draft commit together.
export async function saveImportDraft<T>(
  profileId: number | undefined,
  newProfileName: string | undefined,
  save: (db: SQLiteDBConnection, profileId: number) => Promise<T>,
): Promise<T> {
  const name = newProfileName?.trim()
  if (newProfileName !== undefined && !name) {
    throw new LocalApiError(422, '题库配置名称不能为空')
  }
  if (name && profileId) throw new LocalApiError(422, '不能同时指定新题库和已有题库')
  const existingId = name ? undefined : profileId || await activeQuestionBankProfileId()
  return transaction(async db => {
    let targetId = existingId!
    if (name) {
      const duplicate = await db.query(
        'SELECT id FROM question_bank_profiles WHERE name = ? COLLATE NOCASE AND deleted_at IS NULL',
        [name],
      )
      if (duplicate.values?.length) throw new LocalApiError(409, '已经存在同名题库配置')
      const created = await db.run(
        'INSERT INTO question_bank_profiles(name, description) VALUES (?, ?)',
        [name, ''], false,
      )
      targetId = Number(created.changes?.lastId)
    } else {
      const existing = await db.query(
        'SELECT id FROM question_bank_profiles WHERE id = ? AND deleted_at IS NULL',
        [targetId],
      )
      if (!existing.values?.length) throw new LocalApiError(404, '题库配置不存在')
    }
    return save(db, targetId)
  })
}

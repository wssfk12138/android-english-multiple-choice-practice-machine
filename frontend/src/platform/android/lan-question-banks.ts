import { registerPlugin } from '@capacitor/core'
import { row } from './database'
import { LocalApiError } from './errors'
import { LanTransport, type LanTlsIdentity } from './lan-transport'
import { withLanQuestionBankSession } from './lan-sync'
import { createEsqImportFromNativePackage } from './question-bank'

export interface LanBank {
  packageId: string; contentVersion: string; title: string; fileName: string
  sha256: string; size: number; years: number[]; license: string
}
type Session = { token: string; base: string; tls: LanTlsIdentity }
const native = registerPlugin<{
  downloadLanQuestionBank(options: { url: string; tls: LanTlsIdentity; token: string; sha256: string; expectedSize: number }): Promise<{ packageData: string; cleanupToken: string }>
  resolveQuestionBankAssets(options: { cleanupToken: string; delete: boolean }): Promise<unknown>
}>('AppUpdater')

export function validateLanBankCatalog(value: any, hostId: string): { hostId: string; packages: LanBank[] } {
  if (value?.catalogVersion !== 1 || value.hostId !== hostId || !Array.isArray(value.packages) || value.packages.length > 100) {
    throw new LocalApiError(422, '电脑题库目录或身份无效')
  }
  const seen = new Set<string>()
  for (const item of value.packages) {
    if (!item || typeof item.packageId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(item.packageId)
      || typeof item.contentVersion !== 'string' || !/^1\.0\.0\+[a-f0-9]{64}$/.test(item.contentVersion)
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)
      || item.fileName !== item.sha256 + '.esq' || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 256 * 1024 * 1024
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200
      || typeof item.license !== 'string' || item.license.length > 2000
      || !Array.isArray(item.years) || item.years.length > 100
      || item.years.some((year: unknown) => !Number.isInteger(year) || Number(year) < 1900 || Number(year) > 2200)
      || seen.has(item.packageId)) throw new LocalApiError(422, '电脑题库条目无效')
    seen.add(item.packageId)
  }
  return { hostId, packages: value.packages }
}

async function catalog(session: Session) {
  const response = await LanTransport.post({ url: session.base + '/api/lan-sync/question-banks/catalog',
    tls: session.tls, data: { token: session.token } })
  if (response.status !== 200) throw new LocalApiError(response.status, '无法读取电脑题库，请检查共享和设备权限')
  return validateLanBankCatalog(response.data, session.tls.hostId)
}

export function checkLanQuestionBanks() {
  return withLanQuestionBankSession(undefined, catalog)
}

export function downloadLanQuestionBank(hostId: string, selected: LanBank, destination: { profileId?: number; newProfileName?: string }) {
  return withLanQuestionBankSession(hostId, async session => {
    const current = await catalog(session)
    const item = current.packages.find(p => p.packageId === selected.packageId && p.sha256 === selected.sha256)
    if (!item) throw new LocalApiError(409, '共享内容已变化，请刷新并重新选择')
    const previous = await row<{ id: number; status: string }>(
      `SELECT id, status FROM esq_import_jobs WHERE deleted_at IS NULL
       AND json_extract(package_data, '$.manifest.packageId') LIKE 'lan.bank.%'
       AND json_extract(package_data, '$.manifest.contentVersion') = ?
       AND status IN ('draft', 'published') ORDER BY id DESC LIMIT 1`, [item.contentVersion])
    if (previous) return { id: previous.id, skipped: true, status: previous.status }
    const published = await row<{ id: number }>(
      "SELECT id FROM question_bank_packages WHERE package_id LIKE 'lan.bank.%' AND content_version=? AND status='published' LIMIT 1",
      [item.contentVersion])
    if (published) return { id: 0, skipped: true, status: 'published' }
    if (destination.profileId !== undefined && (!Number.isSafeInteger(destination.profileId) || destination.profileId < 1
      || !await row('SELECT id FROM question_bank_profiles WHERE id=? AND deleted_at IS NULL', [destination.profileId]))) {
      throw new LocalApiError(422, '目标题库配置不存在')
    }
    if (!destination.profileId && !destination.newProfileName?.trim()) throw new LocalApiError(422, '请选择导入位置')
    const downloaded = await native.downloadLanQuestionBank({ url: session.base + '/api/lan-sync/question-banks/download',
      token: session.token, tls: session.tls, sha256: item.sha256, expectedSize: item.size })
    let retained = false
    try {
      const data = JSON.parse(downloaded.packageData)
      if (data?.manifest?.packageId !== item.packageId || data?.manifest?.contentVersion !== item.contentVersion) {
        throw new LocalApiError(422, '题库内容与共享目录不一致')
      }
      const result = await createEsqImportFromNativePackage(item.fileName, data, destination.profileId, destination.newProfileName)
      retained = true
      return { id: Number(result.id), skipped: false, status: 'draft' }
    } finally {
      if (downloaded.cleanupToken) await native.resolveQuestionBankAssets({ cleanupToken: downloaded.cleanupToken, delete: !retained }).catch(() => undefined)
    }
  })
}

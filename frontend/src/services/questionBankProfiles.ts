import { reactive } from 'vue'
import { del, get, patch, post } from '../api'

export const questionBankProfilesState = reactive({
  items: [] as any[],
  activeId: 0,
  loading: false,
})

export async function loadQuestionBankProfiles() {
  questionBankProfilesState.loading = true
  try {
    questionBankProfilesState.items = await get<any[]>('/question-bank-profiles')
    questionBankProfilesState.activeId = Number(
      questionBankProfilesState.items.find(item => item.is_active)?.id || 0,
    )
    return questionBankProfilesState.items
  } finally {
    questionBankProfilesState.loading = false
  }
}

export async function activateQuestionBankProfile(id: number) {
  await post(`/question-bank-profiles/${id}/activate`)
  await loadQuestionBankProfiles()
}

export async function createQuestionBankProfile(name: string) {
  await post('/question-bank-profiles', { name })
  await loadQuestionBankProfiles()
}

export async function renameQuestionBankProfile(id: number, name: string) {
  await patch(`/question-bank-profiles/${id}`, { name })
  await loadQuestionBankProfiles()
}

export async function deleteQuestionBankProfile(id: number) {
  await del(`/question-bank-profiles/${id}`)
  await loadQuestionBankProfiles()
}

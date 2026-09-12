import { ref } from 'vue'
import type { DocumentState } from './documentAgent'

type ChatMessage = {
  id?: number
  role: 'user' | 'assistant'
  content: string
  attachments?: Array<{ name: string; dataUrl: string }>
  profile_id?: number
  model_id?: string
  error?: boolean
}

type Attachment = {
  id: number
  name: string
  size: number
  dataUrl: string
}


export const assistantSession = {
  models: ref<Array<{ profile_id: number; profile_name: string; is_default: boolean; model_id: string; display_name: string; owned_by: string }>>([]),
  conversations: ref<Array<{ id: number; title: string; message_count: number; updated_at: string }>>([]),
  error: ref(''),
  document: ref<DocumentState | null>(null),
  progress: ref<string[]>([]),
  messages: ref<ChatMessage[]>([]),
  conversationId: ref<number | null>(null),
  input: ref(''),
  loading: ref(false),
  loadingData: ref(false),
  reasoningEffort: ref<'' | 'low' | 'medium' | 'high'>(''),
  attachments: ref<Attachment[]>([]),
  controller: null as AbortController | null,
}

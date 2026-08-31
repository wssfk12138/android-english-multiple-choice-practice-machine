<script setup lang="ts">
import {
  Bot,
  History,
  ImageOff,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  UserRound,
  X,
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { api, del, get } from '../api'

type SelectorModel = {
  profile_id: number
  profile_name: string
  is_default: boolean
  model_id: string
  display_name: string
  owned_by: string
}

type ConversationSummary = {
  id: number
  title: string
  message_count: number
  updated_at: string
}

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

type ReasoningEffort = '' | 'low' | 'medium' | 'high'

const router = useRouter()

const models = ref<SelectorModel[]>([])
const conversations = ref<ConversationSummary[]>([])
const messages = ref<ChatMessage[]>([])
const selectedModel = ref(localStorage.getItem('linjian-ai-model') || '')
const reasoningEffort = ref<ReasoningEffort>('')
const conversationId = ref<number | null>(null)
const input = ref('')
const loading = ref(false)
const loadingData = ref(false)
const historyOpen = ref(true)
const error = ref('')
const messageList = ref<HTMLElement | null>(null)
let controller: AbortController | null = null

const attachments = ref<Attachment[]>([])
const noVisionModels = ref(new Set<string>())
const visionError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
let attachmentSeq = 0
const MAX_ATTACHMENTS = 4
// data URL 为 ASCII base64，长度近似字节数；后端会做同样的上限校验。
const MAX_ATTACHMENT_DATA_URL_CHARS = 8 * 1024 * 1024

const VISION_ERROR_PATTERN = /(image|vision|multimodal|multi-modal|unsupported|invalid content|content part|does not support|not support)/i

function modelIdentity(selection: NonNullable<typeof activeModel.value>) {
  return `${selection.profile_id}:${selection.model_id}`
}

const attachDisabled = computed(() =>
  Boolean(activeModel.value && noVisionModels.value.has(modelIdentity(activeModel.value))),
)

function triggerAttach() {
  if (!attachDisabled.value) fileInput.value?.click()
}

function onFilesChosen(event: Event) {
  const inputEl = event.target as HTMLInputElement
  const files = Array.from(inputEl.files || [])
  inputEl.value = ''
  for (const file of files) {
    if (attachments.value.length >= MAX_ATTACHMENTS) break
    if (!file.type.startsWith('image/')) continue
    const captured = ++attachmentSeq
    compressImage(file)
      .then(dataUrl => {
        if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
          error.value = '单张图片附件过大（超过 8 MiB），请裁剪或压缩后再试'
          return
        }
        attachments.value.push({ id: captured, name: file.name, size: file.size, dataUrl })
      })
      .catch(() => undefined)
  }
}

function removeAttachment(id: number) {
  attachments.value = attachments.value.filter(item => item.id !== id)
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read-failed'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('decode-failed'))
      image.onload = () => {
        const maxEdge = 1600
        const scale = Math.min(1, maxEdge / Math.max(image.width || 1, image.height || 1))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round((image.width || 1) * scale))
        canvas.height = Math.max(1, Math.round((image.height || 1) * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('canvas-unavailable'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function formatSize(bytes: number) {
  return bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function modelValue(item: SelectorModel) {
  return `${item.profile_id}:${encodeURIComponent(item.model_id)}`
}

const activeModel = computed(() =>
  models.value.find(item => modelValue(item) === selectedModel.value),
)

const groupedModels = computed(() => {
  const groups = new Map<string, SelectorModel[]>()
  for (const model of models.value) {
    const current = groups.get(model.profile_name) || []
    current.push(model)
    groups.set(model.profile_name, current)
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }))
})

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
}

async function refreshModels() {
  try {
    const result = await get<{ models: SelectorModel[] }>('/ai/selector-models')
    models.value = result.models || []
  } catch {
    // Recover from the saved profiles if the compact selector endpoint is
    // temporarily unavailable during local app startup.
    try {
      const profiles = await get<any[]>('/ai/profiles')
      models.value = profiles
        .filter(profile => profile.enabled)
        .flatMap(profile => {
          const cached = (profile.models || [])
            .filter((model: any) =>
              model.is_visible
              && (model.is_available || model.model_id === profile.default_model),
            )
            .map((model: any) => ({
              profile_id: profile.id,
              profile_name: profile.name,
              is_default: Boolean(profile.is_default),
              model_id: model.model_id,
              display_name: model.display_name || model.model_id,
              owned_by: model.owned_by || '',
            }))
          if (
            !cached.length
            && profile.default_model
          ) {
            cached.push({
              profile_id: profile.id,
              profile_name: profile.name,
              is_default: Boolean(profile.is_default),
              model_id: profile.default_model,
              display_name: profile.default_model,
              owned_by: '',
            })
          }
          return cached
        })
      error.value = models.value.length
        ? ''
        : '没有可用于对话的模型，请在“模型与 API 设置”中启用一个模型。'
    } catch {
      models.value = []
      error.value = '暂时无法读取本机保存的模型配置，请稍后重新进入 AI 学习助手。'
    }
  }
  if (!models.value.some(item => modelValue(item) === selectedModel.value)) {
    selectedModel.value = models.value.length ? modelValue(models.value[0]) : ''
  }
  if (models.value.length) {
    error.value = ''
  }
}

async function refreshConversations() {
  try {
    conversations.value = await get<ConversationSummary[]>('/ai/conversations')
  } catch {
    // History is secondary: a temporary history failure must not block chat.
    conversations.value = []
  }
}

async function loadData() {
  if (loadingData.value) return
  loadingData.value = true
  error.value = ''
  await Promise.all([refreshModels(), refreshConversations()])
  loadingData.value = false
}

function startNewConversation() {
  conversationId.value = null
  messages.value = []
  if (window.innerWidth <= 820) historyOpen.value = false
  input.value = ''
  reasoningEffort.value = ''
}

async function openConversation(id: number) {
  try {
    const result = await get<{ id: number, messages: ChatMessage[] }>(`/ai/conversations/${id}`)
    conversationId.value = result.id
    messages.value = result.messages || []
    const latest = [...messages.value].reverse().find(item => item.profile_id && item.model_id)
    if (latest) {
      const value = `${latest.profile_id}:${encodeURIComponent(latest.model_id || '')}`
      if (models.value.some(item => modelValue(item) === value)) selectedModel.value = value
    }
    if (window.innerWidth <= 820) historyOpen.value = false
    await scrollToBottom()
  } catch (cause) {
    error.value = String(cause)
  }
}

async function removeConversation(id: number) {
  try {
    await del(`/ai/conversations/${id}`)
    if (conversationId.value === id) startNewConversation()
    await refreshConversations()
  } catch (cause) {
    error.value = String(cause)
  }
}

async function sendMessage() {
  const text = input.value.trim()
  const selection = activeModel.value
  const currentAttachments = attachments.value
  if ((!text && !currentAttachments.length) || !selection || loading.value) return
  const attachmentPayload = currentAttachments.map(item => ({ name: item.name, dataUrl: item.dataUrl }))

  messages.value.push({
    role: 'user',
    content: text || '(图片)',
    ...(currentAttachments.length
      ? { attachments: currentAttachments.map(({ name, dataUrl }) => ({ name, dataUrl })) }
      : {}),
  })
  input.value = ''
  attachments.value = []
  error.value = ''
  loading.value = true
  controller = new AbortController()
  await scrollToBottom()
  try {
    const result = await api<{
      conversation_id: number
      message: ChatMessage
    }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId.value,
        profile_id: selection.profile_id,
        model: selection.model_id,
        message: text,
        ...(attachmentPayload.length ? { attachments: attachmentPayload } : {}),
        ...(reasoningEffort.value ? { reasoning_effort: reasoningEffort.value } : {}),
      }),
      signal: controller.signal,
    })
    conversationId.value = result.conversation_id
    messages.value.push(result.message)
    await refreshConversations()
  } catch (cause: any) {
    if (cause?.name === 'AbortError') {
      messages.value.push({
        role: 'assistant',
        content: '已停止等待本次回答。你可以调整问题后重新发送。',
        error: true,
      })
    } else {
      const description = String(cause?.message || cause)
      if (attachmentPayload.length && VISION_ERROR_PATTERN.test(description)) {
        noVisionModels.value.add(modelIdentity(selection))
        visionError.value = '当前模型不支持视觉识别，请更换模型后再次尝试。'
        input.value = text
        attachments.value = currentAttachments
        messages.value.pop()
      } else {
        messages.value.push({
          role: 'assistant',
          content: `暂时无法回答：${String(cause)}`,
          error: true,
        })
      }
    }
  } finally {
    loading.value = false
    controller = null
    await scrollToBottom()
  }
}

function stopMessage() {
  controller?.abort()
}

function handleInputKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendMessage()
  }
}

function openSettings() {
  router.push('/settings')
}

function configChanged() {
  refreshModels()
}

watch(selectedModel, value => {
  if (value) localStorage.setItem('linjian-ai-model', value)
})

onMounted(() => {
  if (window.innerWidth <= 820) historyOpen.value = false
  window.addEventListener('linjian-ai-config-changed', configChanged)
  loadData()
})

onBeforeUnmount(() => {
  controller?.abort()
  window.removeEventListener('linjian-ai-config-changed', configChanged)
})
</script>

<template>
  <div class="ai-assistant-page">
    <header class="ai-page-head">
      <div>
        <h1>AI 学习助手</h1>
        <p class="lead">长难句、选项辨析、词义和学习方法，都可以在这里随时提问。</p>
      </div>
      <button class="button secondary" type="button" @click="openSettings">
        <Settings :size="17" />模型与 API 设置
      </button>
    </header>

    <section class="ai-workspace card" :class="{ 'history-closed': !historyOpen }" aria-label="AI 学习助手工作区">
      <aside class="ai-conversation-sidebar" :class="{ open: historyOpen }" aria-label="历史对话">
        <header class="ai-conversation-head">
          <div>
            <span class="ai-assistant-icon"><History :size="19" /></span>
            <span><strong>历史对话</strong><small>{{ conversations.length }} 个本地会话</small></span>
          </div>
          <button type="button" aria-label="收起历史对话" @click="historyOpen=false">
            <PanelLeftClose :size="19" />
          </button>
        </header>

        <button class="ai-new-chat" type="button" @click="startNewConversation">
          <Plus :size="17" />新对话
        </button>

        <div v-if="conversations.length" class="ai-history-list">
          <div
            v-for="item in conversations"
            :key="item.id"
            class="ai-history-item"
            :class="{ active: conversationId === item.id }"
          >
            <button type="button" @click="openConversation(item.id)">
              <span>{{ item.title }}</span><small>{{ item.message_count }} 条消息</small>
            </button>
            <button type="button" aria-label="删除此对话" @click="removeConversation(item.id)">
              <Trash2 :size="15" />
            </button>
          </div>
        </div>
        <div v-else class="ai-history-empty">还没有保存的对话</div>
      </aside>

      <button
        v-if="historyOpen"
        class="ai-history-dismiss-area"
        type="button"
        aria-label="返回当前对话"
        @click="historyOpen=false"
      />

      <div class="ai-chat-panel">
        <header class="ai-chat-toolbar">
          <div>
            <button
              v-if="!historyOpen"
              type="button"
              title="显示历史对话"
              aria-label="显示历史对话"
              @click="historyOpen=true"
            >
              <PanelLeftOpen :size="19" />
            </button>
            <span><strong>{{ conversationId ? '继续对话' : '新的学习对话' }}</strong></span>
          </div>
        </header>

        <div ref="messageList" class="ai-messages" aria-live="polite">
          <div v-if="!models.length && !loadingData" class="ai-empty-state">
            <span><Settings :size="23" /></span>
            <strong>先启用一个对话模型</strong>
            <p>在模型设置中添加 API、同步模型，并选择哪些模型显示在这里。</p>
            <button class="button secondary compact" type="button" @click="openSettings">前往模型设置</button>
          </div>
          <div v-else-if="!messages.length" class="ai-empty-state">
            <span><Bot :size="23" /></span>
            <strong>把疑问留在这里</strong>
            <p>可以询问长难句、选项差异、词义和学习方法。切换模型不会改动全局默认配置。</p>
          </div>
          <article
            v-for="(message, index) in messages"
            :key="message.id || index"
            class="ai-message"
            :class="[message.role, { error: message.error }]"
          >
            <span class="ai-message-avatar">
              <UserRound v-if="message.role==='user'" :size="15" />
              <Bot v-else :size="15" />
            </span>
            <div>
              <div v-if="message.attachments?.length" class="ai-message-attachments">
                <img
                  v-for="(item, itemIndex) in message.attachments"
                  :key="itemIndex"
                  :src="item.dataUrl"
                  alt=""
                >
              </div>
              <div v-if="message.content">{{ message.content }}</div>
            </div>
          </article>
          <article v-if="loading" class="ai-message assistant">
            <span class="ai-message-avatar"><Bot :size="15" /></span>
            <div class="ai-thinking"><LoaderCircle :size="16" class="spinning" />正在思考…</div>
          </article>
        </div>

        <div v-if="error" class="ai-inline-error" role="alert">{{ error }}</div>

        <form class="ai-composer" @submit.prevent="sendMessage">
          <div v-if="attachments.length" class="ai-attachment-strip">
            <span v-for="item in attachments" :key="item.id" class="ai-attachment-chip">
              <img :src="item.dataUrl" alt="">
              <span class="ai-attachment-meta">
                <strong>{{ item.name }}</strong>
                <small>{{ formatSize(item.size) }}</small>
              </span>
              <button type="button" aria-label="移除附件" @click="removeAttachment(item.id)">
                <X :size="14" />
              </button>
            </span>
          </div>
          <textarea
            v-model="input"
            rows="3"
            maxlength="20000"
            :disabled="!models.length"
            placeholder="输入问题，Enter 发送，Shift + Enter 换行"
            aria-label="向 AI 学习助手提问"
            @keydown="handleInputKey"
          />
          <input
            ref="fileInput"
            class="ai-file-input"
            type="file"
            accept="image/*"
            multiple
            @change="onFilesChosen"
          >
          <div class="ai-composer-actions">
            <button
              class="ai-attach-button"
              type="button"
              :disabled="loading || attachDisabled"
              :title="attachDisabled ? '该模型此前拒绝图片输入，请更换模型后再上传' : '添加图片'"
              aria-label="添加图片"
              @click="triggerAttach"
            >
              <Plus :size="18" />
            </button>
            <div class="ai-model-control">
              <label class="sr-only" for="assistant-model">对话模型</label>
              <select
                id="assistant-model"
                v-model="selectedModel"
                :disabled="!models.length || loading"
                aria-label="切换对话模型"
              >
                <option v-if="!models.length" value="">暂无可用模型</option>
                <optgroup v-for="group in groupedModels" :key="group.name" :label="group.name">
                  <option v-for="model in group.items" :key="modelValue(model)" :value="modelValue(model)">
                    {{ model.display_name || model.model_id }}
                  </option>
                </optgroup>
              </select>
            </div>
            <div class="ai-model-control ai-reasoning-control">
              <label class="sr-only" for="assistant-reasoning-effort">本次对话推理强度</label>
              <span class="ai-reasoning-label" aria-hidden="true">推理强度</span>
              <select id="assistant-reasoning-effort" v-model="reasoningEffort" :disabled="loading" aria-label="本次对话推理强度">
                <option value="">跟随配置</option>
                <option value="low">推理：低</option>
                <option value="medium">推理：中</option>
                <option value="high">推理：高</option>
              </select>
            </div>
            <button
              v-if="loading"
              class="ai-send-button stop"
              type="button"
              aria-label="停止等待回答"
              @click="stopMessage"
            >
              <Square :size="16" />
            </button>
            <button
              v-else
              class="ai-send-button"
              type="submit"
              aria-label="发送问题"
              :disabled="!input.trim() || !activeModel"
            >
              <Send :size="17" />
            </button>
          </div>
        </form>
      </div>

      <div
        v-if="visionError"
        class="ai-vision-overlay"
        role="alertdialog"
        aria-modal="true"
        @click.self="visionError = ''"
      >
        <div class="ai-vision-dialog card">
          <span class="ai-vision-dialog-icon"><ImageOff :size="22" /></span>
          <strong>{{ visionError }}</strong>
          <p>换一个支持图片输入的模型后，重新发送即可。</p>
          <button class="button" type="button" @click="visionError = ''">知道了</button>
        </div>
      </div>
    </section>
  </div>
</template>

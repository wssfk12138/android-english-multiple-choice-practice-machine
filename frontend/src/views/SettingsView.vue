<script setup lang="ts">
import {
  Check,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  Eye,
  EyeOff,
  KeyRound,
  LibraryBig,
  Lock,
  LoaderCircle,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  Server,
  Trash2,
} from 'lucide-vue-next'
import { onMounted, reactive, ref } from 'vue'
import { del, get, post, put } from '../api'
import { platformRuntime } from '../platform/runtime'

type AiModel = {
  model_id: string
  display_name: string
  owned_by: string
  provider: string
  is_visible: boolean
  is_available: boolean
}

type AiProfile = {
  id: number
  name: string
  base_url: string
  api_key?: string
  has_api_key: boolean
  enabled: boolean
  is_default: boolean
  default_model: string
  temperature: number
  max_tokens: number
  system_prompt: string
  models: AiModel[]
}

type LabelStatus = {
  year: number | null
  years: number[]
  total: number
  labeled: number
  locked: number
  review_pending: number
  remaining: number
  percentage: number
}

type QuestionLabel = {
  question_id: number
  number: number
  year: number
  unit_title: string
  primary_skill: string
  secondary_skills: string[]
  trap_types: string[]
  attention_points: string[]
  vocabulary_demand: 'low' | 'medium' | 'high'
  context_dependency: 'low' | 'medium' | 'high'
  grammar_dependency: 'low' | 'medium' | 'high'
  confidence: number
  locked: boolean
  user_edited: boolean
  model_name: string
  updated_at: string
}

const profiles = ref<AiProfile[]>([])
const expanded = ref<number[]>([])
const busy = reactive<Record<string, boolean>>({})
const notices = reactive<Record<number, string>>({})
const message = ref('')
const error = ref('')
const creating = ref(false)
const labelStatus = ref<LabelStatus | null>(null)
const labelYear = ref<number | ''>('')
const labeling = ref(false)
const labelMessage = ref('')
const overwriteUnlocked = ref(false)
const labelRunId = ref('')
const labelManagerOpen = ref(false)
const labelRows = ref<QuestionLabel[]>([])
const labelSearch = ref('')
const editingLabel = ref<QuestionLabel | null>(null)
const supportsQuestionLabeling = !platformRuntime.isAndroid

function blankProfile(): AiProfile {
  return {
    id: 0,
    name: '新 API 配置',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    has_api_key: false,
    enabled: true,
    is_default: false,
    default_model: '',
    temperature: 0.2,
    max_tokens: 1200,
    system_prompt: '',
    models: [],
  }
}

const newProfile = reactive<AiProfile>(blankProfile())

function signalChanged() {
  window.dispatchEvent(new CustomEvent('linjian-ai-config-changed'))
}

function payload(profile: AiProfile) {
  return {
    name: profile.name,
    base_url: profile.base_url,
    api_key: profile.api_key || null,
    enabled: profile.enabled,
    is_default: profile.is_default,
    default_model: profile.default_model,
    temperature: profile.temperature,
    max_tokens: profile.max_tokens,
    system_prompt: profile.system_prompt,
  }
}

function busyKey(action: string, id: number) {
  return `${action}:${id}`
}

function toggleExpanded(id: number) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter(item => item !== id)
    : [...expanded.value, id]
}

async function load() {
  try {
    const result = await get<AiProfile[]>('/ai/profiles')
    profiles.value = result.map(profile => ({ ...profile, api_key: '' }))
    if (!expanded.value.length && profiles.value.length) {
      expanded.value = [profiles.value[0].id]
    }
    error.value = ''
  } catch (cause) {
    error.value = String(cause)
  }
}

async function loadLabelStatus() {
  try {
    const query = labelYear.value === '' ? '' : `?year=${labelYear.value}`
    labelStatus.value = await get<LabelStatus>(`/ai/question-labels/status${query}`)
  } catch (cause) {
    labelMessage.value = `读取标注进度失败：${String(cause)}`
  }
}

async function runLabeling() {
  if (labeling.value) return
  if (!window.confirm('题库智能标注会调用当前默认 API 并产生 Token 消耗。确定开始吗？')) return
  if (!labelRunId.value) {
    labelRunId.value = crypto.randomUUID()
  }
  labeling.value = true
  labelMessage.value = '正在读取下一篇题目…'
  try {
    while (labeling.value) {
      const result = await post<any>('/ai/question-labels/next', {
        year: labelYear.value === '' ? null : labelYear.value,
        overwrite_unlocked: overwriteUnlocked.value,
        run_id: labelRunId.value,
      })
      labelRunId.value = result.run_id || labelRunId.value
      labelStatus.value = result
      if (result.done) {
        labelMessage.value = '所选范围已经全部完成标注'
        labeling.value = false
        labelRunId.value = ''
        break
      }
      labelMessage.value = `已完成：${result.unit_title}，本篇标注 ${result.processed} 道`
      await new Promise(resolve => window.setTimeout(resolve, 120))
    }
  } catch (cause) {
    labelMessage.value = String(cause)
    labeling.value = false
  }
}

function pauseLabeling() {
  labeling.value = false
  labelMessage.value = '已暂停。再次开始时会从下一篇未完成材料继续。'
}

async function loadQuestionLabels() {
  const query = new URLSearchParams()
  if (labelYear.value !== '') query.set('year', String(labelYear.value))
  if (labelSearch.value.trim()) query.set('search', labelSearch.value.trim())
  query.set('limit', '120')
  try {
    labelRows.value = await get<QuestionLabel[]>(`/ai/question-labels?${query}`)
    labelManagerOpen.value = true
  } catch (cause) {
    labelMessage.value = String(cause)
  }
}

function editLabel(row: QuestionLabel) {
  editingLabel.value = {
    ...row,
    // Any manual correction is protected by default. The user can explicitly
    // uncheck this if they want later batch labeling to replace it.
    locked: true,
    secondary_skills: [...(row.secondary_skills || [])],
    trap_types: [...(row.trap_types || [])],
    attention_points: [...(row.attention_points || [])],
  }
}

function splitTags(value: string) {
  return value.split(/[，,；;\n]/).map(item => item.trim()).filter(Boolean)
}

async function saveQuestionLabel() {
  const row = editingLabel.value
  if (!row) return
  const key = busyKey('label', row.question_id)
  busy[key] = true
  try {
    await put(`/ai/question-labels/${row.question_id}`, {
      primary_skill: row.primary_skill,
      secondary_skills: row.secondary_skills,
      trap_types: row.trap_types,
      attention_points: row.attention_points,
      vocabulary_demand: row.vocabulary_demand,
      context_dependency: row.context_dependency,
      grammar_dependency: row.grammar_dependency,
      confidence: row.confidence,
      locked: row.locked,
    })
    labelMessage.value = `已保存并${row.locked ? '锁定' : '解除锁定'} ${row.year} 年第 ${row.number} 题标签`
    editingLabel.value = null
    await Promise.all([loadQuestionLabels(), loadLabelStatus()])
  } catch (cause) {
    labelMessage.value = String(cause)
  } finally {
    busy[key] = false
  }
}

async function createProfile() {
  const key = busyKey('create', 0)
  if (busy[key]) return
  busy[key] = true
  try {
    const created = await post<AiProfile>('/ai/profiles', payload(newProfile))
    Object.assign(newProfile, blankProfile())
    creating.value = false
    message.value = `已添加“${created.name}”`
    error.value = ''
    await load()
    expanded.value = [created.id, ...expanded.value.filter(id => id !== created.id)]
    signalChanged()
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy[key] = false
  }
}

async function saveProfile(profile: AiProfile) {
  const key = busyKey('save', profile.id)
  if (busy[key]) return
  busy[key] = true
  try {
    await put(`/ai/profiles/${profile.id}`, payload(profile))
    notices[profile.id] = '配置已保存'
    message.value = ''
    error.value = ''
    await load()
    signalChanged()
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy[key] = false
  }
}

async function toggleProfile(profile: AiProfile) {
  profile.enabled = !profile.enabled
  await saveProfile(profile)
}

async function syncModels(profile: AiProfile) {
  const key = busyKey('sync', profile.id)
  if (busy[key]) return
  busy[key] = true
  notices[profile.id] = ''
  try {
    const result = await post<{ models: unknown[] }>(`/ai/profiles/${profile.id}/models/sync`)
    notices[profile.id] = `已同步 ${result.models.length} 个模型`
    error.value = ''
    await load()
    signalChanged()
  } catch (cause) {
    notices[profile.id] = `同步失败：${String(cause)}`
  } finally {
    busy[key] = false
  }
}

async function testProfile(profile: AiProfile) {
  const key = busyKey('test', profile.id)
  if (busy[key]) return
  busy[key] = true
  notices[profile.id] = ''
  try {
    const result = await post<{ message: string }>(`/ai/profiles/${profile.id}/test`, {
      model: profile.default_model || null,
    })
    notices[profile.id] = result.message || '连接成功'
    error.value = ''
  } catch (cause) {
    notices[profile.id] = String(cause)
  } finally {
    busy[key] = false
  }
}

async function setModelVisible(profile: AiProfile, model: AiModel) {
  model.is_visible = !model.is_visible
  try {
    await put(`/ai/profiles/${profile.id}/models`, {
      model_id: model.model_id,
      is_visible: model.is_visible,
    })
    signalChanged()
  } catch (cause) {
    model.is_visible = !model.is_visible
    error.value = String(cause)
  }
}

async function setAllVisible(profile: AiProfile, visible: boolean) {
  try {
    await put(`/ai/profiles/${profile.id}/models/visibility`, { is_visible: visible })
    profile.models.forEach(model => { model.is_visible = visible })
    signalChanged()
  } catch (cause) {
    error.value = String(cause)
  }
}

async function removeProfile(profile: AiProfile) {
  if (!window.confirm(`删除 API 配置“${profile.name}”？已保存的对话不会被删除。`)) return
  try {
    await del(`/ai/profiles/${profile.id}`)
    message.value = `已删除“${profile.name}”`
    error.value = ''
    await load()
    signalChanged()
  } catch (cause) {
    error.value = String(cause)
  }
}

onMounted(() => {
  load()
  if (supportsQuestionLabeling) loadLabelStatus()
})
</script>

<template>
  <div class="page ai-settings-page">
    <div class="page-head">
      <div>
        <span class="eyebrow">MODEL WORKSPACE</span>
        <h1>模型与 API</h1>
        <p class="lead">像工作区一样管理多个接口；只有启用的 API 和可见模型会出现在左侧助手中。</p>
      </div>
      <button class="button" type="button" @click="creating=!creating">
        <CirclePlus :size="17" />添加 API 配置
      </button>
    </div>

    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="message" class="settings-success"><Check :size="17" />{{ message }}</div>

    <section v-if="supportsQuestionLabeling" class="question-label-workspace card" aria-labelledby="question-label-title">
      <div class="question-label-heading">
        <span class="api-profile-icon"><LibraryBig :size="21" /></span>
        <div>
          <span class="eyebrow">QUESTION INTELLIGENCE</span>
          <h2 id="question-label-title">题库智能标注</h2>
          <p>模型按整篇材料预先标注每道题的考点、干扰项类型与注意事项。分析错题时复用这些标签，减少重复输出。</p>
        </div>
      </div>
      <div class="question-label-controls">
        <div class="field">
          <label for="label-year">标注范围</label>
          <select id="label-year" v-model="labelYear" :disabled="labeling" @change="loadLabelStatus">
            <option value="">全部年份</option>
            <option v-for="year in labelStatus?.years || []" :key="year" :value="year">{{ year }} 年</option>
          </select>
        </div>
        <label class="default-profile-check label-overwrite">
          <input v-model="overwriteUnlocked" type="checkbox" :disabled="labeling">
          重新标注未锁定题目
        </label>
        <div class="question-label-actions">
          <button v-if="!labeling" class="button" type="button" @click="runLabeling">
            <Play :size="16" />开始标注
          </button>
          <button v-else class="button secondary" type="button" @click="pauseLabeling">
            <Pause :size="16" />暂停
          </button>
          <button class="button secondary" type="button" :disabled="labeling" @click="loadQuestionLabels">
            <Search :size="16" />查看与校正
          </button>
        </div>
      </div>
      <div v-if="labelStatus" class="question-label-progress">
        <div>
          <span>已标注 {{ labelStatus.labeled }} / {{ labelStatus.total }} 道</span>
          <strong>{{ labelStatus.percentage }}%</strong>
        </div>
        <div class="question-label-track" role="progressbar" :aria-valuenow="labelStatus.percentage" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${labelStatus.percentage}%` }" />
        </div>
        <small>
          {{ labelStatus.locked }} 道标签已锁定；人工校正后会默认锁定，不会被批量任务覆盖。
          <template v-if="labelStatus.review_pending">
            其中 {{ labelStatus.review_pending }} 道原题结构待校正，错题分析会暂时忽略其预标注。
          </template>
        </small>
      </div>
      <p v-if="labelMessage" class="api-profile-notice" role="status">{{ labelMessage }}</p>
      <div v-if="labelManagerOpen" class="question-label-manager">
        <div class="question-label-filter">
          <div class="field">
            <label for="label-search">搜索标签</label>
            <input id="label-search" v-model="labelSearch" placeholder="篇目、题号或主要考点" @keyup.enter="loadQuestionLabels">
          </div>
          <button class="button secondary compact" type="button" @click="loadQuestionLabels"><Search :size="15" />搜索</button>
        </div>
        <div v-if="labelRows.length" class="question-label-list">
          <button
            v-for="row in labelRows"
            :key="row.question_id"
            type="button"
            class="question-label-row"
            :class="{ unlabeled: !row.primary_skill }"
            @click="editLabel(row)"
          >
            <span><strong>{{ row.year }} 年 · {{ row.unit_title }}</strong><small>第 {{ row.number }} 题</small></span>
            <span>{{ row.primary_skill || '尚未标注' }}</span>
            <span class="question-label-state"><Lock v-if="row.locked" :size="13" />{{ row.locked ? '已锁定' : '可更新' }}</span>
          </button>
        </div>
        <div v-else class="api-model-empty">当前范围没有符合条件的题目。</div>
      </div>
    </section>

    <div v-if="editingLabel" class="label-editor-overlay" role="presentation" @click.self="editingLabel=null">
      <section class="label-editor card" role="dialog" aria-modal="true" aria-labelledby="label-editor-title">
        <header>
          <div><span class="eyebrow">MANUAL REVIEW</span><h2 id="label-editor-title">{{ editingLabel.year }} 年第 {{ editingLabel.number }} 题</h2></div>
          <button class="button ghost compact" type="button" @click="editingLabel=null">取消</button>
        </header>
        <div class="field"><label>主要考点</label><input v-model.trim="editingLabel.primary_skill"></div>
        <div class="field"><label>次要考点（逗号分隔）</label><input :value="editingLabel.secondary_skills.join('，')" @input="editingLabel.secondary_skills=splitTags(($event.target as HTMLInputElement).value)"></div>
        <div class="field"><label>常见陷阱（逗号分隔）</label><textarea :value="editingLabel.trap_types.join('，')" rows="2" @input="editingLabel.trap_types=splitTags(($event.target as HTMLTextAreaElement).value)"></textarea></div>
        <div class="field"><label>注意事项（每条用逗号或换行分隔）</label><textarea :value="editingLabel.attention_points.join('\n')" rows="3" @input="editingLabel.attention_points=splitTags(($event.target as HTMLTextAreaElement).value)"></textarea></div>
        <div class="grid grid-3">
          <div class="field"><label>词汇依赖</label><select v-model="editingLabel.vocabulary_demand"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
          <div class="field"><label>上下文依赖</label><select v-model="editingLabel.context_dependency"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
          <div class="field"><label>语法依赖</label><select v-model="editingLabel.grammar_dependency"><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></div>
        </div>
        <label class="default-profile-check">
          <input v-model="editingLabel.locked" type="checkbox">
          保存后锁定，后续批量标注不会覆盖
        </label>
        <footer>
          <small>人工保存的内容会标记为“人工校正”，默认建议保持锁定。</small>
          <button class="button" type="button" :disabled="busy[busyKey('label',editingLabel.question_id)] || !editingLabel.primary_skill.trim()" @click="saveQuestionLabel">
            <Save :size="16" />保存标签
          </button>
        </footer>
      </section>
    </div>

    <section v-if="creating" class="api-profile-card new-profile">
      <div class="api-profile-heading">
        <span class="api-profile-icon"><CirclePlus :size="20" /></span>
        <div><span class="eyebrow">NEW CONNECTION</span><h2>添加新的 API</h2></div>
      </div>
      <div class="api-profile-body">
        <div class="grid grid-2">
          <div class="field"><label>配置名称</label><input v-model.trim="newProfile.name" placeholder="例如：本地 Ollama"></div>
          <div class="field"><label>默认模型（可稍后同步选择）</label><input v-model.trim="newProfile.default_model" placeholder="例如：qwen3:8b"></div>
        </div>
        <div class="field"><label>API Base URL</label><input v-model.trim="newProfile.base_url" placeholder="http://127.0.0.1:11434/v1"></div>
        <div class="field"><label>API Key</label><input v-model="newProfile.api_key" type="password" placeholder="本地接口通常可留空"></div>
        <div class="api-create-actions">
          <button class="button secondary" type="button" @click="creating=false">取消</button>
          <button class="button" type="button" :disabled="busy[busyKey('create',0)]" @click="createProfile">
            <LoaderCircle v-if="busy[busyKey('create',0)]" :size="16" class="spinning" />
            <Save v-else :size="16" />保存 API
          </button>
        </div>
      </div>
    </section>

    <div class="api-profile-list">
      <article v-for="profile in profiles" :key="profile.id" class="api-profile-card">
        <header class="api-profile-summary">
          <button class="api-profile-expand" type="button" :aria-expanded="expanded.includes(profile.id)" @click="toggleExpanded(profile.id)">
            <span class="api-profile-icon"><Server :size="20" /></span>
            <span class="api-profile-copy">
              <span><strong>{{ profile.name }}</strong><small v-if="profile.is_default">默认</small></span>
              <small>{{ profile.base_url }}</small>
            </span>
            <span class="api-profile-stats">
              <small>{{ profile.models.filter(model => model.is_visible && model.is_available).length }} 个模型可见</small>
              <span :class="{ online: profile.enabled }">{{ profile.enabled ? '已启用' : '已停用' }}</span>
            </span>
            <ChevronUp v-if="expanded.includes(profile.id)" :size="19" />
            <ChevronDown v-else :size="19" />
          </button>
          <button
            class="api-enable"
            type="button"
            role="switch"
            :aria-checked="profile.enabled"
            :aria-label="profile.enabled ? `停用 ${profile.name}` : `启用 ${profile.name}`"
            :class="{ active: profile.enabled }"
            @click="toggleProfile(profile)"
          ><span /></button>
        </header>

        <div v-if="expanded.includes(profile.id)" class="api-profile-body">
          <div class="grid grid-2">
            <div class="field"><label>配置名称</label><input v-model.trim="profile.name"></div>
            <div class="field">
              <label>默认模型</label>
              <select v-model="profile.default_model">
                <option value="">请选择默认模型</option>
                <option v-for="model in profile.models.filter(item => item.is_available)" :key="model.model_id" :value="model.model_id">
                  {{ model.display_name || model.model_id }}
                </option>
              </select>
            </div>
          </div>
          <div class="field"><label>API Base URL</label><input v-model.trim="profile.base_url"></div>
          <div class="field">
            <label>API Key（留空不会清除）</label>
            <div class="api-key-input">
              <KeyRound :size="17" />
              <input v-model="profile.api_key" type="password" :placeholder="profile.has_api_key ? '密钥已加密保存在本机' : '本地接口通常可留空'">
            </div>
          </div>
          <div class="grid grid-2">
            <div class="field"><label>Temperature</label><input v-model.number="profile.temperature" type="number" min="0" max="2" step=".1"></div>
            <div class="field"><label>最大输出 Token</label><input v-model.number="profile.max_tokens" type="number" min="100" step="100"></div>
          </div>
          <p class="field-hint">Temperature 控制回答的随机性与创造性：值越低越稳定、越适合判分和事实类任务（错题分析、题库导入、单词翻译建议 0.2–0.5）；越高越发散，适合头脑风暴。</p>
          <p class="field-hint">最大输出 Token 限制单次回复的最长输出：错题分析、批量标注等长文本任务若报“模型没有返回可显示的正文”或输出被截断，请调高该值（如 4000–8000）；日常对话保持默认即可。</p>
          <div class="field"><label>附加系统提示词</label><textarea v-model="profile.system_prompt" rows="3" placeholder="对该 API 下的模型统一生效"></textarea></div>
          <label class="default-profile-check">
            <input v-model="profile.is_default" type="checkbox" :disabled="profile.is_default">
            设为默认 API（错题分析、单词翻译和题库校正会优先使用它）
          </label>

          <div class="api-actions">
            <button class="button" type="button" :disabled="busy[busyKey('save',profile.id)]" @click="saveProfile(profile)">
              <LoaderCircle v-if="busy[busyKey('save',profile.id)]" :size="16" class="spinning" />
              <Save v-else :size="16" />保存配置
            </button>
            <button class="button secondary" type="button" :disabled="busy[busyKey('sync',profile.id)]" @click="syncModels(profile)">
              <RefreshCw :size="16" :class="{spinning:busy[busyKey('sync',profile.id)]}" />同步模型
            </button>
            <button class="button secondary" type="button" :disabled="busy[busyKey('test',profile.id)] || !profile.default_model" @click="testProfile(profile)">
              <PlugZap :size="16" />测试连接
            </button>
            <button class="button ghost api-delete" type="button" @click="removeProfile(profile)">
              <Trash2 :size="16" />删除
            </button>
          </div>
          <p v-if="notices[profile.id]" class="api-profile-notice" role="status">{{ notices[profile.id] }}</p>

          <section class="api-model-section">
            <div class="api-model-heading">
              <div><h3>模型选择器</h3><p>关闭“显示”后，该模型仍保留在配置中，但不会出现在助手的切换菜单里。</p></div>
              <div>
                <button type="button" @click="setAllVisible(profile,true)"><Eye :size="15" />全部显示</button>
                <button type="button" @click="setAllVisible(profile,false)"><EyeOff :size="15" />全部隐藏</button>
              </div>
            </div>
            <div v-if="profile.models.length" class="api-model-list">
              <div v-for="model in profile.models" :key="model.model_id" class="api-model-row" :class="{ unavailable: !model.is_available }">
                <div><strong>{{ model.display_name || model.model_id }}</strong><small>{{ model.owned_by || model.provider || '接口模型' }}<template v-if="!model.is_available"> · 本次同步未发现</template></small></div>
                <button
                  type="button"
                  role="switch"
                  :aria-checked="model.is_visible"
                  :disabled="!model.is_available"
                  :class="{ active:model.is_visible }"
                  @click="setModelVisible(profile,model)"
                >
                  <Eye v-if="model.is_visible" :size="15" /><EyeOff v-else :size="15" />
                  {{ model.is_visible ? '显示' : '隐藏' }}
                </button>
              </div>
            </div>
            <div v-else class="api-model-empty">还没有模型列表。保存配置后点击“同步模型”。</div>
          </section>
        </div>
      </article>
    </div>
  </div>
</template>

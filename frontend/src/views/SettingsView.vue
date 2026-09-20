<script setup lang="ts">
import NamedModelKeys from '../components/NamedModelKeys.vue'
import { saveModelVisibility, retryModelVisibility, visibilitySaveStates, intendedModelVisibility } from '../services/profileDrafts'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { preferDefaultProfile, profileDrafts, profileSaveStates, saveProfileDraft, flushProfileDraft, forgetProfileDraft, profileHasDraft, serializeProfileOperation } from '../services/profileDrafts'
import OptionSheet, { type OptionSheetItem } from '../components/OptionSheet.vue'
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  Eye,
  EyeOff,
  ExternalLink,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Save,
  Server,
  PlugZap,
  Trash2,
} from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { del, get, post } from '../api'
import { confirmDialog } from '../platform/dialogs'
import {
  SELECTABLE_ADAPTERS,
  adapterFor,
  normalizeAdapterId,
  type AdapterId,
} from '../platform/android/ai-adapters'

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
  adapter: AdapterId
  base_url: string
  api_key?: string
  has_api_key: boolean
  enabled: boolean
  is_default: boolean
  default_model: string
  temperature: number
  max_tokens: number
  reasoning_effort: '' | 'low' | 'medium' | 'high'
  system_prompt: string
  models: AiModel[]
}

const profiles = ref<AiProfile[]>([])
const landscape = useAndroidLandscape()
const adapters = SELECTABLE_ADAPTERS
const expandedProfileId = ref<number | null>(null)
const busy = reactive<Record<string, boolean>>({})
const notices = reactive<Record<number, string>>({})
const message = ref('')
const error = ref('')
const creating = ref(false)
const moreMenuFor = ref<number | null>(null)
const modelListExpanded = reactive<Record<number, boolean>>({})

function blankProfile(): AiProfile {
  return {
    id: 0,
    name: '新 API 配置',
    adapter: 'openai-chat',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key: '',
    has_api_key: false,
    enabled: true,
    is_default: false,
    default_model: '',
    temperature: 0.2,
    max_tokens: 0,
    reasoning_effort: '',
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
    adapter: profile.adapter,
    base_url: profile.base_url,
    api_key: profile.api_key || null,
    enabled: profile.enabled,
    is_default: profile.is_default,
    default_model: profile.default_model,
    temperature: profile.temperature,
    max_tokens: profile.max_tokens,
    reasoning_effort: profile.reasoning_effort,
    system_prompt: profile.system_prompt,
  }
}

function adapterDefinition(profile: AiProfile) {
  return adapterFor(profile.adapter)
}

function endpointPreview(profile: AiProfile) {
  const adapter = adapterDefinition(profile)
  const baseUrl = profile.base_url.trim() || adapter.baseUrlPlaceholder
  return adapter.chatUrl(baseUrl, profile.default_model.trim() || '{model}')
}

/** 列表中的地址摘要：只显示主机和端口，避免长 URL 撑爆列表行。 */
function addressSummary(baseUrl: string) {
  const text = baseUrl.trim()
  if (!text) return '未填写地址'
  try {
    const url = new URL(text)
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`
  } catch {
    return text.length > 36 ? `${text.slice(0, 36)}…` : text
  }
}

function adapterItems(): OptionSheetItem[] {
  return adapters.map(adapter => ({ value: adapter.id, label: adapter.label, hint: adapter.description }))
}

function reasoningItems(profile: AiProfile): OptionSheetItem[] {
  return [
    { value: '', label: '未设置（由接口决定）' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
    // 协议不支持时保留已选值，但不允许继续更改。
    ...(adapterDefinition(profile).supportsReasoningEffort ? [] : [{ value: '__disabled__', label: '该协议不发送推理强度', disabled: true, unavailableNote: '已选值会保留' }]),
  ]
}

function modelItems(profile: AiProfile): OptionSheetItem[] {
  return profile.models.map(model => ({
    value: model.model_id,
    label: model.display_name || model.model_id,
    hint: model.owned_by || model.provider || '接口模型',
    disabled: !model.is_available,
    unavailableNote: model.is_available ? undefined : '本次同步未发现，暂不可选',
  }))
}

function visibleModelCount(profile: AiProfile) {
  return profile.models.filter(model => model.is_visible).length
}

function filteredModels(profile: AiProfile) {
  return profile.models
}

function busyKey(action: string, id: number) {
  return `${action}:${id}`
}

function toggleExpanded(id: number) {
  expandedProfileId.value = expandedProfileId.value === id ? null : id
}

function toggleMoreMenu(id: number) {
  moreMenuFor.value = moreMenuFor.value === id ? null : id
}

async function load() {
  try {
    const result = await get<AiProfile[]>('/ai/profiles')
    profiles.value = result.map(profile => {
      if (!profileDrafts[profile.id]) profileDrafts[profile.id] = { ...profile, adapter: normalizeAdapterId(profile.adapter), api_key: '' }
      else if (!profileHasDraft(profile.id)) Object.assign(profileDrafts[profile.id], profile, { adapter: normalizeAdapterId(profile.adapter), api_key: '' })
      else profileDrafts[profile.id].models = profile.models
      return profileDrafts[profile.id]
    })
    error.value = ''
  } catch (cause) {
    error.value = String(cause)
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
    signalChanged()
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy[key] = false
  }
}

async function saveProfile(profile: AiProfile) {
  if (!saveProfileDraft(profile.id, payload(profile), true)) return false
  return flushProfileDraft(profile.id)
}
function editProfile(profile: AiProfile, immediate = false) { saveProfileDraft(profile.id, payload(profile), immediate) }
function chooseDefault(profile: AiProfile) {
  preferDefaultProfile(profile.id)
  for (const other of profiles.value) {
    if (other.id !== profile.id && other.is_default) { other.is_default = false; editProfile(other, true) }
  }
  editProfile(profile, true)
}

async function toggleProfile(profile: AiProfile) {
  profile.enabled = !profile.enabled
  await saveProfile(profile)
}

async function syncModels(profile: AiProfile) {
  if (!await saveProfile(profile)) return
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
  if (!await saveProfile(profile)) return
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
  await saveModelVisibility(profile.id, !intendedModelVisibility(profile.id, model), model.model_id)
}

async function setAllVisible(profile: AiProfile, visible: boolean) {
  await saveModelVisibility(profile.id, visible)
}

function toggleModelList(profile: AiProfile) {
  modelListExpanded[profile.id] = !modelListExpanded[profile.id]
}

async function removeProfile(profile: AiProfile) {
  moreMenuFor.value = null
  const confirmed = await confirmDialog({
    title: `删除 API 配置“${profile.name}”？`,
    message: [
      `该配置的地址：${addressSummary(profile.base_url)}。`,
      '删除后该配置不再参与判分、翻译和标注。',
      '已保存的对话不会被删除；API Key 随配置一并移除。',
    ],
    confirmLabel: '删除配置',
    cancelLabel: '取消',
    danger: true,
  })
  if (!confirmed) return
  try {
    await flushProfileDraft(profile.id)
    await serializeProfileOperation(() => del(`/ai/profiles/${profile.id}`))
    forgetProfileDraft(profile.id)
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
})
</script>

<template>
  <div class="page ai-settings-page">
    <div class="page-head">
      <div>
        <h1>模型与 API</h1>
      </div>
      <button class="button" type="button" @click="creating=!creating">
        <CirclePlus :size="17" />添加 API 配置
      </button>
    </div>

    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="message" class="settings-success"><Check :size="17" />{{ message }}</div>

    <section v-if="creating" class="api-profile-card new-profile">
      <div class="api-profile-heading">
        <span class="api-profile-icon"><CirclePlus :size="20" /></span>
        <div><h2>添加新的 API</h2></div>
      </div>
      <div class="api-profile-body">
        <div class="grid grid-2">
          <div class="field"><label for="new-profile-name">配置名称</label><input id="new-profile-name" v-model.trim="newProfile.name" placeholder="例如：本地 Ollama"></div>
          <div class="field">
            <label id="new-profile-adapter-label">接口协议</label>
            <OptionSheet v-model="newProfile.adapter" :items="adapterItems()" title="选择接口协议" searchable placeholder="选择接口协议" aria-labelledby="new-profile-adapter-label" />
          </div>
        </div>
        <div class="grid grid-2">
          <div class="field"><label for="new-profile-model">默认模型（可稍后同步选择）</label><input id="new-profile-model" v-model.trim="newProfile.default_model" placeholder="例如：qwen3:8b"></div>
          <div class="field"><label for="new-profile-url">API Base URL</label><input id="new-profile-url" v-model.trim="newProfile.base_url" :placeholder="adapterDefinition(newProfile).baseUrlPlaceholder"><small>请求端点：{{ endpointPreview(newProfile) }}</small></div>
        </div>
        <div class="grid grid-2">
          <div class="field"><label for="new-profile-key">API Key</label><input id="new-profile-key" v-model="newProfile.api_key" type="password" placeholder="本地接口通常可留空"></div>
          <div class="field">
            <label>默认推理强度</label>
            <OptionSheet v-model="newProfile.reasoning_effort" :disabled="!adapterDefinition(newProfile).supportsReasoningEffort" :items="reasoningItems(newProfile)" title="选择推理强度" />
          </div>
        </div>
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
          <button class="api-profile-expand" type="button" :aria-expanded="expandedProfileId === profile.id" @click="toggleExpanded(profile.id)">
            <span class="api-profile-icon"><Server :size="20" /></span>
            <span class="api-profile-copy">
              <span><strong>{{ profile.name }}</strong><small v-if="profile.is_default">默认</small></span>
              <small>{{ addressSummary(profile.base_url) }}</small>
            </span>
            <span class="api-profile-stats">
              <small>{{ visibleModelCount(profile) }} 个模型显示</small>
              <span :class="{ online: profile.enabled }">{{ profile.enabled ? '已启用' : '已停用' }}</span>
            </span>
            <ChevronDown v-if="expandedProfileId !== profile.id" :size="19" />
            <ChevronUp v-else :size="19" />
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
          <div class="api-more">
            <button class="icon-button" type="button" :aria-label="`${profile.name} 更多操作`" :aria-expanded="moreMenuFor === profile.id" @click="toggleMoreMenu(profile.id)">
              <MoreHorizontal :size="18" />
            </button>
            <div v-if="moreMenuFor === profile.id" class="api-more-menu" role="menu">
              <button class="api-more-item danger-text" type="button" role="menuitem" @click="removeProfile(profile)">
                <Trash2 :size="15" />删除配置
              </button>
            </div>
          </div>
        </header>

        <div v-if="expandedProfileId === profile.id" class="api-profile-body">
          <button v-if="profileSaveStates[profile.id]" class="api-save-status" role="status" type="button" @click="saveProfile(profile)">{{ profileSaveStates[profile.id] }}</button>
          <button v-if="visibilitySaveStates[profile.id]" class="api-save-status visibility-save-status" role="status" type="button" :disabled="visibilitySaveStates[profile.id]?.busy" @click="retryModelVisibility(profile.id)">{{ visibilitySaveStates[profile.id]?.message }}</button>
          <p v-if="notices[profile.id]" class="api-profile-notice" role="status">{{ notices[profile.id] }}</p>

          <section class="api-detail-section" aria-labelledby="api-conn-title">
            <h3 v-if="!landscape" id="api-conn-title">连接与密钥</h3><div class="api-connection-layout"><div class="api-connection-fields">
            <div class="grid grid-2">
              <div class="field"><label for="profile-name">配置名称</label><input id="profile-name" v-model="profile.name" @input="editProfile(profile)" @blur="editProfile(profile,true)"></div>
              <div class="field">
                <label>接口协议</label>
                <OptionSheet v-model="profile.adapter" @update:model-value="editProfile(profile,true)" :items="adapterItems()" title="选择接口协议" searchable />
              </div>
            </div>
            <div class="grid grid-2 api-connection-grid">
              <div class="field"><label for="profile-url">API Base URL</label><input id="profile-url" v-model="profile.base_url" @input="editProfile(profile)" @blur="editProfile(profile,true)" :placeholder="adapterDefinition(profile).baseUrlPlaceholder"><small v-if="!landscape">请求端点：{{ endpointPreview(profile) }}</small></div>
              </div></div><NamedModelKeys :profile="profile" @changed="signalChanged" />
              <button class="default-config-switch-row" type="button" role="switch" :aria-checked="profile.is_default" :class="{ active: profile.is_default }" @click="!profile.is_default && chooseDefault(profile)">
                <span>设置为默认配置</span><i aria-hidden="true"><b /></i>
              </button>
            </div>
          </section>

          <div class="api-model-setup-grid">
            <section class="api-detail-section api-model-default-section" aria-labelledby="api-model-title">
              <h3 v-if="!landscape" id="api-model-title">默认模型</h3>
              <div class="field">
                <label>默认模型</label>
                <OptionSheet
                  v-model="profile.default_model" @update:model-value="editProfile(profile,true)"
                  :items="modelItems(profile)"
                  title="选择默认模型"
                  searchable
                  :placeholder="profile.models.length ? '请选择默认模型' : '还没有模型，请先同步模型'"
                />
                <small v-if="!profile.models.length">点击下方“同步模型”获取模型列表。</small>
              </div>
            </section>

            <section class="api-detail-section api-advanced-section">
              <h3 v-if="!landscape">推理设置</h3>
              <div class="grid grid-2">
                <div class="field">
                  <label>默认推理强度</label>
                  <OptionSheet v-model="profile.reasoning_effort" @update:model-value="editProfile(profile,true)" :disabled="!adapterDefinition(profile).supportsReasoningEffort" :items="reasoningItems(profile)" title="选择推理强度" />
                  <small v-if="!adapterDefinition(profile).supportsReasoningEffort">该协议不发送推理强度，已选值会保留。</small>
                </div>
              </div>
            </section>
          </div>

<section class="api-detail-section api-model-management">
  <div class="api-model-toolbar">
    <div class="api-model-list-control">
      <button class="api-model-list-toggle" type="button" :aria-expanded="!!modelListExpanded[profile.id]" @click="toggleModelList(profile)">
        <span>模型显示列表 · {{ profile.models.length }} 个</span><ChevronDown v-if="!modelListExpanded[profile.id]" :size="18" /><ChevronUp v-else :size="18" />
      </button>
      <div v-if="modelListExpanded[profile.id]" class="api-model-list" role="listbox" aria-label="模型显示列表">
        <div v-for="model in filteredModels(profile)" :key="model.model_id" class="api-model-row" :class="{ unavailable: !model.is_available }">
          <div><strong>{{ model.display_name || model.model_id }}</strong><small>{{ model.owned_by || model.provider || '接口模型' }}<template v-if="!model.is_available"> · 本次同步未发现</template></small></div>
          <button type="button" role="switch" :aria-checked="model.is_visible" :disabled="!model.is_available" :class="{ active:model.is_visible }" @click="setModelVisible(profile,model)">
            <Eye v-if="model.is_visible" :size="15" /><EyeOff v-else :size="15" />{{ model.is_visible ? '显示' : '隐藏' }}
          </button>
        </div>
        <div v-if="!filteredModels(profile).length" class="api-model-empty">没有模型。</div>
      </div>
    </div>
    <div class="api-model-toolbar-actions">
      <button class="button secondary compact" type="button" :disabled="busy[busyKey('sync',profile.id)]" @click="syncModels(profile)"><RefreshCw :size="15" :class="{spinning:busy[busyKey('sync',profile.id)]}" />同步模型</button>
      <button type="button" @click="setAllVisible(profile,true)"><Eye :size="15" />全部显示</button>
      <button type="button" @click="setAllVisible(profile,false)"><EyeOff :size="15" />全部隐藏</button>
      <button v-if="landscape" class="api-test-connection" type="button" :disabled="busy[busyKey('test',profile.id)] || !profile.default_model" @click="testProfile(profile)"><PlugZap :size="15" />测试连接</button>
    </div>
  </div>
</section>

          <div v-if="!landscape" class="api-actions">
            <button class="button" type="button" :disabled="busy[busyKey('save',profile.id)]" @click="saveProfile(profile)">
              <LoaderCircle v-if="busy[busyKey('save',profile.id)]" :size="16" class="spinning" />
              <Save v-else :size="16" />保存配置
            </button>
            <button class="button secondary" type="button" :disabled="busy[busyKey('test',profile.id)] || !profile.default_model" @click="testProfile(profile)">
              <PlugZap :size="16" />测试连接
            </button>
          </div>
        </div>
      </article>
    </div>

    <section class="settings-about card" aria-labelledby="settings-about-title">
      <div class="settings-about-heading">
        <span class="api-profile-icon"><BookOpen :size="20" /></span>
        <div><h2 id="settings-about-title">帮助与关于</h2></div>
      </div>
      <div class="settings-about-actions">
        <RouterLink class="button secondary" to="/help"><BookOpen :size="16" />使用帮助</RouterLink>
        <a class="button ghost" href="https://xiaoheihe.cn/creator/content_management/detail/187311918" target="_blank" rel="noopener noreferrer"><ExternalLink :size="16" />问题反馈</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.api-save-status { border:0; background:transparent; color:var(--muted); min-height:32px; padding:0; text-align:left; }
.api-connection-layout { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
.api-connection-layout,.api-connection-fields { display:contents; }
html[data-platform="android"][data-orientation="landscape"] .api-connection-layout { display:grid; gap:20px; }
html[data-platform="android"][data-orientation="landscape"] .api-connection-fields > .grid { display:contents; }
html[data-platform="android"][data-orientation="landscape"] .api-connection-fields { display:grid; gap:12px; align-content:start; padding-right:20px; border-right:1px solid var(--line); }
html[data-platform="android"][data-orientation="landscape"] .api-connection-fields .field { display:grid; grid-template-columns:100px minmax(0,1fr); gap:12px; align-items:center; margin:0; }
html[data-platform="android"][data-orientation="landscape"] .api-model-setup-grid { grid-template-columns:minmax(0,1.2fr) minmax(0,.85fr) auto; align-items:start; gap:12px; margin-top:12px; padding-top:12px; }
html[data-platform="android"][data-orientation="landscape"] .api-model-setup-grid .field { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; align-items:center; margin:0; }
html[data-platform="android"][data-orientation="landscape"] .api-advanced-section .grid { display:block; }
html[data-platform="android"][data-orientation="landscape"] .api-model-setup-grid small { grid-column:1 / -1; }
html[data-platform="android"][data-orientation="landscape"] .api-model-management { margin-top:12px; padding-top:0; border:0; }
.api-model-setup-grid { display:grid; grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr); gap:14px; margin-top:19px; padding-top:17px; border-top:1px solid var(--line); }
.api-model-setup-grid > .api-detail-section { min-width:0; margin-top:0; padding-top:0; border-top:0; align-content:start; }
.api-advanced-section .api-profile-hints { margin-bottom:0; }
.default-config-switch-row { width:100%; min-height:44px; padding:7px 0; display:flex; align-items:center; justify-content:space-between; gap:14px; border:0; color:var(--ink); background:transparent; font:inherit; text-align:left; }
.default-config-switch-row > i { flex:0 0 auto; width:44px; height:26px; padding:3px; border-radius:999px; background:var(--line-strong); transition:background-color .2s ease; }
.default-config-switch-row > i > b { display:block; width:20px; height:20px; border-radius:50%; background:white; box-shadow:0 2px 7px rgba(30,45,37,.2); transition:transform .2s ease; }
.default-config-switch-row.active > i { background:var(--primary); }
.default-config-switch-row.active > i > b { transform:translateX(18px); }
.api-model-toolbar { position:relative; flex-wrap:nowrap; align-items:flex-start; }
.api-model-list-control { position:relative; z-index:30; flex:1 1 auto; min-width:0; }
.api-model-list-toggle { width:100%; min-height:42px; padding:8px 12px; display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--line); border-radius:10px; color:var(--ink); background:var(--surface-solid); font:inherit; text-align:left; }
.api-model-list-toggle span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.api-model-list { position:absolute; z-index:40; top:calc(100% + 6px); left:0; width:100%; max-width:none; box-shadow:var(--shadow-md); }
.api-model-toolbar-actions { position:relative; z-index:1; flex:0 0 auto; flex-wrap:nowrap; }
.api-test-connection { position:relative; z-index:1; }
@media (max-width:720px) {
  .api-connection-layout { grid-template-columns:minmax(0,1fr); }
  .api-model-setup-grid { grid-template-columns:minmax(0,1fr); gap:0; }
  .api-model-setup-grid > .api-detail-section + .api-detail-section { margin-top:14px; padding-top:14px; border-top:1px solid var(--line); }
  .api-model-toolbar { flex-wrap:wrap; }
  .api-model-list-control { flex-basis:100%; }
}
</style>

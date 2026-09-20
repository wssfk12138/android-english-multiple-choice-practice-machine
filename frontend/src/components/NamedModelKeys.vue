<script setup lang="ts">
import { computed, nextTick, ref, toRefs, watch } from 'vue'
import { keyDraft } from '../services/keyDrafts'
import { profileDrafts, serializeProfileOperation } from '../services/profileDrafts'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { confirmDialog } from '../platform/dialogs'
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-vue-next'
import { post } from '../api'
const props = defineProps<{ profile: { id: number; keys?: { id: string; name: string }[]; selected_key_id?: string; has_api_key: boolean } }>()
const emit = defineEmits<{ changed: [] }>()
const session = keyDraft(props.profile.id)
const { name, value, busy, error, drafts, adding, retry } = toRefs(session.state)
const managing = ref(false)
const landscape = useAndroidLandscape()
const expandedKeys = ref(false)
const renaming = ref('')
async function beginRename(id: string) {
  renaming.value = id
  await nextTick()
  document.getElementById('key-alias-' + props.profile.id + '-' + id)?.focus()
}
const keys = computed(() => props.profile.keys || [])
const selectedKey = computed(() => keys.value.find(key => key.id === props.profile.selected_key_id) || null)
const canCollapse = computed(() => keys.value.length > 1)
watch(() => keys.value.length, (count, previous) => {
  if (count > 1 && count !== previous) expandedKeys.value = false
  if (count <= 1) expandedKeys.value = false
})
async function edit(action: string, identity = '') {
  if (action === 'delete' && !await confirmDialog({ title: '删除此密钥？', message: '删除后无法恢复，需要重新添加。', confirmLabel: '删除密钥', danger: true })) return
  const alias = action === 'rename' ? drafts.value[identity] ?? props.profile.keys?.find(k => k.id === identity)?.name : name.value
  if (action === 'rename' && !alias?.trim()) { error.value = '请输入密钥名称，草稿尚未保存'; return }
  if (action === 'rename' && alias === props.profile.keys?.find(k => k.id === identity)?.name) { renaming.value = ''; return }
  const secret = action === 'add' ? value.value : ''
  session.sequence = session.sequence.then(async () => {
  if (action === 'rename' && alias === props.profile.keys?.find(k => k.id === identity)?.name) return
  busy.value = true
  error.value = ''
  try {
    const result = await serializeProfileOperation(() => post<{ keys: { id: string; name: string }[]; selected_key_id: string; has_api_key: boolean }>(`/ai/profiles/${props.profile.id}/keys`,
      { action, identity, name: alias, value: secret }))
    Object.assign(props.profile, result)
    if (profileDrafts[props.profile.id]) Object.assign(profileDrafts[props.profile.id], result)
    if (action === 'add') { name.value = ''; value.value = ''; adding.value = false; expandedKeys.value = false }
    if (action === 'rename' && drafts.value[identity] === alias) renaming.value = ''
    emit('changed')
    retry.value = null
  } catch { error.value = '密钥操作失败，请检查名称、选择和安全存储'; retry.value = () => edit(action, identity) }
  finally { busy.value = false }
  })
  await session.sequence
}
</script>

<template>
  <fieldset class="named-keys" :disabled="busy">
    <legend v-if="!landscape">API 密钥</legend>
    <div v-if="landscape" class="key-heading"><strong>API Key</strong><label>不使用密钥<button class="no-key-switch" type="button" role="switch" :aria-checked="!profile.selected_key_id" aria-label="不使用密钥" :disabled="!profile.keys?.length" @click="edit('select', profile.selected_key_id ? '' : profile.keys?.[0]?.id)"><span :class="{ active: !profile.selected_key_id }"><i /></span></button></label><button class="key-add" @click="adding=!adding"><Plus :size="16" />添加</button></div>
    <div class="key-select-control">
      <div class="key-summary">
        <button v-if="canCollapse" type="button" class="key-select" :aria-expanded="expandedKeys" @click="expandedKeys=!expandedKeys">
          <span>{{ selectedKey?.name || (profile.has_api_key ? '已保存密钥' : '不使用密钥') }}</span>
          <ChevronDown v-if="!expandedKeys" :size="18" /><ChevronUp v-else :size="18" />
        </button>
        <span v-else>{{ selectedKey?.name || (profile.has_api_key ? '已保存密钥' : '不使用密钥') }}</span>
        <button v-if="!landscape" type="button" :aria-expanded="managing" @click="managing=!managing">{{ managing ? '收起管理' : '管理密钥' }}</button>
      </div>
      <div v-if="landscape && canCollapse && expandedKeys" class="key-menu" role="listbox" aria-label="API Key 列表">
        <div v-for="key in keys" :key="key.id" class="key-row" role="option" :aria-selected="profile.selected_key_id === key.id">
          <input type="radio" :name="`key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @change="edit('select', key.id)">
          <div class="key-alias"><input v-if="renaming === key.id || drafts[key.id] !== undefined && drafts[key.id] !== key.name" :id="'key-alias-' + profile.id + '-' + key.id" :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @input="drafts[key.id] = ($event.target as HTMLInputElement).value" @blur="edit('rename', key.id)" @keydown.enter="edit('rename', key.id)"><strong v-else>{{ key.name }}</strong></div>
          <button type="button" @click="beginRename(key.id)">改名</button>
          <button type="button" title="删除密钥" aria-label="删除密钥" @click="edit('delete', key.id)">删除</button>
        </div>
      </div>
    </div>
    <template v-if="landscape || managing">
    <label v-if="!landscape" class="no-key"><input type="radio" :name="`key-${profile.id}`" :checked="!profile.selected_key_id" @change="edit('select')">不使用密钥</label>
    <div v-if="(!landscape && managing) || (landscape && !canCollapse && keys.length)" class="key-list" role="listbox" aria-label="API Key 列表">
    <div v-for="key in keys" :key="key.id" class="key-row" role="option" :aria-selected="profile.selected_key_id === key.id">
      <input type="radio" :name="`key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @change="edit('select', key.id)">
      <div class="key-alias"><input v-if="!landscape || renaming === key.id || drafts[key.id] !== undefined && drafts[key.id] !== key.name" :id="'key-alias-' + profile.id + '-' + key.id" :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @input="drafts[key.id] = ($event.target as HTMLInputElement).value" @blur="edit('rename', key.id)" @keydown.enter="edit('rename', key.id)"><strong v-else>{{ key.name }}</strong></div>
      <button v-if="landscape" type="button" @click="beginRename(key.id)">改名</button>
      <button v-if="!landscape" type="button" title="保存名称" aria-label="保存名称" @click="edit('rename', key.id)"><Save :size="17" /></button>
      <button type="button" title="删除密钥" aria-label="删除密钥" @click="edit('delete', key.id)"><span v-if="landscape">删除</span><Trash2 v-else :size="17" /></button>
    </div>
    </div>
    <div v-if="!landscape || adding" class="new-key">
      <input v-model="name" aria-label="新密钥名称" placeholder="密钥名称" maxlength="100" autocomplete="off">
      <input v-model="value" aria-label="新 API 密钥" placeholder="API Key" type="password" maxlength="8192" autocomplete="new-password">
      <button type="button" :disabled="!name.trim() || !value.trim()" title="添加密钥" aria-label="添加密钥" @click="edit('add')"><Plus :size="18" /></button>
    </div>
    </template>
    <p v-if="busy" role="status">正在保存密钥…</p>
    <p v-if="error" role="alert">{{ error }}<button v-if="retry" type="button" @click="retry()">重试</button></p>
  </fieldset>
</template>

<style scoped>
.named-keys { position:relative; border:0; padding:0; margin:12px 0; min-width:0; }
.named-keys legend { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.key-select-control { position:relative; min-width:0; }
.key-summary { display:flex; align-items:center; gap:12px; min-width:0; }
.key-summary span { overflow-wrap:anywhere; min-width:0; }
.named-keys .key-summary button { width:auto; min-width:88px; padding-inline:10px; flex-shrink:0; }
.key-select { width:100% !important; min-height:56px; display:flex !important; align-items:center; justify-content:space-between; gap:14px; text-align:left; }
.key-select span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.key-menu { position:absolute; z-index:50; top:calc(100% + 6px); left:0; width:100%; padding:8px; border:1px solid var(--line); border-radius:12px; background:var(--surface-solid); box-shadow:var(--shadow-md); }
.key-list { width:100%; }
.key-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 44px 44px; align-items: center; gap: 8px; margin: 8px 0; }
.new-key { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 44px; gap: 8px; margin-top: 8px; }
.named-keys input { min-width: 0; width: 100%; }
.named-keys input[type=radio] { width: 16px; height: 16px; margin: 0; }
.named-keys button { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-solid); color: var(--ink); }
.no-key { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.key-heading,.key-heading label { display:flex; align-items:center; gap:8px; }
.key-heading label { font-size:12px; }
.key-heading .key-add { margin-left:auto; width:auto; display:flex; gap:4px; border:0; }
.named-keys .no-key-switch { width:44px; height:44px; border:0; background:transparent; }
.no-key-switch > span { display:block; width:37.8px; height:22.4px; padding:2px; border-radius:20px; background:var(--muted); }
.no-key-switch i { display:block; width:18.4px; height:18.4px; border-radius:50%; background:var(--surface-solid); transition:transform .15s; }
.no-key-switch > span.active { background:var(--primary); }
.no-key-switch > span.active i { transform:translateX(15.4px); }
.key-alias { min-width:0; }
.key-alias small { display:none; }
html[data-platform="android"][data-orientation="landscape"] .named-keys { margin:0; }
html[data-platform="android"][data-orientation="landscape"] .key-row { grid-template-columns:20px minmax(0,1fr) 44px 44px; border-bottom:1px solid var(--line); padding-bottom:8px; }
html[data-platform="android"][data-orientation="landscape"] .key-alias input { border-color:transparent; padding:4px; background:transparent; }
@media (max-width: 480px) { .new-key { grid-template-columns: minmax(0, 1fr) 44px; } .new-key input:first-child { grid-column: 1 / -1; } }
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue'
import { keyDraft } from '../services/keyDrafts'
import { profileDrafts, serializeProfileOperation } from '../services/profileDrafts'
import { useAndroidLandscape } from '../composables/useAndroidLandscape'
import { confirmDialog } from '../platform/dialogs'
import { pushOverlayHistory } from '../platform/overlay-history'
import { Pencil, Plus, Save, Trash2, X } from 'lucide-vue-next'
import { post } from '../api'
const props = defineProps<{ profile: { id: number; keys?: { id: string; name: string; mask?: string }[]; selected_key_id?: string; has_api_key: boolean } }>()
const emit = defineEmits<{ changed: [] }>()
const session = keyDraft(props.profile.id)
const { name, value, busy, error, drafts, adding, retry } = toRefs(session.state)
const managing = ref(false)
const landscape = useAndroidLandscape()
const renaming = ref('')
const sheetOpen = ref(false)
const sheetRenaming = ref('')
const pageLimit = ref(2)
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
// 页内最多显示两条密钥，塞不下时退到一条。数值按现场可用高度算，不写死在样式里。
const KEY_ROW_MIN_HEIGHT = 56
const KEY_ROW_GAP = 8
const KEY_MORE_RESERVE = 54
const KEY_BOTTOM_MARGIN = 16
let overlayHandle: { close: () => void; dispose: () => void } | null = null
async function beginRename(id: string) {
  renaming.value = id
  await nextTick()
  document.getElementById('key-alias-' + props.profile.id + '-' + id)?.focus()
}
const keys = computed(() => props.profile.keys || [])
const selectedKey = computed(() => keys.value.find(key => key.id === props.profile.selected_key_id) || null)
// 掩码由安全存储侧算好随配置一起返回，这里只截后四位供识别，界面上不会出现明文密钥。
function keyMask(key: { mask?: string }) {
  const raw = String(key.mask || '')
  if (!raw.includes('****')) return ''
  const tail = raw.split('****').pop() || ''
  return tail ? `···· ${tail}` : ''
}
const pageRows = computed(() => Math.min(Math.max(pageLimit.value, 1), keys.value.length))
// 超过三条才收起；被收起的行仍留在 DOM 里（只是不显示），选中项始终留在页内。
const hiddenIds = computed(() => {
  const hidden = new Set<string>()
  if (!landscape.value || keys.value.length <= 3) return hidden
  const shown = new Set(keys.value.slice(0, pageRows.value).map(key => key.id))
  const selected = props.profile.selected_key_id
  if (selected && !shown.has(selected)) {
    const dropped = keys.value[pageRows.value - 1]
    if (dropped) shown.delete(dropped.id)
    shown.add(selected)
  }
  for (const key of keys.value) if (!shown.has(key.id)) hidden.add(key.id)
  return hidden
})
// 页内被收起的条数：>0 就渲染「查看全部」入口，保证没有密钥变得不可达。
const hiddenCount = computed(() => keys.value.filter(key => hiddenIds.value.has(key.id)).length)
function openKeySheet() { sheetOpen.value = true }
function closeKeySheet() { sheetOpen.value = false }
function selectKey(id: string) {
  if (props.profile.selected_key_id === id) return
  void edit('select', id)
}
function measurePageLimit() {
  const count = keys.value.length
  if (!landscape.value || count <= 3) { pageLimit.value = Math.max(count, 1); return }
  const anchor = listRef.value?.querySelector<HTMLElement>('.key-row') || null
  if (!anchor) { pageLimit.value = 1; return }
  const rect = anchor.getBoundingClientRect()
  const rowHeight = rect.height || KEY_ROW_MIN_HEIGHT
  const newKey = rootRef.value?.querySelector<HTMLElement>('.new-key') || null
  const reserve = KEY_MORE_RESERVE + (newKey ? newKey.getBoundingClientRect().height + 10 : 0)
  const budget = window.innerHeight - KEY_BOTTOM_MARGIN - rect.top - reserve
  pageLimit.value = budget >= rowHeight * 2 + KEY_ROW_GAP ? 2 : 1
}
function scheduleMeasure() { void nextTick(() => measurePageLimit()) }
watch([() => keys.value.length, landscape, adding], scheduleMeasure)
onMounted(() => { scheduleMeasure(); window.addEventListener('resize', scheduleMeasure) })
onBeforeUnmount(() => { window.removeEventListener('resize', scheduleMeasure); overlayHandle?.dispose(); overlayHandle = null })
function onSheetKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  sheetOpen.value = false
}
watch(sheetOpen, (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    overlayHandle = pushOverlayHistory(() => { sheetOpen.value = false })
    window.addEventListener('keydown', onSheetKeydown)
  } else if (!isOpen && wasOpen) {
    overlayHandle?.dispose()
    overlayHandle = null
    sheetRenaming.value = ''
    window.removeEventListener('keydown', onSheetKeydown)
  }
})
async function beginSheetRename(id: string) {
  sheetRenaming.value = id
  await nextTick()
  document.getElementById('key-sheet-alias-' + props.profile.id + '-' + id)?.focus()
}
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
    if (action === 'add') { name.value = ''; value.value = ''; adding.value = false }
    if (action === 'rename' && drafts.value[identity] === alias) renaming.value = ''
    if (action === 'rename') sheetRenaming.value = ''
    emit('changed')
    retry.value = null
  } catch { error.value = '密钥操作失败，请检查名称、选择和安全存储'; retry.value = () => edit(action, identity) }
  finally { busy.value = false }
  })
  await session.sequence
}
</script>

<template>
  <fieldset ref="rootRef" class="named-keys" :disabled="busy">
    <legend v-if="!landscape">API 密钥</legend>
    <template v-if="landscape">
    <div class="key-heading"><strong>API Key</strong><label>不使用密钥<button class="no-key-switch" type="button" role="switch" :aria-checked="!profile.selected_key_id" aria-label="不使用密钥" :disabled="!profile.keys?.length" @click="edit('select', profile.selected_key_id ? '' : profile.keys?.[0]?.id)"><span :class="{ active: !profile.selected_key_id }"><i /></span></button></label><button class="key-add" type="button" :aria-expanded="adding" @click="adding=!adding"><Plus :size="16" />添加</button></div>
    <div ref="listRef" class="key-list" role="listbox" aria-label="API Key 列表">
      <div v-for="key in keys" :key="key.id" v-show="!hiddenIds.has(key.id)" class="key-row" role="option" :aria-selected="profile.selected_key_id === key.id">
        <input type="radio" :name="`key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @change="edit('select', key.id)">
        <div class="key-alias"><input v-if="renaming === key.id || drafts[key.id] !== undefined && drafts[key.id] !== key.name" :id="'key-alias-' + profile.id + '-' + key.id" :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @input="drafts[key.id] = ($event.target as HTMLInputElement).value" @blur="edit('rename', key.id)" @keydown.enter="edit('rename', key.id)"><strong v-else>{{ key.name }}</strong><small v-if="keyMask(key)">{{ keyMask(key) }}</small></div>
        <button type="button" title="改名" aria-label="改名" @click="beginRename(key.id)"><Pencil :size="17" /></button>
        <button type="button" title="删除密钥" aria-label="删除密钥" @click="edit('delete', key.id)"><Trash2 :size="17" /></button>
      </div>
      <button v-if="hiddenCount" class="key-more" type="button" @click="openKeySheet">查看全部 {{ keys.length }} 个密钥</button>
    </div>
    <div v-if="adding" class="new-key">
      <input v-model="name" aria-label="新密钥名称" placeholder="密钥名称" maxlength="100" autocomplete="off">
      <input v-model="value" aria-label="新 API 密钥" placeholder="API Key" type="password" maxlength="8192" autocomplete="new-password">
      <button type="button" :disabled="!name.trim() || !value.trim()" title="添加密钥" aria-label="添加密钥" @click="edit('add')"><Plus :size="18" /></button>
    </div>
    </template>
    <template v-else>
    <div class="key-select-control">
      <div class="key-summary">
        <span>{{ selectedKey?.name || (profile.has_api_key ? '已保存密钥' : '不使用密钥') }}</span>
        <button type="button" :aria-expanded="managing" @click="managing=!managing">{{ managing ? '收起管理' : '管理密钥' }}</button>
      </div>
    </div>
    <template v-if="managing">
    <label class="no-key"><input type="radio" :name="`key-${profile.id}`" :checked="!profile.selected_key_id" @change="edit('select')">不使用密钥</label>
    <div class="key-list" role="listbox" aria-label="API Key 列表">
    <div v-for="key in keys" :key="key.id" class="key-row" role="option" :aria-selected="profile.selected_key_id === key.id">
      <input type="radio" :name="`key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @change="edit('select', key.id)">
      <div class="key-alias"><input :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @input="drafts[key.id] = ($event.target as HTMLInputElement).value"></div>
      <button type="button" title="保存名称" aria-label="保存名称" @click="edit('rename', key.id)"><Save :size="17" /></button>
      <button type="button" title="删除密钥" aria-label="删除密钥" @click="edit('delete', key.id)"><Trash2 :size="17" /></button>
    </div>
    </div>
    <div class="new-key">
      <input v-model="name" aria-label="新密钥名称" placeholder="密钥名称" maxlength="100" autocomplete="off">
      <input v-model="value" aria-label="新 API 密钥" placeholder="API Key" type="password" maxlength="8192" autocomplete="new-password">
      <button type="button" :disabled="!name.trim() || !value.trim()" title="添加密钥" aria-label="添加密钥" @click="edit('add')"><Plus :size="18" /></button>
    </div>
    </template>
    </template>
    <p v-if="busy" role="status">正在保存密钥…</p>
    <p v-if="error" role="alert">{{ error }}<button v-if="retry" type="button" @click="retry()">重试</button></p>
  </fieldset>

  <Teleport to="body">
    <section v-if="sheetOpen" class="app-sheet-overlay" role="presentation" @click.self="closeKeySheet">
      <section class="app-sheet key-sheet" role="dialog" aria-modal="true" aria-labelledby="key-sheet-title">
        <header class="app-sheet-head">
          <h3 id="key-sheet-title">API 密钥</h3>
          <button class="app-sheet-close" type="button" aria-label="关闭" @click="closeKeySheet"><X :size="20" /></button>
        </header>
        <p class="key-sheet-meta">共 {{ keys.length }} 个密钥 · 页内显示 {{ keys.length - hiddenCount }} 个 · 点一行切换使用中的密钥，笔改名称、垃圾桶删除</p>
        <div class="app-sheet-list" role="listbox" aria-label="全部 API 密钥">
          <div v-for="key in keys" :key="key.id" class="app-sheet-option" role="option" tabindex="0" :class="{ selected: profile.selected_key_id === key.id }" :aria-selected="profile.selected_key_id === key.id" @click="selectKey(key.id)" @keydown.enter="selectKey(key.id)">
            <input type="radio" :name="`sheet-key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @click.stop="selectKey(key.id)">
            <span class="app-sheet-option-copy">
              <span class="key-sheet-name"><input v-if="sheetRenaming === key.id || drafts[key.id] !== undefined && drafts[key.id] !== key.name" :id="'key-sheet-alias-' + profile.id + '-' + key.id" :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @click.stop @input="drafts[key.id] = ($event.target as HTMLInputElement).value" @blur="edit('rename', key.id)" @keydown.enter="edit('rename', key.id)"><strong v-else>{{ key.name }}</strong><em v-if="profile.selected_key_id === key.id" class="key-sheet-live">使用中</em></span>
              <small>{{ keyMask(key) || '已保存密钥' }} · id: {{ key.id }}</small>
            </span>
            <button class="key-sheet-icon" type="button" title="改名" aria-label="改名" @click.stop="beginSheetRename(key.id)"><Pencil :size="17" /></button>
            <button class="key-sheet-icon danger-text" type="button" title="删除密钥" aria-label="删除密钥" @click.stop="edit('delete', key.id)"><Trash2 :size="17" /></button>
          </div>
          <div v-if="!keys.length" class="app-sheet-empty">还没有密钥，先在页内添加。</div>
        </div>
        <footer class="key-sheet-foot"><button class="button" type="button" @click="closeKeySheet">完成</button></footer>
      </section>
    </section>
  </Teleport>
</template>

<style scoped>
.named-keys { position:relative; border:0; padding:0; margin:12px 0; min-width:0; }
.named-keys legend { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.key-select-control { position:relative; min-width:0; }
.key-summary { display:flex; align-items:center; gap:12px; min-width:0; }
.key-summary span { overflow-wrap:anywhere; min-width:0; }
.named-keys .key-summary button { width:auto; min-width:88px; padding-inline:10px; flex-shrink:0; }
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
/* 横屏：名称后补掩码后四位，整行做成可点胶囊，右侧铅笔/垃圾桶各自 44×44。 */
html[data-platform="android"][data-orientation="landscape"] .named-keys { margin:0; }
html[data-platform="android"][data-orientation="landscape"] .key-heading { display:flex; align-items:center; gap:10px; min-height:44px; }
html[data-platform="android"][data-orientation="landscape"] .key-heading > strong { font-size:17px; font-weight:700; }
html[data-platform="android"][data-orientation="landscape"] .key-heading label { display:flex; align-items:center; gap:6px; color:var(--muted); font-size:13px; }
html[data-platform="android"][data-orientation="landscape"] .key-heading .key-add { margin-left:auto; width:auto; min-height:44px; padding:0 10px; display:flex; align-items:center; gap:4px; border:0; background:transparent; color:var(--primary); font-size:15px; font-weight:600; }
html[data-platform="android"][data-orientation="landscape"] .key-list { display:grid; gap:8px; margin-top:8px; }
html[data-platform="android"][data-orientation="landscape"] .key-row { display:grid; grid-template-columns:22px minmax(0,1fr) 44px 44px; align-items:center; gap:8px; min-height:56px; margin:0; padding:0 6px 0 14px; border:1px solid var(--line); border-radius:999px; background:var(--surface-solid); }
html[data-platform="android"][data-orientation="landscape"] .key-row:has(input:checked) { border-color:var(--primary); background:var(--primary-faint); }
html[data-platform="android"][data-orientation="landscape"] .key-row input[type=radio] { width:22px; height:22px; }
html[data-platform="android"][data-orientation="landscape"] .key-row button { border:0; border-radius:999px; }
html[data-platform="android"][data-orientation="landscape"] .key-alias { display:flex; align-items:baseline; gap:10px; min-width:0; }
html[data-platform="android"][data-orientation="landscape"] .key-alias strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; font-weight:600; }
html[data-platform="android"][data-orientation="landscape"] .key-alias small { display:block; flex:none; color:var(--muted); font-size:13px; letter-spacing:.14em; font-variant-numeric:tabular-nums; }
html[data-platform="android"][data-orientation="landscape"] .key-alias input { border-color:transparent; padding:4px; background:transparent; font-size:15px; }
html[data-platform="android"][data-orientation="landscape"] .key-more { width:100%; min-height:44px; margin-top:2px; border:1px dashed var(--line-strong); border-radius:14px; background:transparent; color:var(--muted); font-size:14px; }
html[data-platform="android"][data-orientation="landscape"] .key-more:hover { border-color:var(--primary); color:var(--primary); }
.key-sheet-meta { padding:12px 2px 0; color:var(--muted); font-size:13px; line-height:1.6; }
.key-sheet .app-sheet-option { gap:12px; padding:10px 12px; cursor:pointer; }
.key-sheet .app-sheet-option input[type=radio] { flex:none; width:22px; height:22px; margin:0; accent-color:var(--primary); }
.key-sheet .key-sheet-name { display:flex; align-items:center; gap:8px; min-width:0; }
.key-sheet .key-sheet-name strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:16px; font-weight:600; }
.key-sheet .key-sheet-name input { min-height:40px; font-size:15px; }
.key-sheet .app-sheet-option-copy small { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
.key-sheet-live { flex:none; padding:2px 7px; border-radius:999px; color:var(--success); background:var(--primary-soft); font-size:12px; font-style:normal; font-weight:700; }
.key-sheet-icon { flex:none; width:44px; height:44px; display:grid; place-items:center; border:1px solid var(--line); border-radius:999px; background:var(--surface-solid); color:var(--ink); }
.key-sheet-icon.danger-text { color:var(--danger); }
.key-sheet-foot { display:flex; justify-content:flex-end; padding-top:10px; border-top:1px solid var(--line); }
@media (max-width: 480px) { .new-key { grid-template-columns: minmax(0, 1fr) 44px; } .new-key input:first-child { grid-column: 1 / -1; } }
</style>

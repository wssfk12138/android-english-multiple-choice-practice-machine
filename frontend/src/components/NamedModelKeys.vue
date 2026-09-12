<script setup lang="ts">
import { ref } from 'vue'
import { Plus, Save, Trash2 } from 'lucide-vue-next'
import { post } from '../api'
const props = defineProps<{ profile: { id: number; keys?: { id: string; name: string }[]; selected_key_id?: string; has_api_key: boolean } }>()
const emit = defineEmits<{ changed: [] }>()
const name = ref('')
const value = ref('')
const busy = ref(false)
const error = ref('')
const drafts = ref<Record<string, string>>({})
async function edit(action: string, identity = '') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await post<{ keys: { id: string; name: string }[]; selected_key_id: string; has_api_key: boolean }>(`/ai/profiles/${props.profile.id}/keys`,
      { action, identity, name: action === 'rename' ? drafts.value[identity] ?? props.profile.keys?.find(k => k.id === identity)?.name : name.value, value: action === 'add' ? value.value : '' })
    Object.assign(props.profile, result)
    if (action === 'add') { name.value = ''; value.value = '' }
    emit('changed')
  } catch { error.value = '密钥操作失败，请检查名称、选择和安全存储' }
  finally { busy.value = false }
}
</script>

<template>
  <fieldset class="named-keys" :disabled="busy">
    <legend>API 密钥</legend>
    <label class="no-key"><input type="radio" :name="`key-${profile.id}`" :checked="!profile.selected_key_id" @change="edit('select')">不使用密钥</label>
    <div v-for="key in profile.keys || []" :key="key.id" class="key-row">
      <input type="radio" :name="`key-${profile.id}`" :checked="profile.selected_key_id === key.id" :aria-label="`选用 ${key.name}`" @change="edit('select', key.id)">
      <input :value="drafts[key.id] ?? key.name" maxlength="100" aria-label="密钥名称" @input="drafts[key.id] = ($event.target as HTMLInputElement).value">
      <button type="button" title="保存名称" aria-label="保存名称" @click="edit('rename', key.id)"><Save :size="17" /></button>
      <button type="button" title="删除密钥" aria-label="删除密钥" @click="edit('delete', key.id)"><Trash2 :size="17" /></button>
    </div>
    <div class="new-key">
      <input v-model="name" aria-label="新密钥名称" placeholder="密钥名称" maxlength="100" autocomplete="off">
      <input v-model="value" aria-label="新 API 密钥" placeholder="API Key" type="password" maxlength="8192" autocomplete="new-password">
      <button type="button" :disabled="!name.trim() || !value.trim()" title="添加密钥" aria-label="添加密钥" @click="edit('add')"><Plus :size="18" /></button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </fieldset>
</template>

<style scoped>
.named-keys { border: 0; padding: 0; margin: 12px 0; min-width: 0; }
.named-keys legend { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
.key-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 44px 44px; align-items: center; gap: 8px; margin: 8px 0; }
.new-key { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) 44px; gap: 8px; margin-top: 8px; }
.named-keys input { min-width: 0; width: 100%; }
.named-keys input[type=radio] { width: 16px; height: 16px; margin: 0; }
.named-keys button { width: 44px; height: 44px; padding: 0; display: grid; place-items: center; border-radius: 6px; border: 1px solid var(--line); background: var(--surface-solid); color: var(--ink); }
.no-key { display: flex; align-items: center; gap: 8px; font-size: 14px; }
@media (max-width: 480px) { .new-key { grid-template-columns: minmax(0, 1fr) 44px; } .new-key input:first-child { grid-column: 1 / -1; } }
</style>

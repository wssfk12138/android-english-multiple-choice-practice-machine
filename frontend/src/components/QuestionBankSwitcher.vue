<script setup lang="ts">
import { LibraryBig, Plus, Settings2, Trash2 } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import {
  activateQuestionBankProfile,
  createQuestionBankProfile,
  deleteQuestionBankProfile,
  loadQuestionBankProfiles,
  questionBankProfilesState,
  renameQuestionBankProfile,
} from '../services/questionBankProfiles'

const emit = defineEmits<{ changed: [] }>()
const managing = ref(false)
const newName = ref('')
const error = ref('')

onMounted(() => {
  if (!questionBankProfilesState.items.length) void loadQuestionBankProfiles()
})

async function activate(event: Event) {
  const id = Number((event.target as HTMLSelectElement).value)
  if (!id || id === questionBankProfilesState.activeId) return
  try {
    await activateQuestionBankProfile(id)
    emit('changed')
  } catch (cause) { error.value = String(cause) }
}

async function createProfile() {
  const name = newName.value.trim()
  if (!name) return
  try {
    await createQuestionBankProfile(name)
    newName.value = ''
  } catch (cause) { error.value = String(cause) }
}

async function renameProfile(profile: any) {
  const name = window.prompt('新的题库配置名称', profile.name)?.trim()
  if (!name || name === profile.name) return
  try {
    await renameQuestionBankProfile(profile.id, name)
    emit('changed')
  } catch (cause) { error.value = String(cause) }
}

async function removeProfile(profile: any) {
  if (!window.confirm(`将“${profile.name}”及其中 ${profile.paper_count || 0} 套试卷移入回收站？七天内可以恢复。`)) return
  try {
    await deleteQuestionBankProfile(profile.id)
    emit('changed')
  } catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <div class="bank-switcher">
    <div class="bank-switcher-main">
      <LibraryBig :size="17" />
      <select :value="questionBankProfilesState.activeId" :disabled="questionBankProfilesState.loading" aria-label="当前题库配置" @change="activate">
        <option v-for="profile in questionBankProfilesState.items" :key="profile.id" :value="profile.id">{{ profile.name }}</option>
      </select>
      <button class="button ghost compact" type="button" @click="managing = !managing"><Settings2 :size="15" />管理</button>
      <RouterLink class="button ghost compact" to="/trash"><Trash2 :size="15" />回收站</RouterLink>
    </div>
    <div v-if="managing" class="bank-manager card">
      <div class="bank-manager-create">
        <input v-model="newName" maxlength="80" placeholder="新题库配置名称" @keyup.enter="createProfile">
        <button class="button compact" type="button" :disabled="!newName.trim()" @click="createProfile"><Plus :size="15" />新建</button>
      </div>
      <div v-for="profile in questionBankProfilesState.items" :key="profile.id" class="bank-manager-row">
        <span><strong>{{ profile.name }}</strong><small>{{ profile.paper_count || 0 }} 套试卷 · {{ profile.question_count || 0 }} 题</small></span>
        <span class="bank-manager-actions">
          <button class="button ghost compact" type="button" @click="renameProfile(profile)">重命名</button>
          <button class="button ghost danger compact" type="button" @click="removeProfile(profile)">删除</button>
        </span>
      </div>
      <p v-if="error" class="warning">{{ error }}</p>
    </div>
  </div>
</template>

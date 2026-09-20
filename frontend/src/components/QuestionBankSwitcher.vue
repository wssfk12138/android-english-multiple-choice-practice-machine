<script setup lang="ts">
import { ArrowRight, BookOpen, Plus, Settings2, Trash2 } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { confirmDialog, promptDialog } from '../platform/dialogs'
import OptionSheet from './OptionSheet.vue'
import {
  activateQuestionBankProfile,
  createQuestionBankProfile,
  deleteQuestionBankProfile,
  loadQuestionBankProfiles,
  questionBankProfilesState,
  renameQuestionBankProfile,
} from '../services/questionBankProfiles'

const emit = defineEmits<{ changed: [] }>()
const props = withDefaults(defineProps<{ showLibraryLink?: boolean }>(), { showLibraryLink: false })
const managing = ref(false)
const newName = ref('')
const error = ref('')

onMounted(() => {
  if (!questionBankProfilesState.items.length) void loadQuestionBankProfiles()
})

async function activate(id: string | number) {
  const numericId = Number(id)
  if (!numericId || numericId === questionBankProfilesState.activeId) return
  try {
    await activateQuestionBankProfile(numericId)
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
  const name = (await promptDialog({
    title: `重命名“${profile.name}”`,
    message: ['输入新的题库配置名称；练习记录和学习数据保持不变。'],
    confirmLabel: '保存名称',
    input: { label: '新名称', value: profile.name, required: true },
  }))?.trim()
  if (!name || name === profile.name) return
  try {
    await renameQuestionBankProfile(profile.id, name)
    emit('changed')
  } catch (cause) { error.value = String(cause) }
}

async function removeProfile(profile: any) {
  const confirmed = await confirmDialog({
    title: `将“${profile.name}”移入回收站？`,
    message: [
      `该配置中现有 ${profile.paper_count || 0} 套试卷将一并移入回收站。`,
      '内容将在回收站保留七天，期间可以恢复。',
    ],
    confirmLabel: '移入回收站',
    danger: true,
  })
  if (!confirmed) return
  try {
    await deleteQuestionBankProfile(profile.id)
    emit('changed')
  } catch (cause) { error.value = String(cause) }
}
</script>

<template>
  <div class="bank-switcher">
    <div class="bank-switcher-main">
      <OptionSheet
        :model-value="questionBankProfilesState.activeId"
        :items="questionBankProfilesState.items.map(profile => ({ value: profile.id, label: profile.name }))"
        title="切换当前题库配置"
        :disabled="questionBankProfilesState.loading"
        @update:model-value="activate"
      />
      <button class="button ghost compact" type="button" @click="managing = !managing"><Settings2 :size="15" />管理</button>
      <RouterLink class="button ghost compact" to="/trash"><Trash2 :size="15" />回收站</RouterLink>
      <RouterLink v-if="props.showLibraryLink" class="button ghost compact bank-library-link" to="/library"><BookOpen :size="17" />查看全部题库<ArrowRight :size="16" /></RouterLink>
      <slot name="actions" />
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

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ArrowLeft, Download, PackageCheck, RefreshCw, Save } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { get, post, put } from '../api'
const router = useRouter()
const busy = ref('')
const notice = ref('')
const error = ref('')
import OptionSheet from '../components/OptionSheet.vue'
import { loadQuestionBankProfiles, questionBankProfilesState } from '../services/questionBankProfiles'
const settings = reactive({
  question_bank_catalog_url: '',
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)
const selectedPackages = ref<string[]>([])
const packageResults = ref<Record<string, { status: 'pending' | 'success' | 'failed', message: string }>>({})
const catalogDestinationOpen = ref(false)
const catalogDestinationMode = ref<'new_profile' | 'existing_profile'>('new_profile')
const catalogProfileNames = ref<Record<string, string>>({})
const catalogExistingProfileId = ref(0)
const catalogDestinationError = ref('')
const packageKey = (item: any) => `${item.packageId}@${item.contentVersion}`
const allPackagesSelected = computed(() => Boolean(questionBankCatalog.value?.packages?.length)
  && questionBankCatalog.value.packages.every((item: any) => selectedPackages.value.includes(packageKey(item))))

async function save() {
  busy.value = 'save'; error.value = ''
  try {
    Object.assign(settings, await put('/android/updates/settings', settings))
    notice.value = '远程题库目录地址已保存'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

async function checkApp() {
  busy.value = 'app'; error.value = ''
  try {
    appUpdate.value = await post('/android/updates/app/check')
    notice.value = appUpdate.value.available ? '检测到新版本' : '当前已经是最新版本'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

async function installApp() {
  if (!appUpdate.value?.manifest) return
  busy.value = 'install'; error.value = ''
  try {
    await post('/android/updates/app/install', { manifest: appUpdate.value.manifest })
    notice.value = '安装包已校验，正在打开 Android 系统安装界面'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

async function checkBanks() {
  busy.value = 'banks'; error.value = ''
  try {
    questionBankCatalog.value = await post('/android/updates/question-banks/check')
    selectedPackages.value = []
    packageResults.value = {}
    notice.value = questionBankCatalog.value.configured
      ? `远程题库源返回 ${questionBankCatalog.value.packages?.length || 0} 个题库包`
      : '尚未配置远程题库源，本地 ESQ 导入不受影响'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

function toggleAllPackages() {
  selectedPackages.value = allPackagesSelected.value
    ? []
    : (questionBankCatalog.value?.packages?.map(packageKey) || [])
}

function selectedCatalogPackages() {
  return (questionBankCatalog.value?.packages || [])
    .filter((item: any) => selectedPackages.value.includes(packageKey(item)))
}

function suggestedCatalogProfileName(item: any) {
  const source = String(item.title || item.fileName || item.packageId || '新题库')
  return source.replace(/\.esq$/i, '').trim().slice(0, 80) || '新题库'
}

function chooseCatalogImportDestination() {
  const selected = selectedCatalogPackages()
  if (!selected.length) return
  catalogDestinationMode.value = 'new_profile'
  catalogProfileNames.value = Object.fromEntries(
    selected.map((item: any) => [packageKey(item), suggestedCatalogProfileName(item)]),
  )
  catalogExistingProfileId.value = questionBankProfilesState.activeId
    || Number(questionBankProfilesState.items[0]?.id || 0)
  catalogDestinationError.value = ''
  catalogDestinationOpen.value = true
}

async function confirmCatalogImportDestination() {
  const selected = selectedCatalogPackages()
  if (!selected.length) {
    catalogDestinationOpen.value = false
    return
  }
  catalogDestinationError.value = ''
  if (catalogDestinationMode.value === 'new_profile') {
    const names: string[] = selected.map(
      (item: any) => String(catalogProfileNames.value[packageKey(item)] || '').trim(),
    )
    if (names.some(name => !name)) {
      catalogDestinationError.value = '请输入每个新题库配置的名称'
      return
    }
    const normalized = names.map(name => name.toLocaleLowerCase())
    if (new Set(normalized).size !== normalized.length) {
      catalogDestinationError.value = '所选题库的新配置名称不能重复'
      return
    }
    const existingNames = new Set(
      questionBankProfilesState.items.map(profile => String(profile.name).trim().toLocaleLowerCase()),
    )
    const duplicateIndex = normalized.findIndex(name => existingNames.has(name))
    if (duplicateIndex >= 0) {
      catalogDestinationError.value = `已经存在题库配置“${names[duplicateIndex]}”，请选择导入已有配置或修改名称。`
      return
    }
  } else if (!questionBankProfilesState.items.some(
    profile => Number(profile.id) === catalogExistingProfileId.value,
  )) {
    catalogDestinationError.value = '请选择要导入的已有题库配置'
    return
  }

  catalogDestinationOpen.value = false
  await installSelectedPackages(selected)
}

async function installSelectedPackages(selected: any[]) {
  busy.value = 'catalog-install'
  error.value = ''
  notice.value = ''
  packageResults.value = {}
  const importIds: number[] = []
  for (const item of selected) {
    const key = packageKey(item)
    packageResults.value[key] = { status: 'pending', message: '正在下载、校验并建立导入草稿' }
    try {
      let profileId = catalogExistingProfileId.value
      if (catalogDestinationMode.value === 'new_profile') {
        const created: any = await post('/question-bank-profiles', {
          name: catalogProfileNames.value[key],
        })
        profileId = Number(created.id)
        await loadQuestionBankProfiles()
      }
      const result: any = await post('/android/updates/question-banks/download', {
        package_id: item.packageId,
        content_version: item.contentVersion,
        profile_id: profileId,
      })
      importIds.push(Number(result.id))
      packageResults.value[key] = { status: 'success', message: '已校验，等待你在导入预览中确认' }
    } catch (cause) {
      packageResults.value[key] = { status: 'failed', message: String(cause) }
    }
  }
  busy.value = ''
  const failedCount = selected.length - importIds.length
  notice.value = `已建立 ${importIds.length} 个导入草稿${failedCount ? `，${failedCount} 个失败` : ''}`
  if (importIds.length) {
    await router.push({ path: '/imports', query: { esqImportId: String(importIds[0]) } })
  }
}


onMounted(async () => {
  try { Object.assign(settings, await get('/android/updates/settings')); await loadQuestionBankProfiles() }
  catch (cause) { error.value = String(cause) }
})

</script>
<template>
<div class="page android-updates-page"><div class="page-head"><div class="page-title-row"><RouterLink class="icon-button" to="/mobile-settings" aria-label="返回设置"><ArrowLeft :size="20" /></RouterLink><h1>更新与远程题库</h1></div></div><p v-if="error" class="warning" role="alert">{{ error }}</p><p v-if="notice" class="settings-success" role="status">{{ notice }}</p><p v-if="busy" role="status" class="operation-status">正在处理，请稍候…</p>
<div class="maintenance-update-grid">    <section class="card update-source-card" data-update-section="catalog">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Download :size="20" /></span>
        <div><h2>远程题库</h2></div>
      </div>
      <div class="field">
        <label for="android-catalog-url">远程题库目录 URL</label>
        <input id="android-catalog-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://github.com/.../question-bank-catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存目录地址</button>
      <button class="button secondary" type="button" :disabled="busy === 'banks' || busy === 'catalog-install'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
    </section>

    <section class="card update-source-card" data-update-section="update">
      <div class="update-source-heading">
        <span class="api-profile-icon"><PackageCheck :size="20" /></span>
        <div><h2>程序更新</h2></div>
      </div>
      <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
      <div v-if="appUpdate" class="update-result">
        <span>当前版本 {{ appUpdate.current_version }}</span>
        <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
        <p v-if="appUpdate.manifest?.releaseNotes">{{ appUpdate.manifest?.releaseNotes }}</p>
        <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
      </div>
    </section>

</div><section v-if="questionBankCatalog?.configured" class="card catalog-results">      <div v-if="questionBankCatalog?.configured" class="update-package-list">
        <div class="catalog-toolbar">
          <span>{{ questionBankCatalog.packages.length }} 个可用 · 已选 {{ selectedPackages.length }} 个</span>
          <div class="update-actions">
            <button class="button ghost compact" type="button" :disabled="busy === 'catalog-install'" @click="toggleAllPackages">{{ allPackagesSelected ? '清空选择' : '全选' }}</button>
            <button class="button compact" type="button" :disabled="busy === 'catalog-install' || !selectedPackages.length" @click="chooseCatalogImportDestination">
              <Download :size="15" />安装选中题库（{{ selectedPackages.length }}）
            </button>
          </div>
        </div>
        <label v-for="item in questionBankCatalog.packages" :key="packageKey(item)" class="catalog-item selection-option">
          <input v-model="selectedPackages" type="checkbox" :value="packageKey(item)" :disabled="busy === 'catalog-install'">
          <span>
            <strong>{{ item.title }}</strong>
            <small>版本 {{ item.contentVersion }} · {{ item.years.join('、') || '多年份' }} · {{ Math.ceil(item.size / 1024) }} KiB</small>
            <small>{{ item.license }}</small>
            <small v-if="packageResults[packageKey(item)]" :class="`catalog-${packageResults[packageKey(item)].status}`">{{ packageResults[packageKey(item)].message }}</small>
          </span>
        </label>
        <p v-if="!questionBankCatalog.packages.length" class="diagnostic-empty">远程目录当前没有可安装题库。</p>
      </div>
</section>    <div v-if="catalogDestinationOpen" class="review-overlay" role="dialog" aria-modal="true" aria-labelledby="catalog-destination-title">
      <div class="review-card import-assist-dialog catalog-destination-dialog">
        <h3 id="catalog-destination-title">选择远程题库导入位置</h3>
        <p class="lead">默认按每个题库包的名称创建独立配置，不会切换当前学习题库。</p>
        <label class="catalog-destination-choice">
          <input v-model="catalogDestinationMode" type="radio" value="new_profile">
          <span><b>按题库包名称创建新题库配置（推荐）</b><small>适合四级、考研等不同考试题库，避免误导入当前配置。</small></span>
        </label>
        <div v-if="catalogDestinationMode === 'new_profile'" class="catalog-profile-name-list">
          <label v-for="item in selectedCatalogPackages()" :key="packageKey(item)" class="field">
            <span>{{ item.title }}</span>
            <input v-model.trim="catalogProfileNames[packageKey(item)]" maxlength="80" aria-label="新题库配置名称">
          </label>
        </div>
        <label class="catalog-destination-choice">
          <input v-model="catalogDestinationMode" type="radio" value="existing_profile">
          <span><b>导入已有题库配置</b><small>所选远程包将导入同一个已有配置，请确认考试类型一致。</small></span>
        </label>
        <label v-if="catalogDestinationMode === 'existing_profile'" class="field">
          <span>已有题库配置</span>
          <OptionSheet v-model="catalogExistingProfileId" :items="questionBankProfilesState.items.map((profile: any) => ({ value: Number(profile.id), label: profile.name }))" title="选择已有题库配置" searchable />
        </label>
        <p v-if="catalogDestinationError" class="warning" role="alert">{{ catalogDestinationError }}</p>
        <div class="catalog-destination-actions">
          <button class="button ghost" type="button" @click="catalogDestinationOpen=false">取消</button>
          <button class="button" type="button" @click="confirmCatalogImportDestination">继续下载并导入</button>
        </div>
      </div>
    </div>

</div></template>
<style scoped>
.maintenance-update-grid { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,2fr); gap:16px; align-items:start; }
.maintenance-update-grid > section { min-width:0; margin:0; }
.update-result p { overflow-wrap:anywhere; }
.catalog-results { margin-top:16px; }
@media(max-width:900px) { .maintenance-update-grid { grid-template-columns:minmax(0,1fr); } }
.update-source-heading > div { min-width: 0; }
.warning { overflow-wrap: anywhere; }
.catalog-destination-dialog { text-align: left; }
.catalog-destination-choice { display: flex; gap: 10px; align-items: flex-start; padding: 11px; border: 1px solid var(--line); border-radius: 12px; margin-top: 12px; }
.catalog-destination-choice input { margin-top: 4px; min-width: 20px; min-height: 20px; }
.catalog-destination-choice span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.catalog-destination-choice small { color: var(--muted); overflow-wrap: anywhere; }
.catalog-profile-name-list { display: grid; gap: 10px; margin: 12px 0; }
.catalog-destination-actions { display: flex; justify-content: center; gap: 10px; margin-top: 20px; }
</style>

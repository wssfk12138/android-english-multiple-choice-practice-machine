<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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
// 只放图标、不放文字的社区入口：QQ 群深链与公开 GitHub 项目页。
// QQ 用官方 mqqapi 群名片深链，只带群号，不含原分享链里的邀请凭证和邀请人账号。
// 官方网页加群只认不透明短码（qm.qq.com/q/<短码>），没有纯群号形式，所以群号能打开的
// 官方入口就是这条深链；它由 QQ 客户端接管，不会落到浏览器。
const communityLinks = {
  qq: 'mqqapi://card/show_pslcard?uin=1012639381&card_type=group',
  github: 'https://github.com/wssfk12138/android-english-multiple-choice-practice-machine',
}
// 没有 QQ 客户端时 startActivity 会静默失败，图标点了没反应，这里补一次兜底提示。
// 跳转成功会让本页隐藏并失焦，两者都没变化才认定系统里没有可接收的 QQ。
const QQ_FALLBACK_DELAY = 2200
let qqFallbackTimer = 0
function openQqGroup() {
  window.clearTimeout(qqFallbackTimer)
  qqFallbackTimer = window.setTimeout(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) error.value = '未检测到 QQ 客户端，请先安装 QQ 后再打开群链接'
  }, QQ_FALLBACK_DELAY)
}
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') window.clearTimeout(qqFallbackTimer)
}
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
  document.addEventListener('visibilitychange', onVisibilityChange)
  try { Object.assign(settings, await get('/android/updates/settings')); await loadQuestionBankProfiles() }
  catch (cause) { error.value = String(cause) }
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.clearTimeout(qqFallbackTimer)
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
      <div class="update-community">
        <a class="icon-button" :href="communityLinks.qq" rel="noreferrer noopener" aria-label="QQ 群 1012639381" title="QQ 群 1012639381" @click="openQqGroup">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="currentColor" stroke="none"><path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673" /></svg>
        </a>
        <a class="icon-button" :href="communityLinks.github" target="_blank" rel="noreferrer noopener" aria-label="GitHub 项目" title="GitHub 项目">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="currentColor" stroke="none"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
        </a>
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
/* 程序更新卡片：更新结果排在按钮上方，操作整行（按钮 + 社区图标）贴到卡片底部。
   容器用三行网格：标题行与结果面板横跨整宽，末行左侧按钮、右侧图标；末行用 1fr + align-self:end 贴底。 */
[data-update-section='update'] { display:grid; grid-template-columns:auto auto minmax(0,1fr); grid-template-rows:min-content min-content 1fr; gap:10px; justify-items:start; }
[data-update-section='update'] > .update-source-heading { grid-column:1/-1; grid-row:1; justify-self:stretch; margin-bottom:10px; }
[data-update-section='update'] > .update-source-heading h2 { margin:0; }
[data-update-section='update'] > .update-result { grid-column:1/-1; grid-row:2; justify-self:stretch; margin:0 0 6px; }
[data-update-section='update'] > .button { grid-column:1; grid-row:3; align-self:end; min-height:44px; }
[data-update-section='update'] > .update-community { grid-column:2; grid-row:3; align-self:end; }
.update-community { display:flex; align-items:center; gap:8px; flex:0 0 auto; }
.update-community .icon-button { width:44px; height:44px; flex:0 0 44px; padding:0; text-decoration:none; }
.update-community .icon-button svg { width:20px; height:20px; fill:currentColor; stroke:none; }
/* 窄屏下全局 .button 被压到 40px/圆角 10px，图标入口跟随同一组尺寸，避免同排不同高 */
@media (orientation: portrait) and (max-width: 840px) {
  .update-community .icon-button { width:40px; height:40px; flex:0 0 40px; border-radius:10px; }
  .update-community .icon-button svg { width:18px; height:18px; }
}
</style>

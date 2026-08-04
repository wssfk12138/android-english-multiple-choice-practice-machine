<script setup lang="ts">
import { Download, PackageCheck, RefreshCw, Save, Server } from 'lucide-vue-next'
import { onMounted, reactive, ref } from 'vue'
import { get, post, put } from '../api'

const settings = reactive({
  app_update_manifest_url: '',
  question_bank_catalog_url: '',
})
const appUpdate = ref<any>(null)
const questionBankCatalog = ref<any>(null)
const busy = ref('')
const notice = ref('')
const error = ref('')

async function load() {
  Object.assign(settings, await get('/android/updates/settings'))
}

async function save() {
  busy.value = 'save'; error.value = ''
  try {
    Object.assign(settings, await put('/android/updates/settings', settings))
    notice.value = '更新地址已保存'
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
    notice.value = questionBankCatalog.value.configured
      ? `远程题库源返回 ${questionBankCatalog.value.packages?.length || 0} 个题库包`
      : '尚未配置远程题库源，本地 ESQ 导入不受影响'
  } catch (cause) {
    error.value = String(cause)
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="page android-updates-page">
    <div class="page-head">
      <div>
        <span class="eyebrow">ANDROID DELIVERY</span>
        <h1>更新与远程题库</h1>
        <p class="lead">程序更新和题库更新相互独立。APK 下载后会校验 SHA-256，并由 Android 系统确认安装。</p>
      </div>
    </div>
    <div v-if="error" class="warning" role="alert">{{ error }}</div>
    <div v-if="notice" class="settings-success" role="status"><PackageCheck :size="17" />{{ notice }}</div>

    <section class="card update-source-card">
      <div class="update-source-heading">
        <span class="api-profile-icon"><Server :size="20" /></span>
        <div><h2>更新源</h2><p class="lead">正式版建议使用 GitHub Releases 的 HTTPS 清单；局域网地址主要用于调试。</p></div>
      </div>
      <div class="field">
        <label for="app-update-url">程序更新清单 URL</label>
        <input id="app-update-url" v-model.trim="settings.app_update_manifest_url" inputmode="url" placeholder="https://.../update.json">
      </div>
      <div class="field">
        <label for="bank-update-url">远程题库目录 URL（可留空）</label>
        <input id="bank-update-url" v-model.trim="settings.question_bank_catalog_url" inputmode="url" placeholder="https://.../catalog.json">
      </div>
      <button class="button" type="button" :disabled="busy === 'save'" @click="save"><Save :size="16" />保存更新源</button>
    </section>

    <div class="grid grid-2 update-check-grid">
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><Download :size="20" /></span>
          <div><h2>程序更新</h2><p class="lead">不会静默安装，最终安装操作由你在系统界面确认。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'app'" @click="checkApp"><RefreshCw :size="16" />检查程序更新</button>
        <div v-if="appUpdate" class="update-result">
          <span>当前版本 {{ appUpdate.current_version }}</span>
          <strong>{{ appUpdate.available ? `可更新至 ${appUpdate.manifest.versionName}` : '已是最新版本' }}</strong>
          <p v-if="appUpdate.manifest.releaseNotes">{{ appUpdate.manifest.releaseNotes }}</p>
          <button v-if="appUpdate.available" class="button" type="button" :disabled="busy === 'install'" @click="installApp"><Download :size="16" />下载、校验并安装</button>
        </div>
      </section>
      <section class="card">
        <div class="update-source-heading">
          <span class="api-profile-icon"><PackageCheck :size="20" /></span>
          <div><h2>远程题库源</h2><p class="lead">当前仅预留目录协议；本地 ESQ 导入仍是第一版的主要方式。</p></div>
        </div>
        <button class="button secondary" type="button" :disabled="busy === 'banks'" @click="checkBanks"><RefreshCw :size="16" />检查远程题库</button>
        <div v-if="questionBankCatalog?.configured" class="update-package-list">
          <div v-for="item in questionBankCatalog.packages" :key="`${item.packageId}:${item.contentVersion}`">
            <strong>{{ item.title }}</strong><small>{{ item.contentVersion }} · {{ item.fileName }}</small>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

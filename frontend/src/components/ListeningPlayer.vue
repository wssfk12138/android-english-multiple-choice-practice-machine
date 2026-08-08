<script setup lang="ts">
import {
  FastForward,
  Headphones,
  LockKeyhole,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  Volume2,
} from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'

type AudioTrack = {
  asset_id?: string
  label?: string
  media_type?: string
  url: string
}

const props = withDefaults(defineProps<{
  tracks?: AudioTrack[]
  seekable?: boolean
  timerPaused?: boolean
}>(), {
  tracks: () => [],
  seekable: true,
  timerPaused: false,
})

const audio = ref<HTMLAudioElement | null>(null)
const selectedIndex = ref(0)
const playing = ref(false)
const loading = ref(false)
const failed = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const lastAllowedTime = ref(0)
const pendingAutoplay = ref(false)
const resumeAfterTimerPause = ref(false)
const loadedTrackKey = ref('')
const restoreTime = ref(0)
const progressByTrack = new Map<string, number>()
const selectedTrack = computed(() => props.tracks[selectedIndex.value] || null)
const trackSignature = computed(() =>
  props.tracks
    .map(track => `${track.asset_id || ''}:${track.url}`)
    .join('|'),
)
const progressMax = computed(() => Math.max(duration.value, 1))

function selectedTrackKey() {
  const track = selectedTrack.value
  return track ? `${track.asset_id || ''}:${track.url}` : ''
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours
    ? [hours, minutes, seconds].map(item => String(item).padStart(2, '0')).join(':')
    : [minutes, seconds].map(item => String(item).padStart(2, '0')).join(':')
}

async function loadSelectedTrack(autoPlay = false) {
  if (loadedTrackKey.value) {
    progressByTrack.set(loadedTrackKey.value, currentTime.value)
  }
  loadedTrackKey.value = selectedTrackKey()
  restoreTime.value = progressByTrack.get(loadedTrackKey.value) || 0
  playing.value = false
  loading.value = Boolean(selectedTrack.value)
  failed.value = false
  pendingAutoplay.value = autoPlay && Boolean(selectedTrack.value)
  currentTime.value = 0
  duration.value = 0
  lastAllowedTime.value = 0
  await nextTick()
  audio.value?.load()
}

async function togglePlayback() {
  const player = audio.value
  if (!player || failed.value) return
  if (!player.paused) {
    resumeAfterTimerPause.value = false
    player.pause()
    return
  }
  loading.value = true
  try {
    await player.play()
  } catch {
    loading.value = false
  }
}

function pause() {
  resumeAfterTimerPause.value = playing.value
  audio.value?.pause()
}

function restart() {
  if (!props.seekable || !audio.value) return
  audio.value.currentTime = 0
  currentTime.value = 0
  lastAllowedTime.value = 0
}

function skip(seconds: number) {
  if (!props.seekable || !audio.value) return
  const target = Math.min(
    Math.max(0, audio.value.currentTime + seconds),
    duration.value || Number.POSITIVE_INFINITY,
  )
  audio.value.currentTime = target
  currentTime.value = target
  lastAllowedTime.value = target
}

function seek(event: Event) {
  if (!props.seekable || !audio.value) return
  const target = Number((event.target as HTMLInputElement).value)
  audio.value.currentTime = target
  currentTime.value = target
  lastAllowedTime.value = target
}

function onLoadedMetadata() {
  const player = audio.value
  duration.value = Number(player?.duration || 0)
  if (!loadedTrackKey.value) {
    loadedTrackKey.value = selectedTrackKey()
    restoreTime.value = progressByTrack.get(loadedTrackKey.value) || 0
  }
  const target = Math.min(restoreTime.value, duration.value || restoreTime.value)
  if (player && target > 0) player.currentTime = target
  currentTime.value = target
  lastAllowedTime.value = target
  loading.value = false
  failed.value = false
}

async function autoplayWhenReady() {
  const player = audio.value
  if (!pendingAutoplay.value || props.timerPaused || !player || player.readyState < 2) return
  pendingAutoplay.value = false
  loading.value = true
  try {
    await player.play()
  } catch {
    loading.value = false
  }
}

function onCanPlay() {
  loading.value = false
  void autoplayWhenReady()
}

function onTimeUpdate() {
  const value = Number(audio.value?.currentTime || 0)
  currentTime.value = value
  lastAllowedTime.value = value
  if (loadedTrackKey.value) progressByTrack.set(loadedTrackKey.value, value)
}

function preventTimedSeeking() {
  const player = audio.value
  if (!player || props.seekable) return
  if (Math.abs(player.currentTime - lastAllowedTime.value) > 1.25) {
    player.currentTime = lastAllowedTime.value
  }
}

watch(trackSignature, (next, previous) => {
  if (next === previous) return
  const shouldAutoplay = Boolean(previous && next)
  if (selectedIndex.value !== 0) {
    pendingAutoplay.value = shouldAutoplay
    selectedIndex.value = 0
  } else {
    void loadSelectedTrack(shouldAutoplay)
  }
})

watch(selectedIndex, () => void loadSelectedTrack(true))
watch(() => props.timerPaused, paused => {
  if (paused) {
    if (playing.value) resumeAfterTimerPause.value = true
    audio.value?.pause()
    return
  }
  if (resumeAfterTimerPause.value || pendingAutoplay.value) {
    resumeAfterTimerPause.value = false
    pendingAutoplay.value = true
    void autoplayWhenReady()
  }
})

defineExpose({ pause })
</script>

<template>
  <div class="listening-console">
    <div class="listening-heading">
      <span class="listening-icon" aria-hidden="true"><Headphones :size="28" /></span>
      <div>
        <span class="eyebrow">Listening practice</span>
        <h1>听力练习</h1>
        <p>不显示听力原文，请按照完整音频完成本段题目。</p>
      </div>
    </div>

    <div v-if="!tracks.length" class="listening-empty" role="status">
      <Volume2 :size="26" />
      <strong>这套题还没有可播放的音频</strong>
      <span>请返回题库，重新导入试卷并在听力音频框中选择文件。</span>
    </div>

    <template v-else>
      <label v-if="tracks.length > 1" class="track-picker">
        <span>音频曲目</span>
        <select v-model.number="selectedIndex">
          <option v-for="(track, index) in tracks" :key="track.asset_id || track.url" :value="index">
            {{ track.label || `听力音频 ${index + 1}` }}
          </option>
        </select>
      </label>

      <div class="player-surface" :class="{ locked: !seekable, failed }">
        <audio
          v-if="selectedTrack"
          ref="audio"
          :src="selectedTrack.url"
          preload="metadata"
          playsinline
          :disableRemotePlayback="!seekable"
          @loadstart="loading=true"
          @loadedmetadata="onLoadedMetadata"
          @canplay="onCanPlay"
          @play="playing=true;failed=false"
          @pause="playing=false"
          @ended="playing=false"
          @timeupdate="onTimeUpdate"
          @seeking="preventTimedSeeking"
          @error="failed=true;loading=false;playing=false"
        />

        <button
          class="main-play-button"
          type="button"
          :disabled="failed"
          :aria-label="playing ? '暂停听力音频' : '播放听力音频'"
          @click="togglePlayback"
        >
          <Pause v-if="playing" :size="31" fill="currentColor" />
          <Play v-else :size="31" fill="currentColor" />
        </button>

        <div class="timeline">
          <div class="time-row">
            <span>{{ formatTime(currentTime) }}</span>
            <span>{{ loading ? '正在载入音频…' : formatTime(duration) }}</span>
          </div>
          <input
            class="audio-progress"
            type="range"
            min="0"
            :max="progressMax"
            step="0.1"
            :value="currentTime"
            :disabled="!seekable || failed"
            :aria-label="seekable ? '听力音频播放进度' : '计时模式下播放进度已锁定'"
            @input="seek"
          />
        </div>

        <div class="secondary-controls">
          <button type="button" :disabled="!seekable || failed" aria-label="后退十秒" @click="skip(-10)">
            <Rewind :size="20" /><span>10 秒</span>
          </button>
          <button type="button" :disabled="!seekable || failed" aria-label="回到开头" @click="restart">
            <RotateCcw :size="20" /><span>回到开头</span>
          </button>
          <button type="button" :disabled="!seekable || failed" aria-label="前进十秒" @click="skip(10)">
            <FastForward :size="20" /><span>10 秒</span>
          </button>
        </div>

        <div v-if="!seekable" class="seek-lock-note" role="status">
          <LockKeyhole :size="18" />
          <span>计时模式已锁定进度，音频会正常连续播放，但不能快进、后退或拖动。</span>
        </div>
        <div v-if="failed" class="audio-error" role="alert">
          音频加载失败。请确认文件仍在题库中，或重新导入该套试题。
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.listening-console { width:min(100%,440px); margin:0 auto; display:grid; gap:24px; }
.listening-heading { display:grid; grid-template-columns:56px 1fr; gap:16px; align-items:start; }
.listening-heading h1 { margin:3px 0 7px; font-size:30px; line-height:1.15; }
.listening-heading p { margin:0; color:var(--muted); font-size:14px; line-height:1.65; }
.listening-icon { width:56px; height:56px; display:grid; place-items:center; border-radius:18px; color:var(--primary); background:linear-gradient(145deg,var(--primary-soft),color-mix(in srgb,var(--lavender) 75%,var(--surface-solid))); box-shadow:var(--shadow-sm); }
.listening-empty { min-height:230px; padding:32px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; text-align:center; border:1px dashed color-mix(in srgb,var(--primary) 36%,var(--line)); border-radius:24px; color:var(--muted); background:color-mix(in srgb,var(--surface-solid) 82%,transparent); }
.listening-empty strong { color:var(--ink); font-size:17px; }
.listening-empty span { max-width:320px; font-size:13px; line-height:1.65; }
.track-picker { display:grid; gap:7px; color:var(--muted); font-size:13px; font-weight:700; }
.track-picker select { min-height:48px; width:100%; padding:0 14px; border:1px solid var(--line); border-radius:13px; background:var(--surface-solid); color:var(--ink); font:inherit; }
.player-surface { padding:26px; display:grid; justify-items:center; gap:22px; border:1px solid color-mix(in srgb,var(--primary) 20%,var(--line)); border-radius:26px; background:linear-gradient(155deg,color-mix(in srgb,var(--surface-solid) 96%,var(--primary-soft)),var(--surface-solid)); box-shadow:var(--shadow); }
.main-play-button { width:84px; height:84px; display:grid; place-items:center; padding:0; border:0; border-radius:50%; color:white; background:var(--primary); box-shadow:0 12px 28px color-mix(in srgb,var(--primary) 32%,transparent); transition:background-color .2s ease,box-shadow .2s ease,opacity .2s ease; }
.main-play-button:hover:not(:disabled) { background:color-mix(in srgb,var(--primary) 86%,black); box-shadow:0 14px 32px color-mix(in srgb,var(--primary) 40%,transparent); }
.main-play-button:focus-visible,.secondary-controls button:focus-visible,.track-picker select:focus-visible,.audio-progress:focus-visible { outline:3px solid color-mix(in srgb,var(--primary) 42%,transparent); outline-offset:3px; }
.main-play-button:disabled { opacity:.42; cursor:not-allowed; }
.timeline { width:100%; display:grid; gap:9px; }
.time-row { display:flex; justify-content:space-between; color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.audio-progress { width:100%; min-height:28px; accent-color:var(--primary); cursor:pointer; }
.audio-progress:disabled { opacity:.48; cursor:not-allowed; }
.secondary-controls { width:100%; display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.secondary-controls button { min-height:52px; display:flex; align-items:center; justify-content:center; gap:6px; padding:8px; border:1px solid var(--line); border-radius:14px; background:var(--surface-solid); color:var(--ink); font-size:12px; font-weight:700; transition:background-color .18s ease,border-color .18s ease,opacity .18s ease; }
.secondary-controls button:hover:not(:disabled) { border-color:var(--primary); background:var(--primary-soft); }
.secondary-controls button:disabled { opacity:.38; cursor:not-allowed; }
.seek-lock-note,.audio-error { width:100%; display:flex; align-items:flex-start; gap:9px; padding:12px 14px; border-radius:13px; font-size:13px; line-height:1.55; }
.seek-lock-note { color:var(--primary); background:var(--primary-soft); }
.audio-error { color:var(--danger); background:var(--danger-soft); }
@media (max-width:599px) {
  .listening-console { width:100%; }
  .player-surface { padding:22px 18px; border-radius:21px; }
  .listening-heading { grid-template-columns:48px 1fr; }
  .listening-icon { width:48px; height:48px; border-radius:15px; }
  .listening-heading h1 { font-size:25px; }
}
@media (prefers-reduced-motion:reduce) {
  .main-play-button,.secondary-controls button { transition:none; }
}
</style>

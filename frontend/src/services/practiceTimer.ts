export type TimerPauseReason = 'manual' | 'automatic' | 'recovery' | 'submitting'
export type PracticeTimerState = {
  mode: 'off' | 'running' | 'paused' | 'finished'
  elapsedMs: number
  startedAt: number | null // Runtime monotonic clock only. Never persisted.
  pauseReason: TimerPauseReason | null
}
export function createTimer(): PracticeTimerState {
  return { mode: 'paused', elapsedMs: 0, startedAt: null, pauseReason: 'automatic' }
}
export function elapsedTimer(state: PracticeTimerState | null, now: number): number {
  if (!state) return 0
  return state.elapsedMs + (state.mode === 'running' && state.startedAt !== null
    ? Math.max(0, now - state.startedAt) : 0)
}
export function checkpointTimer(state: PracticeTimerState, now: number): PracticeTimerState {
  return { ...state, elapsedMs: elapsedTimer(state, now), startedAt: state.mode === 'running' ? now : null }
}
export function pauseTimerState(state: PracticeTimerState, now: number, reason: TimerPauseReason): PracticeTimerState {
  if (state.mode === 'off' || state.mode === 'finished') return state
  // Automatic/background/submit events cannot erase a manual or recovery pause.
  const pauseReason = reason === 'manual' ? reason
    : state.mode === 'paused' && (state.pauseReason === 'manual' || state.pauseReason === 'recovery')
      ? state.pauseReason : reason
  return { mode: 'paused', elapsedMs: elapsedTimer(state, now), startedAt: null, pauseReason }
}
export function resumeTimerState(state: PracticeTimerState, now: number, ready: boolean, explicit = false): PracticeTimerState {
  if (!ready || state.mode !== 'paused' || (state.pauseReason !== 'automatic' && !explicit)) return state
  return { ...state, mode: 'running', startedAt: now, pauseReason: null }
}
export function finishTimerState(state: PracticeTimerState, now: number): PracticeTimerState {
  if (state.mode === 'off') return state
  return { mode: 'finished', elapsedMs: elapsedTimer(state, now), startedAt: null, pauseReason: null }
}
export function timerSnapshot(state: PracticeTimerState, now: number) {
  return {
    version: 2, mode: state.mode === 'running' ? 'paused' : state.mode,
    elapsedMs: elapsedTimer(state, now),
    pauseReason: state.mode === 'running' || state.pauseReason === 'submitting' ? 'recovery' : state.pauseReason,
  }
}
export function restoreTimer(raw: string | null, submitted = false): { state: PracticeTimerState | null; notice: string; backup: boolean } {
  if (raw === null) return { state: null, notice: '', backup: false }
  const invalid = { state: null, notice: '计时记录无法识别，未补算历史用时。原记录已保留；可重新选择计时，答案与成绩不受影响。', backup: true }
  try {
    const saved = JSON.parse(raw)
    if (!saved || typeof saved.elapsedMs !== 'number' || !Number.isFinite(saved.elapsedMs) || saved.elapsedMs < 0) return invalid
    const legacy = saved.version === undefined
    if (!legacy && saved.version !== 2) return invalid
    if (!['off','paused','finished', ...(legacy ? ['running'] : [])].includes(saved.mode)) return invalid
    if (!legacy && (saved.mode === 'paused' ? !['manual','automatic','recovery'].includes(saved.pauseReason) : saved.pauseReason !== null)) return invalid
    let state: PracticeTimerState = {
      mode: saved.mode === 'running' ? 'paused' : saved.mode, elapsedMs: saved.elapsedMs, startedAt: null,
      pauseReason: legacy ? saved.mode === 'running' ? 'recovery' : saved.mode === 'paused' ? 'manual' : null : saved.pauseReason,
    }
    if (submitted && state.mode !== 'off') state = finishTimerState(state, 0)
    return { state, backup: legacy, notice: legacy
      ? '已迁移旧计时记录并保留原值。历史离开时段无法准确恢复，当前仅保留已记录累计，不补算旧起点；已有偏大用时未自动清零。'
      : state.pauseReason === 'recovery' ? '上次计时未正常结束，已恢复最近保存的累计，未计入离线时间。点击继续练习后续计。' : '' }
  } catch { return invalid }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTimer, elapsedTimer, pauseTimerState, resumeTimerState, checkpointTimer, finishTimerState, timerSnapshot, restoreTimer } from '../src/services/practiceTimer.ts'

test('10 minutes + 24 hours away + 5 minutes is 15 minutes; duplicate exits are idempotent', () => {
  let s = resumeTimerState(createTimer(), 0, true, true)
  s = pauseTimerState(s, 600000, 'automatic')
  s = pauseTimerState(s, 700000, 'automatic')
  assert.equal(s.elapsedMs, 600000)
  assert.equal('startedAt' in timerSnapshot(s, 700000), false)
  s = restoreTimer(JSON.stringify(timerSnapshot(s, 700000))).state
  s = resumeTimerState(s, 86400000, true)
  assert.equal(elapsedTimer(s, 86700000), 900000)
})
test('manual/recovery needs explicit continue; off/finished never starts; foreground is required', () => {
  for (const reason of ['manual','recovery']) {
    const s = { ...createTimer(), pauseReason: reason }
    assert.equal(resumeTimerState(s, 20, true).mode, 'paused')
    assert.equal(resumeTimerState(s, 20, false, true).mode, 'paused')
    assert.equal(resumeTimerState(s, 20, true, true).mode, 'running')
  }
  for (const mode of ['off','finished']) assert.equal(resumeTimerState({...createTimer(),mode}, 20,true,true).mode,mode)
})
test('checkpoint does not double count; restart never uses a runtime start; clock rollback is bounded', () => {
  let s = resumeTimerState(createTimer(), 0,true,true)
  s = checkpointTimer(s, 5000)
  s = checkpointTimer(s, 10000)
  assert.equal(elapsedTimer(s, 12000), 12000)
  const restored = restoreTimer(JSON.stringify(timerSnapshot(s, 12000))).state
  assert.equal(restored.elapsedMs,12000)
  assert.equal(restored.startedAt,null)
  assert.equal(restored.pauseReason,'recovery')
  assert.equal(elapsedTimer(s, 2),10000)
})
test('submission freezes time; failure can resume only the prior running state', () => {
  let s = resumeTimerState(createTimer(), 0,true,true)
  s = pauseTimerState(s, 1000,'submitting')
  assert.equal(elapsedTimer(s,90000),1000)
  assert.equal(finishTimerState(s,90000).elapsedMs,1000)
  s = pauseTimerState(s,90000,'automatic')
  s = resumeTimerState(s,90000,true)
  assert.equal(elapsedTimer(s,91000),2000)
  const manual = pauseTimerState(resumeTimerState(createTimer(),0,true,true),1000,'manual')
  assert.equal(pauseTimerState(manual,2000,'submitting').pauseReason,'manual')
})
test('legacy running preserves only finite accumulated base and never calculates to now', () => {
  const raw = JSON.stringify({mode:'running',elapsedMs:987654,startedAt:1})
  const restored = restoreTimer(raw)
  assert.equal(restored.state.elapsedMs,987654)
  assert.equal(restored.state.startedAt,null)
  assert.equal(restored.state.pauseReason,'recovery')
  assert.ok(restored.backup);assert.ok(restored.notice)
  assert.equal(restoreTimer(raw,true).state.mode,'finished')
  assert.equal(restoreTimer(JSON.stringify({mode:'paused',elapsedMs:12,startedAt:null})).state.pauseReason,'manual')
})
test('corrupt/unknown/nonfinite snapshots are preserved for recovery without inventing history', () => {
  for (const raw of ['{','{"version":99}', '{"mode":"running","elapsedMs":1e999}', '{"mode":"running","elapsedMs":"123"}', JSON.stringify({version:2,mode:'paused',elapsedMs:-1,pauseReason:'automatic'})]) {
    const r = restoreTimer(raw)
    assert.equal(r.state,null);assert.ok(r.notice);assert.ok(r.backup)
  }
})

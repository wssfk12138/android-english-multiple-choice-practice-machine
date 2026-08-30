import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const player = await readFile(new URL('../src/components/ListeningPlayer.vue', import.meta.url), 'utf8')
const practice = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.ok(player.includes('playbackStart: []'))
assert.ok(player.includes('function onPlay()'))
assert.ok(player.includes("emit('playbackStart')"))
assert.ok(player.includes("@click=\"emit('locateQuestion')\""))
assert.ok(player.includes('{{ answeredCount }} / {{ questionCount }} 已完成'))
assert.ok(practice.includes('function syncCurrentListeningQuestion()'))
assert.ok(practice.includes('async function advanceListeningQuestion(answeredQuestionId: number)'))
assert.ok(practice.includes('if (isListening.value) await advanceListeningQuestion(question.id)'))
assert.ok(practice.includes('@playback-start="currentListeningQuestion && focusListeningQuestion'))
assert.ok(practice.includes('@locate-question="currentListeningQuestion && focusListeningQuestion'))
assert.ok(styles.includes('html[data-platform="android"] .listening-current'))

console.log('PASS listening playback and current-question linkage contract')

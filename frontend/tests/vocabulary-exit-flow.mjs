import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const practice = await readFile(new URL('../src/views/PracticeView.vue', import.meta.url), 'utf8')
const vocabulary = await readFile(new URL('../src/views/VocabularyView.vue', import.meta.url), 'utf8')
const localApi = await readFile(new URL('../src/platform/android/local-api.ts', import.meta.url), 'utf8')
const assistant = await readFile(new URL('../src/components/AiAssistant.vue', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

assert.match(practice, /practiceExitTranslation\s*=\s*flushVocabularyTranslations\('practice_exit'\)/)
assert.match(practice, /onBeforeRouteLeave\(async \(\) => \{\s*await flushVocabularyOnPracticeExit\(\)/s)
assert.match(practice, /onBeforeUnmount\(\(\) => \{[\s\S]*void flushVocabularyOnPracticeExit\(\)/)
assert.match(vocabulary, /trigger:\s*'vocabulary_open'/)
assert.match(vocabulary, /setInterval\(refreshTranslationStatuses, 2500\)/)
assert.match(localApi, /trigger === 'practice_exit' \|\| trigger === 'vocabulary_open'/)
assert.match(localApi, /queueAndStartVocabularyTranslations\(\[id\]\)/)
assert.match(assistant, /class="ai-history-dismiss-area"/)
assert.match(styles, /html\[data-platform="android"\] \.ai-history-dismiss-area/)

console.log('PASS vocabulary exit translation and portrait AI history contracts')

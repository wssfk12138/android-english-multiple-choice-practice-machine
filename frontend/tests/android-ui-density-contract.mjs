import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sourceFiles = [
  '../src/App.vue',
  '../src/components/AiAssistant.vue',
  '../src/components/ListeningPlayer.vue',
  '../src/views/AndroidUpdatesView.vue',
  '../src/views/DashboardView.vue',
  '../src/views/HelpView.vue',
  '../src/views/ImportView.vue',
  '../src/views/LibraryView.vue',
  '../src/views/MobileSettingsView.vue',
  '../src/views/NotesHubView.vue',
  '../src/views/PracticeView.vue',
  '../src/views/SettingsView.vue',
  '../src/views/TrashView.vue',
  '../src/views/VocabularyView.vue',
  '../src/views/WrongView.vue',
]

const [styles, library, ...sources] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/views/LibraryView.vue', import.meta.url), 'utf8'),
  ...sourceFiles.map(file => readFile(new URL(file, import.meta.url), 'utf8')),
])
const source = sources.join('\n')

const decorativeEyebrows = [
  'YOUR QUIET STUDY SPACE', 'VOCABULARY REVIEW', 'QUESTION LIBRARY',
  'IMPORT & REVIEW', 'AI LABELING', 'SETTINGS', 'HELP &amp; FEEDBACK',
  'ANSWER SHEET', 'UNIT COMPLETE', 'PAPER COMPLETE', 'FOCUS TIMER',
  'TAKE A BREATH', 'WRONG ANSWERS', 'AI REVIEW', 'REVIEW MAP',
  'VOCABULARY BOOK', 'STUDY NOTES', 'RECYCLE BIN', 'MODEL WORKSPACE',
  'QUESTION INTELLIGENCE', 'MANUAL REVIEW', 'NEW CONNECTION',
  'ANDROID DELIVERY', 'DOCUMENTATION', 'AI STUDY COMPANION',
  'Listening practice', 'UPDATE COMPLETE',
]
for (const label of decorativeEyebrows) assert.ok(!source.includes(label), label)

assert.ok(!library.includes('长按试卷或点击“批量管理”'))
assert.ok(!library.includes('完成整年45道客观题后统一判分，中途自动保存。'))
assert.ok(library.includes('v-if="batchMode" class="lead">已选择 {{ selectedIds.size }} 套试卷'))
assert.ok(source.includes('class="eyebrow">{{ activeUnit.year }} · {{ activeUnit.title }}'))
assert.ok(source.includes('v-if="selected.is_frequent" class="eyebrow">高频词'))

const portraitGuardStart = styles.lastIndexOf('Keep smart-label actions readable on narrow portrait phones.')
assert.ok(portraitGuardStart > styles.length * 0.9)
const portraitGuard = styles.slice(portraitGuardStart)
assert.ok(portraitGuard.includes('Keep smart-label actions readable on narrow portrait phones.'))
assert.match(portraitGuard, /\.label-center \.review-actions \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/)
assert.match(portraitGuard, /\.label-center \.review-actions \.button \{[\s\S]*width: 100%[\s\S]*white-space: normal/)

console.log('Android UI density contract tests passed')

import { chatCompletion } from './ai'
import { row, rows, run, transaction } from './database'
import { extractDocument, type ExtractedDocument } from './document-extractor'
import { LocalApiError } from './errors'
import { activeQuestionBankProfileId } from './question-bank-profiles'

type JsonRecord = Record<string, any>

const OPTION_RE = /(?:\[|\(|（|【|(?<![A-Za-z]))\s*([A-Ha-h])\s*(?:\]|\)|）|】|[.．、,])\s*/g
const QUESTION_RE = /^\s*([1-5]?\d)\s*[.．、)]\s*(.+)$/s

function clean(value: unknown): string {
  return String(value || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\u00a0|\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function findIndex(blocks: string[], pattern: RegExp, start = 0): number {
  for (let index = start; index < blocks.length; index++) {
    pattern.lastIndex = 0
    if (pattern.test(blocks[index])) return index
  }
  return -1
}

function splitOptions(value: string): Array<{ key: string; content: string }> {
  const text = clean(value)
  const matches = [...text.matchAll(OPTION_RE)]
  if (!matches.length) return []
  // Reading papers often place one option on each paragraph. Accept a single
  // marker only when it starts the block; inline prose such as "plan A." is
  // still rejected by the position guard.
  if (matches.length === 1 && (matches[0].index || 0) > 2) return []
  return matches.map((match, index) => ({
    key: String(match[1]).toUpperCase(),
    content: clean(text.slice(
      (match.index || 0) + match[0].length,
      index + 1 < matches.length ? matches[index + 1].index : text.length,
    )),
  })).filter(option => option.content)
}

function answerMap(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of text.matchAll(/(?<!\d)([1-5]?\d)\s*[.．、:：]\s*([A-HT])(?=\s|$|\d|[.,，。])/gi)) {
    const number = Number(match[1])
    if (number >= 1 && number <= 45) result[String(number)] = match[2].toUpperCase()
  }
  const rangePattern = /(?:Text\s*[1-4]\s*|(?<![A-Za-z0-9]))([1-4]?\d)\s*[-~～至–—]\s*([1-4]?\d)\s*[:：]?\s*([\s\S]*?)(?=Text\s*[1-4]\s*[1-4]?\d\s*[-~～至–—]\s*[1-4]?\d|(?<![A-Za-z0-9])[1-4]?\d\s*[-~～至–—]\s*[1-4]?\d|Part\s+[BC]|Section\s+[ⅠⅡⅢIV1234]|$)/gi
  for (const match of text.matchAll(rangePattern)) {
    const first = Number(match[1])
    const last = Number(match[2])
    const letters = String(match[3]).toUpperCase().match(/[A-HT]/g) || []
    if (last - first + 1 !== letters.length) continue
    letters.forEach((letter, index) => { result[String(first + index)] = letter })
  }
  const compact = text.replace(/\s+/g, '').toUpperCase()
  for (const match of compact.matchAll(/(?<!\d)([1-4]?\d)[-~～至–—]([1-4]?\d)[:：]?([A-HT]{2,20})/g)) {
    const first = Number(match[1])
    const last = Number(match[2])
    if (last - first + 1 !== match[3].length) continue
    ;[...match[3]].forEach((letter, index) => { result[String(first + index)] = letter })
  }
  // PDF text layers sometimes emit two range headings first and their answer
  // strings on following lines:
  //   21-25:
  //   26-30:
  //   CBDDA
  //   CCDBC
  // Preserve order and pair these blocks instead of losing the second range.
  const pendingRanges: Array<{ first: number; last: number }> = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = clean(rawLine).toUpperCase()
    const range = line.match(/^([1-4]?\d)\s*[-~～至–—]\s*([1-4]?\d)\s*[:：]?\s*$/)
    if (range) {
      pendingRanges.push({ first: Number(range[1]), last: Number(range[2]) })
      continue
    }
    const letters = line.replace(/[^A-HT]/g, '')
    const pending = pendingRanges[0]
    if (!pending || letters.length !== pending.last - pending.first + 1) continue
    pendingRanges.shift()
    ;[...letters].forEach((letter, index) => { result[String(pending.first + index)] = letter })
  }
  return result
}

function ensureBlanks(passage: string, first: number, last: number): string {
  let cursor = 0
  for (let number = first; number <= last; number++) {
    const pattern = new RegExp(`(?<![\\d_])(?:\\(\\s*)?${number}(?:\\s*\\))?(?:\\s*_{2,})?(?![\\d_])`, 'g')
    pattern.lastIndex = cursor
    const match = pattern.exec(passage)
    if (!match || match.index == null) continue
    const replacement = `${number} ______`
    passage = passage.slice(0, match.index) + replacement + passage.slice(match.index + match[0].length)
    cursor = match.index + replacement.length
  }
  return passage.replace(/(?<=[A-Za-z])\n\n(?=[a-z])/g, ' ')
}

function parseCompactClozeOptions(text: string): Array<Array<{ key: string; content: string }>> {
  const normalized = clean(text)
  const starts = [...normalized.matchAll(/(?<!\d)([1-9]|1\d|20)\s*[.．、]\s*/g)]
  const byNumber = new Map<number, Array<{ key: string; content: string }>>()
  starts.forEach((start, index) => {
    const number = Number(start[1])
    const end = index + 1 < starts.length ? starts[index + 1].index! : normalized.length
    const options = splitOptions(normalized.slice(start.index! + start[0].length, end))
    if (options.length === 4 && options.map(option => option.key).join('') === 'ABCD') {
      byNumber.set(number, options)
    }
  })

  let runStart = 21
  for (let number = 1; number <= 20; number++) {
    if (Array.from({ length: 21 - number }, (_, index) => number + index)
      .every(candidate => byNumber.has(candidate))) {
      runStart = number
      break
    }
  }
  if (runStart > 1) {
    const anchor = starts.find(match => Number(match[1]) === runStart)?.index ?? normalized.length
    const prefixOptions = splitOptions(normalized.slice(0, anchor))
    const missingCount = runStart - 1
    if (prefixOptions.length === missingCount * 4) {
      const labels = prefixOptions.map(option => option.key)
      const columnMajor = ['A', 'B', 'C', 'D']
        .flatMap(key => Array.from({ length: missingCount }, () => key))
      if (labels.join('') === columnMajor.join('')) {
        for (let questionIndex = 0; questionIndex < missingCount; questionIndex++) {
          byNumber.set(questionIndex + 1, Array.from({ length: 4 }, (_, column) => ({
            key: String.fromCharCode(65 + column),
            content: prefixOptions[column * missingCount + questionIndex].content,
          })))
        }
      } else {
        for (let questionIndex = 0; questionIndex < missingCount; questionIndex++) {
          const chunk = prefixOptions.slice(questionIndex * 4, questionIndex * 4 + 4)
          if (chunk.map(option => option.key).join('') === 'ABCD') {
            byNumber.set(questionIndex + 1, chunk)
          }
        }
      }
    }
  }
  if (byNumber.size === 20) {
    return Array.from({ length: 20 }, (_, index) => byNumber.get(index + 1)!)
  }

  const flat = splitOptions(normalized)
  if (flat.length === 80) {
    const groups = Array.from({ length: 20 }, (_, index) => flat.slice(index * 4, index * 4 + 4))
    if (groups.every(group => group.map(option => option.key).join('') === 'ABCD')) return groups
  }
  return []
}

function parseCloze(blocks: string[], answers: Record<string, string>): JsonRecord {
  const start = findIndex(blocks, /Section\s*[ⅠI1]\s*Use\s+of\s+English/i)
  const reading = findIndex(blocks, /Section\s*[ⅡI2]\s*Reading\s+Comprehension|Reading\s+Comprehension/i, Math.max(start, 0))
  const section = blocks.slice(Math.max(0, start + 1), reading > start ? reading : blocks.length)
  const content = section.filter(text =>
    !/^(Directions:|Part [ABC]|Section )/i.test(text)
    && !/Choose the best word/i.test(text))
  const optionBlock = [...content].sort((left, right) =>
    [...right.matchAll(OPTION_RE)].length - [...left.matchAll(OPTION_RE)].length)[0] || ''
  const compactGroups = parseCompactClozeOptions(optionBlock)
  if (compactGroups.length === 20) {
    return {
      unit_type: 'cloze',
      subtype: 'cloze',
      title: '完型填空',
      sequence: 1,
      passage: ensureBlanks(content.filter(text => text !== optionBlock).join('\n\n'), 1, 20),
      shared_data: {},
      questions: compactGroups.map((options, index) => {
        const number = index + 1
        return {
          number,
          stem: '',
          options,
          answer: answers[String(number)] || '',
          score: 0.5,
        }
      }),
    }
  }
  const optionRows = new Map<number, Array<{ key: string; content: string }>>()
  const optionIndexes = new Set<number>()
  section.forEach((text, index) => {
    const match = text.match(/^\s*([1-9]|1\d|20)\s*[.．、]\s*/)
    if (!match) return
    const options = splitOptions(text.slice(match[0].length))
    if (options.length === 4) {
      optionRows.set(Number(match[1]), options)
      optionIndexes.add(index)
    }
  })
  const passage = ensureBlanks(
    section
      .filter((text, index) =>
        !optionIndexes.has(index)
        && !/^(Directions:|Part [ABC]|Section )/i.test(text)
        && !/Choose the best word/i.test(text),
      )
      .join('\n\n'),
    1,
    20,
  )
  return {
    unit_type: 'cloze',
    subtype: 'cloze',
    title: '完型填空',
    sequence: 1,
    passage,
    shared_data: {},
    questions: Array.from({ length: 20 }, (_, index) => {
      const number = index + 1
      return {
        number,
        stem: '',
        options: optionRows.get(number) || [],
        answer: answers[String(number)] || '',
        score: 0.5,
      }
    }),
  }
}

function unlabeledQuestionGroups(
  segment: string[],
  firstNumber: number,
): { passage: string; questions: JsonRecord[] } {
  const content = segment.filter(text => !/^(Directions:|Part [ABC]|Section )/i.test(text))
  if (content.length < 25) return { passage: content.join('\n\n'), questions: [] }
  const tail = content.slice(-25)
  return {
    passage: content.slice(0, -25).join('\n\n'),
    questions: Array.from({ length: 5 }, (_, index) => {
      const offset = index * 5
      return {
        number: firstNumber + index,
        stem: tail[offset],
        options: tail.slice(offset + 1, offset + 5).map((option, optionIndex) => ({
          key: String.fromCharCode(65 + optionIndex),
          content: option,
        })),
      }
    }),
  }
}

function readingMarkers(blocks: string[]) {
  return blocks
    .map((text, index) => ({ index, match: text.match(/^\s*Text\s*([1-4lI])\s*$/i) }))
    .filter(item => item.match)
    .map(item => ({
      index: item.index,
      number: ['l', 'i'].includes(String(item.match![1]).toLowerCase())
        ? 1 : Number(item.match![1]),
    }))
}

function parseReading(blocks: string[], answers: Record<string, string>): JsonRecord[] {
  const markers = readingMarkers(blocks).slice(0, 4)
  const partB = findIndex(blocks, /^\s*Part\s*B\s*$/i)
  return markers.map((marker, markerOffset) => {
    const end = markers[markerOffset + 1]?.index
      ?? (partB > marker.index ? partB : blocks.length)
    const segment = blocks.slice(marker.index + 1, end)
    const firstNumber = 21 + (marker.number - 1) * 5
    const expected = new Set(Array.from({ length: 5 }, (_, index) => firstNumber + index))
    const questions: JsonRecord[] = []
    const passage: string[] = []
    let current: JsonRecord | null = null
    let started = false
    for (const text of segment) {
      const match = text.match(QUESTION_RE)
      if (match && expected.has(Number(match[1]))) {
        started = true
        if (current) questions.push(current)
        const remainder = clean(match[2])
        const options = splitOptions(remainder)
        current = {
          number: Number(match[1]),
          stem: options.length ? clean(remainder.slice(0, remainder.search(OPTION_RE))) : remainder,
          options,
        }
        continue
      }
      const options = splitOptions(text)
      if (current && options.length) current.options.push(...options)
      else if (!started && !/^(Directions:|Part [ABC]|Section )/i.test(text)) passage.push(text)
    }
    if (current) questions.push(current)
    let finalPassage = passage.join('\n\n')
    let finalQuestions = questions
    if (questions.length !== 5 || questions.some(question => question.options.length !== 4)) {
      const fallback = unlabeledQuestionGroups(segment, firstNumber)
      finalPassage = fallback.passage
      finalQuestions = fallback.questions
    }
    for (const question of finalQuestions) {
      question.answer = answers[String(question.number)] || ''
      question.score = 2
    }
    return {
      unit_type: 'reading',
      subtype: 'reading_a',
      title: `阅读 Text ${marker.number}`,
      sequence: marker.number + 1,
      passage: finalPassage,
      shared_data: {},
      questions: finalQuestions,
    }
  })
}

function hasObjectivePartB(blocks: string[]): boolean {
  const index = findIndex(blocks, /^\s*Part\s*B\s*$/i)
  if (index < 0) return false
  const context = blocks.slice(index, index + 6).join(' ').toLowerCase()
  if (/translate\s+the\s+underlined|translation/.test(context)) return false
  return /questions?.*?41.*?45|list\s+a|extra\s+choices|wrong\s+order|reorganize|subheading|true\s+or\s+false|choose\s+t\s+if/.test(context)
}

function readingPartBBounds(blocks: string[]): { partB: number; sectionEnd: number } {
  let reading = findIndex(blocks, /Section\s*(?:II|Ⅱ|2)\s*Reading\s+Comprehension/i)
  if (reading < 0) reading = findIndex(blocks, /Reading\s+Comprehension/i)
  const partB = findIndex(blocks, /^\s*Part\s*B\s*$/i, Math.max(reading, 0))
  const sectionEnd = findIndex(
    blocks,
    /^\s*Section\s*(?:III|Ⅲ|3)\s*(?:Translation)?\s*$/i,
    Math.max(partB + 1, 0),
  )
  return { partB, sectionEnd }
}

function parseTrueFalsePartB(
  blocks: string[],
  answers: Record<string, string>,
  partB: number,
  sectionEnd: number,
): JsonRecord {
  const section = blocks.slice(partB + 1, sectionEnd)
  const directions: string[] = []
  let contentStart = 0
  for (let index = 0; index < section.length; index++) {
    const text = section[index]
    if (index === 0 && /^\s*Directions:\s*$/i.test(text)) {
      directions.push(text)
      contentStart = index + 1
      continue
    }
    if (directions.length && /true\s+or\s+false|choose\s+T|ANSWER\s+SHEET|questions?/i.test(text)) {
      directions.push(text)
      contentStart = index + 1
      continue
    }
    break
  }
  const content = section.slice(contentStart)
    .filter(text => !/^(Directions:|Part [ABC]|Section )/i.test(text))
  const statements = content.length >= 5 ? content.slice(-5) : []
  const passage = content.length >= 5 ? content.slice(0, -5) : content
  const options = [{ key: 'T', content: 'True' }, { key: 'F', content: 'False' }]
  return {
    unit_type: 'part_b',
    subtype: 'true_false',
    title: '阅读 Part B（判断题）',
    sequence: 6,
    passage: passage.join('\n\n'),
    shared_data: { directions: clean(directions.join(' ')), candidates: {} },
    questions: Array.from({ length: 5 }, (_, index) => {
      const number = 41 + index
      return {
        number,
        stem: statements[index] || '',
        options: options.map(option => ({ ...option })),
        answer: answers[String(number)] || '',
        score: 2,
      }
    }),
  }
}

function parsePartB(blocks: string[], answers: Record<string, string>): JsonRecord {
  const bounds = readingPartBBounds(blocks)
  if (bounds.partB >= 0 && bounds.sectionEnd > bounds.partB) {
    const context = blocks.slice(bounds.partB, Math.min(bounds.sectionEnd, bounds.partB + 4)).join(' ')
    if (/true\s+or\s+false|choose\s+t\s+if/i.test(context)) {
      return parseTrueFalsePartB(blocks, answers, bounds.partB, bounds.sectionEnd)
    }
  }
  const partB = findIndex(blocks, /^\s*Part\s*B\s*$/i)
  const partC = findIndex(blocks, /^\s*Part\s*C(?:\s+Directions:)?\s*$/i, Math.max(0, partB + 1))
  const section = blocks.slice(partB + 1, partC > partB ? partC : blocks.length)
  const directionEnd = Math.min(
    section.length,
    Math.max(1, section.findIndex(text => /^\s*\[?[A-H]\]?/.test(text))),
  )
  const direction = clean(section.slice(0, directionEnd).join(' '))
  const candidates: Record<string, string> = {}
  const material: string[] = []
  for (const text of section.slice(directionEnd)) {
    const match = text.match(/^\s*\[([A-H])\]\s*(.*)$/is)
    if (match) candidates[match[1].toUpperCase()] = clean(match[2])
    else if (!/^(Directions:|Part [ABC]|Section )/i.test(text)) material.push(text)
  }
  if (Object.keys(candidates).length < 7) {
    const candidateCount = /wrong order|reorganize/i.test(direction) ? 8 : 7
    const tail = material.slice(-candidateCount)
    if (tail.length === candidateCount) {
      tail.forEach((text, index) => { candidates[String.fromCharCode(65 + index)] = text })
      material.splice(material.length - candidateCount, candidateCount)
    }
  }
  const subtype = /wrong order|reorganize/i.test(direction)
    ? 'paragraph_reordering'
    : /subheading/i.test(direction)
      ? 'heading_matching'
      : /people|person|comments|name/i.test(direction)
        ? 'opinion_matching'
        : /paragraphs from the list/i.test(direction)
          ? 'paragraph_insertion'
          : 'sentence_insertion'
  const options = Object.entries(candidates).map(([key, content]) => ({ key, content }))
  return {
    unit_type: 'part_b',
    subtype,
    title: '阅读 Part B',
    sequence: 6,
    passage: ensureBlanks(material.join('\n\n'), 41, 45),
    shared_data: { directions: direction, candidates },
    questions: Array.from({ length: 5 }, (_, index) => {
      const number = 41 + index
      return {
        number,
        stem: `位置 ${number}`,
        options,
        answer: answers[String(number)] || '',
        score: 2,
      }
    }),
  }
}

function expectedNumbers(draft: JsonRecord): number[] {
  return draft.units.flatMap((unit: JsonRecord) =>
    unit.questions.map((question: JsonRecord) => Number(question.number)),
  ).sort((left: number, right: number) => left - right)
}

function applyAnswers(draft: JsonRecord) {
  for (const unit of draft.units) {
    for (const question of unit.questions) {
      const answer = String(draft.answers[String(question.number)] || '').toUpperCase()
      draft.answers[String(question.number)] = answer
      question.answer = answer
    }
  }
}

export function validateDocumentDraft(draft: JsonRecord): string[] {
  const warnings: string[] = []
  applyAnswers(draft)
  const numbers = expectedNumbers(draft)
  const missing = numbers.filter(number => !draft.answers[String(number)])
  if (missing.length) warnings.push(`缺少标准答案：${missing.join('、')}`)
  if (draft.answer_status?.status === 'parsed' && !draft.answers_confirmed) {
    warnings.push('自动识别的标准答案尚未人工确认')
  }
  const cloze = draft.units.find((unit: JsonRecord) => unit.unit_type === 'cloze')
  if (!cloze || cloze.questions.length !== 20) warnings.push('完型填空未识别为20题')
  else {
    const bad = cloze.questions.filter((question: JsonRecord) => question.options.length !== 4)
    if (bad.length) warnings.push(`完型填空选项数量异常：${bad.map((item: JsonRecord) => item.number).join('、')}`)
  }
  const readings = draft.units.filter((unit: JsonRecord) => unit.unit_type === 'reading')
  if (readings.length !== 4) warnings.push(`阅读文章应为4篇，当前为${readings.length}篇`)
  for (const unit of readings) {
    if (unit.questions.length !== 5) warnings.push(`${unit.title} 未识别为5题`)
    for (const question of unit.questions) {
      if (question.options.length !== 4) warnings.push(`第${question.number}题选项数量不是4`)
    }
  }
  for (const unit of draft.units) {
    for (const question of unit.questions) {
      if (question.answer && !question.options.some((option: JsonRecord) => option.key === question.answer)) {
        warnings.push(`第${question.number}题答案未对应现有选项`)
      }
    }
  }
  const partB = draft.units.find((unit: JsonRecord) => unit.unit_type === 'part_b')
  if (partB) {
    if (partB.questions.length !== 5) warnings.push('Part B 未识别为5题')
    const candidateCount = Object.keys(partB.shared_data?.candidates || {}).length
    if (partB.subtype !== 'true_false' && (candidateCount < 7 || candidateCount > 8)) {
      warnings.push(`Part B 候选项数量异常：${candidateCount}`)
    }
  }
  return [...new Set(warnings)]
}

export function parseExtractedExam(
  fileName: string,
  source: ExtractedDocument,
  answerSource?: { fileName: string; extracted: ExtractedDocument },
): JsonRecord {
  const year = Number(fileName.match(/20\d{2}/)?.[0]
    || source.blocks.slice(0, 10).join(' ').match(/20\d{2}/)?.[0])
  const subjectHeader = [fileName, ...source.blocks.slice(0, 12)].join(' ')
  const subject = /英语\s*[\(（]?\s*二\s*[\)）]?|科目代码\s*[：:]?\s*204\b/.test(subjectHeader)
    ? '英语二' : '英语一'
  const embeddedAnswers = answerMap(source.text)
  const attachmentAnswers = answerSource?.extracted.hasTextLayer
    ? answerMap(answerSource.extracted.text) : {}
  const answers = { ...embeddedAnswers, ...attachmentAnswers }
  const embeddedAnswersConfirmed = !answerSource && Object.keys(embeddedAnswers).length > 0
  const units = [parseCloze(source.blocks, answers), ...parseReading(source.blocks, answers)]
  if (hasObjectivePartB(source.blocks)) {
    units.push(parsePartB(source.blocks, answers))
  }
  const draft: JsonRecord = {
    year: Number.isFinite(year) ? year : null,
    subject,
    title: Number.isFinite(year) ? `${year}年考研${subject}真题` : fileName.replace(/\.[^.]+$/, ''),
    detected_format: source.format,
    source_file: fileName,
    answer_source: answerSource?.fileName || (Object.keys(embeddedAnswers).length ? '试卷内置答案' : '未提供'),
    answer_status: {
      status: embeddedAnswersConfirmed ? 'confirmed' : Object.keys(answers).length ? 'parsed' : 'missing',
      message: Object.keys(answers).length
        ? embeddedAnswersConfirmed
          ? `已从试卷 Word 识别 ${Object.keys(answers).length} 道答案`
          : `已识别 ${Object.keys(answers).length} 道答案，请发布前核对`
        : answerSource && !answerSource.extracted.hasTextLayer
          ? '答案 PDF 未检测到可靠文字层，请人工录入答案'
          : '未识别出标准答案，请人工录入',
    },
    answers_confirmed: embeddedAnswersConfirmed,
    answer_sources: Object.fromEntries(
      Object.keys(answers).map(number => [number, answerSource?.fileName || '试卷内置答案']),
    ),
    answers,
    units,
    source_text: source.text.slice(0, 60000),
    answer_text: answerSource?.extracted.text.slice(0, 20000) || '',
  }
  draft.warnings = validateDocumentDraft(draft)
  return draft
}

function parseModelJson(content: string): JsonRecord {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced || content).trim()
  try { return JSON.parse(candidate) } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new LocalApiError(400, '模型没有返回有效 JSON')
  }
}

async function modelIdentity(profileId?: number, model?: string) {
  const profile = profileId
    ? await row<JsonRecord>('SELECT * FROM ai_profiles WHERE id = ? AND enabled = 1', [profileId])
    : await row<JsonRecord>(
      `SELECT * FROM ai_profiles WHERE enabled = 1 AND TRIM(default_model) <> ''
       ORDER BY is_default DESC, id LIMIT 1`,
    )
  if (!profile) throw new LocalApiError(400, '请先配置并启用一个模型')
  const selectedModel = String(model || profile.default_model || '').trim()
  if (!selectedModel) throw new LocalApiError(400, '请选择用于导入校对的模型')
  return { profile, selectedModel }
}

function draftSummary(draft: JsonRecord) {
  return {
    year: draft.year,
    expected_numbers: expectedNumbers(draft),
    units: draft.units.map((unit: JsonRecord) => ({
      unit_type: unit.unit_type,
      title: unit.title,
      questions: unit.questions.map((question: JsonRecord) => ({
        number: question.number,
        stem: String(question.stem || '').slice(0, 300),
        options: question.options.map((option: JsonRecord) => ({
          key: option.key,
          content: String(option.content || '').slice(0, 240),
        })),
        answer: question.answer,
      })),
    })),
    answers_found_locally: draft.answers,
  }
}

export async function applyDocumentModelAssist(
  draft: JsonRecord,
  options: { profile_id?: number; model?: string; correct_structure?: boolean } = {},
): Promise<JsonRecord> {
  const { profile, selectedModel } = await modelIdentity(options.profile_id, options.model)
  const prompt = `你是考研英语真题导入解析助手。只能依据材料校对，不得编造。
输出 JSON：{"answer_map":{"1":"A"},"number_map":{},"question_fixes":[],"issues":[],"notes":""}。
answer_map 必须尽可能覆盖本次全部客观题。若 Part B 是翻译题，不要导入 41-45，也不要报缺失。
普通选择题答案使用 A-H；判断题答案使用 T/F。
number_map 只在题号明确错位时填写。${
  options.correct_structure
    ? '允许 question_fixes 修正题干和选项归属，格式为 {"number":21,"stem":"...","options":[{"key":"A","content":"..."}]}。'
    : 'question_fixes 必须为空数组，不允许修改题干或选项。'
}
只输出合法 JSON，不写解析或翻译。`
  const content = await chatCompletion(
    Number(profile.id),
    selectedModel,
    [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          document_text: String(draft.source_text || '').slice(0, 60000),
          answer_text: String(draft.answer_text || '').slice(0, 20000),
          draft_summary: draftSummary(draft),
        }),
      },
    ],
    { maxTokens: Math.max(8000, Number(profile.max_tokens || 0)), responseFormat: { type: 'json_object' } },
  )
  const result = parseModelJson(content)
  const questionRows = draft.units.flatMap((unit: JsonRecord) =>
    unit.questions.map((question: JsonRecord) => ({ unit, question })),
  )
  const numberMap = result.number_map && typeof result.number_map === 'object'
    ? result.number_map : {}
  const proposed = questionRows.map(({ unit, question }: JsonRecord) => {
    const oldNumber = String(question.number)
    const next = Number(numberMap[oldNumber])
    const allowed = unit.unit_type === 'cloze'
      ? next >= 1 && next <= 20
      : unit.unit_type === 'reading'
        ? next >= 21 && next <= 40
        : unit.unit_type === 'part_b'
          ? next >= 41 && next <= 45
          : next >= 1 && next <= 45
    return Number.isInteger(next) && allowed ? next : Number(question.number)
  })
  let appliedNumberFixes = 0
  if (new Set(proposed).size === proposed.length) {
    const remappedAnswers: Record<string, string> = {}
    const remappedSources: Record<string, string> = {}
    questionRows.forEach(({ question }: JsonRecord, index: number) => {
      const oldNumber = String(question.number)
      const nextNumber = proposed[index]
      if (Number(oldNumber) !== nextNumber) appliedNumberFixes++
      question.number = nextNumber
      if (draft.answers[oldNumber]) remappedAnswers[String(nextNumber)] = draft.answers[oldNumber]
      if (draft.answer_sources[oldNumber]) remappedSources[String(nextNumber)] = draft.answer_sources[oldNumber]
    })
    draft.answers = { ...draft.answers, ...remappedAnswers }
    draft.answer_sources = { ...draft.answer_sources, ...remappedSources }
  }
  const validNumbers = new Set(expectedNumbers(draft).map(String))
  let appliedAnswers = 0
  for (const [number, answer] of Object.entries(result.answer_map || {})) {
    const letter = String(answer).trim().toUpperCase()
    if (!validNumbers.has(String(number)) || !/^[A-HT]$/.test(letter)) continue
    draft.answers[String(number)] = letter
    draft.answer_sources[String(number)] = '模型辅助'
    appliedAnswers++
  }
  let appliedFixes = 0
  if (options.correct_structure && Array.isArray(result.question_fixes)) {
    for (const fix of result.question_fixes) {
      const target = draft.units
        .flatMap((unit: JsonRecord) => unit.questions)
        .find((question: JsonRecord) => String(question.number) === String(fix?.number))
      if (!target) continue
      if (String(fix.stem || '').trim()) target.stem = String(fix.stem).trim()
      if (Array.isArray(fix.options)
        && fix.options.length === target.options.length
        && fix.options.every((option: JsonRecord) => option?.key && option?.content)) {
        target.options = fix.options.map((option: JsonRecord) => ({
          key: String(option.key).trim().toUpperCase(),
          content: String(option.content).trim(),
        }))
      }
      appliedFixes++
    }
  }
  applyAnswers(draft)
  const issues = Array.isArray(result.issues)
    ? result.issues.map((item: unknown) => clean(item)).filter(Boolean).slice(0, 20) : []
  draft.model_assist = {
    status: 'applied',
    applied_answers: appliedAnswers,
    applied_fixes: appliedFixes,
    applied_number_fixes: appliedNumberFixes,
    answer_total: Object.values(draft.answers).filter(Boolean).length,
    issues,
    issue_count: issues.length,
    notes: clean(result.notes).slice(0, 300),
    model_name: selectedModel,
    applied_at: new Date().toISOString(),
  }
  draft.answers_confirmed = validNumbers.size > 0
    && [...validNumbers].every(number => Boolean(draft.answers[number]))
    && issues.length === 0
  if (draft.answers_confirmed) {
    draft.answer_source = '模型辅助'
    draft.answer_status = { status: 'confirmed', message: '模型已完成答案与题目结构校对' }
  }
  draft.warnings = validateDocumentDraft(draft)
  for (const issue of issues) draft.warnings.push(`[模型辅助] ${issue}`)
  return draft
}

function jobPayload(job: JsonRecord) {
  const draft = JSON.parse(job.draft_data || '{}')
  delete draft.source_text
  delete draft.answer_text
  return {
    ...job,
    draft_data: draft,
    warnings: JSON.parse(job.warnings || '[]'),
    published_paper_ids: JSON.parse(job.published_paper_ids || '[]'),
    published_scope_title: job.published_scope_title || '',
  }
}

export async function listDocumentImports(): Promise<JsonRecord[]> {
  const profileId = await activeQuestionBankProfileId()
  const jobs = await rows<JsonRecord>(
    `SELECT id, profile_id, filename, detected_year, detected_format, status, warnings,
       published_paper_ids, published_scope_title, created_at, updated_at
     FROM document_import_jobs
     WHERE profile_id = ? AND deleted_at IS NULL
     ORDER BY id DESC`,
    [profileId],
  )
  return jobs.map(job => ({
    ...job,
    warnings: JSON.parse(job.warnings || '[]'),
    published_paper_ids: JSON.parse(job.published_paper_ids || '[]'),
  }))
}

export async function readDocumentImport(id: number): Promise<JsonRecord> {
  const job = await row<JsonRecord>('SELECT * FROM document_import_jobs WHERE id = ? AND deleted_at IS NULL', [id])
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  return jobPayload(job)
}

export async function createDocumentImport(form: FormData): Promise<JsonRecord> {
  const file = form.get('file')
  const answerFile = form.get('answer_file')
  if (!(file instanceof File) || !/\.(?:doc|docx)$/i.test(file.name)) {
    throw new LocalApiError(400, '请选择 DOC 或 DOCX 试卷文件')
  }
  if (answerFile && (!(answerFile instanceof File) || !/\.(?:doc|docx|pdf)$/i.test(answerFile.name))) {
    throw new LocalApiError(400, '答案文件仅支持 DOC、DOCX 或 PDF')
  }
  const source = await extractDocument(file)
  const answerSource = answerFile instanceof File
    ? { fileName: answerFile.name, extracted: await extractDocument(answerFile) } : undefined
  let draft = parseExtractedExam(file.name, source, answerSource)
  const profileId = Number(form.get('profile_id') || 0) || await activeQuestionBankProfileId()
  const toBase64 = async (input: File) => {
    const bytes = new Uint8Array(await input.arrayBuffer())
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return btoa(binary)
  }
  const requested = String(form.get('use_model_assist') || '') === 'true'
  if (requested) {
    try {
      draft = await applyDocumentModelAssist(draft, {
        correct_structure: String(form.get('model_assist_correct_structure') || '') === 'true',
      })
    } catch (cause) {
      draft.model_assist = {
        status: 'failed',
        error: String(cause).slice(0, 400),
        fell_back_to_local: true,
      }
    }
  }
  const created = await run(
    `INSERT INTO document_import_jobs
      (profile_id, filename, answer_filename, source_file_base64,
       answer_file_base64, detected_year, detected_format, status,
       draft_data, warnings)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    [
      profileId,
      file.name,
      answerFile instanceof File ? answerFile.name : '',
      await toBase64(file),
      answerFile instanceof File ? await toBase64(answerFile) : '',
      draft.year,
      draft.detected_format,
      JSON.stringify(draft),
      JSON.stringify(draft.warnings || []),
    ],
  )
  return {
    id: Number(created.lastId),
    filename: file.name,
    draft: Object.fromEntries(Object.entries(draft).filter(([key]) => !['source_text', 'answer_text'].includes(key))),
    warnings: draft.warnings,
    model_assist: draft.model_assist,
    profile_id: profileId,
  }
}

export async function updateDocumentImport(id: number, body: JsonRecord): Promise<JsonRecord> {
  const job = await row<JsonRecord>('SELECT * FROM document_import_jobs WHERE id = ?', [id])
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  if (job.status === 'published') throw new LocalApiError(409, '已发布题库不能修改')
  const existing = JSON.parse(job.draft_data)
  const incoming = body.draft_data || {}
  const draft = { ...existing, ...incoming, source_text: existing.source_text, answer_text: existing.answer_text }
  draft.warnings = validateDocumentDraft(draft)
  await run(
    `UPDATE document_import_jobs SET draft_data = ?, warnings = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(draft), JSON.stringify(draft.warnings), id],
  )
  return { draft: Object.fromEntries(Object.entries(draft).filter(([key]) => !['source_text', 'answer_text'].includes(key))), warnings: draft.warnings }
}

export async function retryDocumentModelAssist(id: number, body: JsonRecord): Promise<JsonRecord> {
  const job = await row<JsonRecord>('SELECT * FROM document_import_jobs WHERE id = ?', [id])
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  const draft = await applyDocumentModelAssist(JSON.parse(job.draft_data), body)
  await run(
    `UPDATE document_import_jobs SET draft_data = ?, warnings = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(draft), JSON.stringify(draft.warnings), id],
  )
  return { draft: Object.fromEntries(Object.entries(draft).filter(([key]) => !['source_text', 'answer_text'].includes(key))), warnings: draft.warnings, model_assist: draft.model_assist }
}

export async function updateDocumentAnswers(id: number, body: JsonRecord): Promise<JsonRecord> {
  const job = await row<JsonRecord>('SELECT * FROM document_import_jobs WHERE id = ?', [id])
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  const draft = JSON.parse(job.draft_data)
  const allowed = new Set(expectedNumbers(draft).map(String))
  for (const [number, value] of Object.entries(body.answers || {})) {
    const answer = String(value || '').trim().toUpperCase()
    if (!allowed.has(String(number)) || (answer && !/^[A-HT]$/.test(answer))) continue
    draft.answers[String(number)] = answer
    draft.answer_sources[String(number)] = '人工录入'
  }
  draft.answers_confirmed = true
  draft.answer_source = '人工录入/校对'
  draft.answer_status = { status: 'confirmed', message: '答案已人工确认' }
  draft.warnings = validateDocumentDraft(draft)
  await run(
    `UPDATE document_import_jobs SET draft_data = ?, warnings = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify(draft), JSON.stringify(draft.warnings), id],
  )
  return { draft: Object.fromEntries(Object.entries(draft).filter(([key]) => !['source_text', 'answer_text'].includes(key))), warnings: draft.warnings }
}

async function publishDraft(draft: JsonRecord, profileId: number): Promise<number> {
  let paperId = 0
  await transaction(async db => {
    const externalKey = `document:${draft.year}:${draft.subject || '英语一'}:${draft.title}`
    const existing = await db.query(
      `SELECT id FROM papers
       WHERE profile_id = ? AND external_key = ? AND deleted_at IS NULL LIMIT 1`,
      [profileId, externalKey],
    )
    paperId = Number(existing.values?.[0]?.id || 0)
    if (paperId) {
      await db.run('DELETE FROM papers WHERE id = ?', [paperId], false)
      paperId = 0
    }
    const paper = await db.run(
      `INSERT INTO papers (profile_id, external_key, year, subject, title, status)
       VALUES (?, ?, ?, ?, ?, 'published')`,
      [profileId, externalKey, draft.year, draft.subject || '英语一', draft.title],
      false,
    )
    paperId = Number(paper.changes?.lastId)
    for (const unit of draft.units) {
      const unitResult = await db.run(
        `INSERT INTO units
          (paper_id, external_key, unit_type, subtype, title, sequence, passage, shared_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paperId,
          `local-${draft.year}-unit-${unit.sequence}`,
          unit.unit_type,
          unit.subtype || '',
          unit.title,
          unit.sequence,
          unit.passage || '',
          JSON.stringify(unit.shared_data || {}),
        ],
        false,
      )
      const unitId = Number(unitResult.changes?.lastId)
      for (let index = 0; index < unit.questions.length; index++) {
        const question = unit.questions[index]
        const questionResult = await db.run(
          `INSERT INTO questions
            (unit_id, external_key, number, stem, question_type, answer, score, sequence)
           VALUES (?, ?, ?, ?, 'single_choice', ?, ?, ?)`,
          [
            unitId,
            `local-${draft.year}-q-${question.number}`,
            question.number,
            question.stem || '',
            question.answer,
            Number(question.score || 1),
            index + 1,
          ],
          false,
        )
        const questionId = Number(questionResult.changes?.lastId)
        for (let optionIndex = 0; optionIndex < question.options.length; optionIndex++) {
          const option = question.options[optionIndex]
          await db.run(
            `INSERT INTO options
              (question_id, stable_key, original_label, content, sequence)
             VALUES (?, ?, ?, ?, ?)`,
            [questionId, option.key, option.key, option.content, optionIndex + 1],
            false,
          )
        }
      }
    }
  })
  return paperId
}

export async function publishDocumentImport(id: number): Promise<JsonRecord> {
  const job = await row<JsonRecord>('SELECT * FROM document_import_jobs WHERE id = ?', [id])
  if (!job) throw new LocalApiError(404, '题库导入记录不存在')
  const draft = JSON.parse(job.draft_data)
  const warnings = validateDocumentDraft(draft)
  if (warnings.length) throw new LocalApiError(409, `仍有校验问题：${warnings.join('；')}`)
  const paperId = await publishDraft(draft, Number(job.profile_id))
  await run(
    `UPDATE document_import_jobs SET status = 'published',
      published_paper_ids = ?, published_scope_title = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [JSON.stringify([paperId]), draft.title, id],
  )
  return {
    published: true,
    paper_id: paperId,
    paper_ids: [paperId],
    scope_title: draft.title,
    question_count: expectedNumbers(draft).length,
    warnings: [],
  }
}

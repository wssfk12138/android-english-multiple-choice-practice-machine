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
  for (const match of text.matchAll(/(?<!\d)([1-5]?\d)\s*[.．、:：]\s*([A-OT])(?=\s|$|\d|[.,，。])/gi)) {
    const number = Number(match[1])
    if (number >= 1 && number <= 55) result[String(number)] = match[2].toUpperCase()
  }
  const rangePattern = /(?:Text\s*[1-4]\s*|(?<![A-Za-z0-9]))([1-5]?\d)\s*[-~～至–—]\s*([1-5]?\d)\s*[:：]?\s*([\s\S]*?)(?=Text\s*[1-4]\s*[1-5]?\d\s*[-~～至–—]\s*[1-5]?\d|(?<![A-Za-z0-9])[1-5]?\d\s*[-~～至–—]\s*[1-5]?\d|Part\s+[BC]|Section\s+[ⅠⅡⅢIV1234]|$)/gi
  for (const match of text.matchAll(rangePattern)) {
    const first = Number(match[1])
    const last = Number(match[2])
    const letters = String(match[3]).toUpperCase().match(/[A-OT]/g) || []
    if (last - first + 1 !== letters.length) continue
    letters.forEach((letter, index) => { result[String(first + index)] = letter })
  }
  const compact = text.replace(/\s+/g, '').toUpperCase()
  for (const match of compact.matchAll(/(?<!\d)([1-5]?\d)[-~～至–—]([1-5]?\d)[:：]?([A-OT]{2,20})/g)) {
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
    const letters = line.replace(/[^A-OT]/g, '')
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
  if (draft.exam_type === 'cet4' || draft.exam_type === 'cet6') {
    if (numbers.length !== 55) warnings.push(`四六级客观题应为55题，当前为${numbers.length}题`)
    for (const unit of draft.units) {
      for (const question of unit.questions) {
        if (!Array.isArray(question.options) || question.options.length < 2
          || question.options.some((option: JsonRecord) => !clean(option.content))) {
          warnings.push(`第${question.number}题选项不完整`)
        }
      }
    }
    const wordBank = draft.units.find((unit: JsonRecord) => unit.unit_type === 'word_bank')
    if (!wordBank || Object.keys(wordBank.shared_data?.candidates || {}).length < 15) {
      warnings.push('选词填空词库未完整识别')
    }
    const matching = draft.units.find((unit: JsonRecord) => unit.unit_type === 'paragraph_matching')
    if (!matching || Object.keys(matching.shared_data?.paragraphs || {}).length < 10) {
      warnings.push('长篇段落匹配材料未完整识别')
    }
    return [...new Set(warnings)]
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

type PaperSection = {
  title: string
  year: number | null
  month: number | null
  set_number: number
  start_block: number
  end_block: number
  objective_start_block: number
  objective_end_block: number
  has_objective_questions: boolean
}

function inferDocumentPapers(blocks: string[], fileName: string): PaperSection[] {
  const writingStarts = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => /^\s*Part\s*I\s*Writing\b|^\s*Part\s*IWriting\b/i.test(block))
    .map(({ index }) => index)
  const year = Number(fileName.match(/20\d{2}/)?.[0]) || null
  const month = Number(fileName.match(/(?:年|[._-])\s*(\d{1,2})\s*月?/)?.[1]) || null
  const subject = fileName.includes('六级') ? '大学英语六级'
    : fileName.includes('四级') ? '大学英语四级' : '英语'
  if (writingStarts.length <= 1) {
    return [{
      title: fileName.replace(/\.[^.]+$/, ''),
      year,
      month,
      set_number: 1,
      start_block: 0,
      end_block: Math.max(0, blocks.length - 1),
      objective_start_block: 0,
      objective_end_block: Math.max(0, blocks.length - 1),
      has_objective_questions: true,
    }]
  }
  const starts = writingStarts.map(writingStart => {
    for (let index = writingStart - 1; index >= Math.max(0, writingStart - 35); index--) {
      if (/20\d{2}.*第\s*[一二三1-9]\s*套/.test(blocks[index])) return index
    }
    for (let index = writingStart - 1; index >= Math.max(0, writingStart - 35); index--) {
      if (/COLLEGE ENGLISH TEST/i.test(blocks[index])) return index
    }
    return writingStart
  })
  return starts.map((start, offset) => {
    const end = starts[offset + 1] != null ? starts[offset + 1] - 1 : blocks.length - 1
    const segment = blocks.slice(start, end + 1)
    const setMatch = segment.slice(0, 40).join('\n').match(/第\s*([一二三1-9])\s*套/)
    const setNumber = setMatch
      ? ({ 一: 1, 二: 2, 三: 3 } as Record<string, number>)[setMatch[1]] || Number(setMatch[1])
      : offset + 1
    const objectiveOffset = segment.findIndex(block =>
      /Part\s*(?:II|Ⅱ|III|Ⅲ)\s*(?:Listening|Reading)/i.test(block))
    const hasObjective = objectiveOffset >= 0
    return {
      title: year && month
        ? `${year}年${month}月${subject}真题（第${setNumber}套）`
        : `${fileName.replace(/\.[^.]+$/, '')}（第${setNumber}套）`,
      year,
      month,
      set_number: setNumber,
      start_block: start,
      end_block: end,
      objective_start_block: hasObjective ? start + objectiveOffset : start,
      objective_end_block: end,
      has_objective_questions: hasObjective,
    }
  })
}

async function detectDocumentPapers(
  blocks: string[],
  fileName: string,
): Promise<{ papers: PaperSection[]; source: 'model' | 'local'; error?: string }> {
  const fallback = inferDocumentPapers(blocks, fileName)
  try {
    const { profile, selectedModel } = await modelIdentity()
    const content = await chatCompletion(
      Number(profile.id),
      selectedModel,
      [
        {
          role: 'system',
          content: `你是英语考试 Word 题库拆分器。判断文档包含几套试卷，并按 BLOCK 编号给出每套完整边界和客观题边界。
只输出 JSON：{"paper_count":3,"papers":[{"title":"...","year":2019,"month":6,"set_number":1,"start_block":0,"end_block":220,"objective_start_block":25,"objective_end_block":220,"has_objective_questions":true}]}。
若某套只有写作或翻译，has_objective_questions=false。不得混合不同套次。`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            source_name: fileName,
            document_blocks: blocks.map((block, index) => `[BLOCK ${index}] ${block}`).join('\n'),
            local_candidates: fallback,
          }),
        },
      ],
      { responseFormat: { type: 'json_object' } },
    )
    const result = parseModelJson(content)
    if (!Array.isArray(result.papers) || !result.papers.length) throw new Error('模型未返回拆分列表')
    let lastEnd = -1
    const papers: PaperSection[] = result.papers.map((item: JsonRecord, offset: number) => {
      const start = Number(item.start_block)
      const end = Number(item.end_block)
      if (!Number.isInteger(start) || !Number.isInteger(end)
        || start <= lastEnd || end < start || end >= blocks.length) {
        throw new Error('模型返回的拆分边界无效')
      }
      lastEnd = end
      const local = fallback[Math.min(offset, fallback.length - 1)]
      const objectiveStart = Number(item.objective_start_block)
      const objectiveEnd = Number(item.objective_end_block)
      return {
        title: clean(item.title) || local.title,
        year: Number(item.year) || local.year,
        month: Number(item.month) || local.month,
        set_number: Number(item.set_number) || offset + 1,
        start_block: start,
        end_block: end,
        objective_start_block: objectiveStart >= start && objectiveStart <= end ? objectiveStart : start,
        objective_end_block: objectiveEnd >= start && objectiveEnd <= end ? objectiveEnd : end,
        has_objective_questions: item.has_objective_questions !== false,
      }
    })
    if (Number(result.paper_count || papers.length) !== papers.length) throw new Error('模型返回的套数不一致')
    return { papers, source: 'model' }
  } catch (cause) {
    return { papers: fallback, source: 'local', error: String(cause).slice(0, 400) }
  }
}

function shellUnit(
  unitType: string,
  subtype: string,
  title: string,
  sequence: number,
  first: number,
  last: number,
  answers: Record<string, string>,
): JsonRecord {
  return {
    unit_type: unitType,
    subtype,
    title,
    sequence,
    passage: '',
    shared_data: {},
    questions: Array.from({ length: last - first + 1 }, (_, offset) => {
      const number = first + offset
      return {
        number,
        stem: '',
        options: ['A', 'B', 'C', 'D'].map(key => ({ key, content: '' })),
        answer: answers[String(number)] || '',
        score: 1,
      }
    }),
  }
}

export function parseExtractedExam(
  fileName: string,
  source: ExtractedDocument,
  answerSource?: { fileName: string; extracted: ExtractedDocument },
): JsonRecord {
  const year = Number(fileName.match(/20\d{2}/)?.[0]
    || source.blocks.slice(0, 10).join(' ').match(/20\d{2}/)?.[0])
  const subjectHeader = [fileName, ...source.blocks.slice(0, 12)].join(' ')
  const isCet6 = /六级|CET-?6|Band Six/i.test(subjectHeader)
  const isCet4 = !isCet6 && /四级|CET-?4|Band Four/i.test(subjectHeader)
  const subject = isCet6 ? '大学英语六级' : isCet4 ? '大学英语四级'
    : /英语\s*[\(（]?\s*二\s*[\)）]?|科目代码\s*[：:]?\s*204\b/.test(subjectHeader)
      ? '英语二' : '英语一'
  const embeddedAnswers = answerMap(source.text)
  const attachmentAnswers = answerSource?.extracted.hasTextLayer
    ? answerMap(answerSource.extracted.text) : {}
  const answers = { ...embeddedAnswers, ...attachmentAnswers }
  const embeddedAnswersConfirmed = !answerSource && Object.keys(embeddedAnswers).length > 0
  const units = isCet6
    ? [
        shellUnit('listening', 'long_conversation', '听力 Section A — 长对话', 1, 1, 8, answers),
        shellUnit('listening', 'passage', '听力 Section B — 短文', 2, 9, 15, answers),
        shellUnit('listening', 'lecture', '听力 Section C — 讲座/讲话', 3, 16, 25, answers),
        shellUnit('word_bank', 'word_bank', '阅读 Section A — 选词填空', 4, 26, 35, answers),
        shellUnit('paragraph_matching', 'paragraph_matching', '阅读 Section B — 长篇匹配', 5, 36, 45, answers),
        shellUnit('reading', 'reading_a', '阅读 Section C — Passage One', 6, 46, 50, answers),
        shellUnit('reading', 'reading_a', '阅读 Section C — Passage Two', 7, 51, 55, answers),
      ]
    : isCet4
      ? [
          shellUnit('listening', 'news_report', '听力 Section A — 新闻报告', 1, 1, 7, answers),
          shellUnit('listening', 'long_conversation', '听力 Section B — 长对话', 2, 8, 15, answers),
          shellUnit('listening', 'passage', '听力 Section C — 短文', 3, 16, 25, answers),
          shellUnit('word_bank', 'word_bank', '阅读 Section A — 选词填空', 4, 26, 35, answers),
          shellUnit('paragraph_matching', 'paragraph_matching', '阅读 Section B — 长篇匹配', 5, 36, 45, answers),
          shellUnit('reading', 'reading_a', '阅读 Section C — Passage One', 6, 46, 50, answers),
          shellUnit('reading', 'reading_a', '阅读 Section C — Passage Two', 7, 51, 55, answers),
        ]
      : [parseCloze(source.blocks, answers), ...parseReading(source.blocks, answers)]
  if (!isCet4 && !isCet6 && hasObjectivePartB(source.blocks)) units.push(parsePartB(source.blocks, answers))
  const month = Number(fileName.match(/(?:年|[._-])\s*(\d{1,2})\s*月?/)?.[1]) || 0
  const setNumber = Number(fileName.match(/第\s*([1-9])\s*套/)?.[1]) || 1
  const draft: JsonRecord = {
    year: Number.isFinite(year) ? year : null,
    subject,
    exam_type: isCet6 ? 'cet6' : isCet4 ? 'cet4' : subject === '英语二' ? 'postgraduate_english2' : 'postgraduate_english1',
    exam_month: month,
    set_number: setNumber,
    title: Number.isFinite(year)
      ? (isCet4 || isCet6 ? `${year}年${month ? `${month}月` : ''}${subject}真题（第${setNumber}套）` : `${year}年考研${subject}真题`)
      : fileName.replace(/\.[^.]+$/, ''),
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
    source_text: source.text,
    answer_text: answerSource?.extracted.text || '',
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

async function reconstructDocumentUnit(
  draft: JsonRecord,
  unit: JsonRecord,
  profileId: number,
  model: string,
): Promise<JsonRecord> {
  const expected = unit.questions
    .map((question: JsonRecord) => Number(question.number))
    .filter((number: number) => Number.isInteger(number))
  const prompt = `你是英语客观题题库的单元重建器。只依据试卷与答案材料，不得编造。
只重建用户指定的一个单元，并只输出 JSON 对象：
{"sequence":1,"unit_type":"listening","subtype":"long_conversation","title":"...",
"passage":"","shared_data":{},"questions":[
 {"number":1,"stem":"","options":[{"key":"A","content":"..."}],"answer":"B","score":1}
]}。
questions 的题号集合必须与 expected_numbers 完全一致。
CET 听力原文和题干通常不在试卷中：passage 与 stem 留空，准确抄录 A-D 选项。
选词填空：passage 保留带题号空位的原文，shared_data.candidates 为 A-O 词库，每题 options 也使用同一词库。
段落匹配：passage 保留完整文章，shared_data.paragraphs 保存 A-K 段落，36-45 的 stem 是十条陈述，options 为 A-K。
阅读理解：passage 只放本篇文章，完整抄录五道题干与 A-D 选项。
答案只能从材料的标准答案区获取；没有可靠答案时 answer 留空。`
  const content = await chatCompletion(
    profileId,
    model,
    [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          paper: {
            title: draft.title,
            exam_type: draft.exam_type,
            year: draft.year,
            month: draft.exam_month,
            set_number: draft.set_number,
          },
          target_unit: {
            sequence: unit.sequence,
            unit_type: unit.unit_type,
            subtype: unit.subtype,
            title: unit.title,
            expected_numbers: expected,
          },
          document_text: String(draft.source_text || ''),
          answer_text: String(draft.answer_text || ''),
        }),
      },
    ],
    { responseFormat: { type: 'json_object' } },
  )
  return parseModelJson(content)
}

export async function applyDocumentModelAssist(
  draft: JsonRecord,
  options: { profile_id?: number; model?: string; correct_structure?: boolean } = {},
): Promise<JsonRecord> {
  const { profile, selectedModel } = await modelIdentity(options.profile_id, options.model)
  const prompt = `你是英语客观题真题导入解析助手。只能依据材料校对，不得编造。
输出 JSON：{"answer_map":{"1":"A"},"number_map":{},"question_fixes":[],"unit_replacements":[],"issues":[],"notes":""}。
answer_map 必须尽可能覆盖本次全部客观题。若 Part B 是翻译题，不要导入 41-45，也不要报缺失。
普通选择题答案使用 A-O；判断题答案使用 T/F。
number_map 只在题号明确错位时填写。${
  options.correct_structure
    ? '允许 question_fixes 修正单题；unit_replacements 必须保持空数组，程序会按单元分别请求重建。'
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
          document_text: String(draft.source_text || ''),
          answer_text: String(draft.answer_text || ''),
          draft_summary: draftSummary(draft),
        }),
      },
    ],
    { responseFormat: { type: 'json_object' } },
  )
  const result = parseModelJson(content)
  result.unit_replacements = []
  if (options.correct_structure && ['cet4', 'cet6'].includes(String(draft.exam_type))) {
    const reconstructionIssues: string[] = []
    for (const unit of draft.units) {
      try {
        result.unit_replacements.push(await reconstructDocumentUnit(
          draft,
          unit,
          Number(profile.id),
          selectedModel,
        ))
      } catch (cause) {
        reconstructionIssues.push(`${clean(unit.title) || '未知单元'}重建失败：${String(cause).slice(0, 160)}`)
      }
    }
    result.issues = [
      ...(Array.isArray(result.issues) ? result.issues : []),
      ...reconstructionIssues,
    ]
  }
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
    if (!validNumbers.has(String(number)) || !/^[A-OT]$/.test(letter)) continue
    draft.answers[String(number)] = letter
    draft.answer_sources[String(number)] = '模型辅助'
    appliedAnswers++
  }
  let appliedFixes = 0
  let appliedUnitReplacements = 0
  if (options.correct_structure && Array.isArray(result.unit_replacements)) {
    for (const replacement of result.unit_replacements) {
      const sequence = Number(replacement?.sequence)
      const unitIndex = draft.units.findIndex((unit: JsonRecord) => Number(unit.sequence) === sequence)
      if (unitIndex < 0 || !Array.isArray(replacement?.questions)) continue
      const target = draft.units[unitIndex]
      const expected = target.questions.map((question: JsonRecord) => Number(question.number)).sort((a: number, b: number) => a - b)
      const incoming = replacement.questions.map((question: JsonRecord) => Number(question.number)).sort((a: number, b: number) => a - b)
      if (expected.length !== incoming.length || expected.some((number: number, index: number) => number !== incoming[index])) continue
      const cleanedQuestions: JsonRecord[] = []
      let valid = true
      for (const question of replacement.questions) {
        if (!Array.isArray(question.options) || question.options.length < 2) { valid = false; break }
        const cleanedOptions = question.options.map((option: JsonRecord) => ({
          key: clean(option.key).toUpperCase(),
          content: clean(option.content),
        }))
        if (cleanedOptions.some((option: JsonRecord) => !option.key || !option.content)
          || new Set(cleanedOptions.map((option: JsonRecord) => option.key)).size !== cleanedOptions.length) {
          valid = false
          break
        }
        const number = Number(question.number)
        const answer = clean(question.answer || draft.answers[String(number)]).toUpperCase()
        if (answer) {
          draft.answers[String(number)] = answer
          draft.answer_sources[String(number)] = '模型辅助'
        }
        cleanedQuestions.push({
          number,
          stem: clean(question.stem),
          options: cleanedOptions,
          answer,
          score: Number(question.score || target.questions[0]?.score || 1),
        })
      }
      if (!valid) continue
      draft.units[unitIndex] = {
        unit_type: clean(replacement.unit_type) || target.unit_type,
        subtype: clean(replacement.subtype) || target.subtype,
        title: clean(replacement.title) || target.title,
        sequence,
        passage: String(replacement.passage || ''),
        shared_data: replacement.shared_data && typeof replacement.shared_data === 'object'
          ? replacement.shared_data : {},
        questions: cleanedQuestions,
      }
      appliedUnitReplacements++
    }
  }
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
    applied_unit_replacements: appliedUnitReplacements,
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
  const audioFiles = form.getAll('audio_files').filter((item): item is File => item instanceof File)
  if (!(file instanceof File) || !/\.(?:doc|docx)$/i.test(file.name)) {
    throw new LocalApiError(400, '请选择 DOC 或 DOCX 试卷文件')
  }
  if (answerFile && (!(answerFile instanceof File) || !/\.(?:doc|docx|pdf)$/i.test(answerFile.name))) {
    throw new LocalApiError(400, '答案文件仅支持 DOC、DOCX 或 PDF')
  }
  if (audioFiles.some(audio => !/\.(?:mp3|m4a|wav|ogg)$/i.test(audio.name))) {
    throw new LocalApiError(400, '听力音频仅支持 MP3、M4A、WAV 或 OGG')
  }
  const source = await extractDocument(file)
  const answerSource = answerFile instanceof File
    ? { fileName: answerFile.name, extracted: await extractDocument(answerFile) } : undefined
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
  const split = requested
    ? await detectDocumentPapers(source.blocks, file.name)
    : { papers: inferDocumentPapers(source.blocks, file.name), source: 'local' as const }
  const sourceBase64 = await toBase64(file)
  const answerBase64 = answerFile instanceof File ? await toBase64(answerFile) : ''
  const audioPayload = await Promise.all(audioFiles.map(async audio => ({
    name: audio.name,
    type: audio.type || 'application/octet-stream',
    base64: await toBase64(audio),
  })))
  const detectedPaperCount = split.papers.length
  const ignoredPaperCount = Math.max(0, detectedPaperCount - 1)
  const selectedPapers = split.papers.slice(0, 1)
  const createdJobs: JsonRecord[] = []
  for (let index = 0; index < selectedPapers.length; index++) {
    const section = selectedPapers[index]
    const sectionBlocks = source.blocks.slice(section.start_block, section.end_block + 1)
    const sectionSource: ExtractedDocument = {
      ...source,
      blocks: sectionBlocks,
      text: sectionBlocks.join('\n'),
    }
    const sectionFileName = detectedPaperCount > 1 ? `${section.title}.docx` : file.name
    let draft = parseExtractedExam(sectionFileName, sectionSource, answerSource)
    draft.title = section.title
    draft.year = section.year || draft.year
    draft.exam_month = section.month || draft.exam_month
    draft.set_number = section.set_number
    draft.document_split = {
      ...section,
      paper_index: index + 1,
      paper_count: 1,
      detected_paper_count: detectedPaperCount,
      ignored_paper_count: ignoredPaperCount,
      source: split.source,
      error: split.error || '',
    }
    if (!section.has_objective_questions) {
      draft.warnings = ['该套文档未检测到可导入的客观题，可能只包含写作或翻译部分']
    } else if (requested) {
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
    draft.audio_files = audioFiles.map(audio => ({
      name: audio.name,
      type: audio.type || 'application/octet-stream',
    }))
    const created = await run(
      `INSERT INTO document_import_jobs
        (profile_id, filename, answer_filename, source_file_base64,
         answer_file_base64, audio_files_base64, detected_year, detected_format, status,
         draft_data, warnings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        profileId,
        sectionFileName,
        answerFile instanceof File ? answerFile.name : '',
        sourceBase64,
        answerBase64,
        JSON.stringify(audioPayload),
        draft.year,
        draft.detected_format,
        JSON.stringify(draft),
        JSON.stringify(draft.warnings || []),
      ],
    )
    createdJobs.push({
      id: Number(created.lastId),
      filename: sectionFileName,
      draft: Object.fromEntries(Object.entries(draft).filter(([key]) => !['source_text', 'answer_text'].includes(key))),
      warnings: draft.warnings,
      model_assist: draft.model_assist,
      profile_id: profileId,
      paper_index: index + 1,
      paper_count: 1,
      has_objective_questions: section.has_objective_questions,
    })
  }
  return {
    ...createdJobs[0],
    split_jobs: createdJobs,
    split_count: createdJobs.length,
    detected_paper_count: detectedPaperCount,
    ignored_paper_count: ignoredPaperCount,
    split_source: split.source,
    split_error: split.error || '',
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
    if (!allowed.has(String(number)) || (answer && !/^[A-OT]$/.test(answer))) continue
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
  if (draft.document_split?.has_objective_questions === false) {
    throw new LocalApiError(409, '该套文档未检测到客观题，不能发布为空壳题库')
  }
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

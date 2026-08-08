export type ExamUnitTemplate = {
  type: string
  subtype: string
  title: string
  seq: number
  numbers: [number, number]  
}

export type ExamTemplate = {
  label: string
  subjectDefault: string
  answerNumberRange: [number, number]
  units: ExamUnitTemplate[]
}

const EXAM_TEMPLATES: Record<string, ExamTemplate> = {
  cet4: {
    label: "大学英语四级 (CET-4)",
    subjectDefault: "大学英语四级",
    answerNumberRange: [1, 55],
    units: [
      {type:"listening",subtype:"news_report",title:"听力 Section A — 新闻报告",seq:1,numbers:[1,7]},
      {type:"listening",subtype:"long_conversation",title:"听力 Section B — 长对话",seq:2,numbers:[8,15]},
      {type:"listening",subtype:"passage",title:"听力 Section C — 短文",seq:3,numbers:[16,25]},
      {type:"word_bank",subtype:"word_bank",title:"阅读 Section A — 选词填空",seq:4,numbers:[26,35]},
      {type:"paragraph_matching",subtype:"paragraph_matching",title:"阅读 Section B — 长篇匹配",seq:5,numbers:[36,45]},
      {type:"reading",subtype:"reading_a",title:"阅读 Section C — Passage One",seq:6,numbers:[46,50]},
      {type:"reading",subtype:"reading_a",title:"阅读 Section C — Passage Two",seq:7,numbers:[51,55]},
    ],
  },
  cet6: {
    label: "大学英语六级 (CET-6)",
    subjectDefault: "大学英语六级",
    answerNumberRange: [1, 55],
    units: [
      {type:"listening",subtype:"long_conversation",title:"听力 Section A — 长对话",seq:1,numbers:[1,8]},
      {type:"listening",subtype:"passage",title:"听力 Section B — 短文",seq:2,numbers:[9,15]},
      {type:"listening",subtype:"lecture",title:"听力 Section C — 讲座/讲话",seq:3,numbers:[16,25]},
      {type:"word_bank",subtype:"word_bank",title:"阅读 Section A — 选词填空",seq:4,numbers:[26,35]},
      {type:"paragraph_matching",subtype:"paragraph_matching",title:"阅读 Section B — 长篇匹配",seq:5,numbers:[36,45]},
      {type:"reading",subtype:"reading_a",title:"阅读 Section C — Passage One",seq:6,numbers:[46,50]},
      {type:"reading",subtype:"reading_a",title:"阅读 Section C — Passage Two",seq:7,numbers:[51,55]},
    ],
  },
  postgraduate_english1: {
    label: "考研英语（一）",
    subjectDefault: "英语一",
    answerNumberRange: [1, 45],
    units: [
      {type:"cloze",subtype:"cloze",title:"完型填空",seq:1,numbers:[1,20]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 1",seq:2,numbers:[21,25]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 2",seq:3,numbers:[26,30]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 3",seq:4,numbers:[31,35]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 4",seq:5,numbers:[36,40]},
      {type:"part_b",subtype:"paragraph_insertion",title:"阅读 Part B",seq:6,numbers:[41,45]},
    ],
  },
  postgraduate_english2: {
    label: "考研英语（二）",
    subjectDefault: "英语二",
    answerNumberRange: [1, 45],
    units: [
      {type:"cloze",subtype:"cloze",title:"完型填空",seq:1,numbers:[1,20]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 1",seq:2,numbers:[21,25]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 2",seq:3,numbers:[26,30]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 3",seq:4,numbers:[31,35]},
      {type:"reading",subtype:"reading_a",title:"阅读 Text 4",seq:5,numbers:[36,40]},
      {type:"part_b",subtype:"true_false",title:"阅读 Part B",seq:6,numbers:[41,45]},
    ],
  },
}

export const ALLOWED_UNIT_TYPES = new Set([
  "cloze","reading","part_b","listening","word_bank","paragraph_matching",
])

export function detectExamType(blocksText: string, fileName = ""): string {
  const lower = blocksText.toLowerCase()
  const nameLower = fileName.toLowerCase()
  if (/cet-?6|六级/.test(nameLower) || /六级/.test(lower.slice(0,3000))) return "cet6"
  if (/cet-?4|四级/.test(nameLower) || /四级/.test(lower.slice(0,3000))) return "cet4"
  if (/英语（二）|英语二|英语2/.test(lower.slice(0,3000)) || /英语二|英语2/.test(nameLower)) return "postgraduate_english2"
  return "postgraduate_english1"
}

export function templateUnits(examType: string): ExamUnitTemplate[] {
  return EXAM_TEMPLATES[examType]?.units || []
}

export function templateLabel(examType: string): string {
  return EXAM_TEMPLATES[examType]?.label || examType
}

export function templateSubjectDefault(examType: string): string {
  return EXAM_TEMPLATES[examType]?.subjectDefault || ""
}

export function templateAnswerNumbers(examType: string): [number, number] {
  return EXAM_TEMPLATES[examType]?.answerNumberRange || [1, 45]
}

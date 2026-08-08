export class LocalApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'LocalApiError'
    this.status = status
    this.detail = detail ?? message
  }
}

export function incompleteSubmission(unit: any, question: any): never {
  const detail = {
    code: 'incomplete_submission',
    message: `${unit.title}的第 ${question.number} 题还未作答`,
    unit_id: unit.id,
    unit_title: unit.title,
    question_id: question.id,
    question_number: question.number,
  }
  throw new LocalApiError(409, detail.message, detail)
}

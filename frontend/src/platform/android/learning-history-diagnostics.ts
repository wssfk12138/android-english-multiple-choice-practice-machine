import { androidDatabase } from './database'
import { copyDiagnosticText, shareDiagnosticText } from './diagnostics'
import {
  collectLearningHistoryDiagnostics,
  serializeLearningHistoryDiagnostics,
} from './learning-history-diagnostics-core'

export {
  collectLearningHistoryDiagnostics,
  serializeLearningHistoryDiagnostics,
} from './learning-history-diagnostics-core'

async function currentReport(): Promise<string> {
  return serializeLearningHistoryDiagnostics(await collectLearningHistoryDiagnostics(await androidDatabase()))
}

export async function copyLearningHistoryDiagnostics(): Promise<void> {
  await copyDiagnosticText(await currentReport())
}

export async function shareLearningHistoryDiagnostics(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await shareDiagnosticText(
    await currentReport(),
    `english-practice-learning-history-diagnostics-${timestamp}.json`,
    '分享英语刷题机学习历史只读诊断',
  )
}

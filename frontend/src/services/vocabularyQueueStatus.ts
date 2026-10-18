type QueueProgress = { queued?: number; translating?: number; scheduler?: { reason?: string; active?: boolean; task?: string; waitingConfiguration?: boolean; localFailure?: boolean } }
// Only controlled local categories are shown, never provider errors or payloads.
const stops: Record<string, string> = {
  budget: '已达到本段 4 次请求或 10 分钟上限，剩余翻译已停止；点击“重试翻译”可继续处理全部失败和待翻译词。',
  user: '翻译已暂停，剩余单词暂未发送。',
  unknown: '上次请求结果未知，已停止；重试可能重复产生费用，请先核查再使用词条重试按钮。',
  configuration: '模型配置变化，翻译已停止；请检查配置后点击“重试翻译”。',
  content_changed: '词条或语境变化，翻译已停止；请核对后点击“重试翻译”。',
  validation: '模型结果校验失败，翻译已停止；请检查模型配置或重试失败词条。',
  parse: '模型响应解析失败，翻译已停止；请检查模型配置或重试失败词条。',
  truncated: '模型响应被截断，翻译已停止，未自动重发；可重试失败词条。',
  save: '响应保存失败，翻译已停止，未自动重发；请重启应用核查后再操作。',
  http: '供应商请求失败，翻译已停止；请检查模型配置或重试失败词条。',
}
export function translationQueueNotice(progress: QueueProgress): string {
  const state = progress.scheduler
  if (!state || Number(progress.translating) > 0) return ''
  if (state.localFailure) return '任务记录保存失败，翻译已停止；请重启应用核查后继续。'
  if (state.active) return state.task === 'enrichment' ? '正在处理本段词条补缺，翻译暂未发送。' : '正在准备本段翻译请求。'
  if (stops[state.reason || '']) return stops[state.reason!]
  if (state.waitingConfiguration) return '等待配置并启用默认模型，剩余翻译暂未发送。'
  return Number(progress.queued) > 0 ? '剩余单词暂未发送，点击“重试翻译”可继续处理全部失败和待翻译词。' : ''
}

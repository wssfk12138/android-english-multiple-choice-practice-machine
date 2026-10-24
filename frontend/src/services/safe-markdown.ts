import DOMPurify from 'dompurify'
import { marked } from 'marked'

// 模型生成的分析报告按 Markdown 展示：脚本、事件属性、危险协议与远程
// 媒体一律过滤；链接仅保留 http(s)/mailto，外部链接新窗口打开并带
// noopener/noreferrer。解析或净化失败时返回空串，由组件回退纯文本。
let linkHookInstalled = false
function installLinkHook(sanitizer: typeof DOMPurify): void {
  if (linkHookInstalled) return
  linkHookInstalled = true
  sanitizer.addHook('afterSanitizeAttributes', (node: any) => {
    if (!node || String(node.tagName || '').toUpperCase() !== 'A') return
    node.setAttribute('rel', 'noopener noreferrer')
    const href = String(node.getAttribute('href') || '')
    if (/^https?:/i.test(href)) node.setAttribute('target', '_blank')
  })
}

export function renderSafeMarkdown(text: unknown): string {
  const source = String(text ?? '')
  if (!source.trim()) return ''
  try {
    installLinkHook(DOMPurify)
    const html = marked.parse(source, { gfm: true, breaks: true, async: false }) as string
    return DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'img', 'picture', 'video', 'audio', 'iframe', 'form', 'input', 'button', 'object', 'embed'],
      FORBID_ATTR: ['srcset', 'background', 'onerror', 'onload'],
    })
  } catch {
    return ''
  }
}

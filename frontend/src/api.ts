const API_ROOT = '/api'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (document.documentElement.dataset.platform === 'android') {
    const { androidLocalApi } = await import('./platform/android/local-api')
    try {
      return await androidLocalApi<T>(path, options)
    } catch (cause) {
      const diagnostic = diagnosticContext(path, options)
      if (diagnostic) {
        const { recordDiagnosticError } = await import('./platform/android/diagnostics')
        await recordDiagnosticError(
          diagnostic.category,
          diagnostic.stage,
          cause,
          diagnostic.context,
        ).catch(() => undefined)
      }
      throw cause
    }
  }
  const headers = new Headers(options.headers)
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...options, headers })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    let detail: unknown = null
    try {
      const data = await response.json()
      detail = data.detail
      message = typeof detail === 'string'
        ? detail
        : (detail as any)?.message || JSON.stringify(detail)
    } catch {
      // Keep status text.
    }
    const error = new Error(message) as Error & { status?: number, detail?: unknown }
    error.status = response.status
    error.detail = detail
    throw error
  }
  return response.json()
}

function diagnosticContext(path: string, options: RequestInit) {
  const pathname = new URL(path, 'https://local.english-practice.invalid').pathname
  const method = String(options.method || 'GET').toUpperCase()
  if (pathname === '/question-banks/imports' && method === 'POST') {
    const file = options.body instanceof FormData ? options.body.get('file') : null
    return {
      category: 'question_bank_import' as const,
      stage: 'local_esq_read_and_validate',
      context: file instanceof File
        ? { fileName: file.name, fileSize: file.size }
        : {},
    }
  }
  if (pathname === '/imports' && method === 'POST') {
    const file = options.body instanceof FormData ? options.body.get('file') : null
    const answer = options.body instanceof FormData ? options.body.get('answer_file') : null
    const audio = options.body instanceof FormData
      ? options.body.getAll('audio_files').filter(item => item instanceof File)
      : []
    return {
      category: 'question_bank_import' as const,
      stage: 'android_document_extract_and_parse',
      context: {
        ...(file instanceof File ? { fileName: file.name, fileSize: file.size } : {}),
        ...(answer instanceof File ? { answerFileName: answer.name, answerFileSize: answer.size } : {}),
        audioFileCount: audio.length,
      },
    }
  }
  if (/^\/imports\/\d+\/model-assist$/.test(pathname)) {
    return { category: 'question_bank_import' as const, stage: 'model_assisted_proofreading', context: {} }
  }
  if (/^\/imports\/\d+\/publish$/.test(pathname)) {
    return { category: 'question_bank_import' as const, stage: 'document_database_publish', context: {} }
  }
  if (/^\/question-banks\/imports\/\d+\/publish$/.test(pathname)) {
    return {
      category: 'question_bank_import' as const,
      stage: 'database_publish_transaction',
      context: {},
    }
  }
  if (pathname === '/android/updates/app/check') {
    return { category: 'app_update' as const, stage: 'manifest_fetch_and_validate', context: {} }
  }
  if (pathname === '/android/updates/app/install') {
    return { category: 'app_update' as const, stage: 'apk_download_verify_and_install', context: {} }
  }
  if (pathname === '/android/updates/question-banks/check') {
    return { category: 'remote_question_bank' as const, stage: 'catalog_fetch_and_validate', context: {} }
  }
  if (pathname === '/android/updates/question-banks/download') {
    let fileName = ''
    try {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : {}
      fileName = String(body?.package?.fileName || '')
    } catch {
      // The invalid request is still logged without retaining request content.
    }
    return {
      category: 'remote_question_bank' as const,
      stage: 'download_hash_and_import_preview',
      context: { fileName },
    }
  }
  return null
}

export const get = <T>(path: string) => api<T>(path)
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
export const put = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
export const patch = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

import { env } from "../interactor/shared/env";

const DEFAULT_TIMEOUT = 20_000

type RequestOptions = {
  method?: string
  body?: unknown
  timeoutMs?: number
}

const buildUrl = (path: string) => {
  const base = env.api.baseUrl.replace(/\/$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

const request = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const controller = new AbortController()
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(buildUrl(path), {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json'
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`api-error:${response.status}:${text || response.statusText}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      const text = await response.text().catch(() => '')
      return text as T
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeoutId)
  }
}

export const apiGet = <T>(path: string, timeoutMs?: number) => request<T>(path, { timeoutMs })

export const apiPost = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'POST', body, timeoutMs })

export const apiPatch = <T>(path: string, body?: unknown, timeoutMs?: number) =>
  request<T>(path, { method: 'PATCH', body, timeoutMs })

export const apiDelete = <T>(path: string, timeoutMs?: number) =>
  request<T>(path, { method: 'DELETE', timeoutMs })

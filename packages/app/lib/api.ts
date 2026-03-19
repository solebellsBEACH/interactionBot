export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function request<T = unknown>(
  method: string,
  url: string,
  payload?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  })

  let data: Record<string, unknown> = {}
  try {
    data = await res.json()
  } catch {
    // ignore
  }

  if (!res.ok) {
    throw new ApiError(
      (data?.error as string) || `Erro HTTP ${res.status}`,
      res.status
    )
  }

  return data as T
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
}

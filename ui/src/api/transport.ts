// Secure API transport — applies auth token only to configured origins.
// Replaces the previous global `window.fetch` monkey-patch (A01).

export interface ApiTransportConfig {
  apiOrigins: ReadonlyArray<string>
  authHeader: string
  getToken: () => string | null
}

let config: ApiTransportConfig | null = null

export function configureApiTransport(cfg: ApiTransportConfig): void {
  config = cfg
}

function isAuthorized(url: string): boolean {
  if (!config) return false
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
    return config.apiOrigins.includes(u.origin)
  } catch {
    return false
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url

  const authorized = isAuthorized(url)
  const token = authorized && config ? config.getToken() : null

  if (!token) {
    return fetch(input, init)
  }

  const modifiedInit: RequestInit = { ...(init || {}) }
  const headers = new Headers(modifiedInit.headers || (input instanceof Request ? input.headers : undefined))
  const headerName = config!.authHeader || 'Authorization'
  if (!headers.has(headerName)) {
    headers.set(headerName, `Bearer ${token}`)
  }
  modifiedInit.headers = headers
  return fetch(input, modifiedInit)
}

export { apiFetch as default }
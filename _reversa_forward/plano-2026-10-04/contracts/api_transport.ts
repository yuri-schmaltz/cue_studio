// Transporte HTTP seguro (A01)
// Substitui o patch global de window.fetch.

export interface ApiTransportConfig {
  apiOrigins: ReadonlyArray<string>;
  authHeader: string;
  getToken: () => string | null;
}

let config: ApiTransportConfig | null = null;

export function configureApiTransport(c: ApiTransportConfig): void {
  config = c;
}

function parseOrigin(url: string): string | null {
  try {
    return new URL(url, window.location.origin).origin;
  } catch {
    return null;
  }
}

function mergeHeaders(
  base: HeadersInit | undefined,
  extra: Record<string, string>,
): Headers {
  const h = new Headers(base || {});
  for (const [k, v] of Object.entries(extra)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

export async function apiFetch(
  input: Request | string,
  init: RequestInit = {},
): Promise<Response> {
  if (!config) {
    throw new Error('apiFetch: configureApiTransport() not called');
  }
  const url = typeof input === 'string' ? input : input.url;
  const origin = parseOrigin(url);
  const headers: Record<string, string> = {};
  if (origin && config.apiOrigins.includes(origin)) {
    const tok = config.getToken();
    if (tok && config.authHeader) {
      headers[config.authHeader] = `Bearer ${tok}`;
    }
  }
  const finalInit: RequestInit = {
    ...init,
    headers: mergeHeaders(init.headers, headers),
  };
  return fetch(input, finalInit);
}
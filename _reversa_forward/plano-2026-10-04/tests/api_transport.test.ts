// Testes Vitest para o transporte HTTP (A01).
// Para rodar: configurar Vitest no projeto e usar este arquivo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configureApiTransport, apiFetch } from '../contracts/api_transport';

declare const globalThis: any;

describe('apiFetch (A01)', () => {
  beforeEach(() => {
    configureApiTransport({
      apiOrigins: ['https://api.example.com'],
      authHeader: 'Authorization',
      getToken: () => 'fake-token',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies token to authorized origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok'),
    );
    await apiFetch('https://api.example.com/projects');
    const init = fetchSpy.mock.calls[0][1];
    const headers = init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer fake-token');
  });

  it('does not apply token to unauthorized origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok'),
    );
    await apiFetch('https://other.example.com/probe');
    const init = fetchSpy.mock.calls[0][1];
    const headers = (init?.headers as Headers | undefined) ?? new Headers();
    expect(headers.get('Authorization')).toBeNull();
  });

  it('preserves existing Authorization header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok'),
    );
    await apiFetch('https://api.example.com/projects', {
      headers: { Authorization: 'Bearer already-set' },
    });
    const init = fetchSpy.mock.calls[0][1];
    const headers = init?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer already-set');
  });

  it('does not call fetch when transport is unconfigured', async () => {
    // Reset module state for this test only
    vi.resetModules();
    const fresh = await import('../contracts/api_transport');
    await expect(fresh.apiFetch('http://x')).rejects.toThrow(
      'configureApiTransport() not called',
    );
  });

  it('handles AbortSignal', async () => {
    const ac = new AbortController();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok'),
    );
    await apiFetch('https://api.example.com/projects', { signal: ac.signal });
    expect(fetchSpy).toHaveBeenCalled();
    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal)
      .toBe(ac.signal);
  });
});
# Feature A01 — Transporte HTTP seguro

**Origem:** [diagnóstico D02](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md#d02--token-aplicado-a-destinos-externos-pelo-cliente-http) e [plano A01](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0 — falhas verificadas, pequeno escopo.
**Prioridade:** P0.

## 1. Contexto

`ui/src/api/client.ts` substitui `window.fetch` globalmente e adiciona o token de autenticação sem verificar a origem. A inspeção interceptou uma chamada para `https://audit.example.invalid/probe` e recebeu o token fictício.

🟢 Achado confirmado com token fictício. Nenhum segredo real foi exposto durante o teste.

## 2. Requisitos

### 2.1 Comportamento esperado

- O token só é enviado a URLs da **API configurada** (mesmo origin, ou lista explícita configurável).
- `Request`, cabeçalhos e opções de upload são preservados (sem consumir o body, sem alterar `Content-Type`/`Accept`).
- Cancelamento via `AbortSignal` continua funcional.
- Timeouts continuam sendo responsabilidade do consumidor (mantém contratos atuais).
- A função exposta é `apiFetch(input, init?)` (ou nome equivalente decidido em revisão).

### 2.2 Fora de escopo

- Implementar retries; isso é parte de A15/A17.
- Adicionar cache; idem.
- Trocar de cliente HTTP (axios, ofetch). Manter `fetch` nativo.

### 2.3 Princípios

- **Sem patch global.** `window.fetch` não é mais tocado.
- **Sem leitura de variável de ambiente em runtime por requisição.** Configurar uma vez no bootstrap.
- **Sem dependência nova.**

## 3. Contrato

### 3.1 API TypeScript

```ts
// ui/src/api/transport.ts
export interface ApiTransportConfig {
  /** Origins para as quais o token é enviado. */
  apiOrigins: ReadonlyArray<string>;
  /** Header usado para enviar o token. */
  authHeader: string;
  /** Lê o token atual (ex.: do store). */
  getToken: () => string | null;
}

export function configureApiTransport(config: ApiTransportConfig): void;

/** Fetch com cabeçalho de auth aplicado só para origens autorizadas. */
export function apiFetch(
  input: Request | string,
  init?: RequestInit,
): Promise<Response>;
```

### 3.2 Regras de aplicação do token

1. Se `input` é `string`, resolve para `new URL(input, location.origin)` e compara `origin` com `apiOrigins`. Em erro de parsing, **não** aplica token.
2. Se `input` é `Request`, usa `input.url` na mesma lógica.
3. Se a origem não está autorizada, executa `fetch` **sem** mexer em `init.headers`.
4. Se a origem está autorizada e `getToken()` retornar string, adiciona `Authorization: Bearer <token>` apenas se `init.headers` ainda não tiver esse cabeçalho.
5. **Nunca** sobrescreve `init.headers` existente — sempre mescla.

### 3.3 Casos especiais preservados

- `Request` passado diretamente (com seu próprio `headers`): manter todos os cabeçalhos.
- `init.body` em `FormData`, `Blob`, `ReadableStream`: não tocar; apenas adicionar header.
- `init.signal`: nunca tocar.

## 4. Plano de mudança

1. **Remover** o patch de `window.fetch` em `ui/src/api/client.ts`.
2. **Criar** `ui/src/api/transport.ts` com `configureApiTransport` e `apiFetch`.
3. **Criar** `ui/src/api/__tests__/transport.test.ts` com casos:
   - origem autorizada → aplica token;
   - origem não autorizada → não aplica token;
   - `Request` com `headers` próprios → preserva;
   - `init.headers` já contém `Authorization` → preserva o existente;
   - URL inválida → não aplica token, fetch prossegue.
4. **Atualizar** os consumidores de `fetch` para usar `apiFetch` (busca por `fetch(` no diretório `ui/src`; substituir em pontos onde o objetivo é a API).
5. **Configurar** no bootstrap (`ui/src/main.tsx`) com `apiOrigins = [location.origin]` em dev, e mesma origem em produção a partir de `import.meta.env.VITE_API_ORIGIN` se definido.
6. **Adicionar** teste E2E com Playwright/Chromium que intercepta uma URL externa (third-party service) e valida que o token **não** aparece nos cabeçalhos (regressão do achado).

## 5. Testes de aceitação

### 5.1 Unit (Vitest)

```ts
import { describe, it, expect, vi } from "vitest";
import { configureApiTransport, apiFetch } from "../transport";

configureApiTransport({
  apiOrigins: ["https://api.example.com"],
  authHeader: "Authorization",
  getToken: () => "fake-token",
});

describe("apiFetch", () => {
  it("applies token to authorized origin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );
    await apiFetch("https://api.example.com/x");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/x",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit).headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer fake-token");
  });

  it("does not apply token to unauthorized origin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok"),
    );
    await apiFetch("https://other.example.com/x");
    const init = fetchSpy.mock.calls[0][1] as RequestInit | undefined;
    const headers = (init?.headers as Headers | undefined) ?? new Headers();
    expect(headers.get("Authorization")).toBeNull();
  });
});
```

### 5.2 E2E (Playwright)

```ts
test("token is not sent to external origins", async ({ page }) => {
  await page.route("**/external.example/**", (route) =>
    route.fulfill({ status: 200, body: "{}" }),
  );
  await page.goto("/");
  await page.evaluate(() =>
    fetch("https://external.example/probe").then(() => undefined),
  );
  const request = await page.waitForRequest("**/external.example/**");
  expect(request.headers()["authorization"]).toBeUndefined();
});
```

## 6. Critérios de pronto

- Patch global removido.
- `apiFetch` em uso em todos os pontos que falam com o backend.
- Testes unitários passam.
- E2E (Playwright) passa — ou, se Playwright não estiver instalado, registrar em A06.
- Inspeção manual: DevTools Network em uma página com requisições externas (ex.: para um CDN) confirma que `Authorization` **não** aparece.

## 7. Riscos e mitigações

- **Risco:** algum consumidor depende do patch global. **Mitigação:** auditoria com `grep -rn "window.fetch\\|fetch(" ui/src` antes da remoção.
- **Risco:** consumir `Request` como input altera a semântica de `headers` quando o usuário já define `Authorization`. **Mitigação:** regra explícita "preserva existente"; testada.
- **Risco:** testes existentes usam `fetch` globalmockado e podem quebrar. **Mitigação:** mock em `globalThis.fetch`; Vitest já suporta.

## 9. Pré-condições

- A04 (lint) limpo nos pontos do escopo `api/`.

## 10. Pós-condições

- A02 pode conectar política de auth com confiança de que o token está sendo enviado só para a API.
- A15 (erros estruturados) pode capturar respostas HTTP no `apiFetch` e padronizar payload.
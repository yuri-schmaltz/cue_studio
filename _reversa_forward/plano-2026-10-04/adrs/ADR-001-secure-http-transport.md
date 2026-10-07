# ADR-001 — Substituir patch global de fetch por transporte com allowlist

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D02](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).
**Substitui:** nenhuma.
**Substituído por:** —.

## Contexto e problema

`ui/src/api/client.ts` (3215 linhas) substitui `window.fetch` globalmente e adiciona
`Authorization: Bearer <token>` sem verificar a origem. A auditoria interceptou uma
chamada para `https://audit.example.invalid/probe` que recebeu o token fictício.

Em modo `--share`, o backend pode estar exposto em `0.0.0.0`. Combinado com a
ausência de auth integrada (ADR-003), um token válido pode vazar para destinos
externos.

## Decisão

1. Remover **todo** patch de `window.fetch` em `ui/src/api/client.ts`.
2. Introduzir `ui/src/api/transport.ts` com `configureApiTransport(...)` e `apiFetch(...)`.
3. O transporte aplica token **apenas** se a URL parseada tiver `origin` em `apiOrigins`.
4. `Request`, `headers`, `signal` do chamador são preservados.
5. `apiOrigins` é configurado uma vez no bootstrap (`ui/src/main.tsx`).

## Consequências

**Positivas**
- Token nunca é enviado para origens não autorizadas, mesmo por engano.
- Cada request tem política explícita de auth.
- Bootstrapping centraliza a config; nenhum módulo precisa conhecer a URL base.

**Negativas**
- Chamadas legítimas que dependiam do patch agora exigem `apiFetch`.
- Migração requer tocar todos os call sites que usavam `fetch(...)`.

**Neutras**
- `Request` continua sendo input aceito; sem mudança de API para o chamador.

## Alternativas consideradas

- **A. Manter o patch global com filtro por origin.** Rejeitado: o patch global é
  frgil (qualquer terceiro pode redefinir `window.fetch`).
- **B. Mover token para cookie httpOnly.** Rejeitado: app roda local; não
  dependemos de TLS em desenvolvimento.
- **C. Usar ofetch/axios.** Rejeitado: ganho marginal; mantém `fetch` nativo.
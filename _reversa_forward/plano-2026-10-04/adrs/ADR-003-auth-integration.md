# ADR-003 — Política de autenticação no servidor geral

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D03](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).

## Contexto e problema

`app/services/security.py` define `configure_security(...)` e `verify_api_key(...)`
mas nenhum router chama essas APIs. O launcher pode subir com `--share` (escuta em
`0.0.0.0`); sem token, todas as rotas REST estão acessíveis.

## Decisão

1. **Em modo local** (default): `require_auth=False`, `allow_unauthenticated_local=True`.
2. **Em modo compartilhado** (`--share` ou `CUE_REQUIRE_AUTH=1`):
   - `configure_security(require_auth=True, allow_unauthenticated_local=False)`.
   - Adicionar `AuthMiddleware` que valida `Authorization: Bearer <token>` para
     todas as rotas, exceto allowlist pública (`/health`, `/ready`, `/docs`,
     `/openapi.json`, ícones).
3. **Em modo MCP**: política própria continua. Tokens podem ser os mesmos.
4. Erro retorna `ApiError` (A15) com `code="auth.missing"` ou `"auth.invalid"`.
5. CLI companion: rodada em `localhost` por padrão, sem token; se remote, exige.

## Consequências

**Positivas**
- App seguro por padrão em rede compartilhada.
- Modo local sem fricção.
- Erro estruturado (A15) garante UX consistente.

**Negativas**
- Requer ativação em `--share`; testes existentes precisam de update se rodarem
  em modo compartilhado.

## Alternativas

- **A. Sempre exigir token.** Rejeitado: prejudica uso local simples.
- **B. Autenticação via header custom.** Rejeitado: padrão `Authorization` é conhecido.
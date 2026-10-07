# Feature A02 — Autenticação integrada ao servidor geral

**Origem:** [diagnóstico D03](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md#d03--autenticação-geral-não-conectada-ao-servidor) e [plano A02](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0.
**Prioridade:** P0 (em rede compartilhada).

## 1. Contexto

`app/services/security.py` implementa:

- `configure_security(api_key, require_auth, allow_unauthenticated_local)` — define estado global;
- `verify_api_key(request, credentials)` — dependência FastAPI que valida token.

🟢 No commit 27cadae, **nenhuma chamada a `configure_security()` é encontrada** em `app/launch.py` ou em qualquer `app/routers/*` (`grep -rn 'configure_security\|verify_api_key' app/` retorna apenas o módulo `security.py`).

Consequências:
- Mesmo quando o launcher sobe com `--share` (`0.0.0.0`), `is_auth_required()` retorna `False` por padrão.
- Nenhum endpoint declara `Depends(verify_api_key)`. A segurança é uma camada morta.
- O MCP tem política própria em `mcp_access.py`/`routers/mcp.py`, **não** generaliza para os outros endpoints.

🟢 Achado de integração confirmado por leitura. 🔴 Não foi executada exploração real de servidor exposto.

## 2. Requisitos

### 2.1 Comportamento esperado

- Quando o servidor é iniciado **com** `--share` (ou equivalente), todas as rotas REST e de websocket exigem token válido, exceto:
  - health checks explícitos (`/health`, `/ready`);
  - websocket de atualizações de handshake?
- Em modo local (`127.0.0.1`), o token é **opcional** mas **recomendado**; o app pode gerar e exibir um token automaticamente na primeira inicialização em modo local.
- O MCP mantém sua política própria, mas o **mesmo token** pode ser reaproveitado (ou um segundo o cliente). Decidir em revisão.
- Erros de auth retornam HTTP 401 com payload JSON `{ code, message }` (A15).

### 2.2 Fora de escopo

- OAuth, login social.
- Multi-user / RBAC.

## 3. Contrato

### 3.1 Token

```python
# app/services/security.py (contrato existente; ajustar conforme necessário)
@dataclass
class AuthPolicy:
    enabled: bool
    token: str | None  # se None, gera no startup
    header: str = "Authorization"
    scheme: str = "Bearer"

    def validate(self, request: Request) -> bool: ...
```

### 3.2 Integração

```python
# app/launch.py (trecho — proposto)
def create_app(config: AppConfig) -> FastAPI:
    auth = AuthPolicy.from_config(config)  # lê --share e env
    app = FastAPI(...)
    app.add_middleware(AuthMiddleware, policy=auth)  # NOVO
    app.include_router(build_video_editor_router(get_editor))
    # ... demais routers
    return app
```

### 3.3 Headers de resposta

- Em sucesso, sem mudança.
- Em falta/invalidação: 401 + `{ "code": "auth.missing", "message": "..." }`.
- CORS permanece como hoje (controle separado).

## 4. Plano de mudança

1. **Confirmar** `verify_api_key` em `app/services/security.py` (já existe). Usar como dependência FastAPI.
2. **Adicionar middleware** `AuthMiddleware` em `app/services/security.py` que:
   - lê `Authorization: Bearer <token>`;
   - compara contra `_api_key` global;
   - libera rotas do allowlist (`/health`, `/ready`, `/docs`, `/openapi.json`, `/icon.png`, `/cue-studio-icon.png`).
3. **Conectar** no `create_app` em `app/launch.py`:
   - se `--share`, chamar `configure_security(require_auth=True, allow_unauthenticated_local=False)`;
   - se local, `require_auth=False, allow_unauthenticated_local=True` (default atual, **documentado**).
4. **Adicionar dependência** `Depends(verify_api_key)` em routers sensíveis (geração, projetos, fila, mídia, configurações). O MCP já tem política própria.
5. **Atualizar frontend (A01)** para enviar token só em origens autorizadas. UI deve mostrar campo para token no header/footer quando auth estiver ativa.
6. **Testar** com servidor exposto em `0.0.0.0:<porta>` e curl:
   - `GET /api/projects` sem token → 401;
   - com token inválido → 401;
   - com token válido → 200.
7. **Documentar** no `README.md` como gerar/definir token em uso compartilhado.

## 5. Testes de aceitação

```python
# tests/test_api_auth.py (referência)
import os, tempfile, pytest
from fastapi.testclient import TestClient

@pytest.fixture
def auth_client(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "state.sqlite3"))
    from app.launch import create_app  # ajustar nome real
    from app.services.security import AuthPolicy
    app = create_app(share=True, auth_token="secret-token")
    return TestClient(app), "secret-token"

def test_no_token_returns_401(auth_client):
    client, _ = auth_client
    r = client.get("/api/projects")
    assert r.status_code == 401

def test_invalid_token_returns_401(auth_client):
    client, _ = auth_client
    r = client.get("/api/projects", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401

def test_valid_token_passes(auth_client):
    client, token = auth_client
    r = client.get("/api/projects", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code != 401

def test_health_does_not_require_token(auth_client):
    client, _ = auth_client
    r = client.get("/health")
    assert r.status_code != 401
```

## 6. Critérios de pronto

- `python -m unittest discover -s tests -p "test_api_auth.py"` passa.
- `python -m unittest` continua passando nos testes existentes (security, app_state, job_lifecycle).
- README atualizado com seção de auth.
- `--share` documentado em `README.md` e `CHANGELOG.md`.

## 7. Riscos e mitigações

- **Risco:** quebrar clientes existentes que não enviam token (ex.: CLI companion). **Mitigação:** CLI companheiro roda em `localhost` por padrão, então modo local fica sem auth; documentar e avisar quando `--share`.
- **Risco:** CORS ser confundido com auth. **Mitigação:** comentário no `launch.py` separando os dois.
- **Risco:** `--share` ser ativado por descuido. **Mitigação:** log prominente + banner na UI quando auth ativa.

## 9. Pré-condições

- A01 (transporte) implementado — UI precisa enviar token só para a API.

## 10. Pós-condições

- Aplicação segura por padrão em uso compartilhado.
- A15 (erros estruturados) pode especializar resposta 401.
- A18 pode incluir token em secret do SQLite se decidido em revisão.
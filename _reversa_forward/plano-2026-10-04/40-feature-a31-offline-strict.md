# Feature A31 — Modo `--offline-strict` com auditoria de egress

**Origem:** Plano Executivo §7 Eixo 9 + Dossiê R08.
**Ciclo:** 4.
**Prioridade:** P3 (alto valor para requisito local-first).
**Dependência:** nenhuma forte.

## 1. Contexto

Dossiê seção 70: operação offline estrita deve bloquear/monitorar egress dos workers sob controle do app. Variável de ambiente sozinha não comprova bloqueio. Allowlist de modelos Flux 2 existe em `launch.py:3379`, mas sem flag dedicada, sem auditoria, sem CI offline.

## 2. Requisitos

### 2.1 Comportamento esperado

- Flag `--offline-strict` no `start.sh` que:
  - Bloqueia downloads de modelos.
  - Bloqueia CivitAI browser.
  - Bloqueia Web Push.
  - Bloqueia completion alerts remotos.
  - Log explícito ao bloquear.
- `tests/offline/audit_egress.py` que instrumenta sockets e captura conexões.
- CI em modo offline-estrito roda projeto de referência do A29 (fixture "A luz da oficina"); falha se houver destino não-localhost.
- Migração de downloads remanescentes para opcional.
- Plugins (`app/plugins/`) declaram `network_policy ∈ {"offline", "optional", "required"}`.
- Telemetria desativada por padrão; opt-in explícito.
- Documentação `docs/OFFLINE.md` com procedimento.

### 2.2 Fora de escopo

- Garantir isolamento perfeito de subprocessos (limitação reconhecida).
- Suportar firewall corporativo automaticamente.
- Bloquear tráfego de SO fora do app.

## 3. Modelo de dados

```python
class NetworkPolicy(str, Enum):
    OFFLINE = "offline"
    OPTIONAL = "optional"
    REQUIRED = "required"

class ConnectionAttempt(BaseModel):
    timestamp: str
    destination: str  # "host:port"
    protocol: str
    blocked: bool
    reason: str
```

## 4. Endpoints REST

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/v1/system/network-policy` | Estado atual |
| `GET` | `/api/v1/system/connections` | Log de tentativas |

## 5. Critérios de aceite

- `pytest tests/test_offline_strict.py -q` passa.
- CI em Docker `network: none` roda fixture A29 sem warnings.
- 8 testes verdes no protótipo.
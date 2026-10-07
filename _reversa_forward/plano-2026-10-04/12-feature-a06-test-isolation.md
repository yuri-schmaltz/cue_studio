# Feature A06 — Isolamento e lista explícita de testes

**Origem:** [diagnóstico D10](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md#d10--parte-dos-testes-frontend-está-fora-do-fluxo-principal) e [plano A06](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 0.
**Prioridade:** P1.

## 1. Contexto

- `ui/src/store/directorQueueSlice.test.ts` importa Vitest, mas Vitest **não** está em `ui/package.json`.
- O arquivo é excluído do typecheck por config.
- Existem scripts auxiliares `test-director-queue-slice.mjs` e `test-llm-slice.mjs` que **não** rodam no CI atual.
- O teste Python `AppStateDBSingletonTests` inicializou o singleton padrão e tocou `app/.cache/app_state.sqlite3` real. Em uso de worker, pode poluir o banco de desenvolvimento.

🟢 Achado confirmado por inspeção de `ui/package.json`, `ui/tsconfig.app.json`, e log de execução.

## 2. Requisitos

### 2.1 Comportamento esperado

- Toda suíte de teste roda em **diretório temporário isolado**.
- O banco de singleton é resolvido por env var (`APP_SQLITE_PATH` ou similar), com fallback para tempdir quando a var não está setada em teste.
- `npm run test` (Vitest) deve ser o entrypoint único para testes frontend. Os scripts `.mjs` soltos são **integrados** ao Vitest ou removidos.
- A CI lista **explicitamente** as suítes frontend e backend executadas.

### 2.2 Fora de escopo

- Reescrever a suíte Python em pytest (pode coexistir).
- Adotar Playwright agora (separado, se for decidido).

## 3. Contrato

### 3.1 Singleton de banco

```python
# app/services/app_state_db.py (exemplo — localizar o real)
import os
from pathlib import Path
import app.environments as envs

DEFAULT_PATH = Path(".cache/app_state.sqlite3")

def get_default_db_path() -> Path:
    override = os.environ.get("APP_SQLITE_PATH")
    return Path(override) if override else envs.workspace_dir() / DEFAULT_PATH
```

Em testes, monkeypatch no conftest.py:

```python
# tests/conftest.py (acréscimo)
@pytest.fixture(autouse=True)
def isolate_singletons(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_SQLITE_PATH", str(tmp_path / "app_state.sqlite3"))
    monkeypatch.setenv("APP_CACHE_DIR", str(tmp_path / "cache"))
    yield
```

### 3.2 Scripts frontend

Mover os `.mjs` para dentro de `ui/src/**/__tests__/` ou `ui/tests/` e adicionar wrapper Vitest mínimo. Se forem **intencional** standalone, justificar em `ui/tests/README.md`.

### 3.3 CI explícito

```yaml
# .github/workflows/ci.yml (trecho)
- name: Frontend lint & type
  run: |
    cd ui
    npm ci
    npm run lint
    npm run typecheck
- name: Frontend unit tests
  run: |
    cd ui
    npm run test
- name: Backend tests
  run: |
    python -m unittest discover -s tests -p "test_*.py" -v
```

## 4. Plano de mudança

### 4.1 Frontend

1. Confirmar se Vitest está em `ui/package.json` (`grep -i vitest`). Se não, **adicionar** com versões compatíveis com Vite 7.
2. Mover `directorQueueSlice.test.ts` para `ui/src/store/__tests__/directorQueueSlice.test.ts` (se ainda não estiver).
3. Reavaliar `test-director-queue-slice.mjs` e `test-llm-slice.mjs`:
   - Se ainda agregam valor, portar para Vitest.
   - Caso contrário, mover para `ui/tests/manual/` com nota no README.
4. Atualizar `ui/package.json`:
   ```json
   {
     "scripts": {
       "test": "vitest run",
       "test:watch": "vitest"
     },
     "devDependencies": {
       "vitest": "^2.0.0"
     }
   }
   ```
5. Garantir que `tsconfig.app.json` inclui `**/*.test.ts` apenas se Vitest estiver configurado (verificar `vitest.config.ts`).

### 4.2 Backend

1. Localizar a função que cria o caminho padrão do banco (`grep -rn 'app_state.sqlite3\\|app_state_db' app/`).
2. Refatorar para ler `APP_SQLITE_PATH`.
3. Adicionar fixture `isolate_singletons` em `conftest.py` (verificar nome do conftest real — há `conftest.py` na raiz, então é provável que baste).
4. Adicionar `APP_CACHE_DIR` e outros caches que o app tocar.

## 5. Testes de aceitação

- `cd ui && npm run test` → exit 0; testes não tocam `app/.cache/` ou similares.
- `python -m unittest discover -s tests -p "test_*.py"` → exit 0; nenhum arquivo em `app/.cache/` é modificado.
- `find . -newer tests/conftest.py -path './.cache/*'` (antes/depois) é vazio.

## 6. Critérios de pronto

- Vitest é o runner frontend.
- Scripts `.mjs` soltos foram integrados ou justificados.
- Singleton de banco respeita env var em testes.
- CI lista as suítes explícitas.
- `CHANGELOG.md`: entrada.

## 7. Riscos e mitigações

- **Risco:** Vitest em versão errada quebra typecheck. **Mitigação:** fixar versão compatível com `vite@7` no `package.json`.
- **Risco:** testes existentes dependem de fixtures em `tests/fixtures/` no repo. **Mitigação:** caminho absoluto via `Path(__file__).parent / "fixtures"`; nada muda.
- **Risco:** alterar env var padrão causa confusão em dev. **Mitigação:** fallback para `workspace_dir() / DEFAULT_PATH` mantém comportamento atual em dev.

## 9. Pré-condições

- Nenhuma.

## 10. Pós-condições

- A18 (persistência) pode testar migrações em cópias isoladas com segurança.
- A19 (retomada) pode simular reinício sem corromper o estado de dev.
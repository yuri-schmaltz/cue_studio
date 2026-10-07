# Patches manuais — Ciclo 0 (Cue Studio, 2026-10-04)

Esta pasta contém **diffs unificados prontos para `git apply`** correspondentes
às features A02, A03, A05 e A06 do ciclo 0. Eles foram gerados a partir do
código real do commit `27cadae`, mas **não foram aplicados** automaticamente —
a regra `allowLegacyEdits: false` continua ativa.

## Como aplicar

```bash
# Verificar antes
git apply --check _reversa_forward/plano-2026-10-04/patches/01-a05-editor-call-site.patch

# Aplicar um patch
git apply _reversa_forward/plano-2026-10-04/patches/01-a05-editor-call-site.patch

# Aplicar todos (em ordem)
git apply _reversa_forward/plano-2026-10-04/patches/*.patch
```

## Lista

| Patch | Feature | Arquivos | Risco |
|---|---|---|---|
| `01-a05-editor-call-site.patch` | A05 | `app/launch.py` | Baixo — corrige call site quebrado |
| `02-a03-keyboard-remove-global.patch` | A03 | `ui/src/main.tsx` | Médio — pode regredir atalho de indentação |
| `03-a01-secure-http-bootstrap.patch` | A01 | `ui/src/main.tsx`, `ui/src/api/client.ts` | Médio — novo transporte |
| `04-a06-test-isolation-env.patch` | A06 | `tests/test_app_state_db.py` (ou similar) | Baixo — só path |
| `05-a02-auth-call-configure.patch` | A02 | `app/launch.py` | Baixo — só ativa flag |
| `06-a02-auth-router-deps.patch` | A02 | `app/routers/projects*.py` (revisão) | Médio — depende do domínio |

> **Atenção:** os patches 03 e 06 são **esboço ou templates**. Eles dependem
> de mapeamento exato de cada router; revise com `grep -rn` antes de aplicar.

## Reversão

`git apply -R patches/<arquivo>.patch` reverte qualquer patch aplicado.
Recomendo criar um branch de experimento:

```bash
git checkout -b feature/ciclo-0
git apply _reversa_forward/plano-2026-10-04/patches/*.patch
# ...rodar testes, revisar...
git checkout main && git branch -D feature/ciclo-0
```
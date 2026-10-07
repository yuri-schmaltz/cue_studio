# ADR-004 — Matriz de persistência e migrações idempotentes

**Status:** Proposto.
**Data:** 2026-10-04.
**Contexto:** [diagnóstico D08](../../_reversa_sdd/auditoria-2026-10-04/diagnostico.md).

## Contexto e problema

JSON legado e SQLite coexistem em `app/services/`. Não há matriz explícita
nem migrações idempotentes. A auditoria não confirmou corrupção, mas apontou
o risco.

## Decisão

1. Criar `docs/persistence-matrix.md` mapeando **entidade → fonte de verdade → migração**.
2. Migrações versionadas em `app/migrations/NNNN_*.sql`, aplicadas via runner idempotente.
3. Singleton de banco resolve caminho por `APP_SQLITE_PATH` (A06).
4. Backup/restore testável com `scripts/backup.py` e `scripts/restore.py`.
5. Mídias continuam no filesystem; SQLite indexa metadados.

## Consequências

**Positivas**
- Migrações reproduzíveis; reinício seguro.
- Backup antes de migração destrutiva.
- Testes não tocam o cache do usuário.

**Negativas**
- Curva de aprendizado do runner.
- Decidir fonte de verdade exige mapeamento por entidade.

## Alternativas

- **A. Migrar tudo para Postgres.** Adiar; revisar com carga real.
- **B. Alembic.** Rejeitado para o caso atual; o escopo é simples.
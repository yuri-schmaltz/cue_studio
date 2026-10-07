# Feature A18 — Matriz de persistência e migrações

**Origem:** [plano A18](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 3.
**Prioridade:** P1.
**Dependência:** A06.

## 1. Contexto

Existem JSON legado e SQLite coexistindo. A auditoria não confirmou corrupção, mas apontou convívio sem matriz nem migrações idempotentes.

## 2. Requisitos

### 2.1 Comportamento esperado

- Documento `docs/persistence-matrix.md` mapeando **entidade → fonte de verdade → schema → backup → migração**.
- Migrações versionadas: `app/migrations/0001_init.sql`, `0002_add_director_table.sql`, …
- Migrações idempotentes (`IF NOT EXISTS`, checagem de versão).
- Backup/restore testável: `scripts/backup.py`, `scripts/restore.py`.

### 2.2 Fora de escopo

- Migrar tudo para Postgres (decidir em revisão com carga).
- Converter mídias para outra estrutura.

## 3. Contrato

```python
# app/migrations/runner.py
from pathlib import Path
import sqlite3

SCHEMA_VERSION = 2  # incrementado por migração

def get_applied_versions(conn: sqlite3.Connection) -> set[int]:
    cur = conn.execute("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER PRIMARY KEY)")
    return {row[0] for row in cur.execute("SELECT v FROM schema_version").fetchall()}

def migrate(conn: sqlite3.Connection, migrations_dir: Path) -> list[int]:
    applied = get_applied_versions(conn)
    new = []
    for f in sorted(migrations_dir.glob("*.sql")):
        v = int(f.stem.split("_")[0])
        if v in applied:
            continue
        conn.executescript(f.read_text())
        conn.execute("INSERT INTO schema_version (v) VALUES (?)", (v,))
        new.append(v)
    conn.commit()
    return new
```

## 4. Plano

1. Inventariar entidades: `projects`, `media`, `queue`, `director_state`, `editor_state`, `app_state`.
2. Para cada, decidir fonte de verdade (SQLite ou JSON filesystem).
3. Criar migração inicial para o schema atual.
4. Implementar `migrate()`.
5. Adicionar teste de migração: rodar com cópia do banco do usuário em `tmp_path`.

## 5. Testes de aceitação

- Migração roda em banco vazio.
- Migração é idempotente (rodar duas vezes não falha).
- Backup/restore em cópia isolada preserva estado.

## 6. Critérios de pronto

- `docs/persistence-matrix.md` publicado.
- CI executa migração + restore como teste.

## 7. Riscos

- Migração parcial em queda de energia. **Mitigação:** cada migração em transação única.
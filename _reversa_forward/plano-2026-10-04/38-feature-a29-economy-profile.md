# Feature A29 — Perfil Econômico E2 (6–8 GB) comprovado

**Origem:** Plano Executivo §7 Eixo 7 + Dossiê R05 + fixture "A luz da oficina".
**Ciclo:** 4.
**Prioridade:** P1.
**Dependência:** fixture "A luz da oficina" (seção 6 do PLANO_EXECUTIVO).

## 1. Contexto

Dossiê seção 28: matriz de perfis E0–E4. Perfil E2 (6–8 GB) é o **econômico central**. README atual diz "6–8 GB works, but expect heavy offloading; slow; stick to short/low-res clips" — sem obra de referência publicada, sem tempo medido de obra completa, sem relatório versionado.

## 2. Requisitos

### 2.1 Comportamento esperado

- Benchmark reproduzível em GPU 6–8 GB com:
  - Fixture "A luz da oficina" em modos F0 (CI determinístico) e F2 (IA completa com modelos leves homologados).
  - Métricas: wall time, VRAM pico, RAM pico, falhas OOM, falhas de decoder, falhas de continuidade, WER do áudio, drift A/V, takes aprovados sem rerun.
- Relatório versionado em `docs/benchmarks/economy_6gb_2026-XX.md` com:
  - GPU exata, driver, versão Cue Studio, hash dos modelos.
  - Tabela de métricas (3 repetições).
  - Screenshots do Dashboard.
  - Master exportado + link para download público.
  - Limitações honestas.
- Smoke test de CI: roda um único clipe de 2s como teste de sanidade (skip se GPU insuficiente).
- Documento `docs/HARDWARE_PROFILES.md` consolidando H0–H4 / E0–E4.

### 2.2 Fora de escopo

- Implementar modelos leves novos (reusar Wan 2.1 1.3B, Hunyuan Video 1.5, ACE-Step 1.5 2B turbo).
- Garantir 100% determinismo entre GPUs.
- Publicar números sem medição local (3 execuções completas).

## 3. Critérios de aceite

- Relatório `docs/benchmarks/economy_6gb_2026-XX.md` publicado.
- Reprodução em GPU similar gera obra em tempo dentro de ±20% do medido.
- README atualizado com referência ao benchmark.
- 7 testes verdes no protótipo (métricas sintéticas em modo offline).
- Corpus sintético em `tests/benchmarks/economy/` com config.yaml, run_bench.sh stub, analyze.py stub.
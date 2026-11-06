---
schema_version: 1
id: BUG-20261106-AKK6
display_number: 2
title: Planejador expande vídeos breves para múltiplas tomadas de vinte segundos
status: active
phase: awaiting-human
severity: medium
priority: P1
created: 2026-11-06
updated: 2026-11-06
express: true
origin: {type: inspection, external_ref: null}
area: unclassified
module: unclassified
feature: unclassified
labels: [spec-gap]
visibility: normal
security_suspected: false
reproduction: {classification: deterministic, rate: '1/1'}
blocking: []
relationships: []
traceability:
  specs: []
  affected_code: [app/services/director/planners/short_film.py, app/services/director_pipeline.py, app/services/director/preflight.py]
  root_cause:
    state: confirmed
    hypothesis: Gramática e buckets impõem vinte segundos por tomada; o envio ao renderizador também impõe um piso artificial de cinco segundos.
    evidence: [evidence/reproduction.md]
  reproduction_tests: [tests/test_story_duration_budget.py]
  regression_tests: [tests/test_story_duration_budget.py]
spec_verdict: null
change_risk: {classification: média, reasons: [Altera planejamento de vídeos breves e rejeita planos fora do orçamento antes de enfileirar renders]}
change_set:
  - {id: CHG-001, kind: code, artifact: app/services/director/planners/short_film.py, purpose: Planejar tomada breve e validar orçamento, diff: fix/CHG-001.diff}
  - {id: CHG-002, kind: test, artifact: tests/test_story_duration_budget.py, purpose: Prova de duração e regressão, diff: fix/CHG-002.diff}
  - {id: CHG-003, kind: test, artifact: scripts/acceptance_director.py, purpose: Medir plano e saída audiovisual, diff: fix/CHG-003.diff}
  - {id: CHG-004, kind: code, artifact: app/services/director_pipeline.py, purpose: Usar mínimo nativo no envio ao renderizador, diff: fix/CHG-004.diff}
  - {id: CHG-005, kind: code, artifact: app/services/director/preflight.py, purpose: Alinhar estimativa à geração, diff: fix/CHG-005.diff}
  - {id: CHG-006, kind: documentation, artifact: app/services/director/clip_schedule.py, purpose: Explicar mínimo nativo, diff: fix/CHG-006.diff}
  - {id: CHG-007, kind: test, artifact: scripts/check_desktop_upgrade.py, purpose: Preservar diagnóstico quando processo já terminou, diff: fix/CHG-007.diff}
closure: {policy: local-software, satisfied: false}
resolution_kind: null
---
# Duração solicitada no planejamento

## Summary
Pedido de 3 segundos gerou três tomadas de 19,7083 segundos na produção 61c6ebe8.

## Expected Behavior
Respeitar o tempo solicitado, considerando a malha de quadros do modelo. Não existe spec efetiva localizada para a tolerância de duração; spec-gap permanece explícito.

## Steps to Reproduce
Executar a produção de aceitação com target_duration=3 e LTX. Evidência anterior: docs/RELEASE_VALIDATION_2026-11-06.json.

## Root Cause
Restrições contraditórias na passagem 2: mínimo de duas tomadas, buckets mínimos de vinte segundos e total solicitado de três segundos. A normalização arredonda novamente para vinte após tentar reduzir.

## Agent Notes
Prioridade e severidade assumidas. Usuário autorizou continuar a correção no contexto desta pendência, sem novos gates redundantes. Correção direta; debate opcional via /reversa-debugger-debate não solicitado. Sem alteração de produções anteriores ou da spec efetiva. Veredito formal de spec pendente; não encerrar com DONE sem ele.

## Verification

13 testes específicos falham com o código anterior; 14 passam após a correção. Regressão final de parser, gramática e recuperação de mídias: 41 aprovados. Suíte completa anterior ao reforço de gramática: 1451 aprovados e 37 subtestes. AppImage final iniciou e atualizou fonte preservando pesos/configurações/histórico em sessão D-Bus isolada.

## Segundo elo confirmado na produção real

Após corrigir o plano, ab9f3285 planejou 3,0417s mas enviou 129 quadros e produziu 5,13s. O piso round(5*fps) em _run_video_generation causou o desvio. Mínimo nativo do LTX: 17 quadros. Pipeline e preflight agora usam esse mínimo; teste integrado confirma envio de 73 quadros. Nova produção reutiliza o plano e as imagens já aprovados, em diretório isolado.

## Resolution

Correção técnica validada no commit 99f3360. Planejamento de uma tomada e mínimo nativo de geração corrigidos; teste real confirma vídeo 2,76s e contêiner 2,89s para pedido 3s, dentro de ±0,25s. Regressão final: 1456 testes e 37 subtestes aprovados. Sem reparo de dados. Veredito formal de spec continua pendente; closure.satisfied=false e nenhuma trava DONE foi criada.

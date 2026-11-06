---
schema_version: 1
id: BUG-20261105-K7M2
display_number: 1
title: Editor não consegue excluir uploads
status: resolved
phase: delivering
severity: medium
priority: P2
created: 2026-11-05
updated: 2026-11-05
origin:
  type: manual-report
area: unclassified
module: unclassified
feature: unclassified
labels:
- spec-gap
security_suspected: false
visibility: normal
relationships: []
traceability:
  specs:
  - _reversa_sdd/addenda/bug-BUG-20261105-K7M2-v001.md#exclusão-de-uploads-no-editor
  affected_code:
  - ui/src/editor/useEditorStore.ts
  - ui/src/api/client.ts
  - app/launch.py
  root_cause:
    state: confirmed
    hypothesis: Servidor não implementava DELETE uploads, embora o Editor já chamasse
      a rota.
    evidence:
    - evidence/tests-red.log
    - evidence/tests-green.log
  reproduction_tests:
  - tests/test_delete_upload.py
  regression_tests:
  - tests/test_delete_upload.py
  - tests/test_upload_sandbox.py
closure:
  policy: local-software
  satisfied: true
spec_verdict: spec-gap
resolution_kind: fixed
reproduction:
  classification: deterministic
  rate: 3/3 before; 0/3 after
---

# Comportamento esperado
A exclusão explícita de um upload remove o arquivo selecionado e atualiza a biblioteca. Nenhuma exclusão em lote é autorizada.

# Diagnóstico
removeLibraryAsset chama deleteUpload. deleteUpload chama DELETE /api/v1/uploads/{name}. launch.py contém apenas GET nesse caminho. A resposta HTTP de método não suportado produz o erro genérico visto pelo usuário.

# Plano
Adicionar rota DELETE restrita à pasta uploads, com safe_delete e validação de caminho. Devolver erro útil quando o arquivo estiver bloqueado. Cobrir caminho inválido, arquivo ausente e remoção isolada em diretório temporário. Melhorar o cliente para mostrar a mensagem retornada pelo servidor.

# Agent Notes
Severidade e prioridade propostas pelo agente. Dados reais não serão apagados durante os testes. Classificação unclassified até aprovação da taxonomia.

## Resolution

Plano e implementação aprovados na resposta explícita "Sim, aplicar a correção e os testes". O plano inclui veredito spec-gap e o contrato agora documentado em adendo aditivo.

CHG-001: rota DELETE e mensagem útil no cliente. CHG-002: testes isolados. Diffs em fix/. Prova: três falhas antes e 18 testes aprovados após a mudança. Nenhuma mídia real foi apagada; não houve reparo de dados.

# TODO de retomada — Maestro

Revisão: 2026-09-14. Base observada: commit `4b82d94` (HEAD) e alterações
locais nos arquivos `ui/src/api/client.ts`, `ui/src/stores/useStore.ts`,
`ui/src/types/index.ts`, `ui/scripts/store-gauntlet.mjs`, `CHANGELOG.md`,
`HANDOFF.md`.

Este documento compara a análise de 2026-09-12 com as correções e extrações
feitas posteriormente. As rodadas anteriores deste revisor foram somente
diagnósticas; as implementações subsequentes pertencem aos outros agentes.
Nesta rodada (2026-09-14) o patch parcial das ações de cancel foi
completado e os gauntlets passaram; o backend real não foi reiniciado.

## Execução em andamento — 2026-09-14 (cancel + contratos)

Esta etapa completou o patch parcial das ações de cancel no `useStore.ts`
e adicionou a quarta suíte de contratos no `test:store`.

Entregue nesta etapa (verificado com os gates abaixo):

- **Três ações de cancel implementadas.** `cancelDirectorAnalyze`,
  `cancelDirectorTrackGen` e `cancelDirectorImageGen` agora abortam a
  requisição em curso via `AbortController`, incrementam a sequência
  invalidadora para descartar resoluções tardias, fecham o estado de UI
  para o passo correto e (apenas image-gen) chamam `api.cancelJob` no
  job server-side. `DirectorImageGenProgress.status` ganhou o literal
  `'cancelled'`.
- **`cancelPlan` agora invoca os três cancels.** O retorno inclui os
  três campos extras (`cancelledAnalyze`, `cancelledTrackGen`,
  `cancelledImageGen`) além dos três originais.
- **API client com `signal?: AbortSignal`.** `analyzeAudio`,
  `generateMusic` e `uploadAudio` aceitam um signal opcional e o plugam
  no `fetch`. Cancelamento client-side real e não apenas bump-de-sequência.
- **Build oficial e lint restaurados.** Patch parcial de `useStore.ts`
  não tinha implementação; agora completa. `tsc -b`, `vite build` e
  `eslint .` passam sem erro.
- **Quarta suíte no `test:store`.** Cobertura de idempotência dos três
  cancels (no-op quando nada está em curso), formato do retorno de
  `cancelPlan`, cancel da análise com `AbortController` honrado, cancel
  da geração de faixa e cancel da geração de imagem incluindo
  `api.cancelJob`.
- **`directorAnalyzeAndPlan` e `directorGenerateStartImages` protegidos
  contra catch após cancel.** O catch compara a sequência capturada na
  entrada com a sequência global e retorna cedo se forem diferentes —
  assim o estado escrito pelo `cancel*` não é sobrescrito por uma
  falha tardia "espúria".

Evidências desta etapa:

| Verificação | Resultado |
| --- | --- |
| `npm run build` | Aprovado |
| `npm run lint` | Aprovado |
| `npm run test:store` | Aprovado — store + persistência + slices + **cancel** |
| `npm run test:control` | Aprovado |
| `pytest tests/ -q` | 171 passed, 2 skipped, 4 deselected, 33 subtests |

Próximas ações: extrair mais endpoints Director HTTP; CI em ambiente
limpo; geração real.

## Execução em andamento — 2026-09-13 (extração de persistência)

Esta etapa extraiu a camada de persistência do Studio e ampliou os contratos.

Entregue nesta etapa (verificado com os gates abaixo):

- `ui/src/stores/studioPersistence.ts` novo: `saveModeSettings`, `loadModeSettings`,
  `modeBlobToLoraIdKeyed`/`modeBlobToFilenameKeyed`, `stripEphemeralParams` e
  `persistStickyStudioPreferences` (fila serializada de preferências no servidor).
  `useStore.ts` conserva `_saveSettings`/`_loadSettings` como aliases e
  `_persistStickyStudioPreferences` como wrapper; slices seguem recebendo-os via
  `dependencies`.
- Contratos de comportamento de `studioModelSlice`/`studioModeSlice` no `test:store`
  (store raiz composta, catálogo determinístico, router de fetch): hidratação de
  visibilidade única por boot; upgrade de defaults curados (v1→v11) uma vez;
  toggle/all/bulk/reset persistem `maestro_enabled_models`; `selectModel` reseta
  LoRA; lifecycle `toggleLora`/`setLoraWeight` grava por modo; receitas
  `recast`/`restyle` trocam para SCAIL-2 e `retake` restaura; mappings de repaint
  clampam a 5 e recast deriva/clampa; roteamento de criação segue mídias
  (`generate`→`guided`) e rejeita omni-only para frames.
- Corrigido o build oficial, quebrado por um import morto do `studioModelSlice`
  (`recommendedH3OmniSequenceProfile`). `npm run build`, `npm run lint`,
  `npm run test:store` e `npm run test:control` terminam com código zero.
- `directorAnalyzeProgress` confirmado alimentado nos dois pollings de análise
  (`useStore.ts`, aprox. linhas 8366 e 9317) com reset por sequência, e defaults
  avançados confirmados aplicados ao payload efetivo (`applyWorkspaceSetup` +
  `startDirectorPipeline` com precedência de overrides por take) — itens P1
  historicos concluídos; atualizar os checklists abaixo.

Evidências atuais desta etapa:

| Verificação | Resultado |
| --- | --- |
| `npm run build` | Aprovado |
| `npm run lint` | Aprovado |
| `npm run test:store` | Aprovado (0=exit), 5 execuções consecutivas |
| `npm run test:control` | Aprovado |
| Python leve (setup, style bible, cli, cinema, registry) | 106 passed, 6 skipped |

Próximas ações: extrair `setParam`/`params`, campos de finishing/advanced e
snapshots por modo que ainda vivem no root (`useStore.ts`); savas dos routers
backend; CI em ambiente limpo; geração/exportação reais. O backend do usuário
não foi reiniciado.

## Execução em andamento — historico (etapas anteriores)

Esta seção atualiza o diagnóstico histórico abaixo. O objetivo completo continua
ativo: esta etapa restaura os gates básicos e corrige parte das integrações;
não conclui a refatoração Studio/Director/backend nem a validação de produção.

Entregue nesta etapa:

- Build oficial corrigido: ordem do chat, payload de preferências, tipos
  completos dos slices e terceiro argumento do StateCreator.
- Lint completo corrigido com exceção restrita ao harness sem HMR.
- Coleta padrão limitada a `tests`; browser executa dentro de funções;
  smoke selecionado explicitamente no CI. CI também executa lint e contratos UI.
- Launcher/stop verificam a identidade do processo antes de encerrá-lo.
  Porta ocupada por outro processo gera erro claro e preserva o listener.
  Fallback extrai a porta numérica; `.env.local` preserva entradas alheias;
  Vite usa `loadEnv`. Sete testes isolados de launcher passaram.
- Pollings de áudio publicam progresso, sucesso/erro e ignoram respostas de
  sessões canceladas. Reset invalida a sessão anterior.
- Cargas/saves de setup ignoram respostas de outro workspace ou request antigo.
- Advanced hidrata controles reais do Director, em vez de ficar apenas num
  objeto sem uso. `projectAdvancedDefaults.ts` delimita as chaves aceitas.
  Overrides por take posteriores e snapshots restaurados prevalecem.
- `npm run test:store` exercita o store composto: respostas fora de ordem,
  saves atrasados, ciclo do progresso, LoRAs e construção do pedido real de
  pipeline, com fetch interceptado antes de qualquer geração.

Advanced atualmente suportado: `image_spatial_upsampling` e
`video_spatial_upsampling` (`""`, `lanczos1.5`, `lanczos2`),
`image_film_grain_intensity`, `image_film_grain_saturation`,
`video_film_grain_intensity`, `video_film_grain_saturation` (0–1),
`video_self_refiner` (0/1/2), `video_num_inference_steps` (inteiro 1–50) e
`minimax_h3_turbo_mode` (booleano). Restrições próprias do modelo continuam
prevalecendo. Chaves desconhecidas não são espalhadas no pedido de geração.
Valores ausentes de advanced restauram defaults; `music_model: ""` restaura
`ace_step_v1_5_xl_sft_lm_4b`.

Evidências atuais: build oficial, lint, contratos UI e sete testes de launcher
aprovados; smoke executado com `-m smoke`: 1 teste e 35 subtests aprovados.
O teste novo `test_director_opens_without_runtime_errors` passou no Chromium
com mutações interceptadas; screenshot em `/tmp/maestro-overhaul/director-runtime.png`.
Na primeira etapa, o teste visual completo ainda falhava por esperar controles
antigos. A segunda etapa abaixo atualizou o teste e corrigiu regressões reais
de Dashboard e revisão de produção.

Próximas ações: modernizar o teste visual completo com todas as mutações
interceptadas desde o início; verificar salvamento/reabertura e snapshot do
setup; validar execução de skill local no backend; concluir CI em ambiente
limpo; seguir as extrações P2. Geração real e exportação ainda não executadas.
O Vite de teste está em `127.0.0.1:3000`, proxy explícito para `7861`; confirmar
processos vivos antes de reutilizar. O backend do usuário não foi reiniciado.

## Segunda etapa — navegação e setup validados

- Corrigida a criação de projetos para aplicar o setup antes de abrir Director.
  Saves atualizam o cartão e invalidam listagens antigas; editar e reabrir o
  formulário conserva a última configuração salva.
- Dashboard agora renderiza o componente existente na aba correspondente.
- Director mostra `DirectorReview` quando a produção está pausada, permitindo
  aprovar cenas e habilitar a continuação sem trocar para Studio/Medias.
- Teste visual atualizado: 35 combinações de sete abas e cinco larguras,
  teclado, telemetria, Dashboard, revisão pausada, histórico/salvamento do
  Editor e CRUD. Todas as mutações são interceptadas desde o primeiro request.
  Resultado: dois testes de shell Chromium aprovados, sem erros JavaScript.
- Novo teste Chromium de criação/edição/reabertura de setup aprovado. Valida
  proporção, resolução e origem de música no estado efetivo do Director.
- Corrigida seleção de skills locais: frontend envia o ID escolhido, pipeline
  conserva `skill_type` separado do workflow de renderização e orquestrador
  resolve planners pelo registry em runtime. Plugins usam v2 mesmo com a
  preferência legada desligada. O teste HTTP real descobre um plugin instalado
  após o import do orquestrador e executa seu planner/renderers; apenas a carga
  do LLM é substituída, pois o planner de demonstração é determinístico.
- Validação desta etapa: build oficial/lint/contratos UI aprovados; suite Python
  padrão: 162 passed, 2 skipped, 4 deselected, 33 subtests. Browser: 3 testes
  aprovados (2 shell + 1 setup). Artefatos em `/tmp/maestro-overhaul/`.

Ainda faltam: CI em ambiente limpo; testes adicionais de snapshots/workflows e
persistência contra backend real isolado; extrações Studio/Director/routers;
geração e exportação reais; revisão final e commits. O backend existente
continua sem reinício. O objetivo completo permanece ativo.

## Estado inicial do diagnóstico (histórico)

- O commit `659907b` contém as correções iniciais, o serviço Workspace Setup,
  o workspace slice e os helpers de Studio/modelos/LoRAs.
- Antes deste documento, havia modificações em `CHANGELOG.md`, `HANDOFF.md`,
  `ui/src/stores/useStore.ts` e o arquivo novo não rastreado
  `ui/src/stores/studioWorkflowSlice.ts`. Preservar esse trabalho.
- A instância existente ainda escuta em `127.0.0.1:7861`, PID observado
  `141029`. Um processo ativo não prova que carregou o Python mais recente.
- Não assumir que o relato de “gauntlet completo aprovado” equivale a uma
  entrega validada. O build oficial falha no estado revisado.
- `studioWorkflowSlice` é uma extração real de workflows, mas NÃO é o
  `studioSlice` completo solicitado no histórico. Seleção de modelos,
  hidratação, troca de modo, snapshots e efeitos de LoRAs continuam na raiz.

## Melhorias da primeira revisão (histórico)

- [x] Extração de persistência/validação de setup para
  `app/services/workspace_setup.py`, com wrappers em `launch.py` e testes próprios.
- [x] Extração de estado/ações de workspace para `workspaceSlice.ts`.
- [x] Extração de helpers em `studioPreferences.ts`, `modelCatalog.ts` e
  `loraState.ts`, e fachadas de seletores por domínio.
- [x] Preservação de IDs de plugins em `canonicalDirectorSkill`.
  Ainda falta validar o caminho completo de execução de uma skill local.
- [x] Inclusão do tipo, estado inicial e setter de `directorAnalyzeProgress`.
  A alimentação desse estado ainda não foi implementada.
- [x] Aplicação de origem/modelo de música e chamada de `directorSetLora`
  a partir do setup; integração de advanced continua incompleta.
- [x] Restauração do guard e dos testes de gramática JSON ausentes.
- [x] Redução dos erros de lint em `src`; o lint oficial ainda falha em `ui/tests`.

## P0 — Restaurar build e confiabilidade da validação

- [x] Corrigir a ordem das declarações em `DirectorChat.tsx`.
  `chatInputEnabled` é lido no array de dependências do `useCallback` na
  linha 672 e declarado na 675. O acesso acontece durante o render; não é
  apenas uma captura adiada pelo callback. Aceite: compilar e abrir Director
  sem erro de variável não inicializada.
- [x] Alinhar `StudioPreferencePayload.audio_sub_mode` ao tipo da API.
  O helper usa `string`, mas `StudioPreferenceUpdate` aceita uma união
  específica. O erro aparece em `useStore.ts:2960`. Usar os tipos de domínio,
  sem encobrir a incompatibilidade com casts amplos.
- [x] Dar tipos completos aos slices extraídos, em vez de `Partial<AppState>`.
  O spread de `studioWorkflowSlice` torna `studioVideoWorkflow` opcional e
  quebra a construção de `AppState` em `useStore.ts:2971`.
  Definir explicitamente os campos e ações pertencentes a cada slice.
- [x] Corrigir a composição de `createWorkspaceSlice`: um `StateCreator`
  recebe `set`, `get` e a API do store; a chamada atual passa apenas dois
  argumentos (`useStore.ts:11454`). Manter a assinatura e a composição coerentes.
- [x] Corrigir o lint de `ui/tests/control-harness.tsx:25` com uma organização
  ou regra específica apropriada ao harness, sem desabilitar o lint global.
- [x] Usar `npm run build` como gate, ou `tsc -b` explicitamente.
  `tsc --noEmit` executado com o `ui/tsconfig.json` atual termina sem verificar
  os projetos referenciados: `files` é vazio. Nesta revisão,
  `tsc --noEmit --listFiles` não listou nenhum arquivo. `vite build` sozinho
  também não substitui a verificação de tipos.
- [x] Evitar validar retorno por `comando | tail` ou `comando | grep` sem
  `pipefail`. Capturar o exit code do comando original e guardar o log completo.

Aceite do P0: `npm run build`, `npm run lint` e `npm run test:control`
terminam com código zero, seguidos de uma verificação visual do Director.

## P1 — Concluir correções funcionais

- [x] Alimentar `directorAnalyzeProgress` nos dois pollings de análise
  (`useStore.ts`, aproximadamente linhas 10153 e 11094). Hoje atualizam apenas
  `directorLoadingMessage`; o setter novo não tem consumidores. Cobrir início,
  avanço, sucesso, erro e reset, inclusive respostas atrasadas após conclusão.
  *Verificado nesta etapa: ambos os pollings alimentam `directorAnalyzeProgress`
  via `trackAnalysisProgress` com sequência/reset; os contratos de análise
  passam no `test:store`.*
- [x] Aplicar os defaults avançados ao payload efetivo de geração/planning.
  `directorAdvancedDefaults` é inicializado e recebe `setup.advanced`, mas não
  é lido por quem cria os pedidos. Definir precedência entre defaults,
  overrides por take e snapshots de produções salvas; não espalhar chaves
  arbitrárias diretamente em pedidos sem um contrato explícito.
  *Verificado: `test:store` exercita `applyWorkspaceSetup` + `startDirectorPipeline`
  e assere aplicação, precedência do override por take e rejeição de chaves
  desconhecidas.*
- [ ] Validar Project Setup de ponta a ponta: salvar, reabrir, trocar projeto,
  iniciar planejamento e comparar os parâmetros enviados. Incluir música,
  LoRAs, opções avançadas e a semântica de valores vazios.
- [x] Proteger `loadWorkspaceSetup` contra respostas fora de ordem ao alternar
  rapidamente entre projetos. Hoje aplica qualquer resposta recebida sem
  conferir se o workspace continua ativo. Verificar também saves pendentes.
  *Coberto pelos contratos de corrida/atraso do `test:store`.*
- [x] Validar uma skill local desde a listagem até o planner correspondente;
  a correção do canonicalizador, isoladamente, não comprova todo o fluxo.

## P1 — Corrigir launcher e proxy

- [x] Corrigir a extração da porta em `start.sh:281`.
  Para `Port 7860 was busy — using 7861 instead.`, o pipeline atual com
  `awk '{print $NF}'` retorna `instead`. Isso gera uma URL inválida e pode
  levar a timeout/encerramento do backend. Validar número e intervalo.
- [x] Carregar `.env.local` antes de resolver o proxy em `vite.config.ts`,
  por exemplo usando a API local `loadEnv` na função de configuração.
  Reprodução isolada nesta revisão: arquivo com `MAESTRO_BACKEND_PORT=7999`
  e proxy resolvido ainda como `http://127.0.0.1:7860`.
- [x] Atualizar a porta efetiva em todos os caminhos de start/reuso relevantes,
  preservando outras entradas de `.env.local`. Hoje a escrita depende de
  build ausente ou fallback e substitui o arquivo inteiro.
- [x] Remover a premissa de que o bundle de produção embute `server.proxy`.
  O proxy é de desenvolvimento; não exigir rebuild de produção por esse motivo.
- [x] Não encerrar um processo alheio apenas porque ocupa a porta. Identificar
  a instância gerenciada e escolher uma porta livre ou falhar claramente.
- [ ] Testar o ciclo em ambiente isolado com a porta ocupada e um backend falso
  que anuncie fallback. Confirmar URL, pidfile, processo preservado e proxy;
  só depois validar o processo real. Não usar projetos do usuário como fixtures.

## P1 — Corrigir testes e CI

- [x] Restringir a coleta padrão a `tests` (`testpaths` ou equivalente).
  `python -m pytest` na raiz ainda coleta `app/models/.../test_vae.py` e falha
  por falta de `datasets`. `pytest tests/` é uma verificação diferente.
- [x] Corrigir o comando smoke do CI para selecionar o marcador `smoke`.
  O comando atual, `pytest tests/test_smoke_imports.py -v`, resulta em
  `1 deselected / 0 selected` devido a `addopts`; não executa o teste.
- [x] Mover o teste de navegador para funções/fixtures. Ele ainda executa
  Playwright no escopo de módulo, antes da seleção por marcador. Com Playwright
  instalado, `-m 'not browser'` não impede esses efeitos de coleta.
- [x] Alinhar documentação de seleção: `--browser` e `--smoke` são citados
  nos comentários, mas não foram implementados como opções pytest.
- [ ] Verificar o CI em ambiente limpo: versões Python/dependências e a
  divergência `pycocotools==0.0.11` no job smoke versus `2.0.11` no guard.
  O sucesso no venv existente não valida a instalação do workflow.
- [ ] Criar testes de contrato para os slices e helpers extraídos: troca de
  workflow, restauração por modo, persistência e LoRAs por fase. O gauntlet
  atual exercita quatro helpers de timeline/review/plano, não essas extrações.
  *Progresso: o `test:store` agora exercita `studioPersistence`
  (round-trip, sticky, fila), `studioModelSlice` (visibilidade/hidratação,
  defaults curados, enabled write-through, `selectModel` e lifecycle de LoRA)
  e `studioModeSlice` (receitas de edição do Avatar, mappings de mappings e
  roteamento de criação por mídia). Faltam os contratos de `setParam`/campos
  de finishing no root e a restauração por modo via `setGenerationMode`.*

## P2 — Retomar a refatoração planejada após os gates verdes

- [ ] Completar a fronteira Studio: mapear dependências e extrair seleção de
  modelos, opções, hidratação, parâmetros, snapshots, troca de modo e efeitos
  de LoRAs com testes de comportamento entre cada corte. Preservar `useStore`
  como API pública e evitar inicialização duplicada.
  *Já extraído: `studioModelSlice` (catálogo/hidratação/seleção/LoRAs),
  `studioModeSlice` (route, edição, sub-modes), `studioWorkflowSlice` (rotas de
  workflow) e, nesta etapa, `studioPersistence` (persistência por modo + sticky).
  Permanecem no root: `setParam`/`params`, snapshots e troca de modo
  (`setGenerationMode`), campos de finishing (upsampling/film grain/sel-reifier)
  do Studio e do Director, efeitos de download de LoRAs e preferências de visibilidade.
- [ ] Extrair slices reais do Director; seletores/namespace não equivalem a
  mover a implementação de ações/estado para um domínio separado.
- [ ] Extrair grupos backend de modelos/LoRAs, Director/pipeline e mídias,
  preservando contratos HTTP e comparando rotas antes/depois. A extração do
  serviço de setup não equivale à divisão desses routers.
- [ ] Atualizar `HANDOFF.md` e `CHANGELOG.md` para refletir estado comprovado,
  removendo afirmações de conclusão incompatíveis com os gates atuais.
- [ ] Validar navegação/responsividade, geração real de imagem/vídeo,
  exportação e recuperação de erros. Registrar entradas, resultados e limites.
- [ ] Revisar e registrar as alterações em commits coerentes, incluindo
  `studioWorkflowSlice.ts`; conferir novamente o working tree antes disso.

## Comandos para repetir a verificação

Resultados do diagnóstico inicial, anteriores às correções acima:

| Verificação | Resultado |
| --- | --- |
| `npm run build` | Falhou: cinco diagnósticos TypeScript, quatro causas descritas no P0 |
| `npm run lint` | Falhou: um erro no harness de testes |
| `npm run test:control` | Aprovado |
| `python -m pytest tests/ -q` | 162 passed, 2 skipped, 1 deselected; 31 subtests passed |
| `python -m pytest` na raiz | Erro de coleta: `datasets` ausente em teste de código de terceiros |
| Smoke com o comando atual do CI | 1 deselected, 0 selected; não executou o smoke |
| `verify_clean_repo.py` | Aprovado, 2063 arquivos rastreados auditados |
| Sintaxe Bash e `git diff --check` | Aprovados |
| Extração de porta com a mensagem de fallback | Retornou `instead`, em vez de `7861` |
| Configuração Vite com `.env.local` temporário apontando a 7999 | Proxy permaneceu em 7860 |

Logs desta sessão estão em `/tmp/maestro-review-*.log`; são temporários e
não devem ser a única evidência da próxima rodada. O guard audita arquivos
rastreados; seu resultado não cobre automaticamente arquivos ainda untracked.

Executar da raiz, separadamente, preservando os códigos de saída:

```bash
(cd ui && npm run build)
(cd ui && npm run lint)
(cd ui && npm run test:control)
(cd ui && npm run test:store)
app/env/bin/python -m pytest tests/ -q
app/env/bin/python -m pytest tests/test_smoke_imports.py -m smoke -v
python3 scripts/verify_clean_repo.py
bash -n start.sh stop.sh
git diff --check
```

O smoke com `-m smoke`, navegador, geração real e exportação não foram
executados nesta revisão. Não reutilizar como resultado atual os números do
relato do outro agente sem executar o comando correspondente.

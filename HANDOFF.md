# Handoff — Cue Studio fork standalone (2026-09-15)

## Atualização de retomada — 2026-09-14

Consultar primeiro [TODO_RETOMADA](docs/TODO_RETOMADA.md), seção “Execução em
andamento”. O texto abaixo contém histórico e não equivale à validação atual.
HEAD verificado: `4b82d94` (feat(projects): template skills, advanced
collapse, compact skill, neutral auto, model hints). 24 commits à frente
de `659907b`, todos do ciclo `feat/projects/style(projects)` (cards,
banners, skill no setup, model pickers, audio picker etc.). As release
notes de [v2.1](docs/RELEASE_NOTES_V2.1.md) já estão redigidas; `VERSION`
e `pyproject.toml` continuam em 2.0.1 até a promoção explícita.

O build oficial (`npm run build`) e o lint (`npm run lint`) foram
restaurados nesta etapa. O patch parcial em `useStore.ts` que adicionava
as assinaturas de `cancelDirectorAnalyze` / `cancelDirectorTrackGen` /
`cancelDirectorImageGen` foi completado: cada ação aborta o fetch em curso
via `AbortController`, dispara a sequência invalidadora, fecha o passo de
UI correto e (para image-gen) chama `api.cancelJob` no job server-side.
`cancelPlan` agora invoca as três ações e devolve os três campos extras
no retorno estruturado. O `test:store` ganhou a quarta suíte de
contratos (`Cancel contracts`) cobrindo idempotência, formato do retorno
e cancel real em cada um dos três fluxos.

Quatro suítes passam no `test:store`, duas no `test:control`, e 171
testes Python passam (2 skipped, 4 deselected, 33 subtests). O backend
real não foi reiniciado nesta etapa — apenas o working tree e os
gauntlets foram validados.

### Validação da segunda etapa (histórico)

O shell Chromium passou em sete abas e cinco larguras, com revisão de produção,
histórico do Editor e CRUD sob interceptação de gravações. Criação/edição e
reabertura de setup também passaram; criar um projeto agora aplica os defaults
antes de entrar no Director. Dashboard e revisão de produções pausadas foram
conectados aos componentes existentes. A API foi testada com um plugin local
real descoberto após o import do orquestrador; seu ID chega ao planner correto.
Build, lint, contratos UI e 162 testes Python passaram. Geração/exportação
reais e a refatoração estrutural completa continuam pendentes.


### Validação da segunda etapa

O shell Chromium passou em sete abas e cinco larguras, com revisão de produção,
histórico do Editor e CRUD sob interceptação de gravações. Criação/edição e
reabertura de setup também passaram; criar um projeto agora aplica os defaults
antes de entrar no Director. Dashboard e revisão de produções pausadas foram
conectados aos componentes existentes. A API foi testada com um plugin local
real descoberto após o import do orquestrador; seu ID chega ao planner correto.
Build, lint, contratos UI e 162 testes Python passaram. Geração/exportação
reais e a refatoração estrutural completa continuam pendentes.

## Estado e escopo

Fork local baseado em `Blizaine/Maestro v2.0.1`, executado por scripts Bash e
ambiente Python local. Os scripts e menus do antigo launcher foram removidos.
Compatibilidade com configurações legadas ainda existe no backend; referências
históricas não significam dependência do launcher.

O HEAD verificado antes desta revisão é `1c3a241`, que já inclui o alinhamento
dos headers e a versão anterior deste handoff. As correções descritas abaixo
estão no working tree, sem commit nem push. Não use uma contagem antiga de
commits à frente do remoto como estado atual; consulte `git status` e `git log`.

## Como executar

Siga [README — Install](README.md#install) para criar `app/env` com Python 3.12,
PyTorch 2.7.1/CUDA 12.8 e dependências, e construir a UI.

```bash
./start_local.sh                 # 127.0.0.1:7860
./start_local.sh --port 7900     # porta explícita
./start_local.sh --share         # 0.0.0.0, acesso LAN
./start_local.sh --compile       # encaminha --compile ao backend
./stop_local.sh
```

O script seleciona `env-sol` → `env-rtx50` → `env`, informa GPU/driver,
constrói a UI se `ui/dist/index.html` estiver ausente, inicia o backend e
aguarda resposta HTTP de sucesso. O probe usa loopback e ignora proxies do
ambiente, inclusive com `--share`. Portas inválidas são rejeitadas antes do
lançamento. PID e log ficam em `app/.launcher.pid` e `app/.launcher.log`.

`SERVER_NAME` explícito agora prevalece sobre `PINOKIO_SHARE_LOCAL`. Assim,
a variável legada não inverte o comportamento de `start_local.sh`. Em execução
direta de `launch.py`, ela continua servindo de fallback sem `SERVER_NAME`.

Rebuild após mudanças de frontend: `cd ui && npm run build`. O script não
detecta código-fonte mais recente quando já existe um bundle.

## Implementações confirmadas

- **Interface reorganizada:** cinco abas centrais no header: Projects,
  Director, Editor, Medias e Configurations. Projects é a página inicial.
- **Projects:** espaços de trabalho com criação, pesquisa, abertura e exclusão
  confirmada. Atalhos para Director, Editor, Medias e produções salvas.
- **Director:** Planning e Studio na mesma seção. Revisão/aprovação e progresso
  de produção continuam acessíveis, inclusive em telas pequenas.
- **Skills:** Music Video e Short Film disponíveis; Video Podcast e Viral
  Video permanecem desabilitados como funcionalidades futuras.
- **Configurations:** página própria com Performance, Integrations e Notifications.
- **Barra de status:** única e global, em toda a largura inferior. Projeto ativo,
  contagem de mídias, GPU/VRAM, CPU/RAM e modelo; detalhes expansíveis acima.
- **Editor:** troca de abas preserva histórico e salva alterações pendentes.
- **Compatibilidade:** atalhos antigos para Studio/Director/Editor selecionam a
  aba correspondente; a flag legada não oculta mais a navegação Director.
- **Documentação:** CHANGELOG corrigido para os defaults atuais; README substitui menus removidos por instruções standalone. Mensagens
  de erro de PyTorch e porta não encaminham mais ao antigo launcher.
- **Controle:** `ui/scripts/control-gauntlet.mjs` verifica snapshots, revisão
  persistida, reordenação e operações na timeline.
- **Acesso remoto integrado removido:** serviço Tailscale, rotas, controles
  da interface, guia de configuração e dependência de QR code foram removidos.
  Notificações e acesso LAN via `--share` permanecem.

## Histórico corrigido

- `ac399a5`: defaults do Director.
- `d3f59b6`: limpeza de documentação e exclusão de documentos pessoais/runner.
- `d798e60`: adicionou **documentação**, não implementação de monitoramento.
  O relatório de monitoramento descrevia uma coleta temporária da sessão,
  sem serviço permanente. Logs e UI de acompanhamento existentes não devem
  ser confundidos com um coletor contínuo novo.
- `2f96b76`: removeu a antiga suíte Python. Ela não foi restaurada integralmente.
  Esta revisão adiciona apenas `tests/test_standalone_launch.py` para as
  regressões de execução standalone. Os testes em `ui/` permanecem disponíveis.

## Validação

Na análise anterior às correções:

- UI: `npm run build` aprovado, incluindo TypeScript; avisos de bundle grande
  e import estático/dinâmico, sem erro de build.
- `npm run test:control`: aprovado.
- Instância existente: `/` e `/docs` responderam HTTP 200. **A rota
  `/classic/` foi removida da UI ativa e retorna 404 — references
  históricas no CHANGELOG/README são anteriores à remoção e não
  refletem o estado atual. A navegação agora é React-only, com cinco
  abas centrais no header (Projects, Director, Editor, Medias,
  Configurations).**
- Imports: torch `2.7.1+cu128`, mmgp `3.7.12`, diffusers `0.36.0`,
  transformers `4.57.1`, fastapi `0.141.1`, gradio `5.29.0` aprovados.
- CUDA 12.8 disponível; RTX 3060, driver 595.84.

Após as correções: os três testes standalone passaram (incluindo seis casos
de precedência, seis entradas de porta inválidas e dois ciclos de início/parada).
Os testes de controle da UI, a sintaxe Bash/Python e `git diff --check` também
passaram. Para repetir sem carregar modelos:

```bash
python3 tests/test_standalone_launch.py
bash -n start_local.sh stop_local.sh
python3 -m py_compile app/launch.py
(cd ui && npm run test:control)
git diff --check
```

O teste standalone cobre prioridade de endereço, porta inválida e início/parada
com backend HTTP temporário, tanto em loopback quanto com `--share`, incluindo
ambiente com proxy inválido. Não é um teste de geração ou do backend completo.

## Limites e próximos passos

- Reiniciar a instância real para carregar alterações de Python. A revisão
  preservou a instância aberta; o teste de ciclo de vida usa uma cópia isolada.
- Geração real de imagem/vídeo não foi executada nesta revisão.
- O launcher verifica se o PID pertence a `launch.py` deste checkout antes de
  encerrá-lo. Se a porta estiver ocupada por outro processo, preserva-o e falha
  com orientação para escolher uma porta livre.
- O backend pode escolher outra porta se a solicitada ficar ocupada durante
  o lançamento. O launcher agora lê esse fallback do log, atualiza a URL
  exibida e reescreve `ui/.env.local` para que o proxy do Vite acompanhe
  a porta efetiva. A corrida entre o probe e o bind ainda não é coberta
  por uma execução contra a instância real.
- Não há coletor de monitoramento permanente entregue por esta revisão.

## Roadmap de manutenção estrutural

O levantamento de 2026-09-12 confirmou uma dívida de manutenção relevante,
mas não um defeito imediato: `app/launch.py` tem aproximadamente 29 mil linhas,
450 funções e 190 rotas; `ui/src/stores/useStore.ts` tem aproximadamente 14 mil
linhas e 478 ações. Uma migração ampla agora teria risco alto e pouco benefício
operacional, então a extração deve ser incremental e protegida pelos testes.

### Backend (`app/launch.py`)

Extrair nesta ordem, sempre mantendo wrappers compatíveis no módulo atual:

1. **Workspace setup**: `_DEFAULT_PROJECT_SETUP`, carga/persistência de
   `setup.json` e as rotas `/api/v1/workspaces/*/setup`.
2. **Modelos e LoRAs**: catálogo de modelos, normalização de preferências,
   CivitAI/HuggingFace e cache de respostas.
3. **Director HTTP**: catálogo de skills, pipeline, fila e status.
4. **Uploads e outputs**: validação de caminhos, listagem de mídias e
   operações de arquivo.

Cada grupo deve virar um `APIRouter` ou serviço em `app/services/`, sem mover
primeiro funções que dependem de estado global de inicialização. O critério de
aceite para cada extração é: `python3 -m py_compile app/launch.py`, smoke-import,
pytest e uma comparação de `app.routes` antes/depois.

### Frontend (`ui/src/stores/useStore.ts`)

Preservar `useStore` como fachada pública e extrair slices por domínio:

1. `directorSlice`: planejamento, análise, skills, fila e progresso.
2. `studioSlice`: modelos, LoRAs, parâmetros e preferências por modo.
3. `workspaceSlice`: workspaces, setup e uploads.
4. `editorSlice`: projetos, timeline, histórico e exportação.

O primeiro passo de uma futura migração deve ser gerar tipos de slice e testes
de contrato, não mover ações diretamente. `directorSelectors.ts` já é a borda
mais segura para começar porque reduz acoplamento sem mudar a API do store.

### Progresso da primeira extração (2026-09-13)

- Workspace Setup foi extraído para `app/services/workspace_setup.py`.
  `launch.py` conserva wrappers compatíveis e converte o erro de domínio
  para `HTTPException` apenas na borda HTTP. Há testes isolados em
  `tests/test_workspace_setup_service.py`, além dos testes legados de
  `tests/test_project_setup.py`.
- O estado e as ações de Workspace foram extraídos para
  `ui/src/stores/workspaceSlice.ts` e compostos na store raiz por
  `createWorkspaceSlice(set, get)`. Os nomes públicos do `AppState`
  permanecem iguais, portanto consumidores antigos não precisam migrar
  de uma vez.
- O frontend ganhou `workspaceSelectors.ts` e `studioSelectors.ts`, e
  `directorSelectors.ts` passou a expor também `analyzeProgress`.
  `ProjectsPage` e o painel de status do Director já usam essas fachadas.
- O Editor já é um store separado em `ui/src/editor/useEditorStore.ts`;
  portanto a próxima etapa não deve recriá-lo dentro de `useStore.ts`.
- O Studio ainda não foi dividido em um `StateCreator` completo: seleção de
  modelo, parâmetros, LoRAs e persistência compartilham invariantes e
  inicialização pesada. A fachada `studioSelectors.ts` já reduz o acoplamento;
  a próxima extração segura deve separar primeiro persistência de preferências,
  depois o catálogo de modelos, cada uma com contrato próprio.
- A primeira parte dessa sequência já foi extraída para
  `ui/src/stores/studioPreferences.ts`: normalização de `tools` para o modo
  persistido e construção do payload da API agora são funções puras. A escrita
  em localStorage/servidor permanece na store raiz até o próximo corte.
- A normalização e composição do catálogo de modelos foi extraída para
  `ui/src/stores/modelCatalog.ts`; `loadModels` ainda controla hidratação,
  migração e efeitos colaterais, mas a transformação dos registros da API
  agora é pura e preserva explicitamente os metadados do Director.
- O núcleo matemático de LoRAs foi extraído para
  `ui/src/stores/loraState.ts`: contagem de fases, toggle, serialização de
  multiplicadores e atualização de peso agora são puros. `useStore` mantém
  as regras de turbo, persistência e efeitos de download.
- O roteamento de workflows do Studio foi extraído para
  `ui/src/stores/studioWorkflowSlice.ts`, composto como `StateCreator` na
  store raiz. Video Frames/References/Extend/Blend, Image Generate/Inpaint/
  Outpaint e as rotas de Tools continuam com os mesmos nomes públicos; o
  callback de persistência é injetado, enquanto o modo-switch completo
  permanece no root por ainda compartilhar os snapshots por modo.
- A persistência do Studio foi extraída para `ui/src/stores/studioPersistence.ts`:
  `saveModeSettings`/`loadModeSettings` (chave, versão, tradução lora_id/filename,
  disambiguation `#`, strip de campos efêmeros e heal do sufixo `T`) e
  `persistStickyStudioPreferences` (durable generation mode, payload do servidor e
  fila serializada resistente a falha). A store raiz mantém `_saveSettings`/
  `_loadSettings` como aliases e `_persistStickyStudioPreferences` como wrapper,
  então consumidores antigos (inclusive slices via `dependencies`) não migram.
  Os contratos do `test:store` passaram a exercitar o módulo isolado com um
  localStorage fake: round-trip efêmero/legado/lora_id, sticky preservation e a
  fila de preferências. Esta era a próxima extração "persistência primeiro" do
  estúdio; o catálogo (`studioModelSlice`) e o modo (`studioModeSlice`) já tinham
  saído.
- Os contratos de comportamento para `studioModelSlice`/`studioModeSlice` foram
  adicionados ao `test:store` (a store raiz é composta com um catálogo
  determinístico e um router de fetch): (a) a visibilidade do servidor hidrata
  uma única vez por boot e o upgrade determinístico de defaults curados (v1→v11)
  mescla as adições uma vez; (b) toggle/all/bulk/reset de `enabledModels`
  persistem o whitelist em `maestro_enabled_models`; (c) `selectModel` reseta a
  runtime de LoRA por troca de modelo e actors `toggleLora`/`setLoraWeight`
  gravam `savedLoraPerMode` por modo; (d) as receitas `recast`/`restyle` do
  Avatar trocam para os checkpoints SCAIL-2 e `retake` restaura o modelo anterior,
  incluindo o stash para reentrada; (e) mappings de repaint clampam a 5 slots e
  o recast deriva target/person count do primeiro item; (f) o roteamento de
  criação segue as mídias (`generate`→`guided` conforme um frame aparece) e
  modelos omni-only são rejeitados para intenção frames. Execução repetida 5/5
  estável. Falta ainda: extrair `setParam`/`params` e os campos de finishing
  (`slidingWindow*`, `filmGrain*`) que ainda vivem no root.

## Verificação visual da nova interface

Com o backend e o Vite (`cd ui && npm run dev`) ativos, execute:

```bash
python tests/test_application_shell.py
```

Requer Playwright com Chromium instalado. O teste usa cinco larguras de tela,
verifica centralização das abas e geometria do rodapé em todas as seções,
atalhos, configurações, revisão do Director, persistência do Editor e CRUD de
projetos. As gravações de projetos exercitadas pelo teste são interceptadas;
as fixtures não são persistidas no backend. Capturas e resultado vão para
`/tmp/maestro-overhaul` por padrão.

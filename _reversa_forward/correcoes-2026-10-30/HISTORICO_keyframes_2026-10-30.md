# Checkpoint — objetivo ativo: atacar todos os pontos de atenção

## Regras e escopo

Base `main`/`d2bac33`, v2.5.2, sem commit/push. Política `.reversa/reversa-config.json` lida: `allowLegacyEdits=true` com allowlist. Não alterar essa config nem `pyproject.toml`. Análise inicial `_reversa_sdd/estado-atual-2026-10-29.md` preservada. Não usar subagentes sem autorização explícita.

O objetivo continua ativo. Escopo: bootstrap, rotas, modularização, bundles, instalações reproduzíveis, documentação e nova produção real com revisão artística humana vinculada ao master. Não declarar conclusão pelo êxito dos testes de software.

## Código e verificação atual

- Corrigidos shims PyTorch, boot com config parcial, montagem dupla de capacidades/cinema/launcher, contrato HTTP com prefixos reais, corrida de rascunho vs setup, efeitos de navegação e consulta CUDA durante imports CPU.
- Extraídos `runtime_config.py`, `runtime_custom_settings.py` (schema/parsing puro), routers `editor_projects.py`/`media_library.py`, restauração de sidecars, submissão Director e slice síncrono de geração Studio (preserva snapshot no clique).
- Store: **8.284 linhas**, antes 12.526. Launcher ~29.375, WanGP ~15.200; modularização ainda parcial. Não tratar redução de linhas como conclusão das fronteiras.
- Corrigida exportação Editor: filtro FPS final após overlay perdia o último quadro (23 em vez de 24). Conversão final fica no `-r`. Três renders reais de regressão a 24/30/60 fps passaram; export HTTP CPU pós-reload também tem 24 quadros + AAC.
- `/tmp/cue-standard-final.log`: **1.117 passed, 12 skipped, 63 deselected, 33 subtests**, 134.31s. Suíte completa após extração de settings e correção de export.
- `/tmp/cue-smoke-settings.log`: **1 passed, 35 subtests**, processos CPU novos após extração.
- `/tmp/cue-build-current.log`: build acíclico, **33 chunks**, maior **196.585/220.000 bytes**. Vite reprova ciclo entre chunks e orçamento excedido.
- `/tmp/cue-layered-ui-gates.log`: lint, 217 Vitest, store/control aprovados. Sem alteração JS posterior.
- `/tmp/cue-browser-final.log`: **4 passed**, 32.23s (shell/Director/setup/bundle). Escritas interceptadas, não interferem nos jobs reais.
- Último guard: 2.853 arquivos rastreados + novos, zero violações. Repetido após documentos/evidências novos: zero violações. `git diff --check` aprovado.

## Instalações

- `app/env`: Python 3.11.18, torch 2.10.0+cu130, RTX 3060 12 GB, driver 595.99.02. É o runtime de produção. Nunca ocultar CUDA nele durante inferência.
- E0: lock `E0.cpu-only.txt`, 282 pacotes, torch CPU, sem distribuições NVIDIA; strict sync/check/imports, boot HTTP e export software reais. `E0-runtime/export-corrected-evidence.json`: job `ef62baa3`, SHA `2d824a2642cce2ab3af6b4a6c9ff8001c1028d67149f25292e1e8690a3ec53b2`, 24 quadros + AAC. Export anterior de 23 quadros preservado, não promovido.
- E1/E2/E3/E4: **300 pacotes por ambiente independente**, sync estrito com hashes, uv pip check e imports reais aprovados. Envs em `app/.cache/validation-2026-10-30/{E1-env,E2-env,locked-env,E4-env}`.
- Perfis GPU atuais compartilham CUDA 13/torch 2.10; as propostas históricas CUDA 11.8/12.1/12.4/12.8 NÃO foram homologadas. E1/E2/E4 não têm benchmark em hardware alvo. Não extrapolar instalação em RTX 3060 para VRAM 4/8/24 GB.
- Manifest global + `E{i}.source-manifest.json` padrão + `installation-evidence.json` em `app/locks/`. `python scripts/verify_runtime_locks.py` valida pins, SHA e drift dos cinco perfis; CI inclui gate. Revalidar hashes ao mudar inputs/locks.
- Decord: rebuild explícito 0.6.0+cue1, 37 arquivos runtime idênticos ao upstream, decode real de 8 frames. `scripts/build_decord_wheel.py`, wheel SHA `514fa01b918330a9a63c8d2770be258fc07bde9b3d32b76b0fff53765f69baad`.
- uv está em `/tmp/cue-analysis-venv/bin/uv`. Passar `--find-links app/.cache/runtime-wheels` NA CLI; não emitir caminho relativo dentro de lock. Normalizar hashes MD5 de índice com `scripts/normalize_lock_hashes.py` conservando SHA-256.

## Processos — revalidar sempre

- Backend GPU **PID 324186**, sessão **86338**, `http://127.0.0.1:7870`, log `/tmp/cue-validation-server.log`. Config/cache/SQLite isolados sob `app/.cache/validation-2026-10-30/`. Código atual de settings/export foi alterado depois do boot: não reiniciar com geração ativa. Mudanças não afetam inferência em andamento.
- Backend CPU E0 **PID 356567**, sessão **71936**, porta **7872**, log `/tmp/cue-e0-server.log`. Recarregado e export correto comprovado. O log tem NUL/linhas finais do processo antigo 338052 por reutilização do arquivo; não confundir com término do novo servidor. API `/health/version` confirma JSON; `/health` é fallback HTML e não prova saúde.
- Vite porta **3070**, proxy 7870, PID 4118102, sessão **69614**, log `/tmp/cue-vite-dev.log`. Node sistema18; comandos UI usam `npx --yes --package=node@22 -c 'npm run ...'` com workdir `ui/`.
- **NÃO reiniciar backend GPU com jobs ativos.** Conferir `/api/v1/jobs` e recibos antes de submeter novo pedido.
- Logs podem conter stacks base64 enormes: sempre limitar linhas E largura (`cut -c 1-220`); não despejar log bruto.

## Produção real e probes

Artefatos ignorados pelo Git em `app/outputs/validation-2026-10-30/`.

1. **film-v1 TERMINADO exit1**, runner antigo sessão10914. 31 recibos concluídos: quatro falas PT-BR Qwen, música ACE-Step, duas âncoras, 12 imagens e 12 vídeos. `shot-evidence.json` conserva 14 falhas. Sem efeitos/master. Não sobrescrever evidências.
2. Revisão histórica corrigida: `docs/HANDOFF_V11.md` diz que v10 JÁ foi reprovado por humano em cinco dimensões críticas; não relatar aprovação pendente desse master histórico. Arquivo não veio no clone.
3. Detector de bulbo não confunde madeira com luz (corpus real S06/S09/S11 + hashes). Ausência de par mensurável nunca vira separação comprovada. Bulbos apagados podem ser não mensuráveis; planos acesos exigem par. `identity_view` distingue rosto/mãos/ausência; lenses agora também são gate nos vídeos com rosto.
4. `scripts/probe_reference_recipe.py` reutiliza SOMENTE pedido idêntico + SHA válido dentro da raiz, nunca sobrescreve recibo existente. 3 testes aprovados. Receita alterada exige diretório novo.
5. **probes-v2** encerrado: ambiente novo com encaixe na face frontal inferior e holder de cerâmica; S06 tinha mão trocada; S11 só duas lentes.
6. **probes-v3** encerrado, runner vídeo sessão46053 exit0 (produção dos probes, não aprovação): nova âncora neutra com 3 lentes, mão direita corrigida, imagens S06/S09/S11 concluídas. Vídeos:
   - S06 reprovou lentes/escala: caminhou em direção à câmera e saiu parcialmente do quadro; cubo único e régua relativa estáveis. `S06-video-evidence.json`, `video-contact.jpg`.
   - S09 reprovou separação mensurável: zoom no bulbo removeu cubo do quadro. `S09-video-evidence.json`.
   - **S11 passou** lentes/escala/cubo/separação: `S11-video-evidence.json`. Não gerar novamente sem necessidade; seu pedido/artefato podem ser reutilizados se exatos.
7. **probes-v4 EM EXECUÇÃO**, processo observado **370946**, sessão **23026**, log `/tmp/cue-probes-v4.log`. Começou após término do v3, sem concorrência GPU. Stages: `S04-image,S06-image,S07-image,S04-video,S06-video,S07-video`. Reutiliza âncoras v3 e S06-image (pedido idêntico). Novo S06 pede câmera fixa e dois passos laterais sem aproximação; S04/S07 frontais, mão direita em screen-left e cubo metade da largura da cabeça. **Não editar receita enquanto runner estiver ativo.**
8. Stills v4 concluídos: S04/S06/S07 passam 3 lentes e 1 cubo. Régua still S04=1.3039, S06=1.7361, S07=1.7237; S04 desenhou robô atrás da mesa (profundidade distinta), potencial falha de escala — medir vídeo e corrigir posição em candidato novo se necessário. S04-video iniciou, job observado `f7455e92`. Evidência em `probes-v4/still-evidence.json`, contato `contact.jpg`.
9. v4 contém candidatos de movimento fixo S09/S11, mas estes NÃO estão nos stages desse processo. Próximo probe necessário é S09-video com mesmo still e câmera fixa; **S11 deve usar o movimento v3 já aprovado**, não o candidato v4 sem necessidade. Consolidar em receita nova imutável após provas.

Receita de máquina original: `f2-config.json`; configurações de modelo não mudar em pedidos já concluídos. Imagem Flux2 klein9b 1280×720/4steps/guidance1/NAG1.5; vídeo LTX2 22B distilled 129 frames/8steps; música ACE-step; voz Qwen PT-BR; SFX MMAudio v2 ainda não executado nesta rodada.

## Próximas ações

1. Monitorar v4 por recibos/API, medir stills e vídeos (lentes, escala, régua, cubo), inspecionar anatomia/continuidade. Não duplicar jobs. Se still ruim, corrigir candidato em outro diretório antes de lote integral.
2. Provar S09 com câmera fixa; conservar S11 v3 aprovado. Atualizar demais planos com a mesma geometria e visibilidade do rosto, preservando macros de mão. Receita canônica ainda NÃO foi substituída por candidatos.
3. Criar `film-v2` e config nova somente após probes adequados. Reusar fala/música/âncoras/clipes apenas quando pedido é exatamente igual e hash válido. Evitar render integral de ~1h com defeitos já conhecidos.
4. Concluir filme, cinco efeitos e portas técnicas de som/master; construir/servir review com HTTP Range e pedir avaliação humana real vinculada ao SHA. Não inventar aprovação.
5. Continuar fronteiras coesas dos arquivos centrais sem regressões. Instalação reproduzível está provada, benchmarks de hardwares externos não.
6. Atualizar evidências/docs/guard/diff após mudanças. Documentos atuais: `CURRENT_STATE`, `TODO_RETOMADA`, `INSTALLATION_VERIFICATION`, `REFERENCE_FILM_VALIDATION`. Históricos byte-a-byte em `docs/history/`.

## Candidato preparado após este checkpoint

`probes-v5/recipe.json` consolida todos os demais planos com câmera fixa/mesmo ambiente/visibilidade adequada, conserva o movimento S11 v3 já aprovado e corrige S04 para robô no lado da câmera, à frente da mesa (mesma profundidade do cubo). **Não é receita canônica aprovada.** Um runner foi agendado com espera explícita pelo término do processo v4 `370946`, para evitar concorrência GPU. Ele copiará recibos candidatos v4/v3 para `probes-v5/source-receipts/` (sem sobrescrever), e renderizará somente os 12 stills, reutilizando apenas pedidos e hashes idênticos. Log `/tmp/cue-probes-v5-images.log`. Não executar outro lote concorrente. Revalidar processo antes de interferir; a espera não significa geração já iniciada.

- Atualização v4: S04-video concluiu e passou lentes/cubo/régua relativa (mediana1.4621), mas **reprovou escala** (head134→478px, fator3.5672). Contato `probes-v4/S04-video-contact.jpg` confirma zoom real, não falso positivo. A câmera do LTX aproximou apesar do prompt fixo. Investigar controles/LoRA de câmera, parâmetros ou comprimento nativo antes de outro lote integral; não relaxar o gate nem simplesmente repetir a mesma instrução textual. Runner v4 seguiu para S06-video.

## Controle de câmera — investigação a continuar

O metadata de S04 confirma que o prompt enviado chegou sem alteração (1.076 caracteres); não houve enhancer substituindo o pedido. Repetir a instrução textual não resolveu o zoom. O runtime LTX **suporta image_end**: `ltx2_handler.py` declara `image_prompt_types_allowed=TSEV` e `end_frames_always_enabled=True`; `ltx2.py` linhas~2301/2322 monta end_images com condicionamento. Investigar keyframe final condicionado em probes novos: gerar final de S09 com MESMA composição e apenas bulbo aceso usando image_refs do still inicial; usar como image_end (não inventar mídia). Para S04 final com cubo na mão e mesma câmera/escala. Não usar S11 com robô como final de S09 sem robô, nem still idêntico apagado como fim de lâmpada acesa. Não alterar configuração/recibos já submetidos. Os modelos publicados de controle de câmera/LoRA ainda não foram pesquisados.

Torch compilado reportou arquiteturas sm_75, sm_80, sm_86, sm_90, sm_100, sm_120, compute_120. VRAM por si só não define compatibilidade; não prometer suporte a GPUs Pascal só por terem 6 GB.

Runner de stills v5 agendado: sessão **58955**, aguardando v4; log `/tmp/cue-probes-v5-images.log`. Revalidar estado antes de submeter mais trabalho.

## Continuação: controle por keyframes

- Turno anterior classificado como **progresso**: código/instalações/testes/produção geraram estado e evidências novas.
- V4 S06 concluiu e passou lentes/cubo/régua relativa (1.9195), mas **reprovou escala**, head140→445px, fator3.1786. `S06-video-evidence.json` preservado. S07 ainda observado em decodificação, job `d7ae8650`; revalidar.
- **A espera do v5 foi CANCELADA antes de qualquer geração**: wrapper PID378727 tinha somente `sleep5` como filho, recebeu TERM. Sessão58955 não é mais trabalho pendente. A receita v5 continua preparada; ainda não existem seus 12 novos stills. Reprogramar após a prova pequena de keyframes.
- Novo candidato **probes-v6-keyframes**: receita v5 + `S09.end_image` editando o mesmo enquadramento para acender apenas o bulbo. Runner sessão **46315** (wrapper385875 observado), espera o término do v4 e executa SOMENTE `S09-image,S09-end-image`; log `/tmp/cue-probes-v6-end-image.log`. Reutiliza still S09 v3 por pedido exato. **Não tem vídeo v6 submetido ainda.** Inspecionar/medir o end-image antes de pedir vídeo.
- Código novo: `app/services/reference_recipe.py` compartilha construção de pedidos de final de plano e vídeo SE entre probe e runner F2. `end_image` opcional na receita preserva pedidos antigos sem keyframe final. Final é gerado pelo modelo a partir do still inicial, sem mídia substituta.
- Probe agora valida pedido/receita de stills e âncoras também em retomadas só de vídeo; hash correto de receita antiga não basta. End frame alterado/fora da raiz/hash inválido é recusado antes da liberação ou submissão de vídeo. Testes de CLI cobrem cadeia de referências e tampering.
- Runner F2 mede end-images (cubo, lentes nos planos com rosto, separação nos planos aplicáveis) antes de renderizar vídeos. Nenhuma receita canônica foi promovida ainda.
- Testes focados `/tmp/cue-keyframe-recipe-tests.log` (aguardar resultado atual; rodada anterior13passed, mais um cenário de pedido antigo foi acrescentado). Suíte completa1117 é anterior a esta mudança; executar após estabilizar o código desta etapa.

## Checkpoint mais recente — após prova de keyframes e compatibilidade

- **Software:** `/tmp/cue-standard-live-version-final.log`: **1.140 passed, 12 skipped, 63 deselected, 33 subtests**, 119.11s. Inclui novo schema/receita/duração e correção do fluxo real de versão de pedidos. `/tmp/cue-keyframe-delivery-tests.log`:26passed; `/tmp/cue-live-version-tests.log`:9passed (3 novos +6 contratos de rotas). Logs anteriores1117/1125/1137 são históricos.
- **S07 v4** terminou; lentes e escala reprovadas (1/3 lentes em11frames; cabeça131→270px). Cross-shot v4 reprovou fator1.31, limite1.25. `probes-v4/{S07-video,cross-shot}-evidence.json` preservados. V4 não está mais vivo.
- **V6 S09 SE** terminou: cubo único em121/121frames, separação mensurável7amostras/mínimo324px, enquadramento fixo (cubo x590 constante, largura120–122). `probes-v6-keyframes/video-evidence.json`, `video-contact.jpg`. **Duração4.84s**, insuficiente para slot5s. Não promover esse clipe a master. O backend faz trim8de fim com SE.
- **Margem nativa:** `video.end_frame_padding=8` no builder pede137quadros para compensar trim8e remove o campo antes da API. Expande uma janela que já comportava o plano, preserva planos multiwindow deliberados. `validate_generated_duration` mede quadros/fps reais;121@25 não cobre120@24. F2 grava `duration_evidence` e não passa master curto.
- **V7 stills completo:**12 imagens passaram cubo/lentes/separação aplicáveis; `all-still-evidence.json`, `all-still-contact.jpg`. Avaliação visual detectou finais rejeitados: S04-end segurou cubo com duas mãos; S07-end removeu a lâmpada. NÃO usar esses finais.
- **V9:** novo final S04 foi gerado e inspecionado: uma mão direita apenas, esquerda vazia, três lentes. Régua inicial1.6543/final1.8493. S07 usa `end_image_source="start"` por ser pausa. S06-end mantém pose e passo lateral muito curto; é prova de condicionamento, ainda precisa revisão da fidelidade do deslocamento da ação.
- **V9 runner sessão1374/PID419966 foi TERMINADO antes de enfileirar S06/S07/S09**, pois a configuração sem `settings_version` descartou janela e dividiu S04 em2windows. O job S04 `88869018` continuou até terminar. Harvester exclusivo sessão39973 acompanhou o mesmo ID sem submeter novamente, mas terminouexit1: job retornou2artefatos e o cliente recusou escolher um. Recibo `probes-v9/receipts/S04-video.json` tem statuscompleted porém **SEM artifact válido**. Preservar para diagnóstico, nunca promover/reutilizar como clipe aprovado.
- **Causa e fix:** `wgp._process_task_params` chama migração de versão0 e apaga janela de arquivo legado. A preparação de pedido ATUAL agora injeta `wgp.settings_version` quando ausente, antes da fila. Versão explícita continua intacta. Migração de arquivo antigo não mudou. `/tmp/cue-request-compat-real.log`: `LIVE_REQUEST_COMPAT_PASSED`, schema2.58, janela146→146 e137frames após preparação real E0 e `_process_task_params`.
- **Backend GPU atual PID436746, sessão44086**, porta7870, log **`/tmp/cue-validation-v2-server.log`**. Antigos324186e431920 foram encerrados APENAS com jobs vazios. Processo atual inclui a correção no lugar correto (`_prepare_generation_submission`). Não usar PIDs/logs antigos como atuais.
- **V10 EM EXECUÇÃO:** runner PID437075, sessão41279, log **`/tmp/cue-probes-v10-videos.log`**. Config nova imutável `f2-keyframes-modern-config.json` (end_frame_padding8, settings_version2.58), receita v9 copiada em `probes-v10/recipe.json`. Stages: copiar/revalidar stills/end-images e gerar S04/S06/S07/S09. Job S04 observado **13362742**, primeira prova após fix em uma janela, faseVAE2m47s. Revalidar API/recibos antes de agir. Não submeter outro lote concorrente.
- **Receitas:** `load_visual_recipe` valida planos, congela bytes em `recipe-used.json` no probe e `visual-recipe.json` no F2, recusa mudanças no mesmo diretório. F2 aceita `config.visual_recipe` externo cobrindo exatamente12planos e registraSHA. A fixture canônica ainda não recebeu os candidatos.

## Fidelidade antes do lote integral

Verificar vídeos v10 de fato, não apenas contagem. A ação S06 deve transportar o cubo até o pedestal; um passo mínimo que apenas facilita passar gates não basta para homologação artística. Examinar escala aparente de S02 (ainda está ao fundo atrás da mesa), geometria/presença da lâmpada entre planos e o encaixe em S08. O conjunto v7 de imagens passou as métricas, mas isso não prova esses requisitos visuais.

Para próximos candidatos: quadros finais com referência inicial são adequados às pausas (S01/S03/S05/S07/S10/S12 conforme ação) e preservam estado. S02 de caminhada e S08 de inserção precisam final com ação concluída; não usar imagem inicial para apagar a ação. Preservar S11 v3 validado onde pedido exato couber; nova configuração2.58 altera pedido, então não editar recibo antigo para aparentar correspondência. Os quatro vídeos v10 são provas do controle de câmera/duração, ainda não um filme completo.


## Checkpoint preservado antes da decisão de perfil, 30/10/2026

# Estado operacional — objetivo ativo em 30/10/2026

## Escopo e regras

Objetivo do usuário: **atacar todos os pontos de atenção**, incluindo nova produção real autorizada. Abrange bootstrap, rotas, concentração de responsabilidades, bundles, instalações reproduzíveis, documentação e homologação do filme. Permanece ativo; não declarar conclusão somente pelos testes de software.

Base `main`/`d2bac33`, versão 2.5.2, alterações locais sem commit/push. `.reversa/reversa-config.json` foi lida: allowLegacyEdits=true com allowlist. Não alterar essa config nem `pyproject.toml`. Não usar subagentes sem autorização explícita. A análise inicial em `_reversa_sdd/estado-atual-2026-10-29.md` está preservada com erratum sobre v10.

Histórico dos checkpoints e dos probes anteriores: [HISTORICO_keyframes_2026-10-30.md](HISTORICO_keyframes_2026-10-30.md). Esse histórico contém PIDs/sessões antigos; os atuais estão abaixo.

## Software verificado

- `/tmp/cue-standard-live-version-final.log`: **1.140 passed, 12 skipped, 63 deselected, 33 subtests**, 119.11s. Após todas as mudanças de código desta etapa.
- `/tmp/cue-live-version-tests.log`: **9 passed**, inclui 3 testes novos do fluxo real de preparação/fila e contrato de rotas.
- `/tmp/cue-keyframe-delivery-tests.log`: **26 passed**, receita, snapshots, keyframes, duração nativa, recibos e F0.
- `/tmp/cue-smoke-settings.log`: **1 passed, 35 subtests**, imports em processos CPU novos. Anterior aos helpers de receita, que não carregam runtime GPU.
- UI sem alteração posterior aos gates: `/tmp/cue-layered-ui-gates.log` lint/217 Vitest/store/control; `/tmp/cue-build-current.log` build acíclico, **33 chunks**, maior **196.585/220.000 bytes**; `/tmp/cue-browser-final.log` **4 passed**, 32.23s.
- `python scripts/verify_runtime_locks.py`: E0–E4, pins/hashes/origem aprovados. Último clean guard: **2.858 arquivos**, zero violações, incluindo novos. Repetir após documentos novos. `git diff --check` aprovado.

Corrigidos: shims PyTorch preservando CUDA real, configuração parcial, imports CUDA em CPU, montagem dupla de capacidades/cinema/launcher, contrato HTTP com prefixos reais, corrida draft/setup, efeitos de navegação e perda do último quadro no export Editor. Export CPU real pós-fix: 24 quadros + AAC; testes reais de render 24/30/60 fps.

Extraídos: defaults e schema/parsing customizado do runtime, routers editor e biblioteca de outputs, restauração de sidecars/Director sob demanda e submissão Studio em slice síncrono. Store **8.284 linhas**, antes12.526; launcher ~29.380, WanGP ~15.200. Modularização ainda parcial; redução de linhas não prova fronteiras concluídas.

## Instalações

`app/env`: Python3.11.18, torch2.10.0+cu130, RTX3060 12GB, driver595.99.02. Não ocultar CUDA no backend/F2. `CUDA_VISIBLE_DEVICES=''` somente nos testes CPU.

E0:282 pacotes CPU, sem distribuições NVIDIA, sync estrito/check/imports, boot HTTP e export software. E1/E2/E3/E4:300 pacotes por ambiente independente, sync com hashes/check/imports aprovados. Locks e manifests em `app/locks/`; `installation-evidence.json` registra evidências. Perfis GPU atuais usam CUDA13; propostas históricas CUDA11.8/12.1/12.4/12.8 não foram homologadas. Benchmarks nas GPUs alvo E1/E2/E4 permanecem pendentes; instalação nesta RTX3060 não os prova.

Decord0.6.0+cue1 é rebuild determinístico explícito;37 arquivos runtime idênticos ao upstream, decode real8frames. `scripts/build_decord_wheel.py`, SHA `514fa01b918330a9a63c8d2770be258fc07bde9b3d32b76b0fff53765f69baad`. uv em `/tmp/cue-analysis-venv/bin/uv`; `--find-links app/.cache/runtime-wheels` na CLI, nunca emitido relativo dentro do lock. Normalizador remove MD5 conservando SHA256.

## Processos atuais — revalidar antes de agir

- **Backend GPU PID436746, sessão44086**, `http://127.0.0.1:7870`, log **`/tmp/cue-validation-v2-server.log`**. Config/cache/SQLite isolados sob `app/.cache/validation-2026-10-30/`. Inclui correção de versão no ponto correto `_prepare_generation_submission`.
- **Runner v10 PID437075, sessão41279**, log **`/tmp/cue-probes-v10-videos.log`**. Stages de vídeo S04/S06/S07/S09, sequência sem concorrência GPU. Config `f2-keyframes-modern-config.json` e receita `probes-v10/recipe.json`, imutáveis.
- S04 v10 job **13362742 concluído e medido**. S06 job **91a67120 concluído e reprovado em escala**. S07/S09 continuam na sequência; conferir `/api/v1/jobs` e recibos atuais.
- Backend CPU E0 PID356567/sessão71936, porta7872, `/tmp/cue-e0-server.log`. Código anterior ao fix mais recente de versão; export correto já comprovado. O log tem NUL/linhas antigas; `/health/version` JSON confirma saúde, `/health` é fallback HTML.
- Vite PID4118102/sessão69614, porta3070, proxy7870, log `/tmp/cue-vite-dev.log`. Node do sistema18: usar `npx --yes --package=node@22 -c 'npm run ...'` com workdir `ui/`.
- Não reiniciar GPU com jobs ativos. Não resubmeter por timeout de observação. Logs podem conter megabytes de base64: limitar linhas E largura com `cut -c 1-220`.

## Produção e provas atuais

Artefatos ignorados pelo Git em `app/outputs/validation-2026-10-30/`. Nenhum master novo está aprovado.

- **film-v1 terminal exit1**:31 recibos reais (4 falas Qwen PT-BR, música ACE-Step,2 âncoras,12 imagens,12 vídeos).14 falhas em `shot-evidence.json`; sem efeitos/master. Preservar tudo. Master histórico v10 também já havia sido reprovado por humano, conforme `docs/HANDOFF_V11.md`.
- Detector de bulbo distingue madeira e luz; corpus real/hash está em testes. Ausência de par não vira separação comprovada. `identity_view` distingue rosto/mãos; lentes também são gate em vídeos de rosto. Não relaxar limites para promover candidatos.
- **V3 S11**: passou lentes/escala/cubo/separação em vídeo; preservar. V3 S06/S09 e V4 S04/S06/S07 reprovaram por zoom/escala/lentes. Não reapresentar esses runners como vivos.
- **V6 S09**: início/fim gerados por modelo, mesmo enquadramento. Cubo único em121/121frames; separação324px; posição x590 constante/largura120–122. Porém121@25fps=4.84s, insuficiente para slot5s. `probes-v6-keyframes/video-evidence.json` conserva essa limitação.
- **V7**:12 stills passaram cubo/lentes/separação aplicáveis; `all-still-evidence.json`, `all-still-contact.jpg`. Finais S04 com duas mãos e S07 sem lâmpada foram rejeitados visualmente. Não usar esses finais.
- **V9**: final S04 corrigido (uma mão direita, esquerda vazia,3 lentes), régua inicial1.6543/final1.8493. S07 usa a própria imagem inicial como final por ser pausa. Runner foi terminado antes de enfileirar os outros vídeos devido ao bug de janela. Job S04 `88869018` completou2artefatos; harvester sessão39973 recusou escolher um e terminouexit1. Recibo completed **sem artifact válido** não serve como clipe aprovado.
- **V10 S06 REPROVOU**: `S06-video-evidence.json`, `S06-video-contact.jpg`.129@25fps=5.16s, lentes/cubo/régua1.75 passaram, mas cabeça126→256px (fator2.0317). Contato visual mostra zoom real no MEIO e retorno ao enquadramento original no fim. Endpoints corretos não bastam para o percurso; não promover como transporte fiel até o pedestal.
- **V10 S04 PASSOU**: `S04-video-evidence.json`, `S04-video-contact.jpg`.129 quadros a25fps=5.16s; lentes/escala/cubo/régua aprovados, mediana1.8611. Inspeção visual confirma câmera fixa, uma mão direita levantando o cubo e esquerda vazia. Vídeo não é ainda homologação do filme.

## Mudanças de geração nesta etapa

1. `reference_recipe.py` constrói quadro final de edição com `image_refs=[still_inicial]` e vídeo SE. `end_image_source="start"` usa o still real como final de pausa, sem inventar job. Ação que muda estado precisa de final próprio. Opções mutuamente exclusivas.
2. `end_frame_padding=8` é orçamento explícito da configuração desta máquina: pede8 quadros nativos adicionais para compensar trim SE do backend. O auxiliar não vai à API. Sem padding, pede o tamanho original. Não repetir quadros para esconder tempo insuficiente.
3. `validate_generated_duration` mede tempo nativo por quadros/fps; F2 grava `duration_evidence`.129@25 cobre slot120@24;121@25 não cobre.
4. Pedidos HTTP atuais sem `settings_version` recebem a versão do runtime antes da fila, evitando que a migração0 apague janela explícita. Versões declaradas e filas antigas mantêm seu comportamento. Prova real em `/tmp/cue-request-compat-real.log`: schema2.58, janela146→146 após preparar e processar parâmetros reais E0.
5. Receita externa em `config.visual_recipe` deve cobrir exatamente12 planos. Bytes congelados em `visual-recipe.json` e SHA no relatório; probe usa `recipe-used.json`. Retomada com receita diferente exige diretório novo.
6. Probe valida receita/pedidos das imagens e âncoras, status, raiz e SHA antes de vídeo. Pedido antigo com bytes íntegros é recusado. Recibos nunca são sobrescritos para aparentar correspondência. Fixture canônica visual ainda não foi promovida para os candidatos.

## Próximas ações, preservando a fidelidade

1. Acompanhar o runner v10 existente e medir S06/S07/S09: duração, lentes, escala, régua, cubo, separação. Conferir vídeo e ação, além das métricas. S04 já passou; não renderizar novamente sem mudança necessária.
2. O deslocamento S06 deve levar o cubo até o pedestal: um passo mínimo que facilita gates não basta como homologação artística. Examinar S02 ao fundo/escala, geometria da lâmpada entre planos, encaixe S08 e continuidade de posições. Imagens v7 passaram métricas, mas isso não prova tais requisitos visuais.
3. Para próximo lote, preparar finais próprios de S02 (caminhada) e S08 (inserção). Estáticos/pausas podem usar início como final quando terminarem no mesmo estado. Preservar o pequeno gesto/tilt onde o roteiro pede, sem trocar por congelamento para passar gate. Considerar continuidade entre final de S06 e começo de S07.
4. Criar config/receita imutável do **film-v2** e reaproveitar fala/música/âncoras/stills/vídeos SOMENTE por pedidos exatos e SHA válido. Config mais recente ainda não aponta visual_recipe: selecionar candidato comprovado antes do runner integral. Geração real de7–12 vídeos restantes pode levar dezenas de minutos.
5. Completar cinco SFX MMAudio reais, mix/master, portas técnicas, construir e servir review com HTTP Range; pedir revisão humana real vinculada ao SHA. Nunca preencher aprovação pelo usuário.
6. Continuar fronteiras coesas dos arquivos centrais e avaliação dos perfis sem extrapolar hardware. Revalidar diffs/docs/guard após alterações. Não marcar objetivo completo enquanto houver trabalho requerido sem prova.

## Próxima investigação concreta de câmera/movimento

O runtime já suporta injeção de keyframes intermediários: `app/models/ltx2/ltx2.py`, `_append_injected_ref_entries` (~2252) usa `input_ref_images` + `frames_relative_positions_list` e `keyframe_inject_mode`; envia `inject_images`/stage2 à pipeline. Ler como os parâmetros públicos montam essas listas antes de novo experimento. `app/launch.py` rota Blend (~22060) já cria hints de movimento com imagens/posições e injection_strength. Não repetir só a instrução textual de câmera fixa nem assumir que endpoints impedem zoom no meio.

Para S06, os quadros intermediários precisam preservar câmera/escala E mostrar transporte lateral real até o pedestal, com continuidade para o começo de S07. Uma série do mesmo frame que apenas congela a ação não satisfaz o roteiro. Considerar permitir referência de outro still real como quadro final para ligar S06→S07, validando origem e existência, sem forjar recibos de geração. Esse suporte ainda não foi implementado. Nenhum candidato v11 foi criado ou submetido.

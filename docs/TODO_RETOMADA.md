# Retomada — objetivo ativo em 30/10/2026

## Defeitos e gates

- [x] Corrigir bootstrap sem PyTorch, preservando CPU/CUDA funcional.
- [x] Remover capacidades duplicadas e efeitos de importação do router de cinema.
- [x] Verificar unicidade de rotas considerando prefixos reais.
- [x] Corrigir boot com configuração parcial e testar preservação de valores.
- [x] Executar suíte Python padrão: 1.169 testes aprovados (incluindo a política de perfil).
- [x] Reduzir todos os chunks abaixo de 220 kB e tornar o limite obrigatório.
- [x] Alinhar Node/CI às dependências atuais.
- [x] Corrigir corrida de rascunho vazio contra setup recém-salvo.
- [x] Encerrar última rodada build/lint/Vitest/contratos/navegador após a correção.
- [x] Concluir smoke de importação no runtime instalado, inclusive com CUDA indisponível.

## Modularização

- [x] Extrair restauração de sidecars/Director sob demanda e submissão do Studio em slice síncrono.
- [x] Extrair rotas de documentos/mídia do editor, biblioteca de outputs, defaults/schema e funções temporais de `wgp.py`.
- [x] Concluir fronteiras do store: geração, catálogo, mídias (`mediaOutputsSlice`), fila (`directorQueueSlice`), short film (`shortFilmSlice`), planning/storyboard do Director (`directorPlanningSlice`), presets/receitas (`recipesSlice`), civitai (`civitaiSlice`); preservando API pública, cancelamento e proteção de respostas tardias.
- [x] Concluir fronteiras do launcher: catálogo/LoRAs (`loras.py`), mídia/áudio (`audio.py`), civitai (`civitai.py`), tools de acabamento (`tools.py`); mantendo composição e lifecycle no ponto de entrada e validando 100% dos contratos via `tests/test_route_contract.py`.
- [ ] Separar bootstrap/configuração/registro e execução do runtime WanGP onde houver fronteiras coesas. Reduzir linhas não prova modularização concluída.
- [ ] Fechar as fronteiras restantes do gauntlet: `g4-undo-director` (histórico de edição do briefing), `g5-a11y`, `g6-modularizacao`, `g7-ci-browser` (os testes de navegador existem, mas `pyproject.toml` os desmarca com `-m 'not browser'`), `g8-docs`. O pre-flight do Director (`g3`) está entregue.

## Instalação e produção

- [x] Instalar runtime CUDA real e confirmar GPU.
- [x] Resolver lock E3/CUDA 13/Python 3.11 com hashes e instalar 300 pacotes independentemente.
- [x] Corrigir empacotamento do decord com versão local explícita, SHA-256 e rebuild determinístico. Todos os 300 pacotes passam na compatibilidade; 37 arquivos runtime idênticos e decodificação real comprovados.
- [x] Instalar E0–E4 separadamente com hashes e verificar compatibilidade/imports; E0 com boot/export software.
- [ ] Medir geração nos hardwares E1/E2/E4; os locks atuais compartilham CUDA 13 e não comprovam os alvos CUDA históricos.
- [x] Gerar preflight PT-BR e quatro falas reais.
- [x] Gerar música, âncoras, 12 imagens e 12 vídeos no lote inicial (reprovado, evidências preservadas).
- [ ] Corrigir continuidade em imagens/vídeos nos probes antes de novo lote; gerar cinco efeitos e master.
- [ ] Gerar master e executar portas técnicas; preservar recibos válidos em retomadas.
- [ ] Apresentar master para revisão artística humana e registrar contra seu SHA-256.
- [ ] Revisar diff, documentação e testes finais antes de declarar conclusão.

## YuE (modelo de música)

- [x] Integrar o YuE v1 ao catálogo, à UI, aos guias de songwriting e à matriz de capacidades (`857dd5d`).
- [ ] Fechar a geração de ponta a ponta e guardar o WAV de validação em `app/outputs/validation-2026-11-04/` (o Stage 1 levou mais de 20 min na RTX 3060 com o perfil conservador).
- [ ] Perfil de memória específico para o YuE: hoje o app usa o perfil de áudio padrão e o planejador de 7B fica lentíssimo.
- [ ] Expor `yue_run_n_segments` e `yue_segment_duration` na UI, e corrigir o slider de duração (o YuE não tem duração nativa).
- [ ] Avaliar o YuE2 (upstream) quando o `mmgp` puder ir a 4.5.0 — material em `_reversa_forward/yue2-port-2026-11-04/`.

Detalhe em [docs/HANDOFF_YUE_MUSIC.md](HANDOFF_YUE_MUSIC.md).

## Falhas do Director

- [x] Diagnosticar as três falhas correlatas do print (Clip 2 "Failed", banner genérico, "Try again" com HTTP 400) contra o código e o runtime vivo: erro real descartado em `launch.py`/`wgp.py`, `oom_info` nunca populado nesse caminho e lookup do estado do pipeline raso demais em `director_pipeline.py`.
- [ ] Preservar a mensagem real do worker em `job["error"]` e anexar `oom_info` no ramo `cmd == "error"` de `app/launch.py`; incluir a causa crua nas mensagens VRAM/RAM de `app/wgp.py`.
- [ ] Achatar o lookup do estado do pipeline em uma única fonte de verdade, cobrindo `out_dir/<sub>/.director/<pid>/` a partir da raiz de projetos.
- [ ] Fazer o retry por clip do `ImagePromptsReview` usar o caminho client-side (fluxo v2) e mostrar a falha no banner em vez de engolir no `console.error`.
- [ ] Cobrir os três pontos com testes (pytest para erro/`oom_info` e para o lookup; vitest para o retry por clip) e rodar pytest, vitest, tsc e build.

Detalhe em [docs/HANDOFF_DIRECTOR_FALHAS.md](HANDOFF_DIRECTOR_FALHAS.md).

Histórico anterior: [history/TODO_RETOMADA_legacy.md](history/TODO_RETOMADA_legacy.md).

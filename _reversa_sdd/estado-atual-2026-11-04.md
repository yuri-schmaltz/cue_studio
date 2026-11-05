# Reanálise do Cue Studio — 04/11/2026

Escopo: leitura do checkout, inspeção do backend existente e execução local dos gates, sem corrigir código nem disparar inferência. Base `main`, HEAD `8fa2a98`, versão HTTP2.5.2. As dependências UI instaladas passaram `npm ls --depth=0`, sem inconsistências reportadas. Checkout inicialmente limpo e alinhado à referência local origin/main; não foi feito fetch, portanto isso não confirma ausência de novos commits remotos.

## Parecer

O projeto evoluiu na organização e nas funções do Director, mas o checkout atual **não está pronto para uma entrega validada**: o build oficial da UI falha, a suíte da UI e o contrato do store não passam, e a verificação dos locks também reprova. O backend vivo responde, mas não valida as mudanças mais recentes.

## Resultados reproduzidos

| Verificação | Resultado desta análise |
|---|---|
| Backend7860 `/health/version` e `/api/v1/jobs` |200, versão2.5.2 e fila vazia no momento da consulta |
| Python padrão, CUDA ocultada só no processo de testes |1418aprovados,1falha,12ignorados,63desmarcados,37subtestes aprovados;416,69s |
| `npm run build`, Node22 |Reprovado:71 diagnósticos TypeScript; Vite e orçamento não são alcançados |
| `npm run lint`, Node22 |74erros e1aviso |
| `npm test`, Node22 |340aprovados,1falha em341testes/51arquivos |
| `npm run test:control` |Aprovado |
| `npm run test:store` |Reprovado em `ui/scripts/store-gauntlet.mjs:112`; modelo musical esperado `ace_step`, recebido `ace_step_v1_5_xl_sft_lm_4b` |
| `scripts/verify_runtime_locks.py` |Reprovado:origem requirements.txt diverge no manifest global e nos cinco perfis E0–E4 |
| `scripts/verify_clean_repo.py` |Aprovado:3016arquivos rastreados; guard ampliado3017incluindo este relatório também passou |

A única falha Python foi `test_f0_render_master_criteria`: o subprocesso do gerador F0 excedeu120s. O teste F1, que chama o mesmo gerador com limite300s, passou. Portanto esta execução comprova um problema de tempo do gate neste ambiente, sem demonstrar uma violação dos critérios de mídia. Não foi alterado o timeout nem repetida a suíte para tentar obter um resultado verde.

Hardware observado: RTX3060,12GB,9501MiB ocupados no instante da consulta. Não foi descarregado nenhum modelo nem reiniciado serviço nesta reanálise.

Logs completos: `/tmp/cue-reanalysis-2026-11-04-{python,ui,build,vitest,contracts}.log`. O log de contratos contém stacktrace com bundle em base64; limitar largura ao inspecioná-lo. As tarefas foram executadas separadamente depois do lint para que sua falha não impedisse build e testes. Não foram repetidos testes de navegador nem geração GPU nesta reanálise.

## Achados por prioridade

1. **P1 — Studio contém referência inexistente que impede o build e pode quebrar a renderização.** `ui/src/components/Shell/StudioPage.tsx:50` declara `mobileTab`, mas122/124 ainda usam `activeTab`, sem definição no escopo. TypeScript acusa TS2304. O acesso ocorre incondicionalmente no JSX, inclusive antes de qualquer ocultação por CSS. Os demais erros incluem incompatibilidades nos slices extraídos, props opcionais nos settings, campos duplicados e tipos Node nos testes. O build antigo existente em dist não comprova o código atual.
2. **P1 — recuperação de falhas do Director continua incompleta.** `app/launch.py:26224` grava somente message no stream de erro; `app/wgp.py:9330` substitui a causa por texto amigável. O lookup em `app/services/director_pipeline.py:1806` só busca a raiz e um nível, enquanto estados são salvos em workspace/.director/id. `ui/src/components/Sidebar/DirectorBriefingColumn.tsx:2893` ainda usa rerunClipImage do servidor no fluxo client-side e2895 apenas console.error. O diagnóstico do handoff segue aplicável ao HEAD. Reproduzido apenas com leitura no backend vivo: job425a6b7d retorna failed/Generation failed/oom_info=null; GET do pipeline603de619 retorna404, a listagem retorna zero, mas seu JSON em Vídeos/more/.director/603de619 existe. Não foi provocada nova OOM nem acionado retry nesta análise.
3. **P1 — locks não acompanham a integração YuE.** O commit857dd5d adicionou tensorboard2.21.0 e argbind0.3.9 em `app/requirements.txt:85`, sem atualizar os locks/manifests. O verificador reproduz seis divergências e é chamado pelo CI. Evidências históricas de instalação continuam históricas; não cobrem a nova superfície de dependências. Corrigir requer resolver/instalar/verificar dependências, não apenas trocar hashes do manifest.
4. **P2 — gates de UI estão vermelhos.** Além dos71erros de compilação, há74erros de lint, um teste QueuePage falhando em151 ao procurar `6 items`, e o contrato do store acima. As duas divergências de teste precisam ser avaliadas contra a regra desejada; não basta trocar expectativas para passar. CI executa esses gates, portanto o código atual falha nos comandos de validação configurados, independentemente de quando o problema surgiu.
5. **P2 — YuE está integrado, mas falta prova completa.** Catálogo, carregamento, knobs e perfil de memória estão no código. Defs atuais usam70%/10% para transformer/transformer2, diferentes dos50%/20% do handoff. Não há diretório `app/outputs/validation-2026-11-04/` nesta inspeção, nem WAV validado localizado nesse destino. Isso não prova que nenhum WAV exista em outro caminho. A UI ainda não expõe yue_run_n_segments/yue_segment_duration; duração nominal não equivale automaticamente à duração gerada.
6. **P2 — documentação mistura evidências de revisões distintas.** CURRENT_STATE/HANDOFF citam build aprovado, chunks e contagens anteriores; isso não descreve os gates atuais. O backendPID130818 iniciou em02/11, enquanto HEAD é de04/11, logo sua saúde não comprova o último código. A própria auditoria de UI ressalva que três mudanças aguardam confirmação visual com um projeto real; essa confirmação não foi refeita nesta análise. O comando do handoff `tsc --noEmit -p tsconfig.json` foi reproduzido e sai0, mas a raiz tem files:[] e referências a outros projetos; isso não equivale ao `tsc -b` do build oficial, que efetivamente reporta71erros. Rodar apenas Vite também não substitui essa checagem.

## Evolução e limites

- O pre-flight existe em `app/services/director/http_preflight.py`, com agenda de clipes compartilhada e ETA pelo histórico local, além de integração na UI.
- A extração do store avançou:5764linhas em useStore.ts, contra8284na etapa anterior. Launcher29366, WanGP15116 e director_pipeline8180 ainda concentram responsabilidades. Redução de linhas não comprova conclusão da modularização, especialmente com contratos/tipos quebrados.
- A configuração de CI mantém browser fora da suíte padrão e não contém etapa explícita de Playwright. Navegador precisa de gate próprio; passing unit tests não cobre falha de renderização no Studio.
- A produção de referência preserva173MB de artefatos locais do dia30/10. Não foram localizados master.mp4/technical-report/creative-review nesse diretório nesta inspeção. Filme e revisão humana continuam sem comprovação final. Benchmarks de outras GPUs também não foram refeitos.

## Ordem recomendada

1. Corrigir a renderização do Studio e fechar TypeScript/build.
2. Corrigir erros do Director, localização de estado e retry v2, com regressões comportamentais.
3. Atualizar e reinstalar locks após YuE, mantendo hashes fortes e prova de instalação.
4. Fechar lint/Vitest/store, adicionar navegador ao CI e só então republicar as evidências de qualidade.
5. Validar YuE com WAV real e concluir filme/master/revisão humana. Manter benchmarks de hardware não disponível explicitamente pendentes.

# Estado operacional — objetivo ativo em 30/10/2026

## Escopo e decisões do usuário

Objetivo: atacar todos os pontos de atenção, incluindo nova produção real. Base main/d2bac33, v2.5.2, alterações locais sem commit/push. Config Reversa lida, allowLegacyEdits=true com allowlist; não editar essa config nem pyproject.toml. Sem subagentes.

O usuário escolheu **perfil natural ao caminhar em S06, preservando cabeça e identidade**. Não exigir três lentes simultaneamente visíveis em perfil. Âncora e stills frontais continuam com contagem exata; vídeo S06 registra distribuição, rejeita lentes extras e fica `review-required`. Detector de lentes não comprova presença da cabeça de perfil. Régua de largura das lentes/cubo durante a rotação é evidência, sem comparar projeções diferentes como escala física. Revisão da cabeça/identidade/escala consta no relatório, além da revisão humana do master vinculada ao SHA.

O usuário também autorizou descarregar o modelo qwen3.5-9b do LM Studio, mantendo o aplicativo. Executado `lms unload qwen3.5-9b`; `lms ps` confirmou nenhum modelo carregado e nvidia-smi confirmou liberação da GPU. Nunca encerrar outros processos sem autorização.

## Evidência de software

- Suíte integral com política de perfil: `/tmp/cue-standard-profile-final.log`, **1169 passed,12 skipped,63 deselected,33 subtests**,111.63s. A página de revisão ganhou instrução explícita sobre cabeça/identidade de perfil após essa execução (texto apenas).
- Política de perfil/receitas/recibos/rotas: `/tmp/cue-profile-policy-tests.log`, **47 passed**. Evidência de perfil, inclusive quadro sem lentes, jamais afirma presença de cabeça nem aprovação.
- Smoke após extração temporal: `/tmp/cue-smoke-runtime-frames.log`, **1 passed,35 subtests**. Funções extraídas mantêm AST/assinaturas; ver frame-extraction-evidence.json.
- UI sem alterações posteriores: lint,217 Vitest,store/control; build acíclico33chunks, maior196585/220000bytes; quatro testes Chromium aprovados. Node22 via npx.
- Routers editor/biblioteca, defaults/schema e cinco funções temporais extraídos; store8284linhas, WanGP~15075. Modularização ainda parcial.
- E0–E4 instalados independentemente com hashes/check/imports; E0 export real CPU. Não confundir instalação na RTX3060 com benchmarks em GPUs4/8/24GB. Locks atuais usam CUDA13, sem homologar alvos históricos.

## Processos — conferir antes de agir

Backend GPU porta7870, sessão48033, log `/tmp/cue-validation-profile-server.log`, config/cache/SQLite isolados em app/.cache/validation-2026-10-30. Inclui correção de versão atual e extrações, SEM reserva experimental Flux2.

Runner de imagens v17 sessão57767, `/tmp/cue-v17-images.log`: S02-image novo e S08-end-image corrigido; demais imagens reutilizadas somente por pedido exato/SHA. Job S02 b9fa17ae concluiu após liberar GPU, sem OOM e sem mudar parâmetros; still tem filamento aparentemente aceso e precisa correção antes do vídeo. Job S08-end-image a034a30d começou em seguida; conferir estado atual pela API/recibos.

Backend E0 porta7872/PID356567 e Vite3070/PID4118102 eram ativos; revalidar. `/health/version` JSON é saúde verdadeira; `/health` pode ser fallback SPA. Backend GPU mantém CUDA habilitada; somente testes CPU usam CUDA_VISIBLE_DEVICES=''.

## Produção real preservada

Diretório ignorado: app/outputs/validation-2026-10-30. Todas as receitas/recibos existentes imutáveis. Config preferida f2-nag-video-config.json: Flux2 Klein9B 1280x720, LTX2.3distilled137quadros nativos para129 entregues/25fps, NAG1.5. Sem reduzir resolução/passos para passar gate.

- film-v1:31recibos reais,4falas/música/âncoras/12imagens/12vídeos; reprovado14verificações. Sem master/SFX novo. v10 histórico de22/10 já reprovado por humano, não é pendência de aprovação.
- v10 S04 passou duração5.16s/lentes/escala/cubo/régua/câmera; S09 passou duração/cubo/separação/câmera. S06 reprovou zoom real no meio. S07 reprovou lentes8/129quadros sob regra frontal.
- v11 final S06 desloca600px até pedestal, S07 referencia esse estado sem recibo falso. Intermediários gerados ficaram parados; trajetória rejeitada. v12 idem. v13 moveu personagem mas perdeu cubo. Não usar esses intermediários.
- v14 NAG S06 job502346eb: deslocamento real até pedestal, câmera fixa confirmada (drift escala~0.03%), cubo único,129@25. Perfil esconde lentes: distribuição0:79,1:1,2:2,3:47. Regra antiga reprovou; nova decisão permite perfil, mas cabeça/identidade/escala ainda requerem revisão visual explícita. Artefatos em probes-v14-nag, nunca promover automaticamente.
- v15 S08-end-image jobe3a2662c manteve cubo na mão fora do encaixe; rejeitado visualmente apesar de pedido de inserção. v17 tenta final corrigido antes de vídeo S08.
- v15 S02-image job8efae253 e v16 S02-image job8a356851 falharam OOM: logs mostram LM Studio usando9.38GiB. Reserva experimental2GB foi implementada/testada e retirada: não há prova de defeito no orçamento original, a causa comprovada foi concorrência externa. Preservar recibos failed. Não citar experimento como correção entregue. Um teste intermediário falhou ao ser executado enquanto essa alteração era retirada; suíte posterior é a evidência vigente.

## Próximas ações

1. Acompanhar v17, medir/inspecionar S02 e novo final S08; rejeitar se cubo ainda não encaixou. Não gerar vídeo com endpoint conhecido errado.
2. Gerar vídeos independentes S01/S03/S05/S10/S12 em lote, preservando modelo entre vídeos; preparar S02/end próprio. S08 depende de final válido. S06 perfil natural autorizado; manter continuidade S06→S07 e revisar cabeça real durante toda caminhada.
3. Selecionar receita do film-v2 com12planos coerentes, reutilizar SOMENTE pedidos/SHA iguais. Completar5SFX MMAudio, mix/master, gates técnicos e review humano real com hash. Não forjar aprovação.
4. Suíte atual1169passed, locksE0–E4 e guard2866arquivos/zero violações aprovados. Conferir diff/guard após docs novas e e atualizar docs após resultados. Continuar modularização onde houver fronteiras coesas, sem declarar concluída por contagem de linhas. Benchmarks em hardware indisponível devem permanecer explicitamente não verificados.

Histórico detalhado: [HISTORICO_keyframes_2026-10-30.md](HISTORICO_keyframes_2026-10-30.md).

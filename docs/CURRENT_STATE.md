# Estado atual — 30/10/2026

Base: `main`, origem `d2bac33`, versão 2.5.2. Correções locais, sem commit ou push. O documento anterior está preservado em [histórico de validação](history/CURRENT_STATE_2026-10-22.md); seus PIDs, ambientes e resultados não descrevem automaticamente este checkout.

## Evidências desta rodada

- Python padrão no runtime instalado: **1.169 testes e 33 subtestes aprovados**, 12 ignorados, 63 desmarcados. `CUDA_VISIBLE_DEVICES=''` somente para a suíte CPU.
- UI atual: build, lint sem avisos, **217 testes Vitest** e contratos store/control aprovados.
- **33 chunks JavaScript**, todos abaixo de 220.000 bytes; maior: 196.585 bytes. O limite agora reprova o build quando excedido.
- Backend isolado em `127.0.0.1:7870`, saúde/catálogo respondendo 200. Python 3.11.18, PyTorch 2.10.0+cu130, RTX 3060 12 GB reconhecida.
- Chromium: **4 testes aprovados** no conjunto final: shell, Director, setup e bundle de produção.
- Lock E3/CUDA 13/Python 3.11 com hashes: **300 pacotes instalados em ambiente independente** e imports reais aprovados. Metadados do decord corrigidos em rebuild explícito com código/biblioteca preservados; ver [instalação](INSTALLATION_VERIFICATION.md).

- Smoke de importação CPU em processos novos: **1 teste e 35 subtestes aprovados**. Corrigida consulta CUDA no import de T5 e na detecção de capacidade do runtime.

- E0: 282 pacotes CPU, boot HTTP e exportação por software exercitados. E1/E2/E4: 300 pacotes por ambiente, instalação estrita, compatibilidade e imports reais aprovados. Os perfis GPU desta revisão compartilham CUDA 13; isso não homologa desempenho em 4/8/24 GB. Ver [limites e reprodução](INSTALLATION_VERIFICATION.md).
- Pedidos de geração novos sem versão agora recebem a versão atual antes da preparação, preservando janelas explícitas na fila. Três testes de compatibilidade e prova no runtime CPU real passaram; migração de filas antigas preservada.
- Fluxo F2/probe suporta quadros finais gerados ou referência inicial de pausa, snapshots imutáveis de receita e verificação de duração nativa. S09 com início/fim manteve composição e cubo único, mas seu primeiro teste tinha 4,84 s; a margem de geração produziu 5,16 s válidos em S04. Endpoints ainda não garantem câmera estável no meio de S06.
- Exportação CPU revelou perda do último quadro: removida conversão FPS redundante. **Três renders reais a 24/30/60 fps aprovados** após a correção.

## Correções implementadas

- Bootstrap diferencia PyTorch ausente, CPU e CUDA funcional; não altera shims imutáveis nem desativa uma GPU funcional. Regressões em três processos independentes.
- Capacidades montadas uma vez. Cinema não inicializa o launcher ao importar seu router. CLI compartilha o módulo vivo `launch`, evitando duas instâncias do backend.
- Contrato HTTP conta ocorrências e prefixos reais. Seis rotas exclusivas do editor legado já viviam em `/api/v1/editor/timeline/api/v1/editor/...`; o teste anterior apagava o prefixo. Nenhuma URL foi alterada.
- Configurações parciais recebem defaults ausentes antes do boot, preservando valores e diretórios explícitos. Defaults e schema/parsing de parâmetros customizados e cinco funções temporais extraídos de `wgp.py` para serviços puros.
- Rotas de documentos/mídia do editor e biblioteca de outputs extraídas para routers independentes, com contratos HTTP de CRUD, workspace, paginação, favoritos e Range.
- Restauração de sidecars e submissão do Director extraídas e carregadas sob demanda; submissão do Studio extraída para slice síncrono para preservar o estado no clique. Store principal reduzido de 12.526 para 8.284 linhas; modularização ainda parcial.
- Bundles separados por responsabilidade, limite obrigatório, Node compatível declarado e CI atualizado para Node 22.
- Rascunhos tardios invalidados por workspace/versão do setup. Resposta vazia preserva os defaults do projeto em vez de apagar parâmetros recém-salvos.

## Nova produção real

O usuário autorizou uma produção nova. Receita e evidências ficam em `app/outputs/validation-2026-10-30/`, ignorado pelo Git.

- S11 do probe v3 passou lentes, escala, cubo e separação em vídeo. Na receita v10, S04 passou também duração nativa (5,16 s) e inspeção da mão direita; S06 reprovou por zoom no meio, apesar de endpoints corretos. S09 também passou duração/cubo/separação/câmera; S07 reprovou lentes em 8/129 quadros.
- Preflight Qwen3 Voice Design PT-BR e quatro falas V01–V04: concluídos com WAVs reais e recibos SHA-256. V01 reutiliza o recibo de preflight após conferir igualdade exata do pedido.
- Primeiro lote completo: música, duas âncoras, 12 imagens e 12 vídeos concluídos; **31 recibos reais**. Reprovou 14 verificações de planos, antes de efeitos/master. Evidências preservadas em `film-v1/`.
- Probes novos corrigem enquadramento frontal, mão direita e encaixe inferior do pedestal. A validação em movimento segue em andamento; S06 v14 passou câmera fixa e transportou o cubo; o usuário autorizou perfil natural, com revisão da cabeça/identidade ainda necessária. Nenhum master novo foi aprovado.
- Detector de bulbo deixa de confundir madeira com luz. Ausência de bulbo mensurável é evidência indisponível, nunca separação comprovada. Gates de rosto cobrem imagens e vídeos dos planos que enquadram o rosto; macros de mão são identificados explicitamente.

O master v10 de 22/10 é histórico, não veio no clone e **já havia sido reprovado por revisão humana**, conforme [handoff v11](HANDOFF_V11.md). A avaliação artística do novo master precisa ser humana e vinculada ao hash; testes técnicos não a substituem.

## Continuidade

O objetivo **“ataque todos os pontos de atenção” permanece ativo**. Restam modularização dos arquivos centrais, benchmarks nos hardwares dos perfis, filme completo e revisão final. Ver [lista de retomada](TODO_RETOMADA.md) e [checkpoint operacional](../_reversa_forward/correcoes-2026-10-30/ESTADO.md).

Decisão de 30/10: S06 pode caminhar de perfil, preservando cabeça e identidade. Ocultação de lentes não prova perda de cabeça; o relatório registra revisão necessária. Stills frontais e âncora mantêm contagem exata. Duas tentativas S02 falharam por LM Studio concorrente usando9,38GiB; usuário autorizou descarregar seu modelo, executado e confirmado. Retomada v17 com parâmetros originais; nenhum master novo aprovado. Ver checkpoint para jobs e testes mais recentes.

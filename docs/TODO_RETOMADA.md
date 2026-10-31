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

Histórico anterior: [history/TODO_RETOMADA_legacy.md](history/TODO_RETOMADA_legacy.md).

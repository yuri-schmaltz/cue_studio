# Reavaliação do Cue Studio, 05/11/2026

## Veredito

Aplicativo desktop Linux funcional, com base de testes significativa, porém ainda em estabilização. Há defeitos confirmados na interpretação de roteiros e no contrato de idioma, fragilidade no processo de atualização do motor privado e lacunas de homologação do Wizard. A versão instalada está à frente do último commit e do AppImage disponível.

## Escopo e base

- Checkout: main, HEAD 56c0bd5. `git fetch origin` seguido de comparação: zero commits de diferença entre HEAD e origin/main.
- Isso não significa que as últimas mudanças foram publicadas: há 22 arquivos rastreados modificados e 26 arquivos ainda não rastreados nesta coleta, antes de criar este relatório.
- Arquitetura: interface React/TypeScript; shell Rust/Tauri; motor Python/PyTorch gerenciado; LLM local em subprocesso llama-server; projetos, mídia, fila e Editor integrados.
- Equipamento: RTX 3060, 12 GB; 842 GB disponíveis na partição de trabalho nesta coleta.
- Desktop instalado estava fechado na inspeção de processos. Um llama-server do checkout separado continuava presente. Nenhum processo ou geração foi iniciado para esta análise.

## Verificação executada nesta rodada

| Verificação | Resultado |
|---|---|
| TypeScript e Vite, produção | Aprovados |
| Orçamento de JavaScript | 37 chunks; maior 192.276 bytes; teto 220.000 |
| ESLint | Aprovado |
| Vitest completo | 349 testes: 348 aprovados, 1 falha; 53 arquivos de teste |
| Python, amostra de regressão | 108 aprovados |
| Rust, cargo test sem features desktop | 7 aprovados |
| Rust, cargo check com desktop | Aprovado |
| git diff --check | Aprovado |
| llama-server instalado, --version | Exit 0, build 12110 |

A amostra Python cobre exclusão de uploads, links de bibliotecas do LLM, sandbox de upload, rotas/projetos/render do Editor e estrutura de roteiro. Os 108 resultados não equivalem à suíte Python completa nem à homologação de geração com todos os modelos.

Logs desta execução: `/tmp/cue-current-ui-audit.log`, `/tmp/cue-current-backend-audit.log`, `/tmp/cue-current-rust-audit.log`. Logs em /tmp são temporários.

## Achados priorizados

### P1: roteiro completo ainda é interpretado como trecho parcial

Reprodução com o arquivo de 22 cenas fornecido pelo usuário: relatório aponta 3 cenas com tempo, início 66 s, fim 255 s e 66 s não cobertos. O texto realmente contém uma sequência contínua de 0 a 255 s.

Causa: `app/services/director/scene_script.py:41` aceita intervalos entre parênteses/colchetes, mas não o formato `Cena 01 | 00:00–00:10`. A leitura do corpo absorve intervalos dos atos seguintes, vinculando-os à cena anterior. Isso prejudica aviso de abrangência, divisão e alinhamento dos clipes. Os testes existentes passam porque não cobrem esse formato real.

Próximo passo: aceitar cabeçalhos com separador vertical, delimitar atos e acrescentar regressão usando a estrutura do roteiro real.

### P1: atualização do pacote não sincroniza automaticamente o código do motor privado

`ui/src-tauri/src/runtime.rs:13` verifica os hashes do lock e requirements, mas não a revisão dos arquivos Python. `ui/src-tauri/src/window.rs:45` reutiliza `data/runtime/app` quando esse marcador está válido.

Consequência: instalar um novo .deb com o mesmo lock pode manter o backend anterior, embora a interface já seja nova. Nos últimos ciclos, a atualização foi completada executando explicitamente runtime_bootstrap.py. Na coleta atual, launch.py e services/llm_service.py do pacote instalado coincidem com os arquivos privados.

Próximo passo: versionar/sincronizar o código do runtime ao iniciar uma versão nova, preservando ambiente, modelos, configuração e dados. Testar atualização com alterações de código e requirements idênticos.

### P2: suíte completa da interface não está verde

Falha em `ui/src/test/language.test.ts:167`. O Wizard recém-adicionado contém textos em português, contrariando o contrato existente de interface em inglês. As verificações anteriores de componentes selecionados não exercitavam esse contrato global.

Próximo passo: alinhar o Wizard ao idioma atual, ou implementar uma política explícita de internacionalização. Não remover o teste apenas para obter verde.

### P2: a etapa do Wizard pode se perder ao reiniciar o desktop

`ui/src/components/Shell/WizardPage.tsx:26` e `:63` gravam a etapa somente em localStorage. `app/desktop_worker.py:109` escolhe uma porta HTTP efêmera a cada inicialização. Portas distintas são origens distintas para localStorage.

Consequência: a etapa salva numa inicialização pode não estar disponível na seguinte. Isso não prova perda do projeto ou dos rascunhos persistidos no servidor, mas afeta a retomada guiada.

Próximo passo: salvar a etapa no rascunho por projeto ou em armazenamento desktop estável; restaurar a etapa em função do estado real do pipeline.

### P2: memória de pasta dos anexos ainda precisa de homologação funcional

`ui/src-tauri/src/file_dialog.rs` agora conecta os inputs HTML ao seletor GTK e a folder_history. A implementação é Linux; outras plataformas mantêm o seletor padrão. A compilação e o teste de persistência em disco passaram. Existe last-folder.json no ambiente instalado, atualizado em 05/11/2026.

Limite: os testes automáticos anteriores não concluíram a sequência de interação real abrir/anexar/reabrir/reiniciar. O arquivo salvo demonstra persistência em disco, mas não comprova sozinho a restauração da janela em todos os tipos de anexo.

Próximo passo: validar seleção múltipla, filtros, cancelamento, pasta removida, reinício e anexos nas telas Director, Wizard, Studio e Editor.

### P2: distribuição e documentação representam revisões diferentes

- .deb reconstruído às 18:58 de 05/11/2026; seu SHA-256 já difere do recibo em docs/desktop-release-verification-2026-11-05.json.
- AppImage gerado às 13:46 do mesmo dia; seu SHA-256 ainda coincide com aquele recibo anterior. Portanto, ele não contém todas as correções subsequentes.
- README/HANDOFF/CURRENT_STATE contêm resultados e bases de ciclos anteriores. O HANDOFF de 04/11 afirma que tudo daquele ciclo foi enviado, o que não descreve as mudanças locais atuais.

Próximo passo: consolidar commits, gerar artefatos da mesma revisão e emitir recibos novos com hashes, revisão e escopo de testes correspondentes.

## O que já está implementado

- Desktop em Rust/Tauri com Python/PyTorch gerenciado e janela de abertura animada.
- Wizard com seis etapas, entrada por Open in, reaproveitamento do Director, revisões e encaminhamento ao Editor.
- Seletores e layout de estrutura dos clipes reorganizados.
- Melhorias dos cards de referência, botões de remoção e nomes derivados de arquivos.
- Exclusão explícita de uploads com validação de caminho, idempotência e mensagem de erro do servidor; regressões aprovadas.
- Reparo de aliases das bibliotecas Linux do llama-server, com teste de idempotência e preservação de arquivos existentes. Carregamento real do Gemma na GPU foi validado no ciclo anterior; nesta rodada foi verificada a execução de --version.

Implementação e testes unitários não substituem produção completa. O Wizard ainda precisa de uma rodada acompanhada de entrada, roteiro, storyboard, aprovação, vídeo, montagem e abertura no Editor na mesma revisão instalada.

## Ordem recomendada

1. Corrigir interpretação do roteiro e seus limites de atos.
2. Corrigir atualização automática do código privado e validar upgrade.
3. Resolver idioma e retomada do Wizard; obter a suíte completa da interface verde.
4. Homologar anexos nativos e uma produção curta completa, com exportação.
5. Consolidar commits/push e reconstruir .deb/AppImage com recibos atuais.

As grandes unidades de código continuam concentrando risco de manutenção: launch.py tem 29.384 linhas, useStore.ts 5.734 e DirectorBriefingColumn.tsx 3.638. Priorizar extrações ligadas a defeitos e testes, depois dos bloqueios funcionais acima.


## Resolução — 06/11

Os achados acima precedem as correções. Estado e evidências finais: [validação](RELEASE_READINESS_2026-11-06.md).

> **Atualização após autorização do usuário:** JSON corrigido e caminhos de documentação liberados. Os patches 01–03 foram aplicados e ampliados no código. O estado atual e as evidências estão em `docs/CURRENT_STATE.md`; as restrições e planos abaixo são o histórico da preparação, não bloqueios atuais. A retirada dos 245 arquivos `.claude/` do índice Git foi autorizada e executada, preservando-os em disco. A raiz permanente foi definida pelo usuário como `app/outputs`. A homologação F2 real continua em andamento.

# Correções da análise de 19/10/2026

Objetivo: concluir todas as correções e melhorias apontadas na análise, preservando o escopo durante a liberação de escrita.

## Restrição verificada

HEAD: 6ec54ab, branch main. `.reversa/reversa-config.json` contém vírgula final após `allowedPathsNote`; JSON inválido. Conforme AGENTS.md, nenhuma alteração aplicada fora das pastas Reversa. O usuário precisa remover essa vírgula e incluir `README.md`, `HANDOFF.md` e `docs/**` em `allowedPaths`. Não editar essa configuração automaticamente.

## Preparado para revisão

- `01-offline-e-ci.patch`: implementa a função usada pela CLI, a função de auditoria usada por Web Push e retenção de tentativas de egress; usa parser de URL e validação de IP para evitar falsos loopbacks; sincroniza mudanças de política; acrescenta regressões e Vitest ao CI.
- `02-media-inspector.patch`: faz o efeito de metadados depender dos valores efetivamente usados, eliminando a dependência incompleta.
- `candidate/app/services/offline_strict.py`: candidato revisável, ainda não instalado.
- `candidate/tests/test_offline_regressions.py`: valida o candidato por import isolado; CLI usa o módulo candidato durante o teste, sem alterar os arquivos de aplicação.

Evidência: 12 testes de regressão do candidato passaram. `git apply --check` passou para os dois patches. Isso NÃO comprova integração nem equivale a patches aplicados. O lint do patch de interface e o CI completo ainda não foram executados.

## Trabalho restante obrigatório

1. Revalidar configuração e aplicar patches somente após liberação efetiva; testar CLI real, auditoria HTTP/Web Push e suíte existente.
2. F2: remover fallbacks silenciosos e narração senoidal; executar adaptadores reais de TTS/música/imagem/vídeo. Teste de GPU deve ser explícito e separado de testes unitários. Falta de modelo não pode produzir aprovação de IA completa. Registrar modelos, inferências, arquivos e hashes efetivamente usados.
3. Aceite F2: verificar amostras dos stems, alinhamento de cues, drift, loudness, true peak, integridade de falas e rubrica artística conforme plano executivo. Não confundir aprovação técnica de FFmpeg com aprovação artística. Se não houver recursos para gerar/avaliar, registrar não validado.
4. F3: adicionar subprocessos reais com sincronização por eventos/arquivos, interrupção controlada, reabertura do banco e reconciliação pelo serviço de produção; comprovar ausência de jobs duplicados, preservação de artefatos aprovados, cancelamento tardio e rejeição de referência removida antes da inferência. Testes existentes só demonstram parte desses comportamentos.
5. Modularização: inspecionar dependências e extrair responsabilidades coesas dos arquivos centrais com contratos de comportamento; não fazer separação cosmética ou movimentação sem teste de integração.
6. Reprodutibilidade: auditar implementação e cobertura do serviço lockfile; hashes e resolução por perfil não estão comprovados pela existência de parser e dataclasses.
7. Documentação: corrigir README (Dashboard removido), atualizar HANDOFF/TODO e resumo gauntlet distinguindo histórico de verificações do checkout atual. Não marcar todas as fases como concluídas sem evidência correspondente.
8. Validação final: Python padrão, smoke, Vitest, contratos UI, lint, TypeScript/build e navegação no browser. Separar geração GPU/aceite artístico dos gates leves. Auditar cada item antes de concluir o objetivo.

## Evidência do diagnóstico, antes das correções

- Python: 909 passed, 4 skipped, 62 deselected, 33 subtests passed.
- Vitest: 179 passed (26 arquivos).
- TypeScript: aplicação e configuração sem erros.
- ESLint: 0 erros, 1 aviso em MediaInspector.
- CLI: `--offline-strict status` falha por import ausente.

Esses números são do diagnóstico; não reutilizar como validação das futuras mudanças.

## Segunda verificação da liberação

Configuração revalidada: continua inválida; patches não aplicados.

Preparado `03-recovery-process.patch`, com teste de subprocesso real: grava checkpoint por ProductionStore, sinaliza commit via pipe, recebe kill e é consultado por dois processos novos. Verifica integridade SQLite, uma única execução persistida, classificação interrupted, oferta de retomada e preservação de arquivo parcial. Resultado: 1 passed em 0,24 s. Isso demonstra sobrevivência do checkpoint a encerramento abrupto; ainda não demonstra retomada de inferência, cancelamento tardio ou publicação atômica do master.

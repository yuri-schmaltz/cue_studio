# Validação — 06/11/2026

Corrigidos os pontos da auditoria: parser de cenas/atos, atualização do motor com dependências inalteradas, persistência do Wizard, idioma e histórico da pasta no seletor nativo. Corrigida também a recuperação de produções em `.director/<run>` e a resolução dessas mídias no Editor.

- Python: 1.440 testes e 37 subtestes aprovados; 12 ignorados e 63 desmarcados.
- UI: 351 testes, build e lint aprovados. Rust: 8 testes aprovados.
- Seletor nativo: seleção, reutilização, cancelamento e reinício aprovados.
- AppImage: atualização antes do boot HTTP preservando pesos, configurações e histórico.
- .deb final instalado; aplicativo aberto, HTTP autenticado 200 e revisão privada igual ao manifesto instalado.
- Produção real com revisões: planejamento, imagens, três vídeos, montagem, recuperação, importação de três itens no Editor e exportação concluídos.

Hashes e metadados: [recibo JSON](RELEASE_VALIDATION_2026-11-06.json). Evidência audiovisual preservada em `app/.cache/release-acceptance-20261105-191725/`, fora do Git. Recibos anteriores são históricos. AppImage final repacotado do AppDir validado após atualização dos módulos Python pelo manifesto.

## Pendência descoberta

O planejador expandiu o pedido de 3 segundos para três tomadas totalizando 59,125 segundos. A cadeia técnica está validada; duração exata e fidelidade artística não estão homologadas. Próximo trabalho: aplicar o orçamento de duração antes da aprovação e comparar pedido, plano e saída em teste de integração. YuE e a qualidade artística de outras produções não foram revalidados nesta rodada.

## Atualização posterior da mesma data

O desvio de 59s e o piso artificial de 5s foram corrigidos. A duração aproximada foi validada em produção real, com limites de precisão explícitos: [recibo de duração](DURATION_BUDGET_2026-11-06.md).

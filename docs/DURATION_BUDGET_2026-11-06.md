# Correção do orçamento de duração

## Causa e comportamento

O planejador anterior exigia pelo menos duas tomadas e durações de 20/40/60/80 segundos mesmo quando o pedido era de três segundos. A redução proporcional era seguida de arredondamento para vinte segundos, recriando o excesso.

Vídeos narrativos abaixo de vinte segundos agora usam uma tomada contínua. A gramática restringe a resposta a um item, com duração na malha nativa de quadros e nenhuma janela. O validador recusa tomadas extras, janelas, ausência de prompt, duração abaixo do mínimo do modelo e diálogo que exceda o tempo disponível. Não remove conteúdo silenciosamente.

Nos demais planos narrativos fora de H3, o resultado é verificado antes de retornar à fila: tolerância máxima de 5% do pedido ou um passo de quadros por tomada, o que for maior. Planos fora do orçamento falham com erro acionável em vez de produzir silenciosamente um filme mais longo. Isso não garante que toda história possa ser acomodada em qualquer duração.

O fluxo guiado por áudio segue a faixa. H3 preserva o contrato existente de duração e diálogo nativo. Produções e mídias anteriores são preservadas.

## Piso artificial na geração

A primeira validação real após o reparo do planejamento produziu 5,13 segundos para um plano de 3,0417 segundos: o Director aplicava `round(5 * fps)` antes de enviar o job. O modelo LTX admite um mínimo nativo de 17 quadros. A geração padrão e o preflight agora respeitam o mínimo do modelo. Teste integrado valida o envio de 73 quadros, em lugar dos 129 anteriores. Clipes curtos guiados por áudio também deixam de ser alongados artificialmente.

## Verificação

- Antes da correção, 13 testes específicos falharam e o caso de preservação do áudio passou, executando o código anterior em processo isolado.
- Depois da correção, os 16 testes específicos passaram, incluindo contrato de gramática.
- Suíte completa no primeiro candidato: 1.451 testes e 37 subtestes aprovados; 12 ignorados e 63 desmarcados. Após o ajuste final de gramática, regressão dirigida e produção real são registradas no recibo desta rodada.
- Build de UI e orçamento de bundles aprovados. Pacotes .deb e AppImage atualizados; fonte do .deb comparada byte a byte com o checkout. AppImage validado em sessão D-Bus isolada para preservar a instância aberta.

## Rastreabilidade

Registro: [_reversa_bugs/story-duration](../_reversa_bugs/story-duration/generated/index.md). A tolerância de duração não tinha spec efetiva localizada. O registro formal permanece aberto quanto ao veredito de spec; nenhuma spec foi alterada e não foi criada trava DONE.

## Resultado medido

Planejamento real `ab9f3285`: pedido 3s, uma tomada de 3,0417s. Nova revisão `78f8244c`, reutilizando os prompts e imagens aprovados: 73 quadros enviados, 69 quadros decodificados a 25fps, vídeo de 2,76s e contêiner com áudio de 2,89s. Ambos passaram pela margem de ±0,25s do teste. Não é uma homologação de duração exata quadro a quadro nem de fidelidade artística; a diferença entre vídeo e áudio permanece explícita.

Suíte final: 1.456 testes e 37 subtestes aprovados, 12 ignorados e 63 desmarcados. Regressão de duração + preflight: 34 aprovados. Recibo e hashes: [DURATION_VALIDATION_2026-11-06.json](DURATION_VALIDATION_2026-11-06.json). Vídeo preservado em `app/outputs/validation-duration-20261106/three-second-cube.mp4`.

O código está no commit `99f3360`. Os novos pacotes foram gerados e o AppImage iniciou com a fonte atualizada. Uma produção ativa foi detectada na instalação aberta, que permanece com o pacote anterior até a atualização em momento apropriado.

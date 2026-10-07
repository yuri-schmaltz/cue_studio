# Checklist — UI/UX e acessibilidade (ciclo 1+)

> ⚠️ **Atenção:** o objetivo é **verificar**, não declarar conformidade.
> A medição completa exige leitores de tela reais, zoom 200% e testes
> de contraste com ferramental apropriado. Esta lista é um sinalizador
> de regressões e melhorias óbvias.

## Tokens e densidade

- [ ] Texto de tarefa (briefing, prompts, cenas) ≥ 14 px no tema padrão.
- [ ] Metadados (timestamps, IDs) entre 12–13 px sem perder legibilidade.
- [ ] Em **timeline** e **lista técnica**, a densidade pode ser menor, mas com
      altura de linha consistente.

## Alvos de toque

- [ ] Botões principais em mobile ≥ 44×44 px (W3C WCAG 2.2 — Target Size).
- [ ] Itens de lista com tap-target ≥ 24 px alto, com espaçamento de até 24 px
      entre eles (ou 44 px com espaçamento zero entre si).

## Foco visível

- [ ] `outline` ou equivalente visível em todos os elementos focalizáveis
      no tema claro e no tema escuro.
- [ ] Foco não depende apenas de cor (ex.: anel + fundo diferente).
- [ ] Foco visível em campos `input`, `select`, `textarea`, `button`, `a`.

## Modais/diálogos

- [ ] `role="dialog"` e `aria-modal="true"`.
- [ ] Foco inicial no primeiro focalizável.
- [ ] `Escape` fecha.
- [ ] Foco retorna ao gatilho ao fechar.
- [ ] Sem conteúdo atrás do modal alcançável via teclado.

## Estados visuais

- [ ] **Vazio**: CTA clara.
- [ ] **Carregando**: indica motivo (download, fila, geração).
- [ ] **Erro**: explica o que fazer a seguir.
- [ ] **Sucesso**: ação subsequente visível.

## Navegação

- [ ] Header/Sidebar mostra projeto ativo.
- [ ] URL reflete projeto/seção.
- [ ] Botão "voltar" do navegador não dispara geração acidental.
- [ ] Deep-link de porta existente: abrir não dispara regeneração.

## Responsividade

- [ ] 1440 px: três colunas no Director; sem scroll horizontal global.
- [ ] 1280 px: dois painéis; sem corte de controles.
- [ ] 768 px: layout colapsa sem sobreposição.
- [ ] 390 px: Controles/Resultados acessíveis no Studio; Director em colunas empilhadas com troca por abas se necessário.

## Temas

- [ ] Contraste mínimo AA para texto (4,5:1 corpo, 3:1 ≥ 18 px).
- [ ] Contraste mínimo AA para elementos não-texto (3:1).
- [ ] Foco visível em ambos os temas.

## Áudio/vídeo

- [ ] Resultado de geração concluída mostra thumbnail + áudio (se aplicável).
- [ ] Em mobile, controles de áudio/vídeo acessíveis.

## Documentação

- [ ] `/README.md` reflete navegação atual (não a antiga).
- [ ] `/HANDOFF.md` menciona novos componentes compartilhados.
- [ ] `/CHANGELOG.md` registra decisões visuais e de A11y.

## Quando rever

- Após cada release em produção com criadores.
- Quando o tema ou a navegação mudar.
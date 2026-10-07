# Checklist — Teclado e foco (A03)

Use esta lista para verificar manualmente a feature A03. Ela **não substitui**
os testes automatizados; serve para confirmar fluxo real no navegador em
desktop e mobile.

Pré-condições: aplicação subiu (local), usuário autenticado (se aplicável).

## Setup

- [ ] Navegador em desktop (1440×900). Tema claro.
- [ ] Foco no body antes de começar (clique no fundo da página, longe de botões).
- [ ] DevTools aberto em "Elements" para inspecionar `document.activeElement`.

## Navegação pela Sidebar

- [ ] Pressionar `Tab` uma vez: foco vai para o **primeiro item focalizável** da página (logo da aplicação ou botão "New project", conforme primeiro elemento da Sidebar).
- [ ] Continuar `Tab`: foco percorre todos os itens da Sidebar em ordem.
- [ ] `Shift+Tab` inverte a ordem.
- [ ] Tecla `Enter` no item navega para a seção correspondente.

## Diálogo New Project

- [ ] Abrir New Project via botão.
- [ ] Foco vai automaticamente para o primeiro campo (`name`) ou `cancel`?
- [ ] `Tab` percorre `name → destination → type → ... → cancel → create`.
- [ ] `Shift+Tab` inverte.
- [ ] `Escape` fecha o diálogo **e** devolve o foco ao botão "New project".
- [ ] Em `textarea`/campo multilinha do diálogo, `Tab` **não** insere espaço; usa setas ou `Ctrl+]/[` para indentar (atalho explícito).

## Director

- [ ] Em `Briefing`, `Tab` percorre campos.
- [ ] Em `Scene list`, `Tab` percorre cenas; `Enter` abre detalhes.
- [ ] Em campo multilinha de prompt, `Tab` navega entre botões adjacentes (não insere tab).
- [ ] `Ctrl+]` indenta; `Ctrl+[` desindenta.

## Studio

- [ ] Em `Controls` (painel à esquerda), `Tab` percorre todos os controles.
- [ ] Em `Results` (painel à direita), `Tab` percorre mídias.
- [ ] Em mobile (390 px), alternar `Controls` ↔ `Results` via teclado é possível (botão visível ou atalho).

## Mobile (390 px)

- [ ] Foco visível e legível.
- [ ] Botões com pelo menos 44 px de altura efetiva (ver A22 depois).
- [ ] Diálogos ocupam viewport e travam o foco até fechar.

## Edge cases

- [ ] Abrir dois diálogos em sequência: foco não fica perdido no body.
- [ ] Cancelar um workflow com mudanças: foco volta ao botão de origem.
- [ ] `Tab` em campo desabilitado: foco pula.

## Critérios de pronto da checklist

- [ ] Todos os itens acima marcados como "ok" no navegador.
- [ ] Sem regressão visível em navegação por clique.
- [ ] Sem regressão em atalhos `mod+k`, `mod+enter`, etc.
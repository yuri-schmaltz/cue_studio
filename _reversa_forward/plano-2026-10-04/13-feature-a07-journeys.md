# Feature A07 — Mapa de jornadas e protótipos

**Origem:** [plano A07](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 1 — fundação UX.
**Prioridade:** P1.
**Responsável:** UX/Produto com apoio do front.

## 1. Contexto

A auditoria identificou navegação com 8 seções, mas sem mapa explícito de jornadas para os fluxos centrais: **Music Video**, **Short Film**, **geração manual**, **exportação**. Cada um tem pontos onde a próxima ação não é evidente.

🟡 A descrição é inferida — depende de validação com criadores.

## 2. Requisitos

### 2.1 Comportamento esperado

- Mapa de jornada documentado para 4 fluxos: Music Video, Short Film, geração manual, exportação.
- Cada fluxo contém: telas envolvidas, gatilhos, próximas ações visíveis, pontos de erro, saídas de modal.
- Avaliação com 3–5 criadores externos ao time registra em [`prototypes/journey-evals.md`](../prototypes/journey-evals.md) (template fornecido).
- Protótipos de baixa fidelidade (wireframes) em [`prototypes/wireframes/`](../prototypes/wireframes/) — HTML estático, **não** usa o app real.

### 2.2 Fora de escopo

- Pesquisa com usuários remunerada (pode entrar em release, não neste ciclo).
- Análise quantitativa de analytics (A24).

## 3. Contrato

`docs/journeys/` (Markdown) com um arquivo por fluxo. Estrutura:

```markdown
# Jornada: <nome>

## Atores
- Quem dispara
- Quem consome (se diferente)

## Pré-condições
- Projeto existe / está aberto / token válido / GPU disponível

## Passos
1. Origem (tela/ação)
3. Próxima ação visível (link, botão, dica)
…

## Pontos de erro
- Se rede cair: o que o usuário vê
- Se GPU ocupada: …

## Saídas
- Quais são as saídas do fluxo (vazio, export, continuar)
```

## 4. Plano

1. Listar os 4 fluxos com base no `plano-de-acao.md`.
2. Para cada um, levantar telas envolvidas via `grep -rn 'rota\\|Route' ui/src/`.
3. Produzir 1 wireframe por tela crítica em HTML estático.
4. Aplicar checklist de `checklists/ui-a11y.md` em cada protótipo.
6. Conduzir 3–5 sessões com criadores externos (assíncronas ou ao vivo).
7. Consolidar achados em `docs/journeys/findings.md`.

## 5. Testes de aceitação

- 4 jornadas documentadas em `docs/journeys/`.
- Wireframes em `prototypes/wireframes/` para 6+ telas.
- `journey-evals.md` com 3–5 sessões registradas.
- Cada jornada referencia pelo menos um critério de aceite do plano.

## 6. Critérios de pronto

- Material pronto para guiar A08 (componentes) e A09 (navegação).
- Achados consolidados; decisões macro alinhadas com o time.

## 7. Riscos

- Wireframes divergirem da arquitetura. **Mitigação:** revisar com engenheiro antes de finalizar.
- Sem acesso a criadores. **Mitigação:** registro da limitação em `findings.md`.
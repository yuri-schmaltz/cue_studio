# Feature A13 — Studio com resultados acessíveis em mobile

**Origem:** [plano A13](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2.
**Prioridade:** P1.
**Dependência:** A08, A09.

## 1. Contexto

`StudioPage.tsx` esconde `MainContent` abaixo de `md`, ocultando o output em mobile. A auditoria confirma que isso esconde o retorno da geração.

## 2. Requisitos

### 2.1 Comportamento esperado

- Em qualquer viewport, **resultado** da geração é acessível sem rolar 2000+ px.
- Padrão recomendado: tabs/pill `Controles | Resultados` em ≤ 767 px.
- Em ≥ 768 px: layout 2 colunas (Controles / Resultados).
- Ao concluir uma geração, o app **abre** automaticamente a aba Resultados e rola até a nova saída (sem disparar nova geração).
- Trocar de aba **preserva** prompt + mídia selecionada.

### 2.2 Fora de escopo

- Preview em tempo real da geração (release posterior).

## 3. Contrato

```ts
// ui/src/studio/types.ts
export type StudioTab = 'controls' | 'results';

export interface StudioLayoutProps {
  activeTab: StudioTab;
  onTabChange: (tab: StudioTab) => void;
  /** Notificação de nova saída. */
  pendingResult?: { id: string; createdAt: string };
}
```

## 4. Plano

1. Criar `StudioTabs` (mobile) e `StudioSplit` (desktop) com mesmo conteúdo.
2. Usar `Container Queries` ou `matchMedia` para escolher layout.
3. Substituir `MainContent hidden md:block` por layout adaptativo.
4. Quando `pendingResult` mudar e o usuário não estiver com foco em input, mudar `activeTab` para `results`.
5. Selecionar `pendingResult.id` no `Results` virtualizado.
6. Garantir que prompt não é perdido ao trocar aba.

## 5. Testes de aceitação

- 390 px: alternar `Controles ↔ Resultados` por teclado.
- Geração concluída: foco vai para resultado, aba muda.
- 768 px: dois painéis lado a lado.
- Trocar aba em 390 → 768 não perde estado.

## 6. Critérios de pronto

- Saída da geração alcançável em ≤ 1 toque ou 1 `Tab` em mobile.
- Sem regressão em desktop.

## 7. Riscos

- Auto-scroll agressivo incomoda. **Mitigação:** só rolar se a última interação foi há ≥ 4 s.
- Notificação cruzada entre projetos. **Mitigação:** `pendingResult.projectId` filtra.
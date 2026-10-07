# Feature A12 — Director: etapa, próxima ação e mobile

**Origem:** [plano A12](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2.
**Prioridade:** P1.
**Dependência:** A07–A10.

## 1. Contexto

Director usa 3 colunas em desktop, mas a **etapa** atual e a **próxima ação** não são explícitas. Em mobile, as colunas viram painéis longos sem troca clara.

## 2. Requisitos

### 2.1 Comportamento esperado

- Cabeçalho do Director mostra: etapa (Briefing / Cenas / Opções / Revisão), próxima ação visível e link "Voltar para Briefing" se já passou.
- Em desktop (≥ 1280 px): 3 colunas (Briefing / Cenas / Opções) com proporções 1:1:1.
- Em 768–1279 px: 2 colunas; opções viram gaveta lateral com botão "Opções".
- Em ≤ 767 px: painéis empilhados com "Toc" "Próximo" e troca por abas: Briefing / Cenas / Opções.
- Cada cena mostra miniatura/placeholder, tempo/duração, versão/take, status, prompt editável e ação principal.

### 2.2 Fora de escopo

- Refazer do zero o Director (manter contratos atuais).
- Adicionar modo offline.

## 3. Contrato

```ts
// ui/src/director/types.ts
export type DirectorStep = 'briefing' | 'scenes' | 'options' | 'review';

export interface DirectorHeaderState {
  step: DirectorStep;
  nextAction?: { label: string; href: string };
  previousAction?: { label: string; href: string };
}

export interface SceneCard {
  id: string;
  index: number;
  durationSec: number;
  takes: number;
  status: 'pending' | 'running' | 'review' | 'done' | 'failed';
  prompt: string;
  thumb?: string;
}
```

## 4. Plano

1. Criar `DirectorHeader` que renderiza stepper (`briefing → scenes → options → review`).
2. Mover lógica de "próxima ação" para o container; cada subcomponente declara `canAdvance` e `nextHref`.
3. Criar layout responsivo:
   - desktop: `grid-cols-3` (≥ 1280);
   - tablet: `grid-cols-2` com gaveta (768–1279);
   - mobile: abas (≤ 767).
4. Substituir layout atual pelo novo.
5. Migrar `SceneCard` para componente compartilhado `<SceneCard>` com `<SceneCard.Thumb>`, `<SceneCard.Prompt>`, `<SceneCard.Actions>`.
6. Garantir foco visível nas tabs mobile.

## 5. Testes de aceitação

- Em 390 px: tabs Briefing/Cenas/Opções navegáveis por teclado e via swipe opcional.
- Cabeçalho mostra etapa atual e próxima ação.
- Cena com status `failed` mostra CTA "Tentar de novo".

## 6. Critérios de pronto

- Direção reversível: rollback para layout anterior se regressão.
- Snapshots visuais em 3 viewports.

## 7. Riscos

- Refactor do layout pode quebrar cenas existentes. **Mitigação:** feature-flag em release canário.
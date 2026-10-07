# Feature A10 — Projetos: criação rápida e setup progressivo

**Origem:** [plano A10](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 2 — fluxos visíveis.
**Prioridade:** P1.
**Dependência:** A08, A09.

## 1. Contexto

New Project já exige destino, skill, formato e workflow no primeiro formulário. A auditoria sugere que criação rápida (nome + tipo + preset recomendado) e setup técnico posterior aumentaria conversão.

🟡 Proposta inferida; precisa validar com criadores (A07).

## 2. Requisitos

### 2.1 Comportamento esperado

- Fluxo padrão:
  1. **Nome** + **Tipo** (Music Video / Short Film / Custom).
  2. **Preset recomendado** sugerido com base no tipo.
  3. Botão "Criar" — usa defaults do preset.
- Botão "Ajustar… mais opções" → expande inline com destino, skill, formato, workflow.
- Defaults do preset persistem; overrides por projeto persistem também.
- URL após criar: `/projects/:projectId/briefing`.

### 2.2 Fora de escopo

- Catálogo extenso de presets (mantém 3–5).
- Substituir o NewProjectDialog atual — adicionar caminhos, não remover.

## 3. Contrato

```ts
// ui/src/projects/presets.ts
export interface ProjectPreset {
  id: string;
  label: string;
  recommendedFor: ('music-video' | 'short-film' | 'custom')[];
  defaults: {
    destination: string;
    skill: string;
    format: string;
    workflow: 'basic' | 'expert';
  };
}

export const DEFAULT_PRESETS: ProjectPreset[] = [
  {
    id: 'mv-default',
    label: 'Music Video — padrão',
    recommendedFor: ['music-video'],
    defaults: { destination: 'outputs', skill: 'cinematic', format: 'mp4', workflow: 'basic' },
  },
  {
    id: 'sf-default',
    label: 'Short Film — padrão',
    recommendedFor: ['short-film'],
    defaults: { destination: 'outputs', skill: 'narrative', format: 'mp4', workflow: 'basic' },
  },
  {
    id: 'custom-default',
    label: 'Custom',
    recommendedFor: ['custom'],
    defaults: { destination: 'outputs', skill: 'auto', format: 'mp4', workflow: 'basic' },
  },
];
```

## 4. Plano

1. Refatorar `NewProjectDialog` para dois passos visuais (não wizard): quick + expandir.
2. Carregar `DEFAULT_PRESETS` em `ui/src/projects/presets.ts`.
3. Persistir preset escolhido em `project.metadata.presetId`.
4. Ao aplicar overrides, marcar `project.metadata.overrides = { destination, skill, format, workflow }`.
5. Botão "Voltar" no header do projeto mostra preset atual e link para mudar.
6. Testes unit para `applyPreset`.

## 5. Testes de aceitação

- Criar projeto "Meu MV" → preset `mv-default` aplicado.
- Mudar `destination` em opções avançadas → `overrides.destination` salvo.
- Reabrir projeto: mostra preset + overrides.

## 6. Critérios de pronto

- Tempo médio de criação (medido com A07) cai ≥ 30%.
- Nenhuma regressão no fluxo "Ajustar tudo".

## 7. Riscos

- Overrides divergirem do preset (preset mudou após override salvo). **Mitigação:** manter overrides atômicos; nunca perder override salvo.
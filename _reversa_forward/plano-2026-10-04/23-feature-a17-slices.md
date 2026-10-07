# Feature A17 — Separar contratos, slices, transporte e polling

**Origem:** [plano A17](../../_reversa_sdd/auditoria-2026-10-04/plano-de-acao.md).
**Ciclo:** 3.
**Prioridade:** P1.
**Dependência:** A01, A06.

## 1. Contexto

`ui/src/stores/useStore.ts` tem ~12.8k linhas concentrando navegação, persistência, polling e ações. Polling e respostas tardias podem contaminar projetos diferentes.

## 2. Requisitos

### 2.1 Comportamento esperado

- Tipos compartilhados em `ui/src/types/` sem import de store/UI.
- Cliente HTTP dividido por domínio (`apiFetch.projects.*`, `apiFetch.queue.*`).
- Estado dividido em slices por domínio (`projectsSlice`, `queueSlice`, `editorSlice`).
- Cada request tem `AbortController` próprio e cancelamento explícito.
- Respostas tardias: se `projectId` mudou, descartar.
- Polling: propriedade do owner; limpa em unmount.

### 2.2 Fora de escopo

- Migrar para TanStack Query (decidir em revisão; documentar requisitos antes).
- Refatoração ampla de UI junto.

## 3. Contrato

```ts
// ui/src/api/projects.ts
import { apiFetch } from "./transport";

export interface ProjectSummary {
  id: string;
  name: string;
  type: 'music-video' | 'short-film' | 'custom';
  updatedAt: string;
}

export const projectsApi = {
  list(signal?: AbortSignal): Promise<ProjectSummary[]> {
    return apiFetch("/api/projects", { signal }).then((r) => r.json());
  },
  create(payload: { name: string; type: ProjectSummary['type'] }, signal?: AbortSignal) {
    return apiFetch("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
      signal,
    });
  },
};
```

```ts
// ui/src/projects/projectsSlice.ts (Zustand)
interface ProjectsState {
  byId: Record<string, ProjectSummary>;
  loading: boolean;
  error?: ApiError;
  fetch(signal?: AbortSignal): Promise<void>;
  cancel(): void; // aborta em curso
}
```

## 4. Plano

1. Criar `ui/src/types/projects.ts` com tipos compartilhados.
2. Criar `ui/src/api/projects.ts` com `projectsApi`.
4. Criar `ui/src/projects/projectsSlice.ts`.
5. Migrar primeiro consumidor (Dashboard, A11).
6. Remover estado de projetos de `useStore.ts`.
7. Repetir por domínio.

## 5. Testes de aceitação

- `useStore.ts` perdeu ≥ 2k linhas (estimativa; medir).
- Componente não dispara `setState` após unmount.
- Polling para quando a tela não está ativa (document.visibilityState).

## 6. Critérios de pronto

- Polling tem owner + cancelamento.
- Tipos compartilhados sem import circular.
- Sem regressão em Dashboard.

## 7. Riscos

- Migração lenta. **Mitigação:** gate: nenhum novo `setSection` em `useStore.ts`.
// Scaffold de slice Zustand (A17).
// Mostra a forma esperada do slice de projetos.

import { create } from 'zustand';
import { projectsApi, type ProjectSummary } from './projects';

interface ProjectsState {
  byId: Record<string, ProjectSummary>;
  loading: boolean;
  error?: { code: string; message: string };

  fetch(signal?: AbortSignal): Promise<void>;
  cancel(): void;
  create(input: { name: string; type: ProjectSummary['type'] }): Promise<ProjectSummary>;
}

let inflight: AbortController | null = null;

export const useProjectsSlice = create<ProjectsState>((set, get) => ({
  byId: {},
  loading: false,

  async fetch(signal) {
    set({ loading: true, error: undefined });
    const controller = new AbortController();
    inflight = controller;
    try {
      const list = await projectsApi.list(controller.signal);
      // response tardia: se signal foi abortado, descartar
      if (signal?.aborted) return;
      const byId: Record<string, ProjectSummary> = {};
      for (const p of list) byId[p.id] = p;
      set({ byId, loading: false });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      set({ error: e, loading: false });
    } finally {
      inflight = null;
    }
  },

  cancel() {
    inflight?.abort();
    inflight = null;
    set({ loading: false });
  },

  async create(input) {
    const p = await projectsApi.create(input);
    set((s) => ({ byId: { ...s.byId, [p.id]: p } }));
    return p;
  },
}));
// Standalone store for the projects slice (feature A17).
//
// Kept separate from `useStore.ts` so consumers can adopt the new
// slice incrementally without dragging the legacy workspace state
// along.

import { create } from 'zustand'

import { createProjectsSlice } from './projectsSlice'
import type { ProjectsSlice } from './projectsSlice'

export const useProjectsStore = create<ProjectsSlice>()((...args) => createProjectsSlice(...args))

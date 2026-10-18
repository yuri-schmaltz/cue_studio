/**
 * Shared project contract types (feature A17).
 *
 * Lives under `types/` with no store or UI imports so both the API
 * layer (`api/projects.ts`) and any store slice can consume it
 * without import cycles.
 */

export type ProjectType = 'music-video' | 'short-film' | 'custom'

export interface ProjectSummary {
  id: string
  name: string
  type: ProjectType
  updatedAt: string
}

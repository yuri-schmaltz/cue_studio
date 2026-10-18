/**
 * Route model + URL mapping (feature A09).
 *
 * The URL always reflects the active project and section so deep
 * links survive refresh and browser Back walks the actual navigation
 * history:
 *
 * | Kind         | URL                                |
 * |--------------|------------------------------------|
 * | `dashboard`  | `/`                                |
 * | `projects`   | `/projects`                        |
 * | `project`    | `/projects/:projectId/:section`    |
 * | `editor`     | `/projects/:projectId/editor`      |
 * | `queue`      | `/queue`                           |
 * | `configurations` | `/configurations`              |
 *
 * Deviation from the spec's idealized contract: this app's project
 * sections are `director` / `studio` / `medias` (there is no separate
 * briefing/scenes/review surface yet), and media browsing is
 * project-scoped, so there is no global `/media` kind. The `Section`
 * union mirrors what actually ships.
 *
 * This module is pure (no store, no DOM) so parse/serialize are unit
 * testable; the store/URL wiring lives in `useUrlNavigation.ts`.
 */

import type { AppSection } from '../types'

export type Section = 'director' | 'studio' | 'medias'

export type AppRoute =
  | { kind: 'dashboard' }
  | { kind: 'projects' }
  | { kind: 'project'; projectId: string; section: Section }
  | { kind: 'queue' }
  | { kind: 'editor'; projectId: string }
  | { kind: 'configurations' }

export const PROJECT_SECTIONS: readonly Section[] = ['director', 'studio', 'medias']

function isProjectSection(value: string): value is Section {
  return (PROJECT_SECTIONS as readonly string[]).includes(value)
}

/** Parse a location pathname into an `AppRoute` (unknown paths fall
 *  back to the dashboard so a stale URL never blanks the app). */
export function parseRoute(pathname: string): AppRoute {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length === 0) return { kind: 'dashboard' }
  if (parts.length === 1) {
    if (parts[0] === 'projects') return { kind: 'projects' }
    if (parts[0] === 'queue') return { kind: 'queue' }
    if (parts[0] === 'configurations') return { kind: 'configurations' }
    return { kind: 'dashboard' }
  }
  if (parts[0] === 'projects' && parts[1]) {
    const projectId = parts[1]
    if (parts.length === 2) return { kind: 'project', projectId, section: 'director' }
    if (parts.length === 3 && parts[2] === 'editor') return { kind: 'editor', projectId }
    if (parts.length === 3 && isProjectSection(parts[2])) {
      return { kind: 'project', projectId, section: parts[2] }
    }
  }
  return { kind: 'dashboard' }
}

/** Serialize an `AppRoute` back into its pathname. */
export function serializeRoute(route: AppRoute): string {
  switch (route.kind) {
    case 'dashboard': return '/'
    case 'projects': return '/projects'
    case 'queue': return '/queue'
    case 'configurations': return '/configurations'
    case 'editor': return `/projects/${encodeURIComponent(route.projectId)}/editor`
    case 'project': return `/projects/${encodeURIComponent(route.projectId)}/${route.section}`
  }
}

/** Map the store's (section, workspace) pair onto a route. Project
 *  sections require a real (non-default) workspace — without one the
 *  user is parked on the projects list, matching `setAppSection`'s
 *  gating. */
export function routeFromState(section: AppSection, workspace: string): AppRoute {
  const hasProject = workspace !== 'default'
  switch (section) {
    case 'director':
    case 'studio':
    case 'medias':
      return hasProject ? { kind: 'project', projectId: workspace, section } : { kind: 'projects' }
    case 'editor':
      return hasProject ? { kind: 'editor', projectId: workspace } : { kind: 'projects' }
    case 'projects': return { kind: 'projects' }
    case 'queue': return { kind: 'queue' }
    case 'configurations': return { kind: 'configurations' }
    case 'dashboard':
    default: return { kind: 'dashboard' }
  }
}

/** Reduce a route to the store-level section (+ project) it selects. */
export function sectionFromRoute(route: AppRoute): { section: AppSection; projectId?: string } {
  switch (route.kind) {
    case 'project': return { section: route.section, projectId: route.projectId }
    case 'editor': return { section: 'editor', projectId: route.projectId }
    case 'projects': return { section: 'projects' }
    case 'queue': return { section: 'queue' }
    case 'configurations': return { section: 'configurations' }
    case 'dashboard':
    default: return { section: 'dashboard' }
  }
}

/**
 * Store ⇄ URL synchronization (feature A09).
 *
 * `useUrlNavigation` (mounted once from `App`) keeps the address bar
 * and the store's navigation state in lock-step:
 *
 * - store → URL: every section/project transition is pushed to the
 *   history, so browser Back returns to the last URL visited. Listing
 *   filters (media filter) are written with `replaceState` so they
 *   don't pollute the history.
 * - URL → store: on cold start the deep link is applied (project +
 *   section restored after the workspace list loads — never
 *   triggering a generation), and `popstate` applies the URL the user
 *   navigated back/forward to.
 *
 * No router dependency: the app's navigation already funnels through
 * `setAppSection`, so the sync layer sits above the store instead of
 * replacing it.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../stores/useStore'
import type { MediaFilter } from '../types'
import { parseRoute, routeFromState, serializeRoute, sectionFromRoute, PROJECT_SECTIONS } from './types'
import type { AppRoute } from './types'

const MEDIA_FILTERS: readonly MediaFilter[] = ['all', 'images', 'videos', 'audio', 'avatars', 'multiclip', 'favorites']
const LAST_ACTIVE_KEY = 'cue-studio-last-active'

function currentHref(): string {
  return window.location.pathname + window.location.search
}

function hrefFor(route: AppRoute, filter?: MediaFilter): string {
  const path = serializeRoute(route)
  // Only the media listing carries URL filters today; keep other
  // routes clean.
  if (route.kind === 'project' && route.section === 'medias' && filter && filter !== 'all') {
    return `${path}?filter=${encodeURIComponent(filter)}`
  }
  return path
}

function filterFromLocation(): MediaFilter | null {
  const value = new URLSearchParams(window.location.search).get('filter')
  return value && (MEDIA_FILTERS as readonly string[]).includes(value) ? (value as MediaFilter) : null
}

/** Apply a parsed route to the store. Returns false when the route
 *  references a project that isn't known (caller falls back). */
async function applyRoute(route: AppRoute): Promise<boolean> {
  const state = useStore.getState()
  const target = sectionFromRoute(route)
  if (target.projectId) {
    if (target.projectId === 'default') return false
    if (state.activeWorkspace !== target.projectId) {
      const known = state.workspaces.some((w) => w.name === target.projectId)
      if (!known) return false
      // Switching never triggers a generation — it only selects the
      // workspace and reloads its outputs/setup.
      await state.switchWorkspace(target.projectId)
    }
  }
  if (state.appSection !== target.section) state.setAppSection(target.section)
  if (route.kind === 'project' && route.section === 'medias') {
    const filter = filterFromLocation()
    if (filter && state.mediaFilter !== filter) state.setMediaFilter(filter)
  }
  return true
}

export function useUrlNavigation(): void {
  const section = useStore((s) => s.appSection)
  const workspace = useStore((s) => s.activeWorkspace)
  const mediaFilter = useStore((s) => s.mediaFilter)
  const workspaces = useStore((s) => s.workspaces)
  // True while a URL→store application is in flight so the
  // store→URL effect doesn't echo intermediate states back into
  // history.
  const applyingRef = useRef(false)
  const hydratedRef = useRef(false)

  // Apply a URL to the store, then canonicalize the address bar so
  // the store→URL effect finds nothing left to write.
  const applyFromLocation = useCallback(async () => {
    let route = parseRoute(window.location.pathname)
    if (route.kind === 'projects' && window.location.pathname === '/') {
      try {
        const raw = localStorage.getItem(LAST_ACTIVE_KEY)
        if (raw) {
          const last = JSON.parse(raw)
          if (last.workspace && workspaces.some((w) => w.name === last.workspace)) {
            if (last.section === 'editor') {
              route = { kind: 'editor', projectId: last.workspace }
            } else if (last.section && (PROJECT_SECTIONS as readonly string[]).includes(last.section)) {
              route = { kind: 'project', projectId: last.workspace, section: last.section }
            }
          }
        }
      } catch {
        /* ignore invalid storage entry */
      }
    }

    applyingRef.current = true
    try {
      // On failure (unknown project) the canonical URL of the current
      // state replaces the broken deep link.
      await applyRoute(route)
      const state = useStore.getState()
      window.history.replaceState(null, '', hrefFor(routeFromState(state.appSection, state.activeWorkspace), state.mediaFilter))
    } finally {
      applyingRef.current = false
    }
  }, [workspaces])

  // URL → store: initial deep link (waits for the workspace list) and
  // browser back/forward.
  useEffect(() => {
    const onPopState = () => {
      void applyFromLocation()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [applyFromLocation])

  // Initial hydration: deep links reference a project, which can only
  // be validated once the workspace list has loaded. Re-runs on
  // workspace list changes until the URL has been applied once.
  useEffect(() => {
    if (hydratedRef.current) return
    const route = parseRoute(window.location.pathname)
    if (route.kind === 'project' || route.kind === 'editor') {
      const known = workspaces.some((w) => w.name === route.projectId)
      if (!known && workspaces.length === 0) return // still loading
    }
    hydratedRef.current = true
    void applyFromLocation()
  }, [workspaces, applyFromLocation])

  // Store → URL.
  const prev = useRef({ section, workspace, mediaFilter })
  useEffect(() => {
    if (!hydratedRef.current || applyingRef.current) {
      // Either a URL→store application is running or the deep link
      // hasn't been validated against the workspace list yet — never
      // rewrite the address bar in those windows.
      prev.current = { section, workspace, mediaFilter }
      return
    }
    const route = routeFromState(section, workspace)
    const target = hrefFor(route, mediaFilter)
    const changed =
      prev.current.section !== section ||
      prev.current.workspace !== workspace
    prev.current = { section, workspace, mediaFilter }
    if (target === currentHref()) return
    if (changed) {
      window.history.pushState(null, '', target)
      try {
        if (workspace && workspace !== 'default') {
          localStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify({ workspace, section }))
        }
      } catch {
        /* ignore storage quota errors */
      }
    } else {
      // Filter-only change: replace so history isn't polluted.
      window.history.replaceState(null, '', target)
    }
  }, [section, workspace, mediaFilter])
}

/** Active project for the current path (falls back to the store's
 *  active workspace outside project routes) — feature A09. */
export function useActiveProject(): string | null {
  const workspace = useStore((s) => s.activeWorkspace)
  const route = parseRoute(window.location.pathname)
  if (route.kind === 'project' || route.kind === 'editor') return route.projectId
  return workspace !== 'default' ? workspace : null
}

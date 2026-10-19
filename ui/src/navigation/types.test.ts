/**
 * Unit tests for parseRoute/serializeRoute and the state ⇄ route
 * mapping (feature A09).
 */

import { describe, expect, it } from 'vitest'

import {
  parseRoute,
  routeFromState,
  sectionFromRoute,
  serializeRoute,
} from './types'
import type { AppRoute } from './types'

describe('parseRoute', () => {
  it('parses the top-level routes', () => {
    expect(parseRoute('/')).toEqual({ kind: 'projects' })
    expect(parseRoute('')).toEqual({ kind: 'projects' })
    expect(parseRoute('/projects')).toEqual({ kind: 'projects' })
    expect(parseRoute('/queue')).toEqual({ kind: 'queue' })
    expect(parseRoute('/configurations')).toEqual({ kind: 'configurations' })
  })

  it('parses project routes with each section', () => {
    expect(parseRoute('/projects/abc/director')).toEqual({ kind: 'project', projectId: 'abc', section: 'director' })
    expect(parseRoute('/projects/abc/studio')).toEqual({ kind: 'project', projectId: 'abc', section: 'studio' })
    expect(parseRoute('/projects/abc/medias')).toEqual({ kind: 'project', projectId: 'abc', section: 'medias' })
  })

  it('defaults a bare project URL to its default section', () => {
    expect(parseRoute('/projects/abc')).toEqual({ kind: 'project', projectId: 'abc', section: 'director' })
  })

  it('parses the editor route', () => {
    expect(parseRoute('/projects/abc/editor')).toEqual({ kind: 'editor', projectId: 'abc' })
  })

  it('falls back to the projects list for unknown paths', () => {
    expect(parseRoute('/nope')).toEqual({ kind: 'projects' })
    expect(parseRoute('/projects/abc/bogus')).toEqual({ kind: 'projects' })
  })

  it('decodes encoded project ids', () => {
    expect(parseRoute('/projects/my%20film/studio')).toEqual({ kind: 'project', projectId: 'my film', section: 'studio' })
  })
})

describe('serializeRoute', () => {
  it('serializes every route kind', () => {
    const routes: AppRoute[] = [
      { kind: 'projects' },
      { kind: 'project', projectId: 'abc', section: 'director' },
      { kind: 'project', projectId: 'abc', section: 'studio' },
      { kind: 'project', projectId: 'abc', section: 'medias' },
      { kind: 'editor', projectId: 'abc' },
      { kind: 'queue' },
      { kind: 'configurations' },
    ]
    expect(routes.map(serializeRoute)).toEqual([
      '/projects',
      '/projects/abc/director',
      '/projects/abc/studio',
      '/projects/abc/medias',
      '/projects/abc/editor',
      '/queue',
      '/configurations',
    ])
  })

  it('round-trips through parseRoute', () => {
    for (const path of ['/projects', '/projects/abc/director', '/projects/abc/studio', '/projects/abc/medias', '/projects/abc/editor', '/queue', '/configurations']) {
      expect(serializeRoute(parseRoute(path))).toBe(path)
    }
  })

  it('encodes project ids', () => {
    expect(serializeRoute({ kind: 'project', projectId: 'my film', section: 'studio' })).toBe('/projects/my%20film/studio')
  })
})

describe('routeFromState / sectionFromRoute', () => {
  it('maps global sections to their routes', () => {
    expect(routeFromState('projects', 'default')).toEqual({ kind: 'projects' })
    expect(routeFromState('queue', 'abc')).toEqual({ kind: 'queue' })
    expect(routeFromState('configurations', 'abc')).toEqual({ kind: 'configurations' })
  })

  it('scopes project sections to the active workspace', () => {
    expect(routeFromState('director', 'abc')).toEqual({ kind: 'project', projectId: 'abc', section: 'director' })
    expect(routeFromState('studio', 'abc')).toEqual({ kind: 'project', projectId: 'abc', section: 'studio' })
    expect(routeFromState('medias', 'abc')).toEqual({ kind: 'project', projectId: 'abc', section: 'medias' })
    expect(routeFromState('editor', 'abc')).toEqual({ kind: 'editor', projectId: 'abc' })
  })

  it('parks project sections on the projects list without a real workspace', () => {
    expect(routeFromState('director', 'default')).toEqual({ kind: 'projects' })
    expect(routeFromState('editor', 'default')).toEqual({ kind: 'projects' })
    expect(routeFromState('medias', 'default')).toEqual({ kind: 'projects' })
  })

  it('reduces routes back to store sections', () => {
    expect(sectionFromRoute({ kind: 'project', projectId: 'abc', section: 'studio' })).toEqual({ section: 'studio', projectId: 'abc' })
    expect(sectionFromRoute({ kind: 'editor', projectId: 'abc' })).toEqual({ section: 'editor', projectId: 'abc' })
    expect(sectionFromRoute({ kind: 'queue' })).toEqual({ section: 'queue' })
  })
})

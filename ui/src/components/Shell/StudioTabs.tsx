// filepath: ui/src/components/Shell/StudioTabs.tsx
//
// Mobile tab bar for Studio (feature A13 §2.1): `Controls | Results`
// at ≤767px so the generation results are reachable without the
// desktop 2-column split (which hides MainContent below `md`).
//
// Accessibility: role="tablist"/"tab" with aria-selected, roving
// tabindex and ArrowLeft/ArrowRight/Home/End keyboard navigation —
// the same pattern used by the Director stage tabs. A "new result"
// dot renders on the Results tab while a concluded generation hasn't
// been visited yet.

import type { KeyboardEvent } from 'react'
import type { StudioLayoutProps } from '../../studio/types'
import { STUDIO_LABELS } from '../../studio/types'

type StudioTabsProps = Pick<StudioLayoutProps, 'activeTab' | 'onTabChange'> & {
  /** Rendered as a dot on the Results tab while a new output is
   *  waiting (user was typing when the run concluded). */
  hasPendingResult?: boolean
}

const TABS: readonly StudioLayoutProps['activeTab'][] = ['controls', 'results']
const tabDomId = (tab: StudioLayoutProps['activeTab']) => `studio-tab-${tab}`

export function StudioTabs({ activeTab, onTabChange, hasPendingResult = false }: StudioTabsProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.indexOf(activeTab)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = TABS[nextIndex]
    onTabChange(nextTab)
    document.getElementById(tabDomId(nextTab))?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="Studio panels"
      className="flex shrink-0 items-center gap-1.5 border-b border-border bg-bg-secondary px-3 py-1.5 md:hidden"
      data-testid="studio-tabs"
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={tabDomId(tab)}
          aria-controls={`studio-${tab}-panel`}
          aria-selected={activeTab === tab}
          tabIndex={activeTab === tab ? 0 : -1}
          onClick={() => onTabChange(tab)}
          data-testid={`studio-tab-${tab}`}
          className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary ${
            activeTab === tab
              ? 'border-accent-blue bg-accent-blue/15 text-accent-blue'
              : 'border-border bg-bg-tertiary text-text-secondary hover:border-border-light hover:text-text-primary'
          }`}
        >
          {STUDIO_LABELS.tabs[tab]}
          {tab === 'results' && hasPendingResult && (
            <>
              <span
                data-testid="studio-tabs-pending"
                aria-hidden="true"
                className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400"
              />
              <span className="sr-only">— new result</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}

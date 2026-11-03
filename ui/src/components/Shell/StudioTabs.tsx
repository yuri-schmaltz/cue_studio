// filepath: ui/src/components/Shell/StudioTabs.tsx
//
// Mobile tab bar for Studio (feature A13 §2.1): `Controls | Results`
// at ≤767px so the generation results are reachable without the
// desktop 2-column split (which hides MainContent below `md`).
//
// Built on the shared `TabStrip` so the Studio, the Director and the
// application navigation all behave the same way (roving tabindex,
// Arrow/Home/End navigation, aria wiring). A "new result" dot renders
// on the Results tab while a concluded generation hasn't been visited
// yet.

import type { StudioLayoutProps } from '../../studio/types'
import { STUDIO_LABELS } from '../../studio/types'
import { TabStrip } from '../shared/TabStrip'

type StudioTabsProps = Pick<StudioLayoutProps, 'activeTab' | 'onTabChange'> & {
  /** Rendered as a dot on the Results tab while a new output is
   *  waiting (user was typing when the run concluded). */
  hasPendingResult?: boolean
}

const TABS: readonly StudioLayoutProps['activeTab'][] = ['controls', 'results']

export function StudioTabs({ activeTab, onTabChange, hasPendingResult = false }: StudioTabsProps) {
  return (
    <TabStrip
      variant="segmented"
      testId="studio-tabs"
      ariaLabel="Studio panels"
      idPrefix="studio-tab"
      controlsId={item => `studio-${item.id}-panel`}
      className="shrink-0 border-b border-border bg-bg-secondary px-3 py-1.5 md:hidden"
      items={TABS.map(tab => ({ id: tab, label: STUDIO_LABELS.tabs[tab] }))}
      value={activeTab}
      onChange={onTabChange}
      itemTestId={item => `studio-tab-${item.id}`}
      renderTrailing={item => (
        item.id === 'results' && hasPendingResult
          ? (
            <>
              <span
                data-testid="studio-tabs-pending"
                aria-hidden="true"
                className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400"
              />
              <span className="sr-only">— new result</span>
            </>
          )
          : null
      )}
    />
  )
}

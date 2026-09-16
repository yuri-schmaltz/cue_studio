import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { migrateAll } from './lib/legacyKeys'

// One-shot v2.1 rebrand migration: rewrites every legacy
// "maestro-*" / "maestro_*" localStorage, sessionStorage, and
// IndexedDB key into its "cue-studio-*" / "cue_studio_*" equivalent
// so existing users keep their settings. The flag stored in
// localStorage makes this a no-op on subsequent boots.
migrateAll()

// Mobile browsers require persistent notifications from a service worker;
// `new Notification()` is desktop-only on several engines, including iOS
// WebKit. This worker deliberately does not cache application assets, so a
// Cue Studio update can never strand users on an old UI bundle.
if ('serviceWorker' in navigator) {
  // Unregister any stale "maestro-sw.js" worker from older builds so
  // we don't get ghost push-subscriptions after the rebrand. The
  // script URL check is intentionally permissive (substring match)
  // because the old worker is gone from the bundle — only registered
  // instances survive, and we want every one evicted.
  navigator.serviceWorker.getRegistrations().then(regs => {
    for (const r of regs) {
      if (r.active && r.active.scriptURL.includes('maestro-sw.js')) {
        void r.unregister()
      }
    }
  })
  void navigator.serviceWorker.register('/cue-studio-sw.js', { scope: '/' }).catch(error => {
    console.warn('[cue-studio] Service worker registration failed:', error)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

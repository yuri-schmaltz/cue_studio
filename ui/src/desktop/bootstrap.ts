import { invoke } from '@tauri-apps/api/core'
import './desktop.css'

interface RuntimeStatus { phase: string; message: string; log_path: string }
const status = document.querySelector<HTMLParagraphElement>('#status')!
const log = document.querySelector<HTMLParagraphElement>('#log')!
const error = document.querySelector<HTMLParagraphElement>('#error')!
const retry = document.querySelector<HTMLButtonElement>('#retry')!
const install = document.querySelector<HTMLButtonElement>('#install')!
const choose = document.querySelector<HTMLButtonElement>('#choose')!
const importWorkspace = document.querySelector<HTMLButtonElement>('#import-workspace')!
let polling = true
async function refresh() {
  try {
    const runtime = await invoke<RuntimeStatus>('desktop_status')
    status.textContent = runtime.message
    const failed = ['failed', 'setup-required', 'stopped'].includes(runtime.phase)
    retry.hidden = !failed
    install.hidden = !['setup-required', 'failed'].includes(runtime.phase)
    choose.hidden = !failed
    log.textContent = failed ? `Diagnostic log: ${runtime.log_path}` : ''
  } catch (cause) {
    error.textContent = `Unable to contact the desktop host: ${String(cause)}`
  }
  if (polling) window.setTimeout(() => { void refresh() }, 500)
}
async function action(command: string) {
  error.textContent = ''
  try { await invoke(command) } catch (cause) { error.textContent = String(cause) }
}
retry.addEventListener('click', () => { void action('desktop_retry') })
choose.addEventListener('click', () => { void action('desktop_choose_runtime') })
importWorkspace.addEventListener('click', () => { void action('desktop_import_workspace') })
install.addEventListener('click', () => { void action('desktop_install_runtime') })
window.addEventListener('pagehide', () => { polling = false })
void refresh()

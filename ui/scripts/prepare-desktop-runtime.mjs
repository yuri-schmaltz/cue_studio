// Stage code and built assets, never GPU weights, user data or virtualenvs.
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const ui = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(ui, '../app')
const destination = join(ui, 'src-tauri/runtime/app')
const excluded = new Set(['ckpts', 'env', 'outputs', 'logs', 'cache', 'temp', 'uploads', 'loras', 'loras_user', 'recipes_user', 'projects', 'models_user', 'settings', '__pycache__', 'wgp_config.json', 'setup_config.json'])
await rm(join(ui, 'src-tauri/runtime'), { recursive: true, force: true })
await mkdir(destination, { recursive: true })
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.name.startsWith('.') || entry.name.startsWith('env-') || excluded.has(entry.name)) continue
  // Source code, definitions and bundled model assets are needed; runtime
  // settings and databases must never become defaults for another person.
  if (!entry.isDirectory() && !/\.(py|json|md|txt|pem|crt|yaml|yml)$/.test(entry.name)) continue
  if (/config|\.sqlite|\.log|settings/i.test(entry.name)) continue
  await cp(join(source, entry.name), join(destination, entry.name), { recursive: true,
    filter: path => !path.split(/[\\/]/).some(part => part === '__pycache__' || part === '.cache' || part === '.git') && !/\.(pyc|pth|pt|safetensors|gguf|bin|sqlite3?)$/.test(path) })
}
await rm(join(ui, 'src-tauri/web'), { recursive: true, force: true })
await cp(join(ui, 'dist'), join(ui, 'src-tauri/web'), { recursive: true })
console.log('Desktop code and UI staged. Python runtime installation is managed separately.')

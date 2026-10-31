import { readdir, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const assets = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const budget = 220_000
const chunks = await Promise.all((await readdir(assets))
  .filter(name => name.endsWith('.js'))
  .map(async name => ({ name, bytes: (await stat(`${assets}/${name}`)).size })))
if (!chunks.length) throw new Error('No built JavaScript chunks found')
const over = chunks.filter(chunk => chunk.bytes > budget)
if (over.length) {
  throw new Error(`JavaScript chunk budget exceeded (${budget} bytes): ${over.map(chunk => `${chunk.name}: ${chunk.bytes}`).join(', ')}`)
}
console.log(`Bundle budget passed: ${chunks.length} JavaScript chunks, largest ${Math.max(...chunks.map(chunk => chunk.bytes))} / ${budget} bytes`)

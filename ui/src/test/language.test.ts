/**
 * Guard: the interface is English-only.
 *
 * The product language was unified in the "Padroniza o idioma" pass, but
 * that pass touched a fixed list of files — the strings living outside it
 * survived, and nothing prevented them from creeping back. This test
 * scans the whole `ui/src` tree and fails on any user-visible Portuguese.
 *
 * What counts as "user-visible": a quoted string literal in a .ts/.tsx
 * file. Comments are stripped before the scan — internal notes may be
 * written in the author's language without reaching the screen.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Portuguese words that must not appear inside a user-visible string.
 *
 * Only unambiguous Portuguese belongs here. English words that happen to
 * share a spelling with a Portuguese one ("panel", "action", "state",
 * "object", "vocal", "texture") are deliberately absent — matching them
 * would make the test cry wolf and get switched off.
 */
const FORBIDDEN_WORDS = [
  'gerando', 'gerar', 'regerar', 'gerados', 'geradas', 'gerou',
  'nenhuma', 'nenhum', 'nenhumas',
  'cena', 'cenas', 'clipe', 'clipes',
  'trilha', 'fila', 'roteiro', 'passos',
  'cancelar', 'compor', 'revisar', 'revisão', 'revisões',
  'aprovação', 'aprovado', 'aprovada', 'rejeitado',
  'insuficiente', 'falhou', 'tentativa', 'tentativas',
  'carregando', 'processando', 'concluído', 'concluida',
  'descartar', 'salvar', 'fechar', 'voltar', 'avançar',
  'anterior', 'próximo', 'proximo',
  'adicionar', 'remover', 'buscar', 'filtrar',
  'configurações', 'gerais', 'desempenho',
  'padrão', 'padrões',
  'rótulo', 'rótulos', 'painéis',
  'confortável', 'compacta',
  'inconsistência', 'inconsistências',
  'equilibrado', 'rápido', 'fidelidade',
  'cinematográficas', 'fotorrealismo',
  'arranjo', 'multilíngue', 'ambiência', 'iluminação', 'câmera',
]

/**
 * Files whose Portuguese strings are *data*, not interface: prompts sent
 * to the model, or identifiers parsed out of the user's own text. Each
 * entry needs a reason — an unexplained allow-list entry is how a
 * language regression sneaks back in.
 */
const ALLOWED: Record<string, string> = {
  'components/Sidebar/DirectorPanel.tsx':
    'matches the user prompt text to pick a duet speaker profile',
  'components/Sidebar/MusicControls.tsx':
    'builds the English prompt handed to the music model',
  'stores/useStore.ts':
    'builds the English prompt handed to the model for voice references',
}

/**
 * Removes comments from the source, preserving line numbers so a
 * violation can still be reported with its original position.
 */
function stripComments(source: string): string {
  const out: string[] = []
  let inBlock = false
  for (const raw of source.split('\n')) {
    const line = raw
    let result = ''
    let i = 0
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i)
        if (end === -1) { i = line.length; break }
        inBlock = false
        i = end + 2
        continue
      }
      if (line.startsWith('/*', i)) { inBlock = true; i += 2; continue }
      if (line.startsWith('//', i)) break
      // A quote may open a string — copy it and its content verbatim so
      // a "//" inside a string is not mistaken for a comment.
      const ch = line[i]
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch
        result += ch
        i += 1
        while (i < line.length) {
          if (line[i] === '\\') { result += line.slice(i, i + 2); i += 2; continue }
          result += line[i]
          if (line[i] === quote) { i += 1; break }
          i += 1
        }
        continue
      }
      result += ch
      i += 1
    }
    out.push(result)
  }
  return out.join('\n')
}

/**
 * Extracts the contents of string literals (single, double and
 * template) with their line number.
 */
function stringLiterals(source: string): { line: number; text: string }[] {
  const results: { line: number; text: string }[] = []
  const lines = source.split('\n')
  lines.forEach((raw, index) => {
    const literal = /(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`)/g
    let match: RegExpExecArray | null
    while ((match = literal.exec(raw)) !== null) {
      const value = match[1] ?? match[2] ?? match[3] ?? ''
      if (value) results.push({ line: index + 1, text: value })
    }
  })
  return results
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectFiles(full, out)
    } else if (['.ts', '.tsx'].includes(extname(full)) && !full.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

describe('interface language', () => {
  const files = collectFiles(SRC_ROOT)

  it('scans a non-empty file set', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('has no Portuguese in user-visible strings', () => {
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(SRC_ROOT, file)
      const source = stripComments(readFileSync(file, 'utf8'))
      for (const literal of stringLiterals(source)) {
        // Accented characters are an unambiguous marker: no English
        // product string needs them.
        if (/[\u00e1\u00e0\u00e2\u00e3\u00e9\u00ea\u00ed\u00f3\u00f4\u00f5\u00fa\u00e7\u00c1\u00c0\u00c2\u00c3\u00c9\u00ca\u00cd\u00d3\u00d4\u00d5\u00da\u00c7]/.test(literal.text)) {
          violations.push(`${rel}:${literal.line} accented — ${literal.text.slice(0, 70)}`)
          continue
        }
        const words = literal.text.toLowerCase().match(/[\p{L}]+/gu) || []
        const hit = words.find(w => FORBIDDEN_WORDS.includes(w))
        if (hit) {
          if (ALLOWED[rel]) continue
          violations.push(`${rel}:${literal.line} "${hit}" — ${literal.text.slice(0, 70)}`)
        }
      }
    }
    expect(violations, `Portuguese strings found:\n${violations.join('\n')}`).toEqual([])
  })

  it('keeps every allow-list entry explained', () => {
    for (const [file, reason] of Object.entries(ALLOWED)) {
      expect(reason, `allow-list entry for ${file} needs a reason`).toBeTruthy()
      expect(reason.length).toBeGreaterThan(10)
    }
  })
})

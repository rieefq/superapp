import { baseVerb, capitalize, STOPWORDS, words } from '../text'

/** Words describing the artifact rather than what it does. */
const CODE_NOUNS = new Set([
  'function', 'functions', 'method', 'script', 'class', 'snippet', 'code', 'program', 'helper', 'utility', 'util',
  'module', 'typescript', 'javascript', 'python', 'golang', 'go', 'rust', 'java', 'kotlin', 'swift', 'ruby', 'php',
  'csharp', 'sql', 'bash', 'shell', 'simple', 'small', 'quick', 'reusable', 'generic', 'write', 'implement', 'create',
  'build', 'make', 'give', 'show', 'node', 'ts', 'js', 'py', 'react', 'component', 'hook', 'cli', 'tool',
])

const STOP_AT = new Set(['into', 'from', 'with', 'using', 'without', 'in', 'on', 'for', 'by', 'when', 'if', 'and', 'or', 'so', 'as', 'than', 'via'])

const E_VERBS = new Set([
  'make', 'write', 'parse', 'validate', 'rename', 'create', 'merge', 'compute', 'normalize', 'serialize', 'encode',
  'decode', 'compare', 'generate', 'calculate', 'update', 'delete', 'remove', 'resize', 'compress', 'translate',
  'migrate', 'schedule', 'archive', 'configure', 'sanitize', 'tokenize', 'use', 'store', 'save', 'score', 'rate',
  'debounce', 'dedupe', 'combine', 'move', 'close', 'invite', 'receive', 'resolve', 'retrieve',
])

/** "renaming" → "rename", "parsing" → "parse", "running" → "run". */
function fromGerund(word: string): string {
  if (!word.endsWith('ing') || word.length < 6) return word
  const root = word.slice(0, -3)
  if (E_VERBS.has(`${root}e`)) return `${root}e`
  if (/([b-df-hj-np-tv-z])\1$/.test(root)) return root.slice(0, -1)
  return root
}

/**
 * Identifier words for the requested code: "a function that parses invoice lines into
 * objects" → ["parse", "invoice", "lines"]. Falls back to ["process", "input"].
 */
export function identifierWords(request: string): string[] {
  const ws = words(request).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean)
  const clauseStart = ws.findIndex((w) => w === 'that' || w === 'which' || w === 'to' || w === 'for')
  const candidates = clauseStart >= 0 ? ws.slice(clauseStart + 1) : ws
  const out: string[] = []
  for (const raw of candidates) {
    if (out.length && STOP_AT.has(raw)) break
    if (CODE_NOUNS.has(raw) || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue
    const w = out.length === 0 ? fromGerund(baseVerb(raw)) : raw
    out.push(w)
    if (out.length >= 3) break
  }
  return out.length ? out : ['process', 'input']
}

export const camelCase = (parts: readonly string[]): string => parts.map((p, i) => (i === 0 ? p.toLowerCase() : capitalize(p.toLowerCase()))).join('')
export const pascalCase = (parts: readonly string[]): string => parts.map((p) => capitalize(p.toLowerCase())).join('')
export const snakeCase = (parts: readonly string[]): string => parts.map((p) => p.toLowerCase()).join('_')
export const kebabCase = (parts: readonly string[]): string => parts.map((p) => p.toLowerCase()).join('-')

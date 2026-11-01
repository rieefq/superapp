/**
 * Syntax highlighting: sugar-high tokens → React-renderable tokens colored with the
 * theme's `--syn-*` variables (no innerHTML, works in both themes).
 */
import { parse } from 'sugar-high/core'
import { lang as resolveLang, languages } from 'sugar-high/lang'
import type { Range } from './diff'

export interface CodeToken {
  text: string
  /** CSS color (a `var(--syn-*)`), absent for plain whitespace. */
  color?: string
  italic?: boolean
  /** Intra-line emphasis (word diff, search hit). */
  mark?: boolean
}

export type CodeLine = CodeToken[]

const SYN = {
  keyword: 'var(--syn-keyword)',
  string: 'var(--syn-string)',
  number: 'var(--syn-number)',
  comment: 'var(--syn-comment)',
  function: 'var(--syn-function)',
  type: 'var(--syn-type)',
  punct: 'var(--syn-punct)',
  plain: 'var(--syn-plain)',
} as const

const LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  css: 'CSS',
  python: 'Python',
  c: 'C',
  go: 'Go',
  glsl: 'GLSL',
  java: 'Java',
  rust: 'Rust',
  json: 'JSON',
  diff: 'Diff',
  shell: 'Shell',
  cpp: 'C++',
  csharp: 'C#',
  sql: 'SQL',
  html: 'HTML',
  vue: 'Vue',
  svelte: 'Svelte',
  yaml: 'YAML',
  markdown: 'Markdown',
  plaintext: 'Text',
  ruby: 'Ruby',
  kotlin: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  toml: 'TOML',
  powershell: 'PowerShell',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  hcl: 'HCL',
  zig: 'Zig',
  lua: 'Lua',
}

const ALIAS_LABELS: Record<string, string> = { tsx: 'TSX', jsx: 'JSX', bash: 'Bash', zsh: 'Zsh', sh: 'Shell' }

/** Canonical sugar-high language id for a fence name, alias or extension. */
export function normalizeLanguage(name?: string | null): string | undefined {
  if (!name) return undefined
  try {
    return resolveLang(name)
  } catch {
    return undefined
  }
}

/** Human label for a language name ('ts' → 'TypeScript', 'tsx' → 'TSX'). */
export function languageLabel(name?: string | null): string {
  if (!name) return 'Text'
  const lower = name.toLowerCase()
  if (ALIAS_LABELS[lower]) return ALIAS_LABELS[lower]
  const id = normalizeLanguage(name)
  return id ? (LABELS[id] ?? id) : name
}

/** Language from a file path ('src/app.tsx' → 'tsx', 'Dockerfile' → 'dockerfile'). */
export function languageFromPath(path?: string | null): string | undefined {
  if (!path) return undefined
  const base = path.split('/').pop() ?? path
  if (/^dockerfile/i.test(base)) return 'dockerfile'
  const ext = base.includes('.') ? base.split('.').pop() : undefined
  return ext && normalizeLanguage(ext) ? ext.toLowerCase() : undefined
}

const configCache = new Map<string, unknown>()
function configFor(id: string) {
  if (!configCache.has(id)) configCache.set(id, languages.find((l) => l.id === id)?.config)
  return configCache.get(id) as Parameters<typeof parse>[1]
}

function stripCr(lines: string[]): string[] {
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
}

/**
 * Highlight a whole document and return one token list per line (multi-line strings and
 * comments tokenize correctly because the whole text is parsed at once).
 */
export function highlightLines(code: string, language?: string | null): CodeLine[] {
  const id = normalizeLanguage(language)
  if (!id || id === 'plaintext' || code.length > 400_000) {
    return stripCr(code.split('\n')).map((text) => (text ? [{ text, color: SYN.plain }] : []))
  }
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse(code, configFor(id))
  } catch {
    return stripCr(code.split('\n')).map((text) => (text ? [{ text, color: SYN.plain }] : []))
  }
  return parsed.lines.map((line) => {
    const raw = line.tokens
    const out: CodeLine = []
    for (let i = 0; i < raw.length; i++) {
      const tok = raw[i]
      let text = tok.value
      if (!text) continue
      if (text.endsWith('\r')) text = text.slice(0, -1)
      let color: string | undefined
      let italic = false
      switch (tok.type) {
        case 'keyword':
          color = SYN.keyword
          break
        case 'string':
          color = SYN.string
          break
        case 'comment':
          color = SYN.comment
          italic = true
          break
        case 'class':
          color = /^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?n?)$/i.test(text) ? SYN.number : SYN.type
          break
        case 'entity':
          color = SYN.keyword
          break
        case 'property':
          color = SYN.function
          break
        case 'sign':
          color = SYN.punct
          break
        case 'identifier': {
          // A call: identifier followed (after spaces) by "(" — sugar-high leaves these plain.
          let j = i + 1
          while (j < raw.length && raw[j].type === 'space') j++
          const next = raw[j]
          color = /^\d/.test(text) ? SYN.number : next && next.type === 'sign' && next.value.startsWith('(') ? SYN.function : SYN.plain
          break
        }
        case 'jsxliterals':
          color = SYN.plain
          break
        default:
          color = undefined
      }
      const prev = out[out.length - 1]
      if (prev && prev.color === color && prev.italic === italic) prev.text += text
      else out.push(italic ? { text, color, italic } : { text, color })
    }
    return out
  })
}

/** Split tokens at range boundaries and flag the parts inside `ranges` as marked. */
export function overlayRanges(tokens: CodeLine, ranges: readonly Range[] | undefined): CodeLine {
  if (!ranges || ranges.length === 0) return tokens
  const out: CodeLine = []
  let pos = 0
  for (const tok of tokens) {
    const start = pos
    const end = pos + tok.text.length
    let cursor = start
    for (const [rs, re] of ranges) {
      if (re <= cursor || rs >= end) continue
      const a = Math.max(rs, cursor)
      const b = Math.min(re, end)
      if (a > cursor) out.push({ ...tok, text: tok.text.slice(cursor - start, a - start) })
      out.push({ ...tok, text: tok.text.slice(a - start, b - start), mark: true })
      cursor = b
    }
    if (cursor < end) out.push({ ...tok, text: tok.text.slice(cursor - start) })
    pos = end
  }
  return out
}

/** Case-insensitive occurrences of `query` in `text` as [start, end) ranges. */
export function matchRanges(text: string, query: string): Range[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hay = text.toLowerCase()
  const out: Range[] = []
  let i = hay.indexOf(q)
  while (i !== -1) {
    out.push([i, i + q.length])
    i = hay.indexOf(q, i + q.length)
  }
  return out
}

import { escapeRegExp, stem } from '../text'

/** A repository file as seen by the coding simulator (content only when known). */
export interface WorkingFile {
  path: string
  content?: string
  size?: number
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'jsx', json: 'json', jsonc: 'json', md: 'markdown', mdx: 'markdown', css: 'css', scss: 'scss', sass: 'scss',
  less: 'less', html: 'html', htm: 'html', vue: 'vue', svelte: 'svelte', py: 'python', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', kts: 'kotlin', rb: 'ruby', php: 'php', cs: 'csharp', swift: 'swift', scala: 'scala', c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', hpp: 'cpp', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', sh: 'shell', bash: 'shell',
  zsh: 'shell', sql: 'sql', graphql: 'graphql', gql: 'graphql', xml: 'xml', svg: 'xml', lua: 'lua', dart: 'dart',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', r: 'r', tf: 'hcl', prisma: 'prisma', proto: 'protobuf',
}

const SPECIAL_FILES: Record<string, string> = {
  dockerfile: 'dockerfile', makefile: 'makefile', '.gitignore': 'gitignore', '.env': 'dotenv', '.env.example': 'dotenv',
}

/** Language id for syntax highlighting / labels, from a file path. */
export function languageFromPath(path: string): string | undefined {
  const base = path.split('/').pop()?.toLowerCase() ?? ''
  if (SPECIAL_FILES[base]) return SPECIAL_FILES[base]
  const dot = base.lastIndexOf('.')
  if (dot < 0) return undefined
  return LANGUAGES[base.slice(dot + 1)]
}

const CODE_RE = /\.(tsx?|mts|cts|jsx?|mjs|cjs|vue|svelte|py|go|rs|java|kt|rb|php|cs|swift|scala|c|cc|cpp|h|hpp|dart|ex|exs)$/i
const IGNORED_RE =
  /(^|\/)(node_modules|dist|build|out|coverage|vendor|third_party|\.next|\.nuxt|\.git|\.cache|target|__pycache__|\.venv|venv)\/|\.min\.(js|css)$|\.d\.ts$|\.map$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.lock|poetry\.lock|go\.sum)$/i
const TEST_RE = /(^|\/)(__tests__|tests?|spec|e2e)\/|\.(test|spec|e2e)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i

export function isCodePath(path: string): boolean {
  return CODE_RE.test(path)
}

export function isIgnoredPath(path: string): boolean {
  return IGNORED_RE.test(path)
}

export function isTestPath(path: string): boolean {
  return TEST_RE.test(path)
}

export function basename(path: string): string {
  return path.split('/').pop() ?? path
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** File name without its last extension (and without a `.test`/`.spec` marker). */
export function stemName(path: string): string {
  return basename(path).replace(/\.[^.]+$/, '').replace(/\.(test|spec|e2e)$/i, '')
}

/** Keyword stems used for fuzzy matching against paths and contents (prompt order is kept). */
export function keywordStems(keywords: readonly string[]): string[] {
  return [...new Set(keywords.map((k) => stem(k)).filter((s) => s.length >= 3))]
}

/** Language keywords that match nearly every source file, so they are useless for content search. */
const CODE_WORDS = new Set(['export', 'import', 'function', 'const', 'return', 'class', 'default', 'async', 'await', 'type', 'interface', 'static', 'public', 'private'])

/** Stems worth searching for inside file contents. */
export function contentStems(stems: readonly string[]): string[] {
  return stems.filter((s) => !CODE_WORDS.has(s))
}

/** Earlier keywords carry the subject of the prompt ("session expiry …"), so they weigh more. */
function weight(i: number): number {
  return 1 / (1 + 0.35 * i)
}

function pathScore(path: string, stems: readonly string[]): number {
  const lower = path.toLowerCase()
  const base = basename(lower)
  let score = 0
  stems.forEach((s, i) => {
    if (base.includes(s)) score += 4 * weight(i)
    else if (lower.includes(s)) score += 2 * weight(i)
  })
  return score
}

function contentScore(content: string | undefined, stems: readonly string[]): number {
  if (!content || !stems.length) return 0
  let score = 0
  stems.forEach((s, i) => {
    if (CODE_WORDS.has(s)) return
    const matches = content.match(new RegExp(escapeRegExp(s), 'gi'))
    if (matches) score += Math.min(matches.length, 8) * 0.5 * weight(i)
  })
  return score
}

/**
 * Rank files by relevance to the keywords (path and, when known, content matches).
 * Generated, vendored and lock files are excluded; tests only when `tests` is set.
 */
export function rankRelevantFiles(
  files: readonly WorkingFile[],
  keywords: readonly string[],
  opts: { max: number; tests?: 'exclude' | 'only' | 'include' },
): WorkingFile[] {
  const stems = keywordStems(keywords)
  const mode = opts.tests ?? 'exclude'
  const scored = files
    .filter((f) => !isIgnoredPath(f.path) && isCodePath(f.path))
    .filter((f) => (mode === 'only' ? isTestPath(f.path) : mode === 'exclude' ? !isTestPath(f.path) : true))
    .map((f) => {
      const depth = f.path.split('/').length
      const srcBonus = /^(src|lib|app|packages|internal|pkg|cmd)\//.test(f.path) ? 0.6 : 0
      return { f, score: pathScore(f.path, stems) + contentScore(f.content, stems) + srcBonus - depth * 0.05 }
    })
    .sort((a, b) => b.score - a.score || a.f.path.localeCompare(b.f.path))
  return scored.slice(0, opts.max).map((s) => s.f)
}

/** Whether anything matched the keywords at all (for honest "no direct match" wording). */
export function hasKeywordMatch(file: WorkingFile, keywords: readonly string[]): boolean {
  const stems = keywordStems(keywords)
  return pathScore(file.path, stems) > 0 || contentScore(file.content, stems) > 0
}

export interface GrepMatch {
  path: string
  line: number
  text: string
}

/** Case-insensitive line search over file contents (like `rg -n -i`), source files first, a few hits per file. */
export function grepContents(files: readonly WorkingFile[], pattern: RegExp, max = 12, perFile = 3): GrepMatch[] {
  const out: GrepMatch[] = []
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''))
  const ordered = [...files].sort((a, b) => Number(!isCodePath(a.path)) - Number(!isCodePath(b.path)) || a.path.localeCompare(b.path))
  for (const f of ordered) {
    if (!f.content || isIgnoredPath(f.path)) continue
    const lines = f.content.split('\n')
    let hits = 0
    for (let i = 0; i < lines.length && hits < perFile; i++) {
      if (re.test(lines[i])) {
        hits++
        out.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 140) })
        if (out.length >= max) return out
      }
    }
  }
  return out
}

/** A grep-style pattern for the keyword stems: `session|expir`. */
export function grepPattern(keywords: readonly string[]): { source: string; regex: RegExp } {
  const stems = contentStems(keywordStems(keywords)).slice(0, 3)
  const source = stems.length ? stems.join('|') : keywords[0]?.toLowerCase() ?? 'TODO'
  return { source, regex: new RegExp(stems.map(escapeRegExp).join('|') || escapeRegExp(source), 'i') }
}

/** Line-numbered excerpt around `focusLine` (1-based), like a file viewer. */
export function formatExcerpt(content: string, opts: { focusLine?: number; maxLines?: number } = {}): string {
  const lines = content.split('\n')
  const max = opts.maxLines ?? 24
  const focus = opts.focusLine ?? 1
  let start = Math.max(1, focus - Math.floor(max / 3))
  const end = Math.min(lines.length, start + max - 1)
  start = Math.max(1, Math.min(start, end - max + 1))
  const width = String(end).length
  const out: string[] = []
  if (start > 1) out.push(`${' '.repeat(width)}  …`)
  for (let n = start; n <= end; n++) out.push(`${String(n).padStart(width)}  ${lines[n - 1]}`)
  if (end < lines.length) out.push(`${' '.repeat(width)}  … (${lines.length - end} more lines)`)
  return out.join('\n')
}

/** Relative import specifier from one file to another, without the extension (`./session`, `../auth/session`). */
export function relativeImport(fromFile: string, toFile: string): string {
  const from = dirname(fromFile).split('/').filter(Boolean)
  const to = toFile.replace(/\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i, '').split('/').filter(Boolean)
  let i = 0
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++
  const up = from.length - i
  const rest = to.slice(i).join('/')
  return up === 0 ? `./${rest}` : `${'../'.repeat(up)}${rest}`
}

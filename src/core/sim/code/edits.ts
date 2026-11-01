import type { Rng } from '@/lib/rng'
import { capitalize, escapeRegExp, pascalCase, slugify, titleFromText, words } from '../text'
import { basename, languageFromPath, stemName } from './files'
import type { CodeIntent } from './intent'

/**
 * Deterministic, plausible modifications of real file contents. Each strategy works on
 * the actual text (finds a real function, a real comparison, a real literal…) and only
 * falls back to a comment when a language is not supported. Nothing here executes code.
 */

export interface EditContext {
  intent: CodeIntent
  keywords: readonly string[]
  stems: readonly string[]
  prompt: string
  rng: Rng
}

export type HelperId = 'toCsv' | 'withRetry' | 'debounce' | 'formatCurrency' | 'isValidEmail' | 'paginate' | 'memoizeWithTtl' | 'featureFlag'

export type TestTarget =
  | {
      kind: 'guard'
      fn: string
      param: string
      /** 'throw' (sync), 'reject' (async) or an early 'return'. */
      mode: 'throw' | 'reject' | 'return'
      /** Source text of the early-return value ('false', "''", '[]'…). */
      returnValue?: string
      /** Error message fragment after the function name, e.g. "session is required". */
      fragment: string
      /** Number of required parameters (python tests pass None for each). */
      arity: number
    }
  | { kind: 'constant'; name: string; value: string }
  | { kind: 'skew'; name: string; value: number }
  | {
      kind: 'expiry'
      fn: string
      field: string
      /** Exported margin constant the helper subtracts (existing or newly added). */
      lead: string
    }
  | { kind: 'helper'; helper: HelperId; fn: string; flagKey?: string }

export type EditStrategy = 'guard' | 'skew' | 'constant' | 'helper' | 'docs' | 'flaky' | 'lazy' | 'note'

export interface SourceEdit {
  path: string
  before: string
  after: string
  strategy: EditStrategy
  /** One line, imperative: "Guard against a missing `session` in `isExpired`". */
  description: string
  test?: TestTarget
}

// ---------------------------------------------------------------- shared helpers

const TS_RE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i

function splitLines(text: string): string[] {
  return text.split('\n')
}

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ''
}

/** Indentation unit used by the file (two spaces, four spaces or a tab). */
function indentUnit(lines: readonly string[]): string {
  for (const l of lines) {
    if (/^\t+\S/.test(l)) return '\t'
    const m = /^( +)\S/.exec(l)
    if (m) return m[1].length % 4 === 0 && m[1].length >= 4 && !lines.some((x) => /^ {2}\S/.test(x)) ? '    ' : '  '
  }
  return '  '
}

/** Index of the line after the leading import block (0 when there are no imports). */
function afterImports(lines: readonly string[]): number {
  let last = -1
  let inImport = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (inImport) {
      if (/from\s+['"][^'"]+['"];?$/.test(l) || /^['"][^'"]+['"];?$/.test(l)) {
        inImport = false
        last = i
      }
      continue
    }
    if (/^import\s/.test(l) || /^(?:const|let|var)\s+\w+\s*=\s*require\(/.test(l)) {
      if (/from\s+['"][^'"]+['"];?$/.test(l) || /^import\s+['"][^'"]+['"];?$/.test(l) || /require\(/.test(l)) last = i
      else inImport = true
      continue
    }
    if (l === '' || l.startsWith('//') || l.startsWith('/*') || l.startsWith('*') || l.startsWith("'use ") || l.startsWith('"use ')) continue
    break
  }
  return last + 1
}

/** Insert `block` (lines) after the import block, separated by blank lines. */
function insertAfterImports(lines: string[], block: string[]): string[] {
  const at = afterImports(lines)
  const out = [...lines]
  const pre = at > 0 && out[at - 1]?.trim() !== '' ? [''] : []
  const post = out[at]?.trim() !== '' ? [''] : []
  out.splice(at, 0, ...pre, ...block, ...post)
  return out
}

function screaming(text: string): string {
  return slugify(text, 24).toUpperCase().replace(/-/g, '_') || 'DEFAULT'
}

// ---------------------------------------------------------------- TS/JS function parsing

interface Param {
  name: string
  optional: boolean
  type?: string
  destructured: boolean
  rest: boolean
}

interface FnInfo {
  name: string
  exported: boolean
  async: boolean
  params: Param[]
  returnType?: string
  /** 0-based line index of the signature (which ends with `{`). */
  line: number
  indent: string
  bodyIndent: string
  bodyText: string
}

const FN_DECL = /^([ \t]*)(export\s+(?:default\s+)?)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(([^()]*)\)\s*(?::\s*([^{=]+?))?\s*\{\s*$/
const ARROW_FN = /^([ \t]*)(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=\s*(async\s+)?(?:<[^>()]*>\s*)?\(([^()]*)\)\s*(?::\s*([^=]+?))?\s*=>\s*\{\s*$/

function splitParams(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if ('<[{('.includes(ch)) depth++
    else if ('>]})'.includes(ch)) depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map((p) => p.trim()).filter(Boolean)
}

function parseParam(p: string): Param {
  if (/^[{[]/.test(p)) return { name: '', optional: false, destructured: true, rest: false }
  const m = /^(\.\.\.)?\s*(?:(?:public|private|protected|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(\?)?\s*(?::\s*([^=]+?))?\s*(=\s*.+)?$/.exec(p)
  if (!m) return { name: '', optional: true, destructured: false, rest: false }
  return { name: m[2], optional: !!m[3] || !!m[5], type: m[4]?.trim(), destructured: false, rest: !!m[1] }
}

function parseFunctions(lines: readonly string[]): FnInfo[] {
  const fns: FnInfo[] = []
  for (let i = 0; i < lines.length; i++) {
    const d = FN_DECL.exec(lines[i])
    const a = d ? null : ARROW_FN.exec(lines[i])
    if (!d && !a) continue
    const indent = (d ?? a)![1]
    const name = d ? d[4] : a![3]
    const exported = !!(d ? d[2] : a![2])
    const isAsync = !!(d ? d[3] : a![4])
    const params = splitParams(d ? d[5] : a![5]).map(parseParam)
    const returnType = (d ? d[6] : a![6])?.trim() || undefined
    let bodyIndent = `${indent}  `
    let bodyIndentFound = false
    let end = i + 1
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue
      if (!bodyIndentFound && indentOf(lines[j]).length > indent.length) {
        bodyIndent = indentOf(lines[j])
        bodyIndentFound = true
      }
      if (indentOf(lines[j]).length <= indent.length && /^\s*[})]/.test(lines[j])) {
        end = j
        break
      }
      end = j
    }
    fns.push({ name, exported, async: isAsync, params, returnType, line: i, indent, bodyIndent, bodyText: lines.slice(i, end + 1).join('\n') })
  }
  return fns
}

function scoreFn(fn: FnInfo, stems: readonly string[], path: string): number {
  const name = fn.name.toLowerCase()
  const body = fn.bodyText.toLowerCase()
  let score = fn.exported ? 1 : 0
  for (const s of stems) {
    if (name.includes(s)) score += 3
    else if (body.includes(s)) score += 1
  }
  if (/\.(tsx|jsx)$/.test(path) && /^[A-Z]/.test(fn.name)) score -= 1.5 // prefer logic over components
  return score
}

// ---------------------------------------------------------------- strategy: guard

interface GuardShape {
  cond: string
  fragment: string
}

function guardShape(p: Param): GuardShape {
  const t = (p.type ?? '').replace(/\s+/g, ' ')
  if (t === 'string') return { cond: `!${p.name}`, fragment: `${p.name} is required` }
  if (t === 'number') return { cond: `!Number.isFinite(${p.name})`, fragment: `${p.name} must be a finite number` }
  if (/\[\]$|^(Readonly)?Array</.test(t)) return { cond: `!${p.name} || ${p.name}.length === 0`, fragment: `${p.name} must not be empty` }
  return { cond: `${p.name} == null`, fragment: `${p.name} is required` }
}

function guardExit(fn: FnInfo, message: string): { stmt: string; mode: 'throw' | 'reject' | 'return'; returnValue?: string } {
  const rt = fn.returnType?.replace(/\s+/g, ' ')
  const raise = `throw new Error('${message}')`
  if (fn.async || (rt && /^Promise</.test(rt))) return { stmt: raise, mode: 'reject' }
  if (!rt) return { stmt: raise, mode: 'throw' }
  if (rt === 'boolean') return { stmt: 'return false', mode: 'return', returnValue: 'false' }
  if (rt === 'string') return { stmt: "return ''", mode: 'return', returnValue: "''" }
  if (rt === 'number') return { stmt: 'return 0', mode: 'return', returnValue: '0' }
  if (rt === 'void') return { stmt: 'return', mode: 'return', returnValue: 'undefined' }
  if (/(^|\|\s*)null(\s*\||$)/.test(rt)) return { stmt: 'return null', mode: 'return', returnValue: 'null' }
  if (/(^|\|\s*)undefined(\s*\||$)/.test(rt)) return { stmt: 'return undefined', mode: 'return', returnValue: 'undefined' }
  if (/\[\]$|^(Readonly)?Array</.test(rt)) return { stmt: 'return []', mode: 'return', returnValue: '[]' }
  return { stmt: raise, mode: 'throw' }
}

function guardEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  const lines = splitLines(content)
  const candidates = parseFunctions(lines)
    .map((fn) => ({ fn, param: fn.params.find((p) => !p.destructured && !p.rest && !p.optional && p.name && !p.name.startsWith('_')) }))
    .filter((c): c is { fn: FnInfo; param: Param } => !!c.param && c.fn.exported && c.fn.indent === '')
    .filter((c) => !new RegExp(`if \\(!?${escapeRegExp(c.param.name)}\\b`).test(c.fn.bodyText.split('\n').slice(1, 4).join('\n')))
  if (!candidates.length) return null
  const best = candidates.sort((a, b) => scoreFn(b.fn, ctx.stems, path) - scoreFn(a.fn, ctx.stems, path) || a.fn.line - b.fn.line)[0]
  const { fn, param } = best
  const shape = guardShape(param)
  const message = `${fn.name}: ${shape.fragment}`
  const exit = guardExit(fn, message)
  const unit = fn.bodyIndent.length > fn.indent.length ? fn.bodyIndent.slice(fn.indent.length) : indentUnit(lines)
  const bi = fn.indent + unit
  const comment =
    ctx.intent === 'fix'
      ? `// Guard against a missing \`${param.name}\` before it is used below.`
      : exit.mode === 'return'
        ? `// Return early when \`${param.name}\` is missing instead of failing further down.`
        : `// Validate \`${param.name}\` up front so callers get a clear error.`
  const block = [`${bi}${comment}`, `${bi}if (${shape.cond}) {`, `${bi}${unit}${exit.stmt}`, `${bi}}`]
  const next = lines[fn.line + 1]
  if (next !== undefined && next.trim() !== '' && !/^\s*}/.test(next)) block.push('')
  const out = [...lines]
  out.splice(fn.line + 1, 0, ...block)
  const requiredCount = fn.params.filter((p) => !p.optional && !p.rest).length
  return {
    path,
    before: content,
    after: out.join('\n'),
    strategy: 'guard',
    description: `Guard against a missing \`${param.name}\` in \`${fn.name}\``,
    test: { kind: 'guard', fn: fn.name, param: param.name, mode: exit.mode, returnValue: exit.returnValue, fragment: shape.fragment, arity: requiredCount },
  }
}

// ---------------------------------------------------------------- strategy: expiry skew

const TIME_STEMS = /expir|session|token|refresh|timeout|ttl|clock|skew|stale|login|auth|sso/

function skewEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  if (!ctx.stems.some((s) => TIME_STEMS.test(s)) || content.includes('EXPIRY_SKEW_MS')) return null
  const lines = splitLines(content)
  const aliases = ['Date.now()']
  for (const l of lines) {
    const m = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*Date\.now\(\)/.exec(l)
    if (m) aliases.push(m[1])
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*(\/\/|\*|import\b)/.test(line)) continue
    for (const alias of aliases) {
      const a = alias === 'Date.now()' ? 'Date\\.now\\(\\)' : `(?<![\\w$.])${escapeRegExp(alias)}(?![\\w$(])`
      // `expiresAt < now` → `expiresAt - EXPIRY_SKEW_MS < now`
      const right = new RegExp(`([^\\s=<>!-])(\\s*)(<=?|>=?)(\\s*)(${a})`)
      // `now > expiresAt` → `now + EXPIRY_SKEW_MS > expiresAt`
      const left = new RegExp(`(${a})(\\s*)(<=?|>=?)(?![=>])`)
      let next: string | null = null
      if (right.test(line)) next = line.replace(right, '$1 - EXPIRY_SKEW_MS$2$3$4$5')
      else if (left.test(line)) next = line.replace(left, '$1 + EXPIRY_SKEW_MS$2$3')
      if (!next || next === line) continue
      const out = [...lines]
      out[i] = next
      const withConst = insertAfterImports(out, [
        '/** Treat sessions as expiring slightly early so they refresh before the identity provider rejects them. */',
        'export const EXPIRY_SKEW_MS = 30_000',
      ])
      return {
        path,
        before: content,
        after: withConst.join('\n'),
        strategy: 'skew',
        description: `Refresh 30 s before expiry (clock-skew margin) in \`${basename(path)}\``,
        test: { kind: 'skew', name: 'EXPIRY_SKEW_MS', value: 30_000 },
      }
    }
  }
  return null
}

/**
 * Expiry helper: when a type has an `expiresAt`-like timestamp but nothing checks it with a
 * margin, add `is<Type>Expiring(value, now)` that reuses the file's own lead/skew constant.
 */
function expiryHelperEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  if (!ctx.stems.some((s) => TIME_STEMS.test(s))) return null
  const typeRe = /export\s+(?:interface\s+([A-Z][\w$]*)[^{]*\{|type\s+([A-Z][\w$]*)\s*=\s*\{)([\s\S]*?)\n\}/g
  let found: { type: string; field: string } | null = null
  for (let m = typeRe.exec(content); m && !found; m = typeRe.exec(content)) {
    const field = /^\s*(expiresAt|expiry|expires|expiresOn|expirationTime|exp)\s*:\s*number\b/m.exec(m[3])
    if (field) found = { type: m[1] ?? m[2], field: field[1] }
  }
  if (!found) return null
  const fn = `is${found.type}Expiring`
  if (content.includes(fn)) return null
  const param = found.type[0].toLowerCase() + found.type.slice(1)
  const existingLead = /export\s+const\s+((?:[A-Z][A-Z0-9_]*_)?(?:LEAD|SKEW|MARGIN|BUFFER)(?:_[A-Z0-9_]*)?)\s*=/.exec(content)?.[1]
  const lead = existingLead ?? 'EXPIRY_SKEW_MS'
  let lines = splitLines(content.replace(/\s+$/, ''))
  if (!existingLead) {
    lines = insertAfterImports(lines, ['/** Treat tokens as expiring slightly early so they refresh before the server rejects them. */', 'export const EXPIRY_SKEW_MS = 30_000'])
  }
  lines.push(
    '',
    `/** Whether the ${param} expires within \`${lead}\` (or already has), so callers can refresh first. */`,
    `export function ${fn}(${param}: ${found.type}, now = Date.now()): boolean {`,
    `  return ${param}.${found.field} - ${lead} <= now`,
    '}',
    '',
  )
  return {
    path,
    before: content,
    after: lines.join('\n'),
    strategy: 'skew',
    description: `Add \`${fn}\` so callers can refresh before the token lapses`,
    test: { kind: 'expiry', fn, field: found.field, lead },
  }
}

// ---------------------------------------------------------------- strategy: extract constant

/** Name a literal from its context: `<Chart height={240}` → CHART_HEIGHT, `pageSize: 25` → PAGE_SIZE. */
function constantName(before: string, timeish: boolean, fallback: string): string {
  const jsx = /<([A-Z][\w$]*)[^<>]*?\b([A-Za-z_$][\w$]*)=\{\s*$/.exec(before)
  if (jsx) return `${screaming(jsx[1].replace(/([a-z0-9])([A-Z])/g, '$1 $2'))}_${screaming(jsx[2].replace(/([a-z0-9])([A-Z])/g, '$1 $2'))}`
  const prop = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/.exec(before)
  if (prop && !/^(const|let|var|return)$/.test(prop[1])) {
    const base = screaming(prop[1].replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
    return timeish && !/_MS$/.test(base) ? `${base}_MS` : base
  }
  const call = /([A-Za-z_$][\w$]*)\([^()]*$/.exec(before)?.[1]
  const subject = screaming(fallback.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
  if (call && /^set(Timeout|Interval)$/.test(call)) return `${subject}_DELAY_MS`
  return timeish ? `${subject}_TIMEOUT_MS` : `MAX_${subject}`
}

function constantEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  const lines = splitLines(content)
  const NUM = /(?<![\w$.'"`])(\d{1,3}(?:_\d{3})+|\d{3,})(?![\w$.'"`])/
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (indentOf(line) === '' || /^\s*(\/\/|\*|\/\*|import\b)/.test(line)) continue
    const m = NUM.exec(line)
    if (!m || m.index === undefined) continue
    const before = line.slice(0, m.index)
    if ((before.match(/['"`]/g)?.length ?? 0) % 2 === 1) continue
    const value = m[1]
    const numeric = Number(value.replace(/_/g, ''))
    if (!Number.isFinite(numeric) || numeric < 100 || /^(19|20)\d\d$/.test(value)) continue
    if (numeric < 600 && /status|code|http|\bres\b|response|port/i.test(line)) continue
    const timeish = /timeout|delay|ttl|interval|expir|setTimeout|setInterval|retry|backoff|\bms\b|Ms\b|seconds|minutes/i.test(line) || numeric % 1000 === 0
    const name = constantName(before, timeish, ctx.keywords[0] ?? stemName(path))
    if (content.includes(name)) continue
    const out = [...lines]
    out[i] = line.slice(0, m.index) + name + line.slice(m.index + value.length)
    const withConst = insertAfterImports(out, [`/** Previously an inline literal; named so it is easy to find and tune. */`, `export const ${name} = ${value}`])
    return {
      path,
      before: content,
      after: withConst.join('\n'),
      strategy: 'constant',
      description: `Extract the magic number ${value} into \`${name}\``,
      test: { kind: 'constant', name, value },
    }
  }
  return null
}

// ---------------------------------------------------------------- strategy: helper

function chooseHelper(prompt: string): HelperId {
  const p = prompt.toLowerCase()
  if (/\bcsv\b|export (to|as) (a )?(file|spreadsheet)|\bexport\b/.test(p)) return 'toCsv'
  if (/retr(y|ies)|backoff|transient|resilien/.test(p)) return 'withRetry'
  if (/debounce|throttle|as you type|search input/.test(p)) return 'debounce'
  if (/currenc|money|price|amount|invoice|billing|total/.test(p)) return 'formatCurrency'
  if (/e-?mail|validat/.test(p)) return 'isValidEmail'
  if (/paginat|\bpages?\b|infinite scroll/.test(p)) return 'paginate'
  if (/cache|memo/.test(p)) return 'memoizeWithTtl'
  return 'featureFlag'
}

function helperSource(helper: HelperId, fn: string, flagKey: string, label: string): string[] {
  switch (helper) {
    case 'toCsv':
      return [
        '/** Serialize rows as CSV (RFC 4180 quoting) for downloads and exports. */',
        `export function ${fn}(rows: ReadonlyArray<Record<string, unknown>>, columns: readonly string[]): string {`,
        '  const escape = (value: unknown): string => {',
        "    const text = value == null ? '' : String(value)",
        '    return /[",\\n\\r]/.test(text) ? `"${text.replace(/"/g, \'""\')}"` : text',
        '  }',
        "  const header = columns.map(escape).join(',')",
        "  return [header, ...rows.map((row) => columns.map((c) => escape(row[c])).join(','))].join('\\n')",
        '}',
      ]
    case 'withRetry':
      return [
        '/** Retry an async operation with exponential backoff (for transient failures). */',
        `export async function ${fn}<T>(operation: () => Promise<T>, options: { retries?: number; baseDelayMs?: number } = {}): Promise<T> {`,
        '  const { retries = 3, baseDelayMs = 200 } = options',
        '  for (let attempt = 0; ; attempt++) {',
        '    try {',
        '      return await operation()',
        '    } catch (error) {',
        '      if (attempt >= retries) throw error',
        '      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))',
        '    }',
        '  }',
        '}',
      ]
    case 'debounce':
      return [
        '/** Delay calls until `waitMs` has passed without another call. */',
        `export function ${fn}<A extends unknown[]>(callback: (...args: A) => void, waitMs: number): (...args: A) => void {`,
        '  let timer: ReturnType<typeof setTimeout> | undefined',
        '  return (...args: A) => {',
        '    if (timer) clearTimeout(timer)',
        '    timer = setTimeout(() => callback(...args), waitMs)',
        '  }',
        '}',
      ]
    case 'formatCurrency':
      return [
        '/** Format an amount in minor units (cents) for display. */',
        `export function ${fn}(amountMinor: number, currency = 'USD', locale = 'en-US'): string {`,
        "  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 100)",
        '}',
      ]
    case 'isValidEmail':
      return [
        '/** Lightweight email shape check for form validation (not a deliverability check). */',
        `export function ${fn}(value: string): boolean {`,
        '  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value.trim())',
        '}',
      ]
    case 'paginate':
      return [
        '/** Slice a list into a 1-based page. */',
        `export function ${fn}<T>(items: readonly T[], page: number, pageSize: number): { items: T[]; page: number; pageCount: number } {`,
        '  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))',
        '  const current = Math.min(Math.max(1, page), pageCount)',
        '  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount }',
        '}',
      ]
    case 'memoizeWithTtl':
      return [
        '/** Cache results of a single-argument function for `ttlMs` milliseconds. */',
        `export function ${fn}<K, V>(compute: (key: K) => V, ttlMs: number): (key: K) => V {`,
        '  const cache = new Map<K, { value: V; expires: number }>()',
        '  return (key: K) => {',
        '    const hit = cache.get(key)',
        '    if (hit && hit.expires > Date.now()) return hit.value',
        '    const value = compute(key)',
        '    cache.set(key, { value, expires: Date.now() + ttlMs })',
        '    return value',
        '  }',
        '}',
      ]
    case 'featureFlag':
      return [
        `/** Whether ${label} is enabled for the current account. */`,
        `export function ${fn}(flags: Readonly<Record<string, boolean>>): boolean {`,
        `  return flags['${flagKey}'] === true`,
        '}',
      ]
  }
}

function helperEdit(path: string, content: string, ctx: EditContext, forced?: HelperId): SourceEdit | null {
  const helper = forced ?? chooseHelper(ctx.prompt)
  const topic = ctx.keywords.slice(0, 2).join(' ') || stemName(path)
  const fn = helper === 'featureFlag' ? `is${pascalCase(topic)}Enabled` : helper
  if (new RegExp(`\\b${escapeRegExp(fn)}\\b`).test(content)) return null
  const flagKey = slugify(topic, 32)
  const label = topic.toLowerCase()
  const body = helperSource(helper, fn, flagKey, label)
  const trimmed = content.replace(/\s+$/, '')
  const after = `${trimmed}\n\n${body.join('\n')}\n`
  const what: Record<HelperId, string> = {
    toCsv: 'a CSV export helper',
    withRetry: 'retry with exponential backoff',
    debounce: 'a debounce helper',
    formatCurrency: 'currency formatting for minor units',
    isValidEmail: 'email validation',
    paginate: 'pagination',
    memoizeWithTtl: 'a TTL cache',
    featureFlag: `a feature gate for ${label}`,
  }
  return {
    path,
    before: content,
    after,
    strategy: 'helper',
    description: `Add ${what[helper]} (\`${fn}\`) to \`${basename(path)}\``,
    test: { kind: 'helper', helper, fn, flagKey },
  }
}

// ---------------------------------------------------------------- strategy: docs

function describeFn(fn: FnInfo): string {
  const parts = words(fn.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')).map((w) => w.toLowerCase())
  const [verb, ...rest] = parts
  const obj = rest.join(' ')
  if (['is', 'has', 'can', 'should'].includes(verb) && rest.length >= 2) {
    return verb === 'is' ? `Returns whether the ${rest.slice(0, -1).join(' ')} is ${rest[rest.length - 1]}.` : `Returns whether it ${verb} ${obj}.`
  }
  const verbs: Record<string, string> = {
    get: 'Returns', create: 'Creates', make: 'Creates', build: 'Builds', format: 'Formats', parse: 'Parses', validate: 'Validates',
    fetch: 'Loads', load: 'Loads', save: 'Saves', update: 'Updates', set: 'Sets', handle: 'Handles', compute: 'Computes',
    calculate: 'Calculates', to: 'Converts to', render: 'Renders', use: 'Hook that provides', refresh: 'Refreshes', sync: 'Syncs',
  }
  if (verbs[verb]) return `${verbs[verb]} ${obj || 'the value'}.`
  return `${capitalize(parts.join(' '))}.`
}

function docsEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  const lines = splitLines(content)
  const fns = parseFunctions(lines)
    .filter((f) => f.exported && f.indent === '')
    .filter((f) => !/^\s*\*\/\s*$/.test(lines[f.line - 1] ?? '') && !/^\s*\/\//.test(lines[f.line - 1] ?? ''))
  if (!fns.length) return null
  const fn = fns.sort((a, b) => scoreFn(b, ctx.stems, path) - scoreFn(a, ctx.stems, path))[0]
  const doc = ['/**', ` * ${describeFn(fn)}`]
  const params = fn.params.filter((p) => p.name && !p.destructured)
  if (params.length) {
    doc.push(' *')
    for (const p of params) doc.push(` * @param ${p.name} - ${p.optional ? 'Optional ' : 'The '}${words(p.name.replace(/([a-z])([A-Z])/g, '$1 $2')).join(' ').toLowerCase()}.`)
  }
  if (fn.async) doc.push(' * @throws When the underlying request fails.')
  doc.push(' */')
  const out = [...lines]
  out.splice(fn.line, 0, ...doc)
  return { path, before: content, after: out.join('\n'), strategy: 'docs', description: `Document \`${fn.name}\` with JSDoc` }
}

function markdownEdit(path: string, content: string, ctx: EditContext): SourceEdit {
  const title = titleFromText(ctx.prompt, 60)
  const section = [
    '',
    `## ${title}`,
    '',
    `${capitalize(ctx.keywords.join(', ') || 'This change')}: see the related source changes for details.`,
    '',
    '- What changed and why',
    '- How to verify it locally',
    '- Follow-ups that are out of scope for this change',
    '',
  ]
  return { path, before: content, after: `${content.replace(/\s+$/, '')}\n${section.join('\n')}`, strategy: 'docs', description: `Document “${title}” in \`${basename(path)}\`` }
}

// ---------------------------------------------------------------- strategy: flaky tests

function flakyEdit(path: string, content: string): SourceEdit | null {
  const lines = splitLines(content)
  if (/@playwright\/test/.test(content)) {
    const out = lines.map((l) => l.replace(/await\s+page\.waitForTimeout\(\s*\d+\s*\)/, "await page.waitForLoadState('networkidle')"))
    if (out.join('\n') !== content) {
      return { path, before: content, after: out.join('\n'), strategy: 'flaky', description: 'Replace fixed sleeps with a load-state wait' }
    }
    const withRetries = insertAfterImports([...lines], ['// Network-dependent flows: allow one retry while the root cause is tracked.', 'test.describe.configure({ retries: 1 })'])
    return { path, before: content, after: withRetries.join('\n'), strategy: 'flaky', description: 'Configure a retry for network-dependent tests' }
  }
  const usesVitest = /from ['"]vitest['"]/.test(content)
  const mock = usesVitest ? 'vi' : 'jest'
  if (content.includes(`${mock}.useFakeTimers()`)) return null
  const describeLine = lines.findIndex((l) => /^\s*describe\(/.test(l))
  const unit = indentUnit(lines)
  const hooks = [
    `${unit}beforeEach(() => {`,
    `${unit}${unit}${mock}.useFakeTimers()`,
    `${unit}})`,
    '',
    `${unit}afterEach(() => {`,
    `${unit}${unit}${mock}.useRealTimers()`,
    `${unit}})`,
    '',
  ]
  const out = [...lines]
  if (describeLine >= 0) out.splice(describeLine + 1, 0, ...hooks)
  else out.splice(afterImports(out), 0, ...hooks.map((h) => h.slice(unit.length)))
  if (usesVitest) {
    const idx = out.findIndex((l) => /import\s*\{[^}]*\}\s*from\s*['"]vitest['"]/.test(l))
    if (idx >= 0) out[idx] = ensureNamedImports(out[idx], ['afterEach', 'beforeEach', 'vi'])
  }
  return { path, before: content, after: out.join('\n'), strategy: 'flaky', description: 'Use fake timers so the test no longer depends on wall-clock timing' }
}

/** Add names to a single-line `import { a, b } from '…'` statement (sorted, deduplicated). */
export function ensureNamedImports(line: string, names: readonly string[]): string {
  return line.replace(/\{([^}]*)\}/, (_, inner: string) => {
    const existing = inner.split(',').map((s) => s.trim()).filter(Boolean)
    const all = [...new Set([...existing, ...names])].sort((a, b) => a.localeCompare(b))
    return `{ ${all.join(', ')} }`
  })
}

// ---------------------------------------------------------------- strategy: lazy loading

export function lazyEdit(path: string, content: string): SourceEdit | null {
  if (!/\.(tsx|jsx)$/.test(path)) return null
  const lines = splitLines(content)
  for (let i = 0; i < lines.length; i++) {
    const def = /^import\s+([A-Z][\w$]*)\s+from\s+['"](\.{1,2}\/[^'"]+)['"];?\s*$/.exec(lines[i])
    const named = def ? null : /^import\s+\{\s*([A-Z][\w$]*)\s*\}\s+from\s+['"](\.{1,2}\/[^'"]+)['"];?\s*$/.exec(lines[i])
    const m = def ?? named
    if (!m || !new RegExp(`<${m[1]}[\\s/>]`).test(content)) continue
    const loader = named ? `import('${m[2]}').then((m) => ({ default: m.${m[1]} }))` : `import('${m[2]}')`
    const out = [...lines]
    out.splice(i, 1)
    const reactIdx = out.findIndex((l) => /^import\s.*from\s+['"]react['"]/.test(l))
    let lazyRef = 'lazy'
    if (reactIdx < 0) out.unshift("import { lazy } from 'react'")
    else if (/\{[^}]*\}/.test(out[reactIdx])) out[reactIdx] = ensureNamedImports(out[reactIdx], ['lazy'])
    else if (/^import\s+\*\s+as\s+(\w+)/.test(out[reactIdx])) lazyRef = `${/^import\s+\*\s+as\s+(\w+)/.exec(out[reactIdx])![1]}.lazy`
    else out[reactIdx] = out[reactIdx].replace(/^import\s+(\w+)\s+from/, 'import $1, { lazy } from')
    const withLazy = insertAfterImports(out, [`// Split ${m[1]} into its own chunk; it is not needed for the first paint.`, `const ${m[1]} = ${lazyRef}(() => ${loader})`])
    return { path, before: content, after: withLazy.join('\n'), strategy: 'lazy', description: `Load \`${m[1]}\` lazily so it is split out of the main bundle` }
  }
  return null
}

// ---------------------------------------------------------------- python

function pythonGuardEdit(path: string, content: string, ctx: EditContext): SourceEdit | null {
  const lines = splitLines(content)
  const defs: Array<{ line: number; name: string; params: string[] }> = []
  lines.forEach((l, i) => {
    const m = /^def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:->\s*[^:]+)?:\s*$/.exec(l)
    if (!m || m[1].startsWith('_')) return
    const params = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('*') && !p.includes('=') && !/^(self|cls)\b/.test(p))
      .map((p) => p.split(':')[0].trim())
    if (params.length) defs.push({ line: i, name: m[1], params })
  })
  if (!defs.length) return null
  const score = (d: (typeof defs)[number]) => ctx.stems.reduce((s, st) => s + (d.name.toLowerCase().includes(st) ? 3 : 0), 0)
  const def = defs.sort((a, b) => score(b) - score(a) || a.line - b.line)[0]
  const param = def.params[0]
  let at = def.line + 1
  const bodyIndent = indentOf(lines[at] ?? '    ') || '    '
  if (/^\s*("""|''')/.test(lines[at] ?? '')) {
    const quote = (lines[at].trim().slice(0, 3))
    const closesSameLine = lines[at].trim().length > 3 && lines[at].trim().endsWith(quote)
    if (closesSameLine) at += 1
    else {
      let j = at + 1
      while (j < lines.length && !lines[j].includes(quote)) j++
      at = j + 1
    }
  }
  if (lines.slice(at, at + 3).some((l) => l.includes(`if ${param} is None`))) return null
  const out = [...lines]
  out.splice(at, 0, `${bodyIndent}if ${param} is None:`, `${bodyIndent}    raise ValueError("${param} is required")`)
  return {
    path,
    before: content,
    after: out.join('\n'),
    strategy: 'guard',
    description: `Guard against a missing \`${param}\` in \`${def.name}\``,
    test: { kind: 'guard', fn: def.name, param, mode: 'throw', fragment: `${param} is required`, arity: def.params.length },
  }
}

// ---------------------------------------------------------------- fallback note

function commentPrefix(path: string): [string, string] {
  const lang = languageFromPath(path)
  if (['python', 'ruby', 'shell', 'yaml', 'toml', 'dockerfile', 'makefile', 'r', 'elixir', 'dotenv', 'gitignore'].includes(lang ?? '')) return ['# ', '']
  if (['html', 'xml', 'markdown', 'vue', 'svelte'].includes(lang ?? '')) return ['<!-- ', ' -->']
  if (['css', 'scss', 'less'].includes(lang ?? '')) return ['/* ', ' */']
  if (['sql', 'lua', 'haskell'].includes(lang ?? '')) return ['-- ', '']
  return ['// ', '']
}

function noteEdit(path: string, content: string, ctx: EditContext): SourceEdit {
  const lines = splitLines(content)
  const [open, close] = commentPrefix(path)
  const re = ctx.stems.length ? new RegExp(ctx.stems.map(escapeRegExp).join('|'), 'i') : null
  let at = re ? lines.findIndex((l) => re.test(l)) : -1
  if (at < 0) at = Math.min(afterImports(lines), lines.length)
  const indent = indentOf(lines[at] ?? '')
  const out = [...lines]
  out.splice(at, 0, `${indent}${open}TODO(${slugify(ctx.keywords[0] ?? 'change', 24)}): ${titleFromText(ctx.prompt, 70)}${close}`)
  return {
    path,
    before: content,
    after: out.join('\n'),
    strategy: 'note',
    description: `Mark the relevant code in \`${basename(path)}\` for follow-up (no code-aware edit for this language)`,
  }
}

// ---------------------------------------------------------------- dispatcher

/**
 * Propose a change to `file` for the prompt's intent. Always returns an edit: when no
 * code-aware strategy applies, a short annotation is added near the relevant code.
 */
export function proposeSourceEdit(file: { path: string; content: string }, ctx: EditContext): SourceEdit {
  const { path, content } = file
  const lang = languageFromPath(path)
  if (lang === 'markdown') return markdownEdit(path, content, ctx)
  if (TS_RE.test(path)) {
    const order: Array<(p: string, c: string, x: EditContext) => SourceEdit | null> =
      ctx.intent === 'test'
        ? [(p, c) => flakyEdit(p, c), guardEdit]
        : ctx.intent === 'docs'
          ? [docsEdit, guardEdit]
          : ctx.intent === 'perf'
            ? [(p, c) => lazyEdit(p, c), constantEdit, (p, c, x) => helperEdit(p, c, x, 'memoizeWithTtl'), guardEdit]
            : ctx.intent === 'refactor'
              ? [constantEdit, guardEdit, docsEdit]
              : ctx.intent === 'feature' || ctx.intent === 'deps'
                ? [helperEdit, guardEdit]
                : [skewEdit, expiryHelperEdit, guardEdit, constantEdit, helperEdit]
    for (const strategy of order) {
      const edit = strategy(path, content, ctx)
      if (edit && edit.after !== content) return edit
    }
    return noteEdit(path, content, ctx)
  }
  if (lang === 'python') return pythonGuardEdit(path, content, ctx) ?? noteEdit(path, content, ctx)
  return noteEdit(path, content, ctx)
}

/** Add a dependency to package.json text (sorted, indentation preserved). Null when already present or unparsable. */
export function addDependency(packageJson: string, name: string, version: string): string | null {
  let pkg: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(packageJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    pkg = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const deps = (pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}) as Record<string, string>
  const dev = (pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}) as Record<string, string>
  if (name in deps || name in dev) return null
  const sorted = Object.fromEntries(Object.entries({ ...deps, [name]: version }).sort(([a], [b]) => a.localeCompare(b)))
  const next: Record<string, unknown> = {}
  let placed = false
  for (const [k, v] of Object.entries(pkg)) {
    if (k === 'dependencies') {
      next[k] = sorted
      placed = true
    } else if (k === 'devDependencies' && !placed) {
      next.dependencies = sorted
      placed = true
      next[k] = v
    } else next[k] = v
  }
  if (!placed) next.dependencies = sorted
  const indent = /^\{\n(\s+)"/.exec(packageJson)?.[1] ?? '  '
  return `${JSON.stringify(next, null, indent)}${packageJson.endsWith('\n') ? '\n' : ''}`
}

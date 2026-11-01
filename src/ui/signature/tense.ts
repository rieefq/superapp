import type { StepStatus } from '@/core/types'

/**
 * Step-title tense (docs/DESIGN.md §8.3): running steps read in the present participle
 * ("Reading 4 sources"), done steps in the past tense ("Read 4 sources"); pending, waiting,
 * failed and skipped steps read as the plain verb ("Read 4 sources", "Run checks").
 *
 * Only verbs in this map are changed, so noun-led titles ("Email from …", "Pull request ready")
 * are never mangled. Ambiguous noun/verb words (report, log, note, list, map, email, pull) are
 * deliberately absent.
 */
type Forms = readonly [base: string, past: string, participle: string]

const IRREGULAR: Forms[] = [
  ['begin', 'began', 'beginning'], ['build', 'built', 'building'], ['choose', 'chose', 'choosing'],
  ['cut', 'cut', 'cutting'], ['draw', 'drew', 'drawing'], ['find', 'found', 'finding'], ['get', 'got', 'getting'],
  ['give', 'gave', 'giving'], ['hold', 'held', 'holding'], ['keep', 'kept', 'keeping'], ['make', 'made', 'making'],
  ['proofread', 'proofread', 'proofreading'], ['put', 'put', 'putting'], ['read', 'read', 'reading'],
  ['re-read', 're-read', 're-reading'], ['re-run', 're-ran', 're-running'], ['rerun', 'reran', 'rerunning'],
  ['rewrite', 'rewrote', 'rewriting'], ['run', 'ran', 'running'], ['send', 'sent', 'sending'], ['set', 'set', 'setting'],
  ['split', 'split', 'splitting'], ['take', 'took', 'taking'], ['think', 'thought', 'thinking'],
  ['write', 'wrote', 'writing'], ['spin', 'spun', 'spinning'], ['undo', 'undid', 'undoing'],
]

/** Regular verbs whose final consonant doubles (plan → planned, planning). */
const DOUBLING = ['plan', 'stop', 'skip', 'tag', 'scan', 'drop', 'ship', 'flag', 'crop', 'trim', 'commit', 'format', 'prep']

/** Regular verbs (base form). Past and participle are derived with the usual spelling rules. */
const REGULAR = [
  'add', 'analyze', 'animate', 'annotate', 'apply', 'archive', 'ask', 'assemble', 'assess', 'assign', 'attach', 'audit',
  'browse', 'calculate', 'call', 'cancel', 'check', 'cite', 'classify', 'clean', 'close', 'cluster', 'collate', 'collect',
  'combine', 'compare', 'compile', 'complete', 'compose', 'compute', 'condense', 'confirm', 'consider', 'continue',
  'convert', 'create', 'cross-check', 'cross-reference', 'decide', 'dedupe', 'define', 'deploy', 'describe', 'detect',
  'download', 'draft', 'edit', 'enrich', 'escalate', 'estimate', 'evaluate', 'explain', 'explore', 'extract', 'fetch',
  'finish', 'fix', 'focus', 'gather', 'generate', 'highlight', 'identify', 'illustrate', 'implement', 'inspect', 'install',
  'investigate', 'lint', 'load', 'look', 'mark', 'measure', 'merge', 'mix', 'move', 'narrate', 'normalize', 'notify',
  'open', 'outline', 'parse', 'pause', 'pick', 'polish', 'post', 'prepare', 'propose', 'publish', 'push', 'query', 'rank',
  'recommend', 'reconcile', 'refine', 'render', 'replay', 'research', 'resolve', 'restore', 'resume', 'retrieve', 'retry',
  'review', 'route', 'save', 'schedule', 'search', 'select', 'share', 'shorten', 'sort', 'start', 'storyboard',
  'summarize', 'sync', 'synthesize', 'tally', 'test', 'tighten', 'transform', 'translate', 'triage', 'triangulate',
  'typecheck', 'update', 'upload', 'upscale', 'use', 'validate', 'verify', 'visualize', 'wait', 'watch', 'weigh',
]

const VOWEL = /[aeiou]/

function regularForms(base: string): Forms {
  if (DOUBLING.includes(base)) {
    const last = base[base.length - 1]
    return [base, `${base}${last}ed`, `${base}${last}ing`]
  }
  if (base.endsWith('ie')) return [base, `${base}d`, `${base.slice(0, -2)}ying`]
  if (base.endsWith('e') && !base.endsWith('ee')) return [base, `${base}d`, `${base.slice(0, -1)}ing`]
  if (base.endsWith('y') && !VOWEL.test(base[base.length - 2] ?? '')) return [base, `${base.slice(0, -1)}ied`, `${base}ing`]
  if (base === 'cancel') return [base, 'cancelled', 'cancelling']
  if (base === 'label') return [base, 'labeled', 'labeling']
  return [base, `${base}ed`, `${base}ing`]
}

type Form = 0 | 1 | 2
const BASE: Form = 0
const PAST: Form = 1
const PARTICIPLE: Form = 2

const INDEX = new Map<string, { forms: Forms; as: Form[] }>()

function register(forms: Forms) {
  forms.forEach((word, form) => {
    const hit = INDEX.get(word)
    if (hit && hit.forms === forms) {
      if (!hit.as.includes(form as Form)) hit.as.push(form as Form)
      return
    }
    if (!hit) INDEX.set(word, { forms, as: [form as Form] })
  })
}

IRREGULAR.forEach(register)
for (const base of new Set([...REGULAR, ...DOUBLING])) {
  if (!IRREGULAR.some((f) => f[0] === base)) register(regularForms(base))
}

const WORD = /^([A-Za-z][A-Za-z-]*)(.*)$/s

function matchCase(source: string, word: string): string {
  if (source === source.toUpperCase() && source.length > 1) return word.toUpperCase()
  if (source[0] === source[0].toUpperCase()) return word[0].toUpperCase() + word.slice(1)
  return word
}

function convertWord(word: string, to: Form): { text: string; from: Form[] } | null {
  const hit = INDEX.get(word.toLowerCase())
  if (!hit) return null
  return { text: matchCase(word, hit.forms[to]), from: hit.as }
}

/**
 * Convert the leading verb (and verbs coordinated with "and"/", then" in the same form)
 * to the requested form. Titles that do not start with a known verb come back unchanged.
 */
function convert(title: string, to: Form): string {
  const m = WORD.exec(title.trimStart())
  if (!m) return title
  const lead = title.slice(0, title.length - title.trimStart().length)
  const first = convertWord(m[1], to)
  if (!first) return title
  // Coordinated verbs: "Marked cited sources and moved the investigation to review".
  const rest = m[2].replace(/((?:\s(?:and|then)|,\s*then)\s+)([A-Za-z][A-Za-z-]*)/g, (whole, joint: string, word: string) => {
    const next = convertWord(word, to)
    if (!next || !next.from.some((f) => first.from.includes(f))) return whole
    return `${joint}${next.text}`
  })
  return `${lead}${first.text}${rest}`
}

export const toBase = (title: string): string => convert(title, BASE)
export const toPast = (title: string): string => convert(title, PAST)
export const toParticiple = (title: string): string => convert(title, PARTICIPLE)

/** True when the title starts with a verb this module knows. */
export function startsWithVerb(title: string): boolean {
  const m = WORD.exec(title.trimStart())
  return !!m && INDEX.has(m[1].toLowerCase())
}

/** The title as it should read for a step in this status. */
export function stepTitle(title: string, status: StepStatus): string {
  if (status === 'running') return toParticiple(title)
  if (status === 'done') return toPast(title)
  return toBase(title)
}

/** Lowercase the first letter of a verb phrase ("Run checks" → "run checks"); acronyms and brands stay ("SSO", "GitHub"). */
export function lowerFirst(text: string): string {
  const m = /^([A-Za-z][A-Za-z-]*)(.*)$/s.exec(text)
  if (!m) return text
  const word = m[1]
  if (/[A-Z]/.test(word.slice(1))) return text
  return word[0].toLowerCase() + word.slice(1) + m[2]
}

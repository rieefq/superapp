import { keyTerms } from '../text'

export type CodeIntent = 'fix' | 'feature' | 'refactor' | 'test' | 'perf' | 'docs' | 'deps'

const INTENT_RULES: Array<[CodeIntent, RegExp]> = [
  ['test', /\b(flaky|flakes?|test coverage|add tests?|write tests?|unit tests?|e2e|failing tests?|spec)\b/i],
  ['docs', /\b(docs?|documentation|readme|jsdoc|docstrings?|comments?|document)\b/i],
  ['perf', /\b(perf(ormance)?|faster|speed( up)?|slow|latency|bundle|size|optimi[sz]e|memory|lazy[- ]?load|cache)\b/i],
  ['deps', /\b(upgrade|bump|migrat\w*|install|dependenc(y|ies)|package|sdk|library)\b/i],
  ['refactor', /\b(refactor\w*|clean ?up|rename|extract|simplif\w*|restructure|dedupe|tidy)\b/i],
  ['fix', /\b(fix\w*|bug\w*|broken|crash\w*|errors?|fails?|failing|regression|wrong|incorrect|expir\w*|leak\w*|issue)\b/i],
  ['feature', /\b(add|adds|adding|implement\w*|create|build|support|introduce|new|enable|allow|export)\b/i],
]

/** What kind of change the prompt asks for. */
export function classifyIntent(prompt: string): CodeIntent {
  for (const [intent, re] of INTENT_RULES) if (re.test(prompt)) return intent
  return 'fix'
}

const CODE_STOP = new Set([
  'fix', 'fixes', 'fixed', 'fixing', 'bug', 'bugs', 'issue', 'issues', 'add', 'adds', 'adding', 'make', 'update', 'updates',
  'change', 'changes', 'implement', 'create', 'support', 'improve', 'ensure', 'handle', 'code', 'file', 'files',
  'function', 'functions', 'test', 'tests', 'broken', 'works', 'working', 'properly', 'correctly', 'instead', 'please',
  'refactor', 'clean', 'cleanup', 'rename', 'extract', 'simplify', 'reduce', 'increase', 'remove', 'delete', 'migrate',
  'upgrade', 'bump', 'install', 'docs', 'documentation', 'document', 'write', 'introduce', 'enable', 'allow', 'build',
  'flaky', 'failing', 'fails', 'error', 'errors', 'wrong', 'incorrect', 'new', 'feature', 'performance', 'faster', 'slow',
])

/** The domain keywords of a coding prompt ("Fix session expiry after SSO login" → session, expiry, SSO, login). */
export function codeKeywords(prompt: string, max = 4): string[] {
  return keyTerms(prompt, max, CODE_STOP)
}

/** Well-known packages a prompt may imply, with a plausible major-version range. */
const KNOWN_PACKAGES: Array<{ re: RegExp; name: string; version: string }> = [
  { re: /\bstripe\b/i, name: 'stripe', version: '^17.0.0' },
  { re: /\bzod\b/i, name: 'zod', version: '^3.24.0' },
  { re: /\bdate-fns\b/i, name: 'date-fns', version: '^4.1.0' },
  { re: /\bdayjs\b/i, name: 'dayjs', version: '^1.11.0' },
  { re: /\baxios\b/i, name: 'axios', version: '^1.8.0' },
  { re: /\blodash\b/i, name: 'lodash', version: '^4.17.21' },
  { re: /\b(react[- ]query|tanstack query)\b/i, name: '@tanstack/react-query', version: '^5.0.0' },
  { re: /\bmsw\b|\bmock service worker\b/i, name: 'msw', version: '^2.7.0' },
  { re: /\bplaywright\b/i, name: '@playwright/test', version: '^1.50.0' },
  { re: /\bdompurify\b|\bsaniti[sz]e html\b/i, name: 'dompurify', version: '^3.2.0' },
  { re: /\bpapaparse\b|\bparse csv\b|\bcsv import\b/i, name: 'papaparse', version: '^5.5.0' },
  { re: /\bsentry\b/i, name: '@sentry/react', version: '^9.0.0' },
  { re: /\bposthog\b/i, name: 'posthog-js', version: '^1.200.0' },
  { re: /\bi18next\b|\binternationali[sz]ation\b|\bi18n\b/i, name: 'i18next', version: '^24.0.0' },
  { re: /\breact-hook-form\b/i, name: 'react-hook-form', version: '^7.54.0' },
  { re: /\brecharts\b/i, name: 'recharts', version: '^2.15.0' },
  { re: /\buuid\b/i, name: 'uuid', version: '^11.0.0' },
  { re: /\bnanoid\b/i, name: 'nanoid', version: '^5.0.0' },
]

export interface ImpliedPackage {
  name: string
  version: string
}

/**
 * A dependency the prompt implies, if any: an explicit `npm install x` / "add the x package",
 * or a well-known library named in the prompt (e.g. "Migrate invoices to Stripe Billing" → stripe).
 */
export function impliedPackage(prompt: string): ImpliedPackage | null {
  const explicit =
    /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|i)\s+(@?[a-z0-9][\w./-]*)/i.exec(prompt) ??
    /\b(?:install|add)\s+(?:the\s+)?(@?[a-z0-9][\w./-]*)\s+(?:package|library|dependency|lib|sdk)\b/i.exec(prompt)
  if (explicit) {
    const name = explicit[1].toLowerCase().replace(/[.,;:]+$/, '')
    const known = KNOWN_PACKAGES.find((k) => k.name === name)
    return { name, version: known?.version ?? 'latest' }
  }
  const known = KNOWN_PACKAGES.find((k) => k.re.test(prompt))
  return known ? { name: known.name, version: known.version } : null
}

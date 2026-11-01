import type { Block, ComposeContext, ComposedParts } from '../types'
import { camelCase, identifierWords, kebabCase, pascalCase, snakeCase } from '../code/naming'
import { SKELETONS } from '../code/skeletons'
import { bashTemplate, renderTsSource, sqlTemplate, TEMPLATES, type CodeTemplate } from '../code/templates'
import { bullets, heading } from '../layout'
import { detectLanguage, type CodeLanguage } from '../shapes'
import { capitalize, ensurePeriod, stripTrailingPunctuation, titleCase } from '../text'
import { closingOffer, sourcesBlock } from './common'

export const LANGUAGE_LABEL: Record<CodeLanguage, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', tsx: 'React (TSX)', jsx: 'React (JSX)', python: 'Python', go: 'Go',
  rust: 'Rust', java: 'Java', kotlin: 'Kotlin', swift: 'Swift', ruby: 'Ruby', php: 'PHP', csharp: 'C#', sql: 'SQL',
  bash: 'Bash', css: 'CSS', html: 'HTML',
}

const FENCE: Record<CodeLanguage, string> = {
  typescript: 'ts', javascript: 'js', tsx: 'tsx', jsx: 'jsx', python: 'python', go: 'go', rust: 'rust', java: 'java',
  kotlin: 'kotlin', swift: 'swift', ruby: 'ruby', php: 'php', csharp: 'csharp', sql: 'sql', bash: 'bash', css: 'css',
  html: 'html',
}

const ENTITIES = [
  'customers', 'orders', 'users', 'events', 'invoices', 'payments', 'products', 'employees', 'tickets', 'sessions',
  'accounts', 'subscriptions', 'tasks', 'projects', 'items', 'messages', 'shipments', 'deliveries',
]

function entitiesIn(text: string): string[] {
  const lower = text.toLowerCase()
  return ENTITIES.filter((e) => new RegExp(`\\b${e.replace(/ies$/, '(?:y|ies)').replace(/s$/, 's?')}\\b`).test(lower))
}

/** Render a template for a language, or undefined when the template has no source for it. */
function renderTemplate(t: CodeTemplate, lang: CodeLanguage): string | undefined {
  const { ts, tsx, python, go } = t.sources
  switch (lang) {
    case 'typescript':
      return ts && renderTsSource(ts, 'ts')
    case 'javascript':
      return ts && renderTsSource(ts, 'js')
    case 'tsx':
      return tsx ? renderTsSource(tsx, 'ts') : ts && renderTsSource(ts, 'ts')
    case 'jsx':
      return tsx ? renderTsSource(tsx, 'js') : ts && renderTsSource(ts, 'js')
    case 'python':
      return python
    case 'go':
      return go
    default:
      return undefined
  }
}

function pickTemplate(text: string, lang: CodeLanguage): { template: CodeTemplate; code: string } | undefined {
  const candidates = TEMPLATES.filter((t) => t.match.test(text))
  const ordered = lang === 'tsx' || lang === 'jsx' ? [...candidates.filter((t) => t.sources.tsx), ...candidates.filter((t) => !t.sources.tsx)] : candidates
  for (const template of ordered) {
    const code = renderTemplate(template, lang)
    if (code) return { template, code }
  }
  return undefined
}

function fill(src: string, values: Record<string, string>): string {
  return src.replace(/⟦([A-Z_]+)⟧/g, (m, key: string) => values[key] ?? m)
}

/** One-sentence description of what the requested code should do, from the request. */
function describe(np: string): string {
  const m = /\b(?:that|which|to|for)\s+(.+)$/i.exec(np)
  return ensurePeriod(capitalize(stripTrailingPunctuation(m ? m[1] : np)))
}

function identifier(lang: CodeLanguage, parts: string[]): string {
  if (lang === 'python' || lang === 'ruby' || lang === 'rust') return snakeCase(parts)
  if (lang === 'csharp') return pascalCase(parts)
  return camelCase(parts)
}

function resourceRoute(text: string): string {
  return entitiesIn(text)[0] ?? 'items'
}

interface CodeResult {
  code: string
  title: string
  notes: string[]
  tests: string[]
  usage?: string
  scaffold: boolean
}

function build(ctx: ComposeContext, lang: CodeLanguage): CodeResult {
  const text = ctx.text
  if (lang === 'sql') {
    const ents = entitiesIn(text)
    const limit = Number(/\btop\s+(\d{1,3})\b/i.exec(text)?.[1] ?? 10)
    const table = ents[0] ?? 'records'
    const join = ents.find((e) => e !== table && /orders|payments|invoices|subscriptions|events/.test(e))
    const { title, sql } = sqlTemplate(text, table, join, limit)
    return {
      code: sql,
      title,
      notes: [
        'Written for PostgreSQL (DATE_TRUNC, INTERVAL); adjust the date functions for MySQL or SQLite.',
        `Table and column names (${table}${join ? `, ${join}` : ''}, created_at…) are assumptions — rename them to match your schema.`,
        'If the table is large, index the columns you filter and sort by.',
      ],
      tests: ['Run it with LIMIT on a staging copy first.', 'Spot-check a few rows by hand.', 'Compare totals against a number you already trust.'],
      scaffold: false,
    }
  }
  if (lang === 'bash') {
    const { title, script } = bashTemplate(text)
    return {
      code: script,
      title,
      notes: [
        'set -euo pipefail stops on errors, unset variables and failed pipes.',
        "File names with spaces are handled safely with -print0 and read -d ''.",
        'Try it on a copy of the data first.',
      ],
      tests: ['Run with no arguments to check the usage message.', 'Run against an empty directory.', 'Run against names containing spaces.'],
      scaffold: false,
    }
  }

  const parts = identifierWords(ctx.subject.np)
  const values: Record<string, string> = {
    NAME: identifier(lang, parts),
    CLASS: lang === 'java' || lang === 'csharp' ? `${pascalCase(parts)}Utils` : pascalCase(parts),
    PASCAL: pascalCase(parts.length > 1 ? parts : [...parts, 'list']),
    KEBAB: kebabCase(parts),
    DESC: describe(ctx.subject.np),
    TITLE: titleCase(stripTrailingPunctuation(ctx.subject.np.replace(/^(?:an?|the)\s+/i, ''))),
    LABEL: titleCase(parts.join(' ')),
    LABEL_LOWER: parts.join(' ').toLowerCase(),
    ROUTE: resourceRoute(text),
  }

  const picked = pickTemplate(text, lang)
  if (picked) {
    const usage = lang === 'python' ? picked.template.usage?.python : lang === 'typescript' ? picked.template.usage?.ts : undefined
    return { code: fill(picked.code, values), title: picked.template.title, notes: picked.template.notes, tests: picked.template.tests, usage, scaffold: false }
  }
  return {
    code: fill(SKELETONS[lang], values),
    title: values.DESC,
    notes: [
      lang === 'css' || lang === 'html' ? 'The structure is ready to adapt; names follow the request.' : 'Input is split into trimmed, non-empty lines, and empty input fails fast with a clear error.',
      "The core rule is a marked TODO — I don't know your exact requirements, so I didn't guess them.",
      `Naming and error handling follow common ${LANGUAGE_LABEL[lang]} conventions.`,
    ],
    tests: ['A typical input produces the expected output.', 'Empty input fails with a clear error.', 'Unusual but valid input (extra whitespace, Unicode) is handled.'],
    scaffold: true,
  }
}

export function composeCode(ctx: ComposeContext): ComposedParts {
  const { rng, depth, evidence } = ctx
  const deep = depth === 'deep'
  const lang = detectLanguage(ctx.text)
  const label = LANGUAGE_LABEL[lang]
  const result = build(ctx, lang)
  const blocks: Block[] = []

  const opener = result.scaffold
    ? `Here's a ${label} starting point. The structure and input handling are in place; the core rule is marked TODO because I don't know your exact requirements.`
    : lang === 'sql'
      ? rng.pick([`Here's a SQL query for ${result.title}.`, `This query returns ${result.title}.`])
      : rng.pick([`Here's ${result.title} in ${label}.`, `Here's a ${label} implementation of ${result.title}.`])
  blocks.push({ md: opener, priority: Infinity })
  blocks.push({ md: `\`\`\`${FENCE[lang]}\n${result.code}\n\`\`\``, priority: Infinity })
  blocks.push({ md: heading('How it works') + bullets(deep ? result.notes : result.notes.slice(0, 2)), priority: 3 })
  if (deep && result.usage) blocks.push({ md: `${heading('Usage')}\`\`\`${FENCE[lang]}\n${result.usage}\n\`\`\``, priority: 2 })
  if (deep) blocks.push({ md: heading('Tests to add') + bullets(result.tests), priority: 2 })

  const sources = sourcesBlock(ctx, evidence.slice(0, 2), 'Relevant notes from your docs')
  if (sources) blocks.push({ ...sources, priority: 2 })
  blocks.push({ md: "_I haven't run this code — review it and add tests before relying on it._", priority: Infinity })
  blocks.push(closingOffer(ctx, ['Want tests for it, or a version in another language?', 'I can adapt it to your codebase if you share the surrounding code.']))

  return {
    blocks,
    extras: deep ? undefined : [{ md: heading('Tests to add') + bullets(result.tests), priority: 1 }],
    approach: {
      format: `a ${label} code block${result.scaffold ? ' scaffold with the unknown rule marked TODO' : ''}`,
      structure: 'show the code first, then explain how it works and what to test',
    },
  }
}

/**
 * Integrations workspace logic (docs/DESIGN.md §6.11): catalog filters, sections, search, status words
 * and the plain-language explanations of each permission. Pure — unit-tested in logic.test.ts.
 */
import type { IntegrationListItem, IntegrationStatus } from '@/core/services/integrations'
import { INTEGRATION_CATEGORIES } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import type { Capability, GrantMode, IntegrationCategory, IntegrationDef } from '@/core/types'
import { timeAgo } from '@/lib/format'

// ------------------------------------------------------------------------------------------------ filters

export type CatalogFilter = { kind: 'all' } | { kind: 'connected' } | { kind: 'category'; category: IntegrationCategory }

const CATEGORY_IDS = new Set<string>(INTEGRATION_CATEGORIES.map((c) => c.id))

/** `?filter=connected` · `?category=code` · nothing = the whole catalog. */
export function parseFilter(params: URLSearchParams): CatalogFilter {
  if (params.get('filter') === 'connected') return { kind: 'connected' }
  const category = params.get('category')
  if (category && CATEGORY_IDS.has(category)) return { kind: 'category', category: category as IntegrationCategory }
  return { kind: 'all' }
}

export function filterHref(filter: CatalogFilter): string {
  if (filter.kind === 'connected') return '/integrations?filter=connected'
  if (filter.kind === 'category') return `/integrations?category=${filter.category}`
  return '/integrations'
}

export function sameFilter(a: CatalogFilter, b: CatalogFilter): boolean {
  if (a.kind !== b.kind) return false
  return a.kind !== 'category' || (b.kind === 'category' && a.category === b.category)
}

export function categoryLabel(category: IntegrationCategory): string {
  return INTEGRATION_CATEGORIES.find((c) => c.id === category)?.label ?? category
}

export function filterTitle(filter: CatalogFilter): string {
  if (filter.kind === 'connected') return 'Connected'
  if (filter.kind === 'category') return categoryLabel(filter.category)
  return 'Integrations'
}

// ------------------------------------------------------------------------------------------------ status

/** Connected, connecting or failing: the integration has a live connection row worth showing first. */
export function isConnectedLike(status: IntegrationStatus): boolean {
  return status === 'connected' || status === 'error' || status === 'connecting'
}

/** Errors first (they need fixing), then connecting, connected, disconnected, available. */
export const STATUS_ORDER: Record<IntegrationStatus, number> = { error: 0, connecting: 1, connected: 2, disconnected: 3, available: 4 }

export interface StatusSpec {
  word: string
  shape: 'dot' | 'ring' | 'cross'
  tone: 'ink-2' | 'ink-3' | 'live' | 'fail'
  live?: boolean
}

/** Status → glyph and word. Connected is a calm filled dot: color is kept for working (live) and failing. */
export const STATUS_SPEC: Record<IntegrationStatus | 'always', StatusSpec> = {
  connected: { word: 'Connected', shape: 'dot', tone: 'ink-2' },
  connecting: { word: 'Connecting…', shape: 'dot', tone: 'live', live: true },
  error: { word: 'Error', shape: 'cross', tone: 'fail' },
  disconnected: { word: 'Disconnected', shape: 'ring', tone: 'ink-3' },
  available: { word: 'Available', shape: 'ring', tone: 'ink-3' },
  always: { word: 'Always on', shape: 'dot', tone: 'ink-2' },
}

/** Model providers read "Not connected" rather than "Available" (they need your key or endpoint). */
export function statusWord(def: IntegrationDef, status: IntegrationStatus): string {
  if (def.category === 'models' && (status === 'available' || status === 'disconnected')) return 'Not connected'
  return STATUS_SPEC[status].word
}

/** "29 uses · 2h ago" · "1 use · yesterday" · "Not used yet". */
export function usageLine(usageCount: number, lastUsedAt: number | undefined, now = Date.now()): string {
  if (!usageCount) return 'Not used yet'
  const uses = `${usageCount} ${usageCount === 1 ? 'use' : 'uses'}`
  return lastUsedAt ? `${uses} · ${timeAgo(lastUsedAt, now)}` : uses
}

// ------------------------------------------------------------------------------------------------ search

/** Case-insensitive match on name, id, monogram, category, description and capability labels. */
export function matchesQuery(def: IntegrationDef, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [
    def.name,
    def.id,
    def.monogram,
    categoryLabel(def.category),
    def.description,
    def.support === 'live' ? 'live' : 'simulated',
    ...def.capabilities.map((c) => CAPABILITIES[c].label),
  ]
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((word) => hay.includes(word))
}

/** The simulator card answers to these words too (it is not a catalog entry). */
export function simulatorMatches(query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = 'simulator sim swift deep local ai models offline template engine simulated'
  return q.split(/\s+/).every((word) => hay.includes(word))
}

// ------------------------------------------------------------------------------------------------ sections

export interface CatalogSection {
  id: string
  label: string
  /** 'models' sections also show the Simulator card. */
  kind: 'models' | 'connected' | 'category'
  items: IntegrationListItem[]
  /** Show the Simulator card in this section. */
  simulator?: boolean
}

const byName = (a: IntegrationListItem, b: IntegrationListItem) => a.def.name.localeCompare(b.def.name)

/** Errors first, then most recently used, then name. */
export function connectedOrder(a: IntegrationListItem, b: IntegrationListItem): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (b.connection?.lastUsedAt ?? 0) - (a.connection?.lastUsedAt ?? 0) ||
    byName(a, b)
  )
}

const CATEGORY_INDEX = new Map(INTEGRATION_CATEGORIES.map((c, i) => [c.id, i]))

/** Category order (as in the list pane), then name. */
export function categoryOrder(a: IntegrationListItem, b: IntegrationListItem): number {
  return (CATEGORY_INDEX.get(a.def.category) ?? 0) - (CATEGORY_INDEX.get(b.def.category) ?? 0) || byName(a, b)
}

/** Status order, then name (category views). */
export function statusOrder(a: IntegrationListItem, b: IntegrationListItem): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b)
}

/**
 * The catalog's sections (§6.11): AI models first (Simulator, Anthropic, OpenAI-compatible), then
 * Connected, then the rest of the catalog by category. Filters narrow it to one section; search
 * narrows every section and drops the empty ones.
 */
export function buildSections(items: IntegrationListItem[], filter: CatalogFilter, query = ''): CatalogSection[] {
  const hits = items.filter((i) => matchesQuery(i.def, query))
  const simulator = simulatorMatches(query)

  if (filter.kind === 'connected') {
    const connected = hits.filter((i) => isConnectedLike(i.status)).sort(connectedOrder)
    return connected.length ? [{ id: 'connected', label: 'Connected', kind: 'connected', items: connected }] : []
  }

  if (filter.kind === 'category') {
    const inCategory = hits.filter((i) => i.def.category === filter.category)
    if (filter.category === 'models') {
      return inCategory.length || simulator
        ? [{ id: 'models', label: 'AI models', kind: 'models', items: inCategory, simulator }]
        : []
    }
    const sorted = inCategory.sort(statusOrder)
    return sorted.length ? [{ id: filter.category, label: categoryLabel(filter.category), kind: 'category', items: sorted }] : []
  }

  const sections: CatalogSection[] = []
  // The live model providers keep their catalog order (Anthropic, then OpenAI-compatible).
  const models = hits.filter((i) => i.def.category === 'models')
  if (models.length || simulator) sections.push({ id: 'models', label: 'AI models', kind: 'models', items: models, simulator })

  const services = hits.filter((i) => i.def.category !== 'models')
  const connected = services.filter((i) => isConnectedLike(i.status)).sort(connectedOrder)
  if (connected.length) sections.push({ id: 'connected', label: 'Connected', kind: 'connected', items: connected })

  // One grid in category order (each card names its category; the list pane filters by category).
  const rest = services.filter((i) => !isConnectedLike(i.status)).sort(categoryOrder)
  if (rest.length) sections.push({ id: 'catalog', label: 'Catalog', kind: 'category', items: rest })
  return sections
}

export interface PaneCounts {
  all: number
  connected: number
  errors: number
  byCategory: Record<IntegrationCategory, number>
}

/** Counts for the list pane. The Simulator counts as an AI model. */
export function paneCounts(items: IntegrationListItem[]): PaneCounts {
  const byCategory = Object.fromEntries(INTEGRATION_CATEGORIES.map((c) => [c.id, 0])) as Record<IntegrationCategory, number>
  let connected = 0
  let errors = 0
  for (const i of items) {
    byCategory[i.def.category]++
    if (isConnectedLike(i.status)) connected++
    if (i.status === 'error') errors++
  }
  byCategory.models++
  return { all: items.length + 1, connected, errors, byCategory }
}

/** "12 connected · 1 error" for the catalog toolbar. */
export function catalogSummary(counts: PaneCounts): string {
  const parts = [`${counts.connected} connected`]
  if (counts.errors) parts.push(`${counts.errors} ${counts.errors === 1 ? 'error' : 'errors'}`)
  return parts.join(' · ')
}

// ------------------------------------------------------------------------------------------------ permissions

export const GRANT_LABEL: Record<GrantMode, string> = { allow: 'Allow', ask: 'Ask', deny: 'Deny' }

const verbOf = (capability: Capability) => {
  const label = CAPABILITIES[capability].label
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/**
 * What a policy means, in one sentence. Mirrors `evaluatePermission`: deny always wins, ask asks,
 * allow defers to the agent's own grant and autonomy (and to the global always-ask list).
 */
export function policyExplanation(integrationName: string, capability: Capability, mode: GrantMode): string {
  const verb = verbOf(capability)
  if (mode === 'deny') return `Blocked. Runs that try to ${verb} through ${integrationName} stop at that step.`
  if (mode === 'ask') return `Every attempt to ${verb} through ${integrationName} waits for your approval in Needs you.`
  return `Runs may ${verb} through ${integrationName} without asking here; each agent’s own abilities and autonomy still apply.`
}

/** The global safety note for capabilities on the always-ask list (Settings › Permissions). */
export function alwaysAskNote(capability: Capability): string {
  return `Your safety settings always ask before runs ${verbOf(capability)}.`
}

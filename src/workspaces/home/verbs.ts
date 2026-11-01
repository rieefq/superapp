import { detectIntent, type Intent, type IntentResult } from '@/core/ai/intent'
import type { StartKind } from '@/app/shell/store'

/**
 * Home's verb chips (§6.1): Auto · Ask · Research · Build · Delegate · Create · Automate. Auto routes
 * with `detectIntent` (keyword rules, not a model) and shows the router's reason; Tab changes the verb.
 */
export type HomeVerb = 'auto' | 'ask' | 'research' | 'build' | 'delegate' | 'create' | 'automate'

export const HOME_VERBS: readonly { id: HomeVerb; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'ask', label: 'Ask' },
  { id: 'research', label: 'Research' },
  { id: 'build', label: 'Build' },
  { id: 'delegate', label: 'Delegate' },
  { id: 'create', label: 'Create' },
  { id: 'automate', label: 'Automate' },
]

export const INTENT_LABEL: Record<Intent, string> = {
  ask: 'Ask',
  research: 'Research',
  build: 'Build',
  delegate: 'Delegate',
  create: 'Create',
  automate: 'Automate',
  organize: 'Organize',
}

/** "Looks like code work" — the router's reading of the request, by intent. */
const READING: Record<Intent, string> = {
  ask: 'Reads as a question',
  research: 'Looks like research',
  build: 'Looks like code work',
  delegate: 'Looks like work for an agent',
  create: 'Looks like something to make',
  automate: 'Looks like an automation',
  organize: 'Looks like something to organize',
}

/** Start sheet kind for the verbs that open it. */
export const SHEET_KIND: Partial<Record<Intent, StartKind>> = {
  research: 'research',
  build: 'session',
  delegate: 'agent',
  organize: 'task',
}

export interface Routed {
  intent: Intent
  /** The router's result when the verb is Auto (otherwise undefined). */
  auto?: IntentResult
}

/** The intent a verb resolves to for this draft. */
export function routeVerb(verb: HomeVerb, text: string): Routed {
  if (verb !== 'auto') return { intent: verb }
  const auto = detectIntent(text)
  return { intent: auto.intent, auto }
}

/** The line under the hero composer: `Looks like code work → Build in Atlas Portal v2 · ⇥ to change`. */
export function routeLine(routed: Routed, projectName: string | null): { reading?: string; target: string } {
  const where = projectName ? ` in ${projectName}` : ''
  const target = `${INTENT_LABEL[routed.intent]}${where}`
  return routed.auto ? { reading: READING[routed.intent], target } : { target }
}

/** Next verb for Tab (Shift+Tab goes back). */
export function cycleVerb(verb: HomeVerb, dir: 1 | -1): HomeVerb {
  const i = HOME_VERBS.findIndex((v) => v.id === verb)
  const n = HOME_VERBS.length
  return HOME_VERBS[(i + dir + n) % n].id
}

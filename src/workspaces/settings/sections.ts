import { Bell, Cpu, Database, Gauge, Info, Keyboard, ShieldCheck, SunMoon, UserRound, Wallet, type LucideIcon } from 'lucide-react'

/**
 * The Settings sections (docs/DESIGN.md §2.6, §6.12), in rail order. Each lists the settings it holds
 * so the list pane's "Find a setting" field and ⌘K can jump straight to one (`/settings/<section>#<setting>`).
 * This module is imported by the manifest, so it stays light: data and icons only.
 */

export type SectionId =
  | 'profile'
  | 'appearance'
  | 'models'
  | 'permissions'
  | 'budgets'
  | 'notifications'
  | 'keyboard'
  | 'simulator'
  | 'data'
  | 'about'

export interface SettingDef {
  /** Anchor id inside the section: `/settings/appearance#theme`. */
  id: string
  label: string
  keywords?: string[]
}

export interface SectionDef {
  id: SectionId
  label: string
  icon: LucideIcon
  /** One sentence under the stage header. */
  lead: string
  keywords: string[]
  settings: SettingDef[]
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: UserRound,
    lead: 'How you appear in Atrium. Your profile is stored on this device and never synced.',
    keywords: ['account', 'me', 'user', 'identity'],
    settings: [
      { id: 'name', label: 'Name', keywords: ['display name', 'initials', 'full name'] },
      { id: 'email', label: 'Email', keywords: ['address', 'mail'] },
      { id: 'hue', label: 'Identity hue', keywords: ['color', 'colour', 'avatar', 'hue', 'initials'] },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: SunMoon,
    lead: 'Theme, density and motion. Changes apply at once and are remembered on this device.',
    keywords: ['look', 'display', 'ui'],
    settings: [
      { id: 'theme', label: 'Theme', keywords: ['dark', 'light', 'system', 'mode', 'color scheme'] },
      { id: 'density', label: 'Density', keywords: ['compact', 'comfortable', 'rows', 'spacing'] },
      { id: 'motion', label: 'Motion', keywords: ['animation', 'reduce motion', 'reduced', 'accessibility'] },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    icon: Cpu,
    lead: 'Which model answers by default, how hard it thinks, and how it uses your knowledge.',
    keywords: ['ai', 'llm', 'model'],
    settings: [
      { id: 'default-model', label: 'Default model', keywords: ['model', 'provider', 'claude', 'simulator', 'llm'] },
      { id: 'effort', label: 'Effort', keywords: ['reasoning effort', 'thinking', 'low', 'medium', 'high'] },
      { id: 'reasoning', label: 'Show reasoning', keywords: ['thinking', 'trace', 'reasoning summary'] },
      { id: 'auto-retrieve', label: 'Auto-retrieve knowledge', keywords: ['retrieval', 'rag', 'likely', 'knowledge', 'context'] },
      { id: 'delegated', label: 'Delegated runs', keywords: ['research', 'agents', 'coding', 'workflows', 'simulated'] },
      { id: 'providers', label: 'Providers and keys', keywords: ['api key', 'anthropic', 'openai', 'ollama', 'integrations', 'connect'] },
    ],
  },
  {
    id: 'permissions',
    label: 'Permissions & safety',
    icon: ShieldCheck,
    lead: 'What runs may do without asking you, and the standing permissions you have granted.',
    keywords: ['safety', 'approvals', 'policy', 'security'],
    settings: [
      { id: 'autonomy', label: 'Default autonomy', keywords: ['supervised', 'balanced', 'autonomous', 'approval'] },
      { id: 'always-ask', label: 'Always ask', keywords: ['capabilities', 'approval', 'messages', 'payments', 'pull requests'] },
      { id: 'policy', label: 'What runs may do', keywords: ['preview', 'policy', 'allowed', 'asks'] },
      { id: 'confirm-destructive', label: 'Confirm destructive actions', keywords: ['delete', 'confirm', 'remove'] },
      { id: 'always-allow', label: 'Always-allow permissions', keywords: ['grants', 'revoke', 'agent', 'always allow'] },
    ],
  },
  {
    id: 'budgets',
    label: 'Budgets',
    icon: Wallet,
    lead: 'A monthly ceiling on model spend. Simulated runs spend nothing.',
    keywords: ['spend', 'cost', 'money', 'limit'],
    settings: [
      { id: 'monthly-budget', label: 'Monthly budget', keywords: ['spend', 'cost', 'limit', 'usd', 'dollars'] },
      { id: 'count-simulated', label: 'Count simulated estimates', keywords: ['estimate', 'simulated cost', 'reference pricing'] },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: Bell,
    lead: 'What interrupts you, and what waits quietly in Updates.',
    keywords: ['alerts', 'updates'],
    settings: [
      { id: 'toasts', label: 'Toasts', keywords: ['popups', 'pop-ups', 'banners'] },
      { id: 'focus-mode', label: 'Focus mode', keywords: ['quiet', 'do not disturb', 'dnd'] },
      { id: 'approvals', label: 'Approval requests', keywords: ['needs you', 'approvals'] },
      { id: 'run-completed', label: 'Finished runs', keywords: ['completed', 'done', 'landed'] },
      { id: 'run-failed', label: 'Failed runs', keywords: ['errors', 'failures'] },
    ],
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    icon: Keyboard,
    lead: 'Every shortcut in Atrium, and whether single keys are on.',
    keywords: ['shortcuts', 'hotkeys', 'keys'],
    settings: [
      { id: 'single-keys', label: 'Single-key shortcuts', keywords: ['hotkeys', 'accessibility', 'chords'] },
      { id: 'shortcuts', label: 'All shortcuts', keywords: ['keys', 'hotkeys', 'cheat sheet', 'reference'] },
    ],
  },
  {
    id: 'simulator',
    label: 'Simulator',
    icon: Gauge,
    lead: 'How fast the local simulator plays its runs, and what it stands in for.',
    keywords: ['simulation', 'sim', 'demo'],
    settings: [
      { id: 'speed', label: 'Simulation speed', keywords: ['fast', 'pacing', 'speed', '2x', '4x', 'demo'] },
      { id: 'in-flight', label: 'Simulated runs in flight', keywords: ['running', 'now'] },
      { id: 'what-is-simulated', label: 'What is simulated', keywords: ['sim', 'honest', 'live', 'real'] },
    ],
  },
  {
    id: 'data',
    label: 'Data',
    icon: Database,
    lead: 'Everything lives in this browser. Export it, bring it back, or start over.',
    keywords: ['storage', 'backup', 'privacy'],
    settings: [
      { id: 'storage', label: 'Storage', keywords: ['usage', 'size', 'local storage', 'bytes', 'tables'] },
      { id: 'export', label: 'Export JSON', keywords: ['backup', 'download', 'save'] },
      { id: 'import', label: 'Import JSON', keywords: ['restore', 'upload', 'load'] },
      { id: 'reset', label: 'Reset demo world', keywords: ['demo', 'seed', 'start over', 'northwind'] },
      { id: 'erase', label: 'Erase everything', keywords: ['clear', 'delete all', 'wipe', 'remove'] },
    ],
  },
  {
    id: 'about',
    label: 'About',
    icon: Info,
    lead: 'The version you are running, and an honest account of what is real in this build.',
    keywords: ['version', 'build', 'info'],
    settings: [
      { id: 'version', label: 'Version', keywords: ['build', 'release'] },
      { id: 'honesty', label: 'Honesty', keywords: ['labels', 'sim', 'promise'] },
      { id: 'whats-real', label: 'What’s real in this build', keywords: ['live', 'simulated', 'honesty', 'matrix'] },
    ],
  },
]

export const DEFAULT_SECTION: SectionId = 'profile'

/** Old or alternative names that still lead somewhere (`/settings/safety` → permissions). */
export const SECTION_ALIASES: Readonly<Record<string, SectionId>> = {
  general: 'profile',
  account: 'profile',
  theme: 'appearance',
  ai: 'models',
  model: 'models',
  safety: 'permissions',
  budget: 'budgets',
  spend: 'budgets',
  shortcuts: 'keyboard',
  simulation: 'simulator',
  storage: 'data',
}

export function getSection(id: string | null | undefined): SectionDef | undefined {
  return id ? SECTIONS.find((s) => s.id === id) : undefined
}

export function sectionPath(id: SectionId, setting?: string): string {
  return `/settings/${id}${setting ? `#${setting}` : ''}`
}

// ------------------------------------------------------------------------------------------------ search

export interface SettingHit {
  section: SectionDef
  /** Undefined when the section itself matched (not one setting inside it). */
  setting?: SettingDef
  score: number
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9×&]+/g, ' ').trim()

function scoreText(tokens: string[], label: string, extra: readonly string[]): number {
  const l = norm(label)
  const hay = [l, ...extra.map(norm)].join(' ')
  if (!tokens.every((t) => hay.includes(t))) return 0
  const q = tokens.join(' ')
  if (l === q) return 100
  if (l.startsWith(q)) return 80
  if (l.split(' ').some((w) => w.startsWith(tokens[0]))) return 60
  return 30
}

/**
 * "Find a setting": every setting whose label, keywords or section match all the words typed,
 * best first. A section matches on its own label and keywords.
 */
export function searchSettings(query: string, sections: readonly SectionDef[] = SECTIONS): SettingHit[] {
  const tokens = norm(query).split(' ').filter(Boolean)
  if (!tokens.length) return []
  const hits: SettingHit[] = []
  sections.forEach((section, si) => {
    const own = scoreText(tokens, section.label, section.keywords)
    if (own) hits.push({ section, score: own + 5 - si * 0.01 })
    section.settings.forEach((setting, i) => {
      const score = scoreText(tokens, setting.label, [...(setting.keywords ?? []), section.label])
      if (score) hits.push({ section, setting, score: score - si * 0.01 - i * 0.001 })
    })
  })
  return hits.sort((a, b) => b.score - a.score)
}

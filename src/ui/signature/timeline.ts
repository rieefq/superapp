import { getIntegration } from '@/core/integrations/catalog'
import type { EntityKind, Run, RunStep, StepKind, StepStatus } from '@/core/types'
import { stepTitle } from './tense'

/**
 * RunTimeline logic (docs/DESIGN.md §5.4.4): which steps collapse into a read/search group,
 * which tools were simulated, how tools are named. Pure; the component renders the result.
 */

export interface TimelineStepEntry {
  type: 'step'
  step: RunStep
  index: number
}

export interface TimelineGroupEntry {
  type: 'group'
  key: string
  steps: TimelineStepEntry[]
  /** "Read 6 files", "Searched and read 8 sources", "Ran 3 searches". */
  label: string
  kind: 'read' | 'search'
}

export type TimelineEntry = TimelineStepEntry | TimelineGroupEntry

const READ_KINDS: readonly StepKind[] = ['read', 'browse']
const GROUPABLE: readonly StepKind[] = ['read', 'browse', 'search']

const NOUNS: Partial<Record<EntityKind, [string, string]>> = {
  source: ['source', 'sources'],
  knowledge: ['document', 'documents'],
  repo: ['repository', 'repositories'],
  session: ['session', 'sessions'],
  task: ['task', 'tasks'],
  message: ['message', 'messages'],
  investigation: ['investigation', 'investigations'],
}

function readNoun(steps: readonly RunStep[], runKind: Run['kind'] | undefined, n: number): string {
  const kinds = new Set(steps.flatMap((s) => (s.refs ?? []).map((r) => r.kind)))
  const pickNoun = (pair: [string, string]) => (n === 1 ? pair[0] : pair[1])
  if (kinds.size === 1) {
    const only = NOUNS[[...kinds][0]]
    if (only) return pickNoun(only)
  }
  if (kinds.size === 0 && runKind === 'code') return pickNoun(['file', 'files'])
  if (kinds.size === 0 && steps.every((s) => s.kind === 'browse')) return pickNoun(['page', 'pages'])
  return pickNoun(['item', 'items'])
}

/** Label for a collapsed group of finished read/search steps. */
export function groupLabel(steps: readonly RunStep[], runKind?: Run['kind']): string {
  const reads = steps.filter((s) => READ_KINDS.includes(s.kind))
  const searches = steps.length - reads.length
  const n = reads.reduce((sum, s) => sum + Math.max(1, s.refs?.length ?? 0), 0)
  if (!reads.length) return `Ran ${searches} searches`
  const noun = readNoun(reads, runKind, n)
  return searches ? `Searched and read ${n} ${noun}` : `Read ${n} ${noun}`
}

/**
 * Collapse runs of ≥2 consecutive finished read/search steps into one group. Running, waiting,
 * failed and skipped steps always stay visible on their own.
 */
export function groupTimelineSteps(steps: readonly RunStep[], opts: { runKind?: Run['kind']; minGroup?: number } = {}): TimelineEntry[] {
  const min = opts.minGroup ?? 2
  const out: TimelineEntry[] = []
  let pending: TimelineStepEntry[] = []
  const flush = () => {
    if (pending.length >= min) {
      const list = pending.map((e) => e.step)
      out.push({
        type: 'group',
        key: `group-${pending[0].step.id}`,
        steps: pending,
        label: groupLabel(list, opts.runKind),
        kind: list.some((s) => READ_KINDS.includes(s.kind)) ? 'read' : 'search',
      })
    } else out.push(...pending)
    pending = []
  }
  steps.forEach((step, index) => {
    const entry: TimelineStepEntry = { type: 'step', step, index }
    if (GROUPABLE.includes(step.kind) && step.status === 'done' && !step.approvalId) pending.push(entry)
    else {
      flush()
      out.push(entry)
    }
  })
  flush()
  return out
}

/**
 * Whether a step's tool work was simulated. In a simulated run everything is. In a live run,
 * the code sandbox, web search and every simulated integration are simulated; GitHub reads are
 * live but pushes and pull requests are simulated in this build.
 */
export function isStepSimulated(run: Pick<Run, 'simulated'>, step: Pick<RunStep, 'kind' | 'tool' | 'integrationId' | 'capability'>): boolean {
  if (run.simulated) return true
  const def = step.integrationId ? getIntegration(step.integrationId) : undefined
  if (def) {
    if (def.id === 'github') return step.capability === 'repo.write' || step.capability === 'repo.pull_request'
    return def.support === 'simulated'
  }
  if (isTerminalStep(step) || isWebStep(step)) return true
  if (step.kind === 'generate' || step.capability === 'media.generate') return true
  if (step.capability === 'messages.send') return true
  return false
}

const TOOL_LABELS: Record<string, string> = {
  terminal: 'Terminal',
  checks: 'Checks',
  editor: 'Editor',
  repo: 'Repository',
  github: 'GitHub',
  'knowledge.search': 'Knowledge',
  knowledge: 'Knowledge',
  'web.search': 'Web search',
  'web.browse': 'Browser',
  workspace: 'Workspace',
  slack: 'Slack',
  gmail: 'Gmail',
  sandbox: 'Sandbox',
}

/** Human tool name for the step's tool chip ("Terminal", "Web search", "GitHub"), if it used one. */
export function toolLabel(step: Pick<RunStep, 'tool' | 'integrationId'>): string | undefined {
  const tool = step.tool?.trim()
  if (tool) {
    const known = TOOL_LABELS[tool.toLowerCase()]
    if (known) return known
    const def = getIntegration(tool.toLowerCase())
    if (def) return def.name
    const words = tool.replace(/[._-]+/g, ' ').trim()
    return words ? words[0].toUpperCase() + words.slice(1) : undefined
  }
  if (step.integrationId) return getIntegration(step.integrationId)?.name
  return undefined
}

type ToolStep = Pick<RunStep, 'kind' | 'tool' | 'integrationId' | 'capability'>

export const isTerminalStep = (step: ToolStep): boolean =>
  step.kind === 'command' || step.kind === 'test' || /^(terminal|checks|shell|sandbox)/.test(step.tool ?? '')

export const isWebStep = (step: ToolStep): boolean =>
  step.kind === 'browse' || /^web\./.test(step.tool ?? '') || !!step.capability?.startsWith('web.') || step.integrationId === 'web-search'

/**
 * Header of the hatched frame around a simulated tool step's output (exact strings, §8.4).
 * Undefined for steps that used no tool (plans, thinking, writing).
 */
export function simulatedFrameHeader(step: ToolStep): string | undefined {
  if (isTerminalStep(step)) return 'Simulated terminal — nothing was executed'
  if (isWebStep(step)) return 'Simulated web result'
  const def = step.integrationId ? getIntegration(step.integrationId) : undefined
  if (def) return `Simulated ${def.name} — nothing left your browser`
  const label = toolLabel(step)
  return label ? `Simulated ${label} result` : undefined
}

/** Duration of a step: finished = end − start, running = now − start. */
export function stepDurationMs(step: Pick<RunStep, 'startedAt' | 'endedAt' | 'status'>, now = Date.now()): number | undefined {
  if (step.startedAt === undefined) return undefined
  if (step.endedAt !== undefined) return Math.max(0, step.endedAt - step.startedAt)
  if (step.status === 'running' || step.status === 'waiting') return Math.max(0, now - step.startedAt)
  return undefined
}

/** A group's status: failed › running › waiting › done. Groups only hold finished steps today. */
export function groupStatus(steps: readonly Pick<RunStep, 'status'>[]): StepStatus {
  if (steps.some((s) => s.status === 'failed')) return 'failed'
  if (steps.some((s) => s.status === 'running')) return 'running'
  if (steps.some((s) => s.status === 'waiting')) return 'waiting'
  return 'done'
}

/** Title for a step as displayed in its current status. */
export const displayStepTitle = (step: Pick<RunStep, 'title' | 'status'>): string => stepTitle(step.title, step.status)

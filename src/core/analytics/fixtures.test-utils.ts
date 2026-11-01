/**
 * Minimal row builders and a time-zone switch for analytics tests (not used by the app).
 */
import { afterAll } from 'vitest'
import { ME, type Agent, type Approval, type Run, type Task, type Usage, type Workflow } from '@/core/types'

export const SEC = 1_000
export const MIN = 60 * SEC
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

/** Epoch ms for an ISO timestamp with an explicit offset (`Z` or `±hh:mm`). */
export const at = (iso: string): number => {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`Bad timestamp ${iso}`)
  return t
}

/**
 * Run this file's assertions in `timeZone` (local-time bucketing depends on it) and restore the
 * previous zone after the file. Call at module top level, before any test runs.
 */
export function useTimeZone(timeZone: string): void {
  const previous = process.env.TZ
  process.env.TZ = timeZone
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ
    else process.env.TZ = previous
  })
}

export const cost = (costUsd: number, inputTokens = 0, outputTokens = 0): Usage => ({ inputTokens, outputTokens, costUsd })

export function mkRun(o: Partial<Run> & { id: string }): Run {
  return {
    kind: 'agent', title: o.id, status: 'succeeded', projectId: null, initiator: ME, steps: [], outputs: [],
    simulated: true, usage: cost(0), progress: 1, createdAt: 0, ...o,
  }
}

/** A finished run that started at `start` and took `durationMs`. */
export function finished(o: Partial<Run> & { id: string; start: number; durationMs?: number }): Run {
  const { start, durationMs = 10 * SEC, ...rest } = o
  return mkRun({ createdAt: start, startedAt: start, endedAt: start + durationMs, ...rest })
}

export function mkApproval(o: Partial<Approval> & { id: string }): Approval {
  return {
    runId: 'run_x', stepId: 'stp_x', title: o.id, capability: 'messages.send', risk: 'medium', requestedBy: ME,
    status: 'pending', createdAt: 0, ...o,
  }
}

export function mkTask(o: Partial<Task> & { id: string }): Task {
  return {
    projectId: null, title: o.id, status: 'todo', priority: 'none', assignee: null, labels: [], subtasks: [], runIds: [],
    order: 0, createdAt: 0, updatedAt: 0, ...o,
  }
}

export function mkAgent(o: Partial<Agent> & { id: string }): Agent {
  return {
    name: o.id, role: 'Analyst', description: '', hue: 'violet', sigil: 1, modelId: 'sim-swift', instructions: '',
    capabilities: [], knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'balanced',
    status: 'active', createdAt: 0, updatedAt: 0, ...o,
  }
}

export function mkWorkflow(o: Partial<Workflow> & { id: string }): Workflow {
  return {
    name: o.id, description: '', projectId: null, hue: 'mint', trigger: { type: 'manual', label: 'Manual' }, nodes: [],
    edges: [], enabled: true, version: 1, createdAt: 0, updatedAt: 0, ...o,
  }
}

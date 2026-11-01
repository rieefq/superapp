import type { ActorRef, EntityRef, ID, Run, RunKind, RunScriptState, RunStep, Usage } from '@/core/types'

/** STUB — replaced by the run-engine implementation (signatures are a contract). */
export interface CreateRunInput {
  kind: RunKind
  title: string
  projectId?: ID | null
  agentId?: ID
  workflowId?: ID
  parentRunId?: ID
  origin?: EntityRef
  initiator?: ActorRef
  modelId?: string
  simulated: boolean
  script?: RunScriptState
}

const ni = (n: string): never => {
  throw new Error(`${n} not implemented yet`)
}

export function createRun(input: CreateRunInput): Run {
  void input
  return ni('createRun')
}
export function appendStep(runId: ID, step: Omit<RunStep, 'id'> & { id?: ID }): RunStep {
  void runId
  void step
  return ni('appendStep')
}
export function updateStep(runId: ID, stepId: ID, patch: Partial<RunStep>): void {
  void runId
  void stepId
  void patch
  ni('updateStep')
}
export function addUsage(runId: ID, usage: Usage): void {
  void runId
  void usage
  ni('addUsage')
}
export function completeRun(runId: ID, input?: { summary?: string; outputs?: EntityRef[] }): void {
  void runId
  void input
  ni('completeRun')
}
export function failRun(runId: ID, error: string): void {
  void runId
  void error
  ni('failRun')
}
export function cancelRun(runId: ID, reason?: string): void {
  void runId
  void reason
  ni('cancelRun')
}

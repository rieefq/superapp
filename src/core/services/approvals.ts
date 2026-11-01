import { useShallow } from 'zustand/react/shallow'
import { db, useDB, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs/engine'
import type { Approval, ID } from '@/core/types'

export interface PendingApprovalsFilter {
  /** Only approvals whose run belongs to this project (null/undefined = all work). */
  projectId?: ID | null
}

function selectPending(s: Tables, projectId: ID | null | undefined): Approval[] {
  const out: Approval[] = []
  for (const a of Object.values(s.approvals)) {
    if (a.status !== 'pending') continue
    if (projectId && s.runs[a.runId]?.projectId !== projectId) continue
    out.push(a)
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/** Pending approvals, newest first. */
export function usePendingApprovals(opts: PendingApprovalsFilter = {}): Approval[] {
  const { projectId } = opts
  return useDB(useShallow((s) => selectPending(s, projectId)))
}

/** Number of pending approvals (cheap: re-renders only when the count changes). */
export function usePendingApprovalCount(opts: PendingApprovalsFilter = {}): number {
  const { projectId } = opts
  return useDB((s) => selectPending(s, projectId).length)
}

/** Every approval requested by a run (any status), in the order they were requested. */
export function useApprovalsForRun(runId: ID | null | undefined): Approval[] {
  return useDB(
    useShallow((s) =>
      runId ? Object.values(s.approvals).filter((a) => a.runId === runId).sort((a, b) => a.createdAt - b.createdAt) : [],
    ),
  )
}

/** Approve a pending request; the waiting run continues with the approved step. */
/**
 * Approve a pending request. With `payload`, the human edited what will happen (the command,
 * message or text) before approving: the approval preview and the waiting step's input are
 * updated so the run proceeds with — and records — the edited version.
 */
export function approve(id: ID, note?: string, opts?: { payload?: string }): void {
  const payload = opts?.payload
  if (payload !== undefined) {
    const approval = db.get('approvals', id)
    if (approval?.status === 'pending') {
      if (approval.preview) db.update('approvals', id, { preview: { ...approval.preview, content: payload } })
      db.update('runs', approval.runId, (run) => ({
        ...run,
        steps: run.steps.map((s) => (s.id === approval.stepId ? { ...s, input: payload } : s)),
      }))
    }
  }
  runEngine.resolveApproval(id, 'approved', note)
}

/** Reject a pending request; the step is skipped and the run stops unless its script allows skipping. */
export function reject(id: ID, note?: string): void {
  runEngine.resolveApproval(id, 'rejected', note)
}

export function getPendingCount(): number {
  return db.filter('approvals', (a) => a.status === 'pending').length
}

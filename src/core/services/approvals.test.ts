import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { runEngine } from '@/core/runs/engine'
import type { Approval, Run } from '@/core/types'
import { approve, getPendingCount, reject, useApprovalsForRun, usePendingApprovalCount, usePendingApprovals } from './approvals'

function run(id: string, projectId: string | null): Run {
  return {
    id, kind: 'agent', title: id, status: 'waiting', projectId, initiator: { type: 'user', id: 'usr_me' }, steps: [], outputs: [],
    simulated: true, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, progress: 0, createdAt: 0,
  }
}

function approval(id: string, runId: string, createdAt: number, status: Approval['status'] = 'pending'): Approval {
  return {
    id, runId, stepId: `stp_${id}`, title: id, capability: 'shell.execute', risk: 'medium',
    requestedBy: { type: 'system', id: 'system' }, status, createdAt,
  }
}

beforeEach(() => {
  db.replaceAll(emptyTables())
  db.insertMany('runs', [run('run_a', 'prj_1'), run('run_b', 'prj_2'), run('run_c', null)])
  db.insertMany('approvals', [
    approval('apv_1', 'run_a', 10),
    approval('apv_2', 'run_b', 30),
    approval('apv_3', 'run_a', 20, 'approved'),
    approval('apv_4', 'run_c', 40),
    approval('apv_5', 'run_a', 5, 'expired'),
  ])
})

const ids = (list: Approval[]) => list.map((a) => a.id)

describe('pending approvals', () => {
  it('lists pending approvals newest first, optionally scoped to a project via their run', () => {
    expect(ids(renderHook(() => usePendingApprovals()).result.current)).toEqual(['apv_4', 'apv_2', 'apv_1'])
    expect(ids(renderHook(() => usePendingApprovals({ projectId: 'prj_1' })).result.current)).toEqual(['apv_1'])
    expect(ids(renderHook(() => usePendingApprovals({ projectId: null })).result.current)).toEqual(['apv_4', 'apv_2', 'apv_1'])
    expect(getPendingCount()).toBe(3)
  })

  it('updates when an approval is resolved', () => {
    const list = renderHook(() => usePendingApprovals())
    const count = renderHook(() => usePendingApprovalCount({ projectId: 'prj_2' }))
    expect(count.result.current).toBe(1)
    act(() => {
      db.update('approvals', 'apv_2', { status: 'approved' })
    })
    expect(ids(list.result.current)).toEqual(['apv_4', 'apv_1'])
    expect(count.result.current).toBe(0)
  })

  it('lists every approval of a run in request order', () => {
    expect(ids(renderHook(() => useApprovalsForRun('run_a')).result.current)).toEqual(['apv_5', 'apv_1', 'apv_3'])
    expect(renderHook(() => useApprovalsForRun(undefined)).result.current).toEqual([])
  })
})

describe('approve / reject', () => {
  it('delegate to the run engine', () => {
    const resolve = vi.spyOn(runEngine, 'resolveApproval').mockImplementation(() => {})
    approve('apv_1', 'ok')
    reject('apv_2')
    expect(resolve).toHaveBeenNthCalledWith(1, 'apv_1', 'approved', 'ok')
    expect(resolve).toHaveBeenNthCalledWith(2, 'apv_2', 'rejected', undefined)
  })
})

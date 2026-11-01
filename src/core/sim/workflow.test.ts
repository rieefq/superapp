import { describe, expect, it } from 'vitest'
import type { WorkflowNode } from '@/core/types'
import { createRng } from '@/lib/rng'
import { delayDuration, evaluateCondition, findCycle, reachableFrom, topologicalOrder, triggerPayload } from './workflow'

const n = (id: string, config: Record<string, unknown> = {}, type: WorkflowNode['type'] = 'condition'): WorkflowNode => ({ id, type, label: id, position: { x: 0, y: 0 }, config })
const e = (source: string, target: string) => ({ source, target })

describe('graph utilities', () => {
  it('orders a DAG topologically and blocks cycles', () => {
    const nodes = ['t', 'a', 'b', 'c'].map((id) => ({ id }))
    expect(topologicalOrder(nodes, [e('t', 'a'), e('t', 'b'), e('a', 'c'), e('b', 'c')]).order).toEqual(['t', 'a', 'b', 'c'])
    const cyclic = topologicalOrder(nodes, [e('t', 'a'), e('a', 'b'), e('b', 'a'), e('b', 'c')])
    expect(cyclic.order).toEqual(['t'])
    expect(cyclic.blocked).toEqual(['a', 'b', 'c'])
    expect(findCycle(nodes, [e('t', 'a'), e('a', 'b'), e('b', 'a')])).toEqual(['a', 'b', 'a'])
    expect(findCycle(nodes, [e('t', 'a'), e('a', 'b')])).toBeNull()
    expect([...reachableFrom('t', [e('t', 'a'), e('b', 'c')])]).toEqual(['t', 'a'])
  })
})

describe('evaluateCondition', () => {
  it('honours forced branches and reads the run context', () => {
    expect(evaluateCondition(n('c', { branch: 'false' }), { priority: 'urgent' }, createRng(1))).toEqual({ branch: 'false', reason: 'branch fixed in the step settings' })
    expect(evaluateCondition(n('c', { expression: "priority == 'urgent'" }), { priority: 'urgent' }, createRng(1))).toEqual({ branch: 'true', reason: 'priority is urgent' })
    expect(evaluateCondition(n('c', { expression: "priority == 'urgent'" }), { priority: 'low' }, createRng(1)).branch).toBe('false')
    expect(evaluateCondition(n('c', { expression: 'score > 0.5' }), { score: 0.8 }, createRng(1))).toEqual({ branch: 'true', reason: 'score 0.8 > 0.5' })
    expect(evaluateCondition(n('c', { expression: "contains('refund')" }), { subject: 'Refund request for invoice' }, createRng(1)).branch).toBe('true')
  })
})

describe('payloads and delays', () => {
  it('simulates trigger payloads with fictional senders', () => {
    const mail = triggerPayload({ type: 'event', label: 'New email', event: 'gmail.message.received' }, undefined, createRng(3))
    expect(mail.output).toMatch(/^From: [a-z]+@[a-z]+\.example\nSubject: /)
    expect(mail.context.subject).toBeTruthy()
    expect(triggerPayload({ type: 'manual', label: 'Manual' }, undefined, createRng(1), { userName: 'Morgan Lee' }).detail).toBe('Started manually by Morgan Lee')
    expect(triggerPayload({ type: 'manual', label: 'Manual' }, undefined, createRng(1), { override: 'Weekly check' }).detail).toBe('Weekly check')
  })

  it('shortens delays for simulation', () => {
    expect(delayDuration(n('d', { hours: 2 }, 'delay'))).toEqual({ label: '2 hour(s)', simulatedMs: 2500 })
    expect(delayDuration(n('d', { duration: '30s' }, 'delay'))).toEqual({ label: '30 second(s)', simulatedMs: 800 })
  })
})

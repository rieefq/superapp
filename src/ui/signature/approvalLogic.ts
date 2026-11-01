import type { Agent, Approval, Capability, CapabilityGrant, RiskLevel } from '@/core/types'
import { formatHm } from './format'
import { lowerFirst, startsWithVerb, toBase } from './tense'

/** ApprovalCard logic (docs/DESIGN.md §5.4.9), pure. */

export const RISK_LABEL: Record<RiskLevel, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' }

/**
 * The headline in the product voice: `{Agent} wants to {verb phrase} {target}` (§8.3).
 * Titles already written that way, or not starting with a verb, are kept as they are.
 */
export function approvalHeadline(title: string, requesterName?: string): string {
  const t = title.trim()
  if (!requesterName) return t
  if (t.toLowerCase().startsWith(requesterName.toLowerCase())) return t
  if (!startsWithVerb(t)) return t
  return `${requesterName} wants to ${lowerFirst(toBase(t))}`
}

/** Previews that can be edited before approving. */
export const isEditablePreview = (approval: Pick<Approval, 'preview'>): boolean =>
  !!approval.preview && approval.preview.kind !== 'diff'

/** True for unified-diff text. */
export const isPatch = (text: string): boolean => /^(diff --git |--- |\+\+\+ |@@ )/m.test(text)

/**
 * The first `lines` body lines of a unified diff (file and hunk headers kept), for the mini
 * preview with "Show all". `hidden` counts the body lines left out.
 */
export function truncatePatch(patch: string, lines = 12): { patch: string; hidden: number } {
  const all = patch.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  const out: string[] = []
  let body = 0
  let hidden = 0
  let inHunk = false
  for (const line of all) {
    const header = /^(diff --git |index |--- |\+\+\+ )/.test(line)
    if (line.startsWith('@@')) {
      inHunk = true
      if (body < lines) out.push(line)
      continue
    }
    if (header || !inHunk) {
      if (body < lines) out.push(line)
      continue
    }
    if (body < lines) {
      out.push(line)
      body++
    } else hidden++
  }
  return { patch: `${out.join('\n')}\n`, hidden }
}

/** The stamp after resolution: "Approved by you · 10:42", "Denied · Not this week", "Expired · 10:42". */
export function stampText(approval: Pick<Approval, 'status' | 'resolvedAt' | 'resolution'>): string {
  const at = approval.resolvedAt !== undefined ? formatHm(approval.resolvedAt) : undefined
  const note = approval.resolution?.note?.trim()
  switch (approval.status) {
    case 'approved':
      return ['Approved by you', at, note].filter(Boolean).join(' · ')
    case 'rejected':
      return note ? `Denied · ${note}` : ['Denied by you', at].filter(Boolean).join(' · ')
    case 'expired':
      return ['Expired', at].filter(Boolean).join(' · ')
    default:
      return 'Waiting for you'
  }
}

/** Grants after "Always allow {agent} to {capability}": every grant for it becomes allow (or one is added). */
export function grantsWithAlwaysAllow(agent: Pick<Agent, 'capabilities'>, capability: Capability): CapabilityGrant[] {
  const has = agent.capabilities.some((g) => g.capability === capability)
  const next = agent.capabilities.map((g) => (g.capability === capability ? { ...g, mode: 'allow' as const, always: true } : { ...g }))
  return has ? next : [...next, { capability, mode: 'allow', always: true }]
}

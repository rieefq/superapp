import type { ActorRef, ID } from '@/core/types'
import { KNOWLEDGE, PROJECT, THREAD } from '../../ids'
import type { RunSpec } from '../runKit'
import type { Timeline } from '../timeline'
import { ref } from '../util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }

interface ChatTurn {
  thread: ID
  title: string
  projectId: ID | null
  at: number
  model: 'sim-deep' | 'sim-swift'
  /** Knowledge retrieved for the answer (empty = no retrieval step). */
  retrieved: ID[]
  answer: string
  tokens: number
}

/**
 * One chat run per assistant turn that matters for analytics. The messages themselves
 * belong to the threads (content part); these runs carry model usage and retrieval traces.
 */
export function chatRunSpecs(tl: Timeline): RunSpec[] {
  const { wd } = tl.clock
  const turns: ChatTurn[] = [
    {
      thread: THREAD.tokens, title: 'Naming our design tokens', projectId: PROJECT.atlas, at: wd(14, 15, 30), model: 'sim-swift',
      retrieved: [KNOWLEDGE.designSystems], tokens: 5_200,
      answer: 'Proposed a three-tier scheme (primitive → semantic → component) with names that describe intent, not color.',
    },
    {
      thread: THREAD.portbase, title: 'How does Portbase position against us?', projectId: PROJECT.landscape, at: wd(17, 10, 45), model: 'sim-deep',
      retrieved: [KNOWLEDGE.marketSizing, KNOWLEDGE.freightlyNotes], tokens: 11_800,
      answer: 'Summarized what we know and suggested a proper investigation into Portbase’s pricing and positioning.',
    },
    {
      thread: THREAD.triage, title: 'Designing a support triage rubric', projectId: PROJECT.ops, at: wd(13, 14, 20), model: 'sim-deep',
      retrieved: [KNOWLEDGE.slaPolicy], tokens: 9_400,
      answer: 'Drafted four priority levels with definitions tied to SLA tiers and suggested letting Sentinel test them on real tickets.',
    },
    {
      thread: THREAD.retro, title: 'Sprint 14 retro synthesis', projectId: PROJECT.atlas, at: wd(10, 9, 20), model: 'sim-swift',
      retrieved: [KNOWLEDGE.codeReview], tokens: 7_100,
      answer: 'Grouped the retro notes into keep, change and try, with an owner proposed for each change.',
    },
    {
      thread: THREAD.launchPlan, title: 'Launch plan outline', projectId: PROJECT.lumen, at: wd(9, 10, 0), model: 'sim-swift',
      retrieved: [KNOWLEDGE.launchChecklist, KNOWLEDGE.messagingHouse], tokens: 8_300,
      answer: 'Outlined the launch in four phases (beta wrap-up, announce, enable sales, measure) mapped to the checklist.',
    },
    {
      thread: THREAD.heroCopy, title: 'Hero copy variations', projectId: PROJECT.lumen, at: wd(8, 16, 40), model: 'sim-swift',
      retrieved: [KNOWLEDGE.brandVoice, KNOWLEDGE.messagingHouse], tokens: 4_600,
      answer: 'Compared the six variations against the messaging house and recommended two for testing.',
    },
    {
      thread: THREAD.incident, title: 'Postmortem: checkout latency spike', projectId: PROJECT.ops, at: wd(7, 10, 30), model: 'sim-deep',
      retrieved: [KNOWLEDGE.incidentLatency], tokens: 13_900,
      answer: 'Turned the incident report into a blameless postmortem: timeline, contributing factors, and five follow-ups with owners.',
    },
    {
      thread: THREAD.pricing, title: 'Pricing tiers for Atlas Lumen', projectId: PROJECT.lumen, at: wd(6, 13, 15), model: 'sim-deep',
      retrieved: [KNOWLEDGE.pricingMemo, KNOWLEDGE.lumenPrd, KNOWLEDGE.csvAccounts], tokens: 16_400,
      answer: 'Laid out seat-based, usage-based and hybrid options with the trade-offs for our top accounts.',
    },
    {
      thread: THREAD.hiring, title: 'Interview loop for a senior frontend engineer', projectId: null, at: wd(5, 12, 10), model: 'sim-swift',
      retrieved: [KNOWLEDGE.onboarding, KNOWLEDGE.codeReview], tokens: 6_800,
      answer: 'Proposed a four-stage loop with a take-home that mirrors real portal work and a structured scorecard.',
    },
    {
      thread: THREAD.stripeRisks, title: 'Stripe migration risks', projectId: PROJECT.atlas, at: wd(4, 11, 5), model: 'sim-deep',
      retrieved: [KNOWLEDGE.stripePlan], tokens: 14_700,
      answer: 'Ranked the migration risks: double billing during cutover, currency mismatches and invoice numbering gaps, each with a mitigation.',
    },
    {
      thread: THREAD.ssoBug, title: 'Session expiry after SSO login', projectId: PROJECT.atlas, at: wd(3, 16, 10), model: 'sim-deep',
      retrieved: [KNOWLEDGE.adrSessions], tokens: 12_300,
      answer: 'Likely cause: the refresh timer reuses the token lifetime from login; refreshed tokens from the IdP live shorter. Suggested handing it to Forge.',
    },
    {
      thread: THREAD.okrs, title: 'Drafting Q1 OKRs', projectId: null, at: wd(2, 17, 5), model: 'sim-deep',
      retrieved: [KNOWLEDGE.okrsDraft, KNOWLEDGE.lumenPrd], tokens: 10_900,
      answer: 'Tightened the draft to three objectives with measurable key results and flagged two that were really tasks.',
    },
    {
      thread: THREAD.agentsReading, title: 'Notes on agent reliability patterns', projectId: PROJECT.fieldNotes, at: tl.saturday + 75 * 60_000,
      model: 'sim-swift', retrieved: [KNOWLEDGE.agentPatterns], tokens: 5_900,
      answer: 'Summarized the reading into five patterns: explicit plans, small tool surfaces, approvals for side effects, idempotent steps, and evals.',
    },
  ]

  return turns.map((t, i) => {
    const retrievalTokens = 600 + t.retrieved.length * 350
    return {
      id: `run_seed_chat_${String(i + 1).padStart(2, '0')}`,
      kind: 'chat',
      title: t.title,
      status: 'succeeded',
      at: t.at,
      projectId: t.projectId,
      origin: ref('thread', t.thread),
      initiator: ME,
      modelId: t.model,
      summary: t.answer,
      steps: [
        {
          kind: 'read',
          title: `Retrieved ${t.retrieved.length} knowledge ${t.retrieved.length === 1 ? 'item' : 'items'}`,
          tool: 'knowledge.search',
          capability: 'knowledge.read',
          refs: t.retrieved.map((id) => ref('knowledge', id)),
          ms: 400 + t.retrieved.length * 150,
          tokens: retrievalTokens,
        },
        { kind: 'write', title: 'Answered', output: t.answer, ms: Math.round(t.tokens * 0.45), tokens: t.tokens - retrievalTokens },
      ],
    }
  })
}

import type { ActorRef } from '@/core/types'
import { AGENT, INVESTIGATION, KNOWLEDGE, PROJECT } from '../../ids'
import type { RunSpec } from '../runKit'
import type { Timeline } from '../timeline'
import { ref } from '../util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const web = { capability: 'web.search' as const, integrationId: 'web-search', tool: 'web.search' }
const browse = { capability: 'web.browse' as const, integrationId: 'web-search', tool: 'web.browse' }

/** Completed research runs (the active pricing investigation is in inflight.ts). */
export function researchRunSpecs(tl: Timeline): RunSpec[] {
  const scout = { kind: 'research' as const, agentId: AGENT.scout, modelId: 'sim-deep', initiator: ME, projectId: PROJECT.landscape }
  return [
    {
      ...scout,
      id: 'run_seed_research_tidewell_1',
      title: 'Tidewell positioning & pricing',
      status: 'succeeded',
      at: tl.tidewell1,
      origin: ref('investigation', INVESTIGATION.tidewell),
      summary:
        'Tidewell sells annual, per-site contracts to enterprise shippers. Strongest on customs workflows; weakest on invoicing and self-serve onboarding. 6 findings with sources, report drafted for review.',
      steps: [
        {
          kind: 'plan', title: 'Planned 4 angles', ms: 3_400, tokens: 2_100,
          output: '1. Who Tidewell sells to and how they describe the problem\n2. Pricing and packaging, public and reported\n3. Product gaps versus Atlas: tracking, invoicing, analytics\n4. Where customers say Tidewell wins and loses',
        },
        { kind: 'search', title: 'Searched: Tidewell pricing tiers', ...web, input: 'Tidewell pricing plans freight visibility', output: '18 results · kept 6', ms: 5_200, tokens: 3_400 },
        { kind: 'search', title: 'Searched: Tidewell customer reviews', ...web, input: 'Tidewell reviews logistics operations team', output: '22 results · kept 5', ms: 4_900, tokens: 3_100 },
        {
          kind: 'browse', title: 'Read 9 pages', ...browse, ms: 41_000, tokens: 23_800,
          output: 'Pricing page, two case studies, six months of changelog, three review-site summaries and an analyst note. Two vendor listicles discarded.',
        },
        {
          kind: 'read', title: 'Compared with our own notes', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [ref('knowledge', KNOWLEDGE.freightlyNotes), ref('knowledge', KNOWLEDGE.marketSizing)], ms: 2_400, tokens: 5_300,
        },
        {
          kind: 'think', title: 'Cross-checked claims', ms: 8_200, tokens: 6_400,
          output: 'Two sources disagree on Tidewell’s enterprise floor price; both kept, marked low confidence.',
        },
        { kind: 'write', title: 'Wrote 6 findings with sources', ms: 7_100, tokens: 7_300 },
        { kind: 'write', title: 'Drafted the report', ms: 10_400, tokens: 9_900 },
      ],
    },
    {
      ...scout,
      id: 'run_seed_research_tidewell_2',
      title: 'Tidewell: enterprise pricing & contract terms (follow-up)',
      status: 'succeeded',
      at: tl.tidewell2,
      origin: ref('investigation', INVESTIGATION.tidewell),
      outputs: [ref('knowledge', KNOWLEDGE.tidewellTeardown)],
      summary: 'Added contract terms (annual, per site, implementation fee) and resolved the floor-price conflict. Report saved to Knowledge as “Competitor teardown: Tidewell”.',
      steps: [
        { kind: 'plan', title: 'Focused on contract terms and the price conflict', ms: 2_100, tokens: 1_500 },
        { kind: 'search', title: 'Searched: Tidewell enterprise contract terms', ...web, output: '11 results · kept 3', ms: 4_400, tokens: 2_900 },
        { kind: 'browse', title: 'Read 3 pages', ...browse, ms: 17_000, tokens: 11_200 },
        {
          kind: 'think', title: 'Resolved the floor-price conflict', ms: 5_600, tokens: 4_800,
          output: 'The lower figure predates the per-site model; the newer source wins. Confidence raised to medium.',
        },
        { kind: 'write', title: 'Updated the report and findings', ms: 7_900, tokens: 7_200 },
        {
          kind: 'write', title: 'Saved the report to Knowledge', capability: 'knowledge.write',
          refs: [ref('knowledge', KNOWLEDGE.tidewellTeardown)], ms: 900, tokens: 600,
        },
      ],
    },
    {
      ...scout,
      id: 'run_seed_research_churn_1',
      title: 'Why do logistics customers churn?',
      status: 'succeeded',
      at: tl.churn1,
      origin: ref('investigation', INVESTIGATION.churn),
      summary: 'Findings and a draft report are ready for review. Our interview synthesis and external sources mostly agree; two findings rest on a single source and are marked low confidence.',
      steps: [
        { kind: 'plan', title: 'Planned 3 angles', ms: 2_900, tokens: 1_900, output: '1. What our churned customers told us\n2. What the market says about portal churn\n3. Early warning signals we could measure' },
        {
          kind: 'read', title: 'Read our churn interviews and customer calls', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [ref('knowledge', KNOWLEDGE.churnInterviews), ref('knowledge', KNOWLEDGE.meridianCall), ref('knowledge', KNOWLEDGE.csvAccounts)],
          ms: 3_600, tokens: 14_200,
        },
        { kind: 'search', title: 'Searched: B2B logistics software churn drivers', ...web, output: '19 results · kept 5', ms: 5_300, tokens: 3_700 },
        { kind: 'browse', title: 'Read 5 sources', ...browse, ms: 24_000, tokens: 16_900 },
        { kind: 'think', title: 'Compared interviews with external sources', ms: 7_600, tokens: 6_900 },
        { kind: 'write', title: 'Wrote findings with confidence ratings', ms: 6_800, tokens: 6_400 },
        { kind: 'write', title: 'Drafted the report for review', ms: 9_300, tokens: 8_700 },
      ],
    },
  ]
}

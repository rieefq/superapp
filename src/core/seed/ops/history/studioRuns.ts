import type { ActorRef } from '@/core/types'
import { AGENT, BOARD, KNOWLEDGE, PROJECT } from '../../ids'
import type { RunSpec } from '../runKit'
import type { Timeline } from '../timeline'
import { ref } from '../util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const gen = { tool: 'image-gen', capability: 'media.generate' as const, integrationId: 'image-gen' }
const brand = [ref('knowledge', KNOWLEDGE.brandVoice), ref('knowledge', KNOWLEDGE.messagingHouse)]

/** Studio generations by Muse. Previews are procedural (simulated), never model-generated images. */
export function studioRunSpecs(tl: Timeline): RunSpec[] {
  const muse = { kind: 'studio' as const, agentId: AGENT.muse, modelId: 'sim-swift', initiator: ME, projectId: PROJECT.lumen }
  return [
    {
      ...muse,
      id: 'run_seed_studio_gradients',
      title: 'Lumen gradient explorations',
      status: 'succeeded',
      at: tl.studioGradients,
      origin: ref('board', BOARD.brand),
      summary: 'Eight gradient studies on Brand explorations. The deep teal to amber set reads best on dark dashboards.',
      steps: [
        { kind: 'read', title: 'Read the brand voice guide', tool: 'knowledge.search', capability: 'knowledge.read', refs: [ref('knowledge', KNOWLEDGE.brandVoice)], ms: 1_500, tokens: 3_100 },
        { kind: 'plan', title: 'Planned 4 palettes × 2 compositions', ms: 2_200, tokens: 1_400 },
        { kind: 'generate', title: 'Generated 8 gradient studies', ...gen, output: '8 procedural previews (simulated)', ms: 18_000, tokens: 5_200 },
        { kind: 'artifact', title: 'Saved 8 variants to Brand explorations', refs: [ref('board', BOARD.brand)], ms: 600 },
      ],
    },
    {
      ...muse,
      id: 'run_seed_studio_isometric',
      title: 'Isometric freight yard illustrations',
      status: 'cancelled',
      at: tl.studioIsometric,
      origin: ref('board', BOARD.brand),
      error: 'Cancelled by you: too playful for the brand voice.',
      steps: [
        { kind: 'read', title: 'Read the brand voice guide', tool: 'knowledge.search', capability: 'knowledge.read', refs: [ref('knowledge', KNOWLEDGE.brandVoice)], ms: 1_300, tokens: 3_000 },
        { kind: 'plan', title: 'Planned 6 isometric scenes', ms: 2_400, tokens: 1_600 },
        { kind: 'generate', title: 'Generated 2 of 6 illustrations', ...gen, ms: 7_400, tokens: 2_100 },
      ],
    },
    {
      ...muse,
      id: 'run_seed_studio_keyart',
      title: 'Hero key art: four directions',
      status: 'succeeded',
      at: tl.studioKeyArt,
      origin: ref('board', BOARD.launch),
      summary: 'Four key-art directions on Lumen launch visuals, each tied to one message pillar. Pick one to take into the hero video.',
      steps: [
        { kind: 'read', title: 'Read the messaging house and brand voice', tool: 'knowledge.search', capability: 'knowledge.read', refs: brand, ms: 1_800, tokens: 5_600 },
        {
          kind: 'plan', title: 'Proposed four directions', ms: 3_900, tokens: 3_200,
          output: [
            '1. Night terminal: cranes in the dark, one lane lit up.',
            '2. Dispatch desk: the Lumen lane view on a real screen at 6 a.m.',
            '3. Light trails: shipment paths drawn over a muted map.',
            '4. Still life: one container, its whole journey annotated.',
          ].join('\n'),
        },
        { kind: 'generate', title: 'Generated directions 1–2', ...gen, output: '6 procedural previews (simulated)', ms: 14_000, tokens: 3_900 },
        { kind: 'generate', title: 'Generated directions 3–4', ...gen, output: '6 procedural previews (simulated)', ms: 13_500, tokens: 3_800 },
        { kind: 'artifact', title: 'Saved 4 directions to Lumen launch visuals', refs: [ref('board', BOARD.launch)], ms: 700 },
      ],
    },
    {
      ...muse,
      id: 'run_seed_studio_backgrounds',
      title: 'Product screenshot backgrounds',
      status: 'succeeded',
      at: tl.studioBackgrounds,
      summary: 'Six quiet backgrounds for product screenshots in the launch deck and docs.',
      steps: [
        { kind: 'plan', title: 'Matched backgrounds to the dark and light product themes', ms: 1_900, tokens: 2_000 },
        { kind: 'generate', title: 'Generated 6 backgrounds', ...gen, output: '6 procedural previews (simulated)', ms: 12_000, tokens: 3_300 },
        { kind: 'artifact', title: 'Saved 6 backgrounds to Studio', ms: 500 },
      ],
    },
    {
      ...muse,
      id: 'run_seed_studio_social',
      title: 'Social cutdowns: LinkedIn, X and Instagram Stories',
      status: 'succeeded',
      at: tl.studioSocial,
      origin: ref('board', BOARD.social),
      summary: 'Nine cutdowns (three formats × three messages) with captions and alt text, saved to Social cutdowns.',
      steps: [
        { kind: 'read', title: 'Read the launch checklist', tool: 'knowledge.search', capability: 'knowledge.read', refs: [ref('knowledge', KNOWLEDGE.launchChecklist)], ms: 1_400, tokens: 3_800 },
        { kind: 'generate', title: 'Recomposed key art for 3 formats', ...gen, output: '1200×628 · 1080×1080 · 1080×1920', ms: 15_000, tokens: 4_100 },
        { kind: 'write', title: 'Wrote captions and alt text', ms: 4_200, tokens: 3_700 },
        { kind: 'artifact', title: 'Saved 9 cutdowns to Social cutdowns', refs: [ref('board', BOARD.social)], ms: 600 },
      ],
    },
  ]
}

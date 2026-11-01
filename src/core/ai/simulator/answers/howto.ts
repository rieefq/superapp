import type { Block, ComposeContext, ComposedParts } from '../types'
import { bullets, heading, numbered } from '../layout'
import { capitalize } from '../text'
import { closingOffer, lead, noSourcesBlock, sourcesBlock, take } from './common'

const PITFALLS: string[] = [
  'Changing several things at once — small, reversible steps are far easier to debug.',
  "Settings that only live in one person's head; write them down as you go.",
  'Skipping the rollback plan because the change “looks simple”.',
  'Trying it for the first time on something people depend on.',
  'Declaring victory before checking the edge cases.',
]

export function composeHowto(ctx: ComposeContext): ComposedParts {
  const { rng, subject, evidence, depth } = ctx
  const deep = depth === 'deep'
  const vp = subject.kind === 'action' ? subject.vp : undefined
  const blocks: Block[] = []

  blocks.push({
    md: vp
      ? rng.pick([
          `Here's a practical path to ${vp}.`,
          `Here's how I'd approach ${subject.np}, step by step.`,
          `A reliable way to ${vp} is to work in small, verifiable steps:`,
        ])
      : rng.pick(["Here's a step-by-step approach.", 'A reliable way to tackle this is in small, verifiable steps:']),
    priority: Infinity,
  })

  const steps = [
    lead('Define done', `write one sentence describing what success looks like${vp ? ` once you ${vp}` : ''}, and who needs to sign off.`),
    lead('Gather prerequisites', 'list the access, tools and decisions you need up front; missing access tends to stall work midway.'),
    lead('Start somewhere safe', 'try it first in a low-stakes place — a test account, a branch or a draft — before touching anything people rely on.'),
    lead(
      vp ? capitalize(vp.split(' ').slice(0, 6).join(' ')) : 'Make the core change',
      'do it in one focused pass and note each setting or decision so it is reproducible.',
    ),
    lead('Verify', 'check the result against your definition of done, including one edge case and one failure path.'),
    lead('Roll out and document', 'share what changed, where it lives and how to undo it.'),
  ]
  if (deep) steps.push(lead('Review after a week', 'note anything surprising and fold it back into the documentation.'))
  blocks.push({ md: heading('Steps') + numbered(steps), priority: Infinity })

  const sources = sourcesBlock(ctx, evidence.slice(0, deep ? 4 : 2), 'From your docs')
  if (sources) blocks.push(sources)

  blocks.push({ md: heading('Watch out for') + bullets(take(ctx, PITFALLS, deep ? 3 : 2)), priority: 2 })
  const noSources = noSourcesBlock(ctx, 'a general approach')
  if (noSources) blocks.push({ ...noSources, priority: 2 })
  blocks.push(
    closingOffer(ctx, [
      'Want me to turn these steps into tasks{project}?',
      'I can turn this into a checklist{project} if that helps.',
      'If you share the specifics of your setup, I can tailor these steps.',
    ]),
  )

  return {
    blocks,
    extras: [
      {
        md: heading('Done when') + bullets(['The outcome matches your one-sentence definition.', 'Someone else could repeat it from your notes.', 'You know how to undo it.']),
        priority: 1,
      },
    ],
    approach: {
      format: 'a numbered sequence of steps',
      structure: 'go from defining done to verifying and documenting, with pitfalls at the end',
    },
  }
}

import type { Block, ComposeContext, ComposedParts } from '../types'
import { recurringTheme } from '../evidence'
import { bullets, heading, numbered } from '../layout'
import { closingOffer, lead, noSourcesBlock, sourcesBlock, take, topicOf } from './common'

const THING_LENSES = (t: string): string[] => [
  lead('Purpose', `what problem ${t} solves, and for whom.`),
  lead('Mechanics', 'the moving parts and how they interact.'),
  lead('Trade-offs', 'what you give up to get the benefits.'),
  lead('Failure modes', 'where it tends to break down in practice.'),
  lead('Signals', "what you'd observe if it's working, and what you'd see if it isn't."),
  lead('Context', 'which of your constraints (scale, team, timeline) would change the answer.'),
  lead('Alternatives', 'what people reach for instead, and the reason they do.'),
]

const QUESTION_LENSES: string[] = [
  lead('Candidate explanations', 'list every plausible cause before committing to one.'),
  lead('Evidence', 'what data would tell those explanations apart.'),
  lead('Timing', 'what changed shortly before the pattern started.'),
  lead('Scope', 'whether it affects everyone or one segment, region or plan.'),
  lead('Counter-check', 'what would have to be true if your favorite explanation were wrong.'),
  lead('Decision', "what you'd do differently depending on the answer."),
]

const NEXT_STEPS: string[] = [
  'Write down the one decision this needs to inform — it keeps the analysis focused.',
  'Test the framing against a real example from your own work.',
  'Note the assumption you are least sure about and find the cheapest way to check it.',
  'Ask me to turn this into a one-page brief or a checklist.',
]

const QUESTIONS_WORTH_ASKING: string[] = [
  'What would “good” look like here, in one sentence?',
  'Who else has a stake in the answer, and what do they need from it?',
  "What's the cheapest way to test the riskiest assumption?",
  'What would change your mind?',
]

export function composeExplain(ctx: ComposeContext): ComposedParts {
  const { rng, subject, evidence, depth } = ctx
  const deep = depth === 'deep'
  const t = topicOf(ctx)
  const hasEvidence = evidence.length > 0
  const blocks: Block[] = []

  const opener =
    subject.kind === 'question'
      ? rng.pick([
          "Here's how I'd reason through this.",
          "Let's work through it methodically — there are a few angles worth separating.",
          'There are a few distinct angles here; separating them makes the answer clearer.',
        ])
      : hasEvidence
        ? rng.pick([
            `Your workspace has material on this, so I'll start with what it says about ${t}.`,
            `Here's what your documents say about ${t}, and how I'd frame it.`,
          ])
        : rng.pick([`Here's how I'd think about ${t}.`, `Let's break ${t} down.`, `Here's a structured way to look at ${t}.`])
  blocks.push({ md: opener, priority: Infinity })

  const sources = sourcesBlock(ctx, evidence.slice(0, deep ? 4 : 3))
  if (sources) blocks.push(sources)
  const theme = recurringTheme(evidence, ctx.text)
  if (theme) {
    blocks.push({
      md: `Across these passages, **${theme}** comes up more than once — that's probably the part worth settling first.`,
      priority: 2,
    })
  }

  const lenses = subject.kind === 'question' ? QUESTION_LENSES : THING_LENSES(t)
  blocks.push({
    md: heading(hasEvidence ? "How I'd frame it" : 'A useful way to frame it') + bullets(take(ctx, lenses, deep ? 5 : 3)),
    priority: hasEvidence ? 2 : Infinity,
  })

  const noSources = noSourcesBlock(ctx)
  if (noSources) blocks.push(noSources)

  blocks.push({ md: heading('Next steps') + numbered(take(ctx, NEXT_STEPS, deep ? 3 : 2)), priority: 3 })
  blocks.push(
    closingOffer(ctx, [
      'If it helps, I can turn this into a short brief{project}.',
      'Want me to go deeper on any one of these angles?',
      'Tell me which part matters most and I’ll expand on it.',
    ]),
  )

  return {
    blocks,
    extras: [{ md: heading('Questions worth asking') + bullets(take(ctx, QUESTIONS_WORTH_ASKING, 3)), priority: 1 }],
    approach: {
      format: subject.kind === 'question' ? 'a set of angles to reason through' : 'a short framing plus the key ideas',
      structure: hasEvidence
        ? 'lead with what the documents say, then add a frame and next steps'
        : 'offer a frame and concrete next steps rather than claims',
    },
  }
}

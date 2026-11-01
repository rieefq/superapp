import type { Block, ComposeContext, ComposedParts } from '../types'
import { bullets, heading, table } from '../layout'
import { extractDuration } from '../shapes'
import { gerund, stripTrailingPunctuation } from '../text'
import { relevanceStems } from '../evidence'
import { closingOffer, noSourcesBlock, sourcesBlock, take, topicOf } from './common'

interface Phase {
  name: string
  activities: string[]
  exit: string
}

type PlanDomain = 'launch' | 'learning' | 'engineering' | 'generic'

function domainOf(text: string): PlanDomain {
  if (/\b(launch|campaign|go-to-market|gtm|announce|marketing|release)\b/i.test(text)) return 'launch'
  if (/\b(learn|learning|study|course|curriculum|skill|practice|onboard(?:ing)?)\b/i.test(text)) return 'learning'
  if (/\b(migrat|refactor|rebuild|rewrite|deploy|infrastructure|platform|api|integration|system|auth|sso|billing)\w*/i.test(text)) return 'engineering'
  return 'generic'
}

const PHASES: Record<PlanDomain, (t: string) => Phase[]> = {
  launch: (t) => [
    { name: 'Prepare', activities: [`Agree on the one-sentence message for ${t}.`, 'Name an owner for each channel and asset.', 'List the audiences and what each needs to hear.'], exit: 'Message, owners and audiences signed off.' },
    { name: 'Build momentum', activities: ['Draft the core assets: page, email, announcement, FAQ.', 'Brief internal teams so support and sales can answer questions.', 'Line up early users or partners for quotes and feedback.'], exit: 'Assets reviewed; internal teams briefed.' },
    { name: 'Launch', activities: ['Ship in a deliberate order: internal, existing customers, then public.', 'Watch the agreed signals closely in the first 48 hours.', 'Keep a running log of questions and issues.'], exit: 'Live, with no unresolved launch blockers.' },
    { name: 'Follow through', activities: ['Share early results with the team.', 'Turn recurring questions into docs or product fixes.', 'Hold a short retro and capture what to repeat.'], exit: 'Retro done; follow-ups assigned.' },
  ],
  learning: (t) => [
    { name: 'Foundations', activities: [`Pick one primary resource for ${t} and stick with it.`, 'Set a fixed weekly time block.', 'Write down why you are learning this and what you want to build.'], exit: 'You can explain the core concepts in your own words.' },
    { name: 'Guided practice', activities: ['Work through small exercises daily.', 'Keep a notes file of mistakes and fixes.', 'Re-implement something you already know in the new skill.'], exit: 'You complete small exercises without looking things up constantly.' },
    { name: 'Build something real', activities: ['Choose a small project with a clear finish line.', 'Ask someone experienced to review it.', 'Write a short post about what surprised you.'], exit: 'A finished project someone else has reviewed.' },
    { name: 'Deepen', activities: ['Study one advanced topic that your project exposed.', 'Contribute a fix or note to a shared resource.', 'Plan the next project one step harder.'], exit: 'A clear next goal and a habit that sticks.' },
  ],
  engineering: (t) => [
    { name: 'Discover', activities: [`Map the current state of ${t}: owners, dependencies, known issues.`, 'Agree on success criteria and the metrics that prove them.', 'Identify the riskiest assumption and how to test it.'], exit: 'Written scope, success criteria and risks.' },
    { name: 'Design', activities: ['Write a short design doc covering options and the chosen approach.', 'Plan the rollout and the rollback before building.', 'Get review from the people who will operate it.'], exit: 'Design reviewed; rollout and rollback agreed.' },
    { name: 'Build in slices', activities: ['Deliver in small, independently shippable pieces.', 'Put new behavior behind a flag where possible.', 'Test each slice against the success criteria.'], exit: 'All slices shipped behind flags and verified.' },
    { name: 'Cut over and clean up', activities: ['Roll out gradually and watch the agreed metrics.', 'Remove old paths and flags once stable.', 'Document what changed and update runbooks.'], exit: 'Fully rolled out; old paths removed; docs updated.' },
  ],
  generic: (t) => [
    { name: 'Align', activities: [`Write down the outcome ${t} should produce, in one sentence.`, 'Agree who decides and who needs to be consulted.', 'List constraints: budget, dates, people.'], exit: 'Outcome, decision-maker and constraints agreed.' },
    { name: 'Plan', activities: ['Break the work into milestones of one to two weeks.', 'Assign an owner to each milestone.', 'Identify the riskiest piece and schedule it early.'], exit: 'Milestones with owners and dates.' },
    { name: 'Execute', activities: ['Work in short cycles with a weekly check-in.', 'Track progress where everyone can see it.', 'Escalate blockers within a day, not a week.'], exit: 'Milestones delivered or consciously re-planned.' },
    { name: 'Review', activities: ['Compare the result with the original outcome.', 'Capture lessons while they are fresh.', 'Decide what to keep doing, stop and start.'], exit: 'Retro written; next steps assigned.' },
  ],
}

function phaseDurations(total: { amount: number; unit: string } | undefined, count: number): string[] {
  if (!total) return Array.from({ length: count }, () => '')
  const weights = count === 3 ? [0.25, 0.5, 0.25] : [0.2, 0.25, 0.35, 0.2]
  const unit = total.unit
  let start = 1
  return weights.map((w, i) => {
    const len = i === count - 1 ? Math.max(1, total.amount - start + 1) : Math.max(1, Math.round(total.amount * w))
    const end = Math.min(total.amount, start + len - 1)
    const label = end > start ? `${unit}s ${start}–${end}` : `${unit} ${start}`
    start = end + 1
    return start > total.amount + 1 ? '' : ` (${label.charAt(0).toUpperCase()}${label.slice(1)})`
  })
}

/** "a launch plan for Lumen" → "Lumen"; "a plan to migrate billing" → "migrating billing". */
export function planTopic(np: string): string {
  let t = np.trim()
  const m = /^(?:(?:a|an|the|my|your)\s+)?(?:[\w-]+\s+){0,3}?(?:plan|roadmap|timeline|strategy|schedule|outline)\s+(for|to|on)\s+(.+)$/i.exec(t)
  if (m) t = m[1].toLowerCase() === 'to' ? gerund(m[2]) : m[2]
  else t = t.replace(/(?:\s+(?:learning|launch|migration|project|rollout|go-to-market))?\s+(?:plan|roadmap|timeline|strategy|schedule|outline)$/i, '')
  t = t.replace(/^(?:(a|an|the)\s+)?(?:\d+|one|two|three|four|six|eight|ten|twelve)[- ](?:day|week|month|quarter)s?\s+/i, (_m, article?: string) => (article ? 'the ' : ''))
  t = t.replace(/^(?:a|an)\s+/i, '').trim()
  return t || np
}

export function composePlan(ctx: ComposeContext): ComposedParts {
  const { rng, depth, evidence, facts } = ctx
  const deep = depth === 'deep'
  const t = planTopic(topicOf(ctx, 'the plan'))
  const domain = domainOf(`${ctx.text} ${facts.projectGoal ?? ''}`)
  const all = PHASES[domain](t)
  const phases = deep ? all : [all[0], all[1], all[2]]
  const durations = phaseDurations(extractDuration(ctx.text), phases.length)
  const blocks: Block[] = []

  const kind = domain === 'learning' ? 'learning plan' : domain === 'launch' ? 'launch plan' : 'plan'
  blocks.push({
    md: rng.pick([`Here's a phased ${kind} for ${t}.`, `Here's how I'd sequence ${t}, in ${phases.length} phases.`, `A ${phases.length}-phase ${kind} for ${t}:`]),
    priority: Infinity,
  })
  const goal = facts.projectGoal
  if (goal && [...relevanceStems(goal)].some((s) => relevanceStems(ctx.text).has(s))) {
    blocks.push({ md: `It's anchored on the project goal: “${stripTrailingPunctuation(goal)}”.`, priority: 3 })
  }

  const phaseMd = phases.map((p, i) => {
    const acts = deep ? p.activities : p.activities.slice(0, 2)
    return `### Phase ${i + 1} — ${p.name}${durations[i] ?? ''}\n\n${bullets(acts)}\n\n*Exit criteria:* ${p.exit}`
  })
  blocks.push({ md: phaseMd.join('\n\n'), priority: Infinity })

  const sources = sourcesBlock(ctx, evidence.slice(0, deep ? 3 : 2), 'Constraints from your docs')
  if (sources) blocks.push(sources)

  if (deep) {
    blocks.push({
      md:
        heading('Risks to watch') +
        table(
          ['Risk', 'Mitigation'],
          take(ctx, [
            ['Scope creep', 'Freeze scope per phase; new ideas go to a parking lot.'],
            ['Hidden dependencies', 'Name an owner for every dependency in phase 1.'],
            ['Slipping dates', 'Weekly check-in; re-plan early instead of late.'],
            ['Unclear ownership', 'One accountable owner per milestone.'],
          ], 3),
        ),
      priority: 2,
    })
  }
  const noSources = noSourcesBlock(ctx, 'a starting template')
  if (noSources) blocks.push({ ...noSources, priority: 2 })
  blocks.push(closingOffer(ctx, ['Want me to turn these phases into milestones and tasks{project}?', 'I can turn this into a project with milestones{project} if you like.']))

  return {
    blocks,
    extras: [
      { md: heading('First step this week') + bullets([phases[0].activities[0], 'Share the plan with the people it affects and ask what is missing.']), priority: 1 },
    ],
    approach: {
      format: `a ${phases.length}-phase plan with exit criteria`,
      structure: 'sequence the work so the riskiest decisions happen early, and give each phase a clear exit',
    },
  }
}

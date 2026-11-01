import type { KnowledgeItem } from '@/core/types'
import { COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import type { SeedCtx } from '../helpers'
import { MSG } from '../keys'
import { item } from './build'

export function notesKnowledge({ clock, at }: SeedCtx): KnowledgeItem[] {
  const { day } = clock
  return [
    item({
      id: KNOWLEDGE.agentPatterns,
      kind: 'note',
      title: 'Notes: reliable agent patterns',
      summary: 'Working principles for reliable AI agents: autonomy as a budget, gated side effects, idempotent tools, checkpoints, visible traces, confidence thresholds, own-data evals and spend limits.',
      tags: ['agents', 'reliability', 'ai', 'patterns'],
      collectionId: COLLECTION.notes,
      projectIds: [PROJECT.fieldNotes],
      source: { type: 'manual' },
      createdAt: day(24, 21, 15),
      updatedAt: at.saturday + 120 * 60_000,
      content: `
# Notes: reliable agent patterns

Collected while building the Sentinel, Forge and Herald workflows, from a few engineering write-ups, and from a lot of trial and error. These are my working principles, not settled truth.

## 1. Autonomy is a budget, not a setting
Agents earn autonomy per action, not per agent. Sentinel can label tickets on its own because a wrong label is cheap to fix; posting to Slack still asks, because a wrong alert at 2 a.m. is not. Keep tool surfaces small, too: give each agent the fewest tools that do the job. Sentinel has no tool that can email a customer.

## 2. Side effects need a gate
Reading is cheap; writing is where agents hurt you. Anything that sends, merges, pays or deletes should pause for approval until the agent has a track record on that exact action. The approval must show the exact payload (the message, the diff, the command). "Approve action?" is not a real approval.

## 3. Idempotency everywhere
Agents retry and networks fail mid-step. Every tool call that changes something needs a natural key (an email message-id, a pull request number, an invoice id) so that running it twice does nothing the second time. Sentinel creating two tasks for the same email thread was our first real agent bug.

## 4. Explicit plans and checkpoints
Plans should be data, a list of steps the agent writes down before acting, rather than one giant prompt. Long runs should persist after every step so that a crash or a page reload resumes the run instead of restarting it.

## 5. Make the work visible
Every step should record what it did, what it read, what it produced, how long it took and what it cost. If I cannot reconstruct why an agent did something from its trace, it should not be doing it unattended.

## 6. Confidence thresholds and graceful handoff
For classification work, ask for a confidence and route low-confidence cases to a person. A good handoff says what the agent tried and why it stopped.

## 7. Evaluate on your own data
Generic benchmarks did not predict how Sentinel would do on our tickets. Comparing its labels with Theo's on a week of real tickets did.

## 8. Budgets and kill switches
Set a monthly spend cap per agent, and make sure the pause button actually stops work that is already in flight.

## Anti-patterns I have seen
- "Autonomous" agents that keep no record of what they did.
- Approval fatigue: asking about everything trains people to click approve without reading.
- One mega-agent for everything instead of narrow roles with narrow permissions.

## Open questions
- How do we measure when an agent has earned more autonomy on an action?
- Who reviews agent work when the usual approver is on vacation?
`,
    }),

    item({
      id: KNOWLEDGE.designSystems,
      kind: 'note',
      title: 'Notes: design systems that scale',
      summary: 'Two-tier tokens (primitives and semantic roles), themes as mappings, component tokens only for multi-brand needs, and adoption through linting. Applied to Atlas dark mode.',
      tags: ['design-systems', 'tokens', 'frontend', 'notes'],
      collectionId: COLLECTION.notes,
      projectIds: [PROJECT.fieldNotes, PROJECT.atlas],
      source: { type: 'manual' },
      createdAt: day(33, 20, 40),
      updatedAt: day(16, 21, 10),
      content: `
# Notes: design systems that scale

Notes from a design-systems meetup talk, "Tokens all the way down" by Ines Calder, plus conversations with Sofia and Hana. The ideas below are in my own words.

## Key ideas
1. **Two tiers of tokens are enough for most products.** Primitives describe the palette (\`blue-500\`); semantic tokens describe roles (\`color.bg.surface\`, \`color.text.muted\`). Components consume only semantic tokens.
2. **Name by role, not by value.** A token called \`blue-500\` cannot become purple in dark mode without lying. A token called \`color.action.primary\` can.
3. **Themes are mappings, not new tokens.** Dark mode re-points semantic tokens at different primitives; components do not change at all.
4. **Component tokens are an escape hatch.** Add \`button.primary.bg\` only when a component must differ between brands or themes in a way the semantic layer cannot express, for example white-label portals.
5. **Adoption beats completeness.** A lint rule that flags primitives used inside components did more than any amount of documentation.
6. **Document decisions, not just tokens.** Why a contrast ratio or a spacing step was chosen matters more than the value itself.
7. **Measure it.** Track the share of components that use only semantic tokens and the number of one-off colors in the CSS.

## A naming grammar I like
\`{category}.{role}.{variant}.{state}\`, for example \`color.bg.surface-raised\`, \`color.text.muted\`, \`color.border.focus\` and \`color.action.primary.hover\`.

## How this applies to Atlas
- Sofia's audit found about 140 hard-coded hex values in the portal.
- Dark mode is coming, so the semantic layer has to come first.
- White-label portals for Enterprise customers would justify component tokens later, not now.
`,
    }),

    item({
      id: KNOWLEDGE.rustPlan,
      kind: 'note',
      title: 'Rust learning plan',
      summary: 'Six-week plan to learn Rust from a TypeScript background at about four hours a week, ending with a CLI log parser. Weeks 1–2 done, week 3 in progress.',
      tags: ['rust', 'learning', 'plan', 'typescript'],
      collectionId: COLLECTION.notes,
      projectIds: [PROJECT.fieldNotes],
      source: { type: 'chat', ref: { kind: 'message', id: MSG.rustSaved } },
      createdAt: day(16, 21, 2),
      updatedAt: day(2, 20, 30),
      content: `
# Rust learning plan (6 weeks, about 4 hours a week)

Goal: read and write small Rust programs comfortably, and finish a CLI tool by week 6.

| Week | Topic | Read | Practice | Bridge from TypeScript |
|---|---|---|---|---|
| 1 | Ownership and borrowing | Rust book, chapter 4 | Ownership exercises | Every value has one owner; \`&\` is a read-only view, \`&mut\` is exclusive access |
| 2 | Structs, enums, pattern matching | Chapters 5–6 | Model shipment statuses as an enum | Discriminated unions become enums plus \`match\` |
| 3 | Error handling | Chapter 9 | CLI log parser, part 1 | \`Result\` and \`Option\` instead of throw and undefined; the \`?\` operator |
| 4 | Traits and generics | Chapter 10 | Pluggable output formats for the parser | Interfaces become traits |
| 5 | Collections, iterators, closures | Chapters 8 and 13 | Aggregate the parsed logs | Array methods become iterator adapters |
| 6 | Project week | | Finish the CLI: parse, filter, summarize | |

## Rules for myself
- Type every example by hand; no copy and paste.
- When the borrow checker complains, write down why in one sentence before fixing it.
- Ask Sofia to review the final project.

## Progress
- [x] Week 1: ownership exercises
- [x] Week 2: shipment status enum with \`match\`
- [ ] Week 3: CLI log parser (in progress; error handling with \`Result\` works, output formatting next)
`,
    }),

    item({
      id: KNOWLEDGE.leadership,
      kind: 'note',
      title: 'Notes: managing through ambiguity',
      summary: 'Reflections on leading through uncertainty: separate decisions from information, treat one-way doors carefully, name owners and dates, and write down what we know versus assume.',
      tags: ['leadership', 'management', 'decision-making', 'reflection'],
      collectionId: COLLECTION.notes,
      projectIds: [PROJECT.fieldNotes],
      source: { type: 'manual' },
      createdAt: day(38, 19, 30),
      updatedAt: day(3, 21, 0),
      content: `
# Notes: managing through ambiguity

Reflections after a leadership workshop with Grace and the other leads, updated with examples from this quarter.

## The core idea
Ambiguity is not a problem to eliminate; handling it is the job. The team needs enough clarity to act, not certainty.

## What has helped this quarter
1. **Separate the decision from the information.** For Lumen pricing we wrote down which decision we had to make and by when (the pricing lock), then listed what would change our minds. An open-ended debate turned into a research plan.
2. **Treat one-way doors differently.** Most choices are reversible, so make them quickly. The invoice numbering scheme after the Stripe cutover is close to a one-way door for customers' accounts-payable systems, so it got far more care than a dashboard color.
3. **Name an owner and a date.** "We should figure out numbering" went nowhere for a week. Once it became "Owen decides, Daniel is consulted, before the cutover freeze", both options were on paper within two days.
4. **Write down what we know, what we assume and what we do not know.** It surfaces disagreements that are really about different assumptions.
5. **Over-communicate the why.** People can handle a changed plan; they struggle with an unexplained one.

## What I want to do differently
- Stop carrying decisions in my head; log each one in the weekly sync notes.
- Ask "what would have to be true?" before arguing about options.
- Give the team the context, not just the conclusion.

## A template I keep reusing
| What we know | What we assume | What we do not know | How we will find out |
|---|---|---|---|
| Beta partners use scorecards weekly | They would pay for them | Willingness to pay by tier | Pricing research, then the first 30 days of sales |
| Onboarding takes 19 days at the median | Shorter onboarding reduces churn | Whether the two are correlated | Query onboarding dates against churn |
`,
    }),
  ]
}

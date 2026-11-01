import type { Block, ComposeContext, ComposedParts } from '../types'
import { quoteShort, type Evidence } from '../evidence'
import { bullets, heading, table } from '../layout'
import { extractComparisonItems } from '../shapes'
import { joinList, stem, tableCell, words } from '../text'
import { closingOffer, noSourcesBlock, sourcesBlock, take } from './common'

interface Criterion {
  name: string
  why: string
  /** Guiding checks used when no source says anything specific. */
  checks: [string, string]
  /** Words that tie an evidence sentence to this row. */
  terms: string[]
}

const c = (name: string, why: string, checks: [string, string], terms: string[]): Criterion => ({ name, why, checks, terms })

const TECH: Criterion[] = [
  c('Fit for your use case', 'The best option on paper still loses if it fits your main workflow badly.', ['How well does it handle your main workflow?', 'Does it cover your must-have requirements?'], ['use', 'workflow', 'feature', 'support', 'need']),
  c('Performance at scale', 'Problems tend to show up at peak load, not in demos.', ['How does it behave at your expected peak?', 'What happens to latency as data grows?'], ['latency', 'performance', 'scale', 'load', 'fast', 'slow', 'throughput']),
  c('Developer experience', 'Daily friction compounds across a team.', ['How quickly can someone build a working prototype?', 'How clear are the errors and docs?'], ['developer', 'api', 'docs', 'sdk', 'debug', 'learning']),
  c('Ecosystem & support', 'Integrations, docs and community answers save weeks.', ['How mature are its integrations?', 'Where do you get help when stuck?'], ['ecosystem', 'integration', 'community', 'plugin', 'vendor']),
  c('Total cost', 'License fees are only part of it — operating time counts too.', ['What does it cost at your volume, including ops time?', 'How does cost grow as usage grows?'], ['cost', 'price', 'pricing', 'budget', 'expensive', 'cheap', 'fee', 'license']),
  c('Lock-in & exit', 'Switching later is often the most expensive part.', ['What would migrating away involve?', 'Can you export your data cleanly?'], ['migrat', 'lock', 'export', 'portab', 'switch']),
]

const BUSINESS: Criterion[] = [
  c('Customer value', 'Adoption follows the problem it solves for customers.', ['Which customer problem does it solve best?', 'Who would pay for it, and why?'], ['customer', 'user', 'value', 'need', 'problem']),
  c('Revenue impact', 'Some options grow revenue; others mostly protect it.', ['How does it change expansion or churn?', 'What revenue does it put at risk?'], ['revenue', 'arr', 'price', 'pricing', 'expansion', 'churn', 'upsell']),
  c('Cost to deliver', 'Delivery and support costs decide whether it scales.', ['What does it take to build and support?', 'Which team carries the ongoing load?'], ['cost', 'support', 'build', 'effort', 'team']),
  c('Risk', 'Downside scenarios matter as much as the upside.', ['What could go wrong, and how visibly?', 'How reversible is the decision?'], ['risk', 'concern', 'compliance', 'security', 'legal']),
  c('Time to market', 'Speed changes the competitive picture.', ['How soon could it ship?', 'What has to be true to launch?'], ['launch', 'timeline', 'quarter', 'week', 'date', 'ship']),
  c('Strategic fit', 'Good options compound with what you already do.', ['How does it fit the strategy and positioning?', 'Does it strengthen or dilute the core story?'], ['strategy', 'position', 'market', 'segment', 'competitor', 'brand']),
]

const APPROACH: Criterion[] = [
  c('Effort', 'Effort competes with everything else on the roadmap.', ['How much work does it take to start?', 'What is the ongoing effort?'], ['effort', 'work', 'time', 'hours']),
  c('Speed to results', 'Early feedback is worth a lot.', ['How soon would you see results?', 'What is the first visible milestone?'], ['fast', 'quick', 'speed', 'week', 'soon']),
  c('Quality of outcome', 'The cheapest path can cost more later.', ['How good is the result likely to be?', 'What does “good enough” look like?'], ['quality', 'better', 'outcome', 'result']),
  c('Risk', 'Know the downside before committing.', ['What is the worst plausible outcome?', 'How would you notice it early?'], ['risk', 'fail', 'issue', 'problem']),
  c('Reversibility', 'Easy-to-undo choices can be made faster.', ['How hard is it to back out?', 'What would you lose by switching later?'], ['revers', 'undo', 'rollback', 'switch']),
  c('Team fit', 'People and skills decide execution.', ['Does the team have the skills today?', 'Who would own it?'], ['team', 'skill', 'owner', 'hire', 'people']),
]

const TECH_RE = /\b(database|db|framework|library|language|tool|platform|api|cloud|sdk|stack|server|hosting|queue|cache|orm|frontend|backend|react|vue|postgres|mongo|redis|kafka|aws|gcp|azure|python|typescript|javascript|rust|go|java)\b/i
const BUSINESS_RE = /\b(pricing|price|plan|tier|strategy|market|vendor|competitor|positioning|revenue|customer|segment|offer|package|channel|partner)\b/i

function criteriaFor(text: string): Criterion[] {
  if (TECH_RE.test(text)) return TECH
  if (BUSINESS_RE.test(text)) return BUSINESS
  return APPROACH
}

function mentions(e: Evidence, item: string): boolean {
  const itemStems = words(item).filter((w) => w.length > 2).map(stem)
  const sentence = new Set(words(e.sentence).map(stem))
  return itemStems.length > 0 && itemStems.some((s) => sentence.has(s))
}

function matchesCriterion(e: Evidence, crit: Criterion): boolean {
  const ws = words(e.sentence)
  return crit.terms.some((t) => ws.some((w) => w.startsWith(t)))
}

export function composeCompare(ctx: ComposeContext): ComposedParts {
  const { rng, evidence, depth } = ctx
  const deep = depth === 'deep'
  const items = extractComparisonItems(ctx.text)
  const criteria = criteriaFor(`${ctx.text} ${items.join(' ')}`).slice(0, deep ? 6 : 4)
  const blocks: Block[] = []
  const used = new Set<Evidence>()

  const opener = items.length
    ? rng.pick([`Here's a side-by-side of ${joinList(items)}.`, `Here's how ${joinList(items)} compare on the criteria that usually decide this.`])
    : rng.pick(["Here's a side-by-side framework for this decision.", "Here's how I'd compare the options."])
  blocks.push({ md: opener, priority: Infinity })

  const takeEvidence = (pred: (e: Evidence) => boolean): Evidence | undefined => {
    const hit = evidence.find((e) => !used.has(e) && pred(e))
    if (hit) used.add(hit)
    return hit
  }

  let rows: string[][]
  let header: string[]
  if (items.length >= 2) {
    const showWhy = items.length === 2
    header = ['Criterion', ...(showWhy ? ['Why it matters'] : []), ...items.map(tableCell)]
    rows = criteria.map((crit) => [
      `**${crit.name}**`,
      ...(showWhy ? [crit.why] : []),
      ...items.map((item) => {
        const hit = takeEvidence((e) => mentions(e, item) && matchesCriterion(e, crit))
        return tableCell(hit ? quoteShort(hit) : rng.pick(crit.checks))
      }),
    ])
  } else {
    header = ['Criterion', 'Why it matters', 'What your sources say']
    rows = criteria.map((crit) => {
      const hit = takeEvidence((e) => matchesCriterion(e, crit))
      return [`**${crit.name}**`, crit.why, tableCell(hit ? quoteShort(hit) : '—')]
    })
  }
  blocks.push({ md: table(header, rows), priority: Infinity })

  if (!used.size && evidence.length === 0) {
    const what = items.length ? joinList(items) : 'the options'
    blocks.push({
      md: `_I haven't filled the cells with specifics because I don't have verified details on ${what} — they're the checks I'd run. Pin vendor notes or a comparison doc and I'll fill the table from them._`,
      priority: Infinity,
    })
  }

  blocks.push({
    md:
      heading("How I'd decide") +
      bullets([
        'Pick the one or two criteria that matter most to you; weight them double and let them break ties.',
        rng.pick([
          'Test each option against your hardest real case in a short, time-boxed spike — differences show up faster than in feature lists.',
          'Run a small trial of each against a real scenario before committing; it surfaces the differences that matter.',
        ]),
        'When the scores are close, favor the option that is easier to reverse.',
      ]),
    priority: 3,
  })

  const remaining = evidence.filter((e) => !used.has(e)).slice(0, deep ? 3 : 2)
  const sources = sourcesBlock(ctx, remaining)
  if (sources) blocks.push(sources)
  if (!items.length) {
    const noSources = noSourcesBlock(ctx, 'a decision framework')
    if (noSources) blocks.push(noSources)
  }
  blocks.push(closingOffer(ctx, ['Want me to turn this into a decision doc{project}?', 'Tell me which criteria matter most and I can weight the comparison.']))

  return {
    blocks,
    extras: [
      {
        md: heading('Questions to settle first') + bullets(take(ctx, ['Which criterion would make you walk away from an option?', 'When do you need to decide?', 'Who needs to agree with the choice?', 'What would you do if neither option works out?'], 3)),
        priority: 1,
      },
    ],
    approach: {
      format: `a side-by-side table${items.length ? ` of ${joinList(items)}` : ''}`,
      structure: 'compare on a few decisive criteria, then give a simple way to decide',
    },
  }
}

import type { Block, ComposeContext, ComposedParts } from '../types'
import { marker } from '../evidence'
import { bullets, heading, numbered } from '../layout'
import { extractCount } from '../shapes'
import { capitalize, gerund, keywords, stripTrailingPunctuation, truncateWords } from '../text'
import { closingOffer, lead, take, topicOf } from './common'

const IDEAS = (t: string): string[] => [
  lead('Start with the smallest version', `a stripped-down take on ${t} for a handful of people, expanded only once you see what they actually use.`),
  lead('Remove a step', 'find the one step people skip or resent today and design it out.'),
  lead('Make progress visible', 'a simple tracker or a short weekly note so everyone can see momentum.'),
  lead('Borrow from an adjacent field', 'look at how another industry handles a similar problem and adapt one idea.'),
  lead('Automate the repetitive part', 'hand the most tedious recurring piece to a workflow or an agent.'),
  lead('Turn it into a ritual', 'attach it to a recurring moment, like a Monday kickoff or a Friday review, so it sticks.'),
  lead('Ask the people closest to it', 'five short conversations with users or teammates often surface the real constraint.'),
  lead('Set a deliberate constraint', 'a fixed budget, a one-week deadline or a single channel can force sharper choices.'),
  lead('Pair it with an existing habit', `connect ${t} to something people already do every day.`),
  lead('Measure one thing', 'pick a single signal that tells you it is working and ignore the rest for now.'),
  lead('Write the announcement first', 'drafting the launch note up front clarifies what actually matters.'),
  lead('Invert the problem', `list everything that would make ${t} fail, then design against the top three.`),
  lead('Create a reusable template', 'capture the best version once so the next one takes minutes.'),
  lead('Run a time-boxed experiment', 'two weeks, one clear hypothesis and a decision at the end.'),
  lead('Make it social', 'a shared channel, a demo day or a show-and-tell turns it into something people talk about.'),
  lead('Offer a choice', 'let people pick between two or three variants and learn from what they choose.'),
]

const QUESTIONS: string[] = [
  'What would success look like six months from now?',
  'What is the hardest part of this today, and why?',
  'What have you already tried, and what happened?',
  'Which constraint is truly fixed, and which only feels fixed?',
  'Who is affected most if this goes wrong?',
  'What would you stop doing to make room for this?',
  'How will you know early that it is not working?',
  'What decision is waiting on the answer?',
  'Where do people disagree today?',
  'What would a great outcome make possible next?',
]

const NAME_NOUNS = ['Lens', 'Pulse', 'Compass', 'Signal', 'Harbor', 'Relay', 'Canvas', 'Orbit', 'Tide', 'Beacon', 'Loom', 'Keel']
const NAME_PREFIXES = ['Clear', 'True', 'North', 'Open', 'Bright', 'Steady', 'Keen', 'Plain']
const NAME_REASONS = [
  'short and easy to say',
  'suggests clarity and direction',
  'works as a verb and a noun',
  'leaves room to grow beyond the first use case',
  'feels calm rather than hype-driven',
  'pairs well with a simple icon',
]

const GENERIC_ROOTS = /^(?:names?|ideas?|product|products|feature|features|new|our|your|for|add-on|addon|app|apps|tool|tools|service|platform|module|plugin|thing)$/

function nameIdeas(ctx: ComposeContext, topic: string, n: number): string[] {
  const kws = keywords(topic, 6).filter((k) => !GENERIC_ROOTS.test(k))
  const roots = kws.map((k) => capitalize(k.replace(/[^a-z0-9]/gi, ''))).filter((r) => r.length > 2)
  const out = new Set<string>()
  for (let guard = 0; out.size < n && guard < 80; guard++) {
    const form = roots.length ? ctx.rng.int(0, 2) : 2
    const root = roots.length ? ctx.rng.pick(roots) : ''
    const name =
      form === 0 ? `${root} ${ctx.rng.pick(NAME_NOUNS)}` : form === 1 ? `${ctx.rng.pick(NAME_PREFIXES)} ${root}` : ctx.rng.pick(NAME_NOUNS)
    out.add(name)
  }
  const reasons = ctx.rng.shuffle(NAME_REASONS)
  return [...out].map((name, i) => `**${name}** — ${reasons[i % reasons.length]}`)
}

const LIST_NOUN =
  /^(?:(?:\d+|a few|a couple of|some|several|three|four|five|six|seven|eight|nine|ten|more)\s+)?(?:(?:good|great|fresh|creative|new|quick|catchy|simple)\s+)?(?:ideas?|names?|ways?|options?|suggestions?|questions?|tips?|alternatives?|examples?|angles?|themes?|topics?|titles?|taglines?|hooks?|concepts?)\s+(for|to|of|about|on)\s+(.+)$/i

/** "ideas for the launch event" → "the launch event"; "ways to reduce churn" → "reducing churn". */
export function brainstormTopic(np: string): string {
  const m = LIST_NOUN.exec(np.trim())
  if (!m) return np
  return m[1].toLowerCase() === 'to' ? gerund(m[2]) : m[2]
}

export function composeBrainstorm(ctx: ComposeContext): ComposedParts {
  const { rng, depth, evidence, text } = ctx
  const deep = depth === 'deep'
  const t = brainstormTopic(topicOf(ctx, 'this'))
  const n = extractCount(text, deep ? 9 : 6, deep ? 12 : 8)
  const isNames = /\bnames?\b/i.test(text) && !/\bnames? of\b/i.test(text)
  const isQuestions = /\bquestions\b/i.test(text)
  const blocks: Block[] = []

  blocks.push({
    md: rng.pick([
      `Here are ${n} ${isNames ? 'name ideas' : isQuestions ? 'questions' : 'ideas'} for ${t}, from quick wins to bigger bets.`,
      `A spread of ${isNames ? 'names' : isQuestions ? 'questions' : 'options'} for ${t}:`,
      `Here are ${n} ${isNames ? 'candidates' : isQuestions ? 'questions worth asking' : 'directions'} to react to — keep the ones that spark something.`,
    ]),
    priority: Infinity,
  })

  const grounded = isNames
    ? []
    : evidence.slice(0, deep ? 2 : 1).map((e) =>
        lead(
          `Build on ${e.source === 'knowledge' ? `*${e.title}*` : 'your file'}`,
          `it says “${stripTrailingPunctuation(truncateWords(e.sentence, 28))}”${marker(e)}; an idea that leans on that has a head start.`,
        ),
      )
  const generic = isNames ? nameIdeas(ctx, t, n) : isQuestions ? take(ctx, QUESTIONS, n) : take(ctx, IDEAS(t), n)
  const list = [...grounded, ...generic].slice(0, Math.max(n, grounded.length + 2))
  blocks.push({ md: numbered(list), priority: Infinity })

  if (isNames) {
    blocks.push({
      md: '_Check trademarks and domain availability before you fall in love with any of these — I have not verified either._',
      priority: Infinity,
    })
  }
  blocks.push({
    md: heading("How I'd narrow it down") + bullets(['Score each on impact and effort, then start with high-impact, low-effort picks.', 'Cut anything you could not explain in one sentence.', 'Test the top two with the people they are for.']),
    priority: 2,
  })
  blocks.push(closingOffer(ctx, ['If one of these stands out, I can sketch it into a plan{project}.', 'Want more in a particular direction? Tell me which one and I’ll riff on it.']))

  return {
    blocks,
    extras: isNames
      ? [
          {
            md: heading('What makes a name work') + bullets(['Easy to spell after hearing it once.', "Doesn't box you into a single feature.", 'Reads naturally in a sentence: “Open it in ___.”', 'Clearly different from names your competitors use.']),
            priority: 1,
          },
          { md: heading('Next step') + 'Shortlist three, say each one aloud in a real sentence, and check availability before sharing them widely.', priority: 1 },
        ]
      : [
          { md: 'Quantity first, judgment second: it is easier to cut a long list than to stretch a short one.', priority: 1 },
          { md: heading('If you only try one') + `Pick the idea you could test this week with the least coordination — momentum on ${t} matters more than picking the perfect option.`, priority: 1 },
        ],
    approach: {
      format: isNames ? 'a list of name candidates with a reason for each' : isQuestions ? 'a list of questions' : 'a numbered list of distinct ideas',
      structure: 'go wide first, then suggest a quick way to narrow down',
    },
  }
}

import { getIntegration } from '@/core/integrations/catalog'
import type { WorkflowTrigger } from '@/core/types'
import { capitalize, joinList, pad2 } from './text'
import type { TriggerEventInfo } from './types'

/**
 * Human text for workflow triggers: "Mondays at 09:00", "When a Gmail message arrives", "Manual".
 * Pure: cron and event ids are interpreted structurally, never against the clock.
 */

/** Events the assist heuristics know how to name (and the workflow drafter can produce). */
export const TRIGGER_EVENTS: readonly TriggerEventInfo[] = [
  { event: 'gmail.message.received', integrationId: 'gmail', label: 'When a Gmail message arrives' },
  { event: 'github.pull_request.opened', integrationId: 'github', label: 'When a pull request is opened' },
  { event: 'github.pull_request.merged', integrationId: 'github', label: 'When a pull request is merged' },
  { event: 'github.issue.opened', integrationId: 'github', label: 'When a GitHub issue is opened' },
  { event: 'github.push', integrationId: 'github', label: 'When code is pushed to GitHub' },
  { event: 'linear.issue.created', integrationId: 'linear', label: 'When a Linear issue is created' },
  { event: 'jira.issue.created', integrationId: 'jira', label: 'When a Jira issue is created' },
  { event: 'slack.message.posted', integrationId: 'slack', label: 'When a Slack message is posted' },
  { event: 'meetings.transcript.ready', integrationId: 'meetings', label: 'When a meeting transcript is ready' },
  { event: 'google-drive.file.created', integrationId: 'google-drive', label: 'When a file is added to Google Drive' },
  { event: 'google-calendar.event.created', integrationId: 'google-calendar', label: 'When a calendar event is created' },
  { event: 'stripe.payment.succeeded', integrationId: 'stripe', label: 'When a Stripe payment succeeds' },
  { event: 'stripe.payment.failed', integrationId: 'stripe', label: 'When a Stripe payment fails' },
  { event: 'knowledge.created', label: 'When knowledge is added' },
]

const EVENT_LABEL = new Map(TRIGGER_EVENTS.map((e) => [e.event, e.label]))

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const isNum = (s: string) => /^\d+$/.test(s)
const stepOf = (s: string) => /^\*\/(\d+)$/.exec(s)?.[1]

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** Days of week from a cron field ("1", "1,4", "1-5", "MON-FRI"), or undefined when unparseable. */
function parseDays(field: string): number[] | undefined {
  const names = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const toNum = (t: string): number | undefined => {
    const lower = t.toLowerCase()
    if (isNum(lower)) return Number(lower) % 7
    const idx = names.indexOf(lower.slice(0, 3))
    return idx >= 0 ? idx : undefined
  }
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const range = /^(\w+)-(\w+)$/.exec(part)
    if (range) {
      const a = toNum(range[1])
      const b = toNum(range[2])
      if (a === undefined || b === undefined) return undefined
      // 0-6 style ranges; "5-7" style (7 = Sunday) is normalized by % 7 above.
      const end = b < a ? b + 7 : b
      for (let d = a; d <= end; d++) out.add(d % 7)
      continue
    }
    const n = toNum(part)
    if (n === undefined) return undefined
    out.add(n)
  }
  return [...out].sort((x, y) => x - y)
}

function daysPhrase(days: number[]): string {
  const key = days.join(',')
  if (days.length === 7) return 'Daily'
  if (key === '1,2,3,4,5') return 'Weekdays'
  if (key === '0,6') return 'Weekends'
  // Monday-first reading order (Sunday last).
  const ordered = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
  return joinList(ordered.map((d) => `${DAY_NAMES[d]}s`))
}

/**
 * "0 9 * * 1" → "Mondays at 09:00", "*\/15 * * * *" → "Every 15 minutes", "0 9 1 * *" → "Monthly on the 1st at 09:00".
 * Returns undefined for expressions it cannot phrase faithfully.
 */
export function describeCron(cron: string): string | undefined {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return undefined
  const [min, hour, dom, mon, dow] = parts
  const restAny = dom === '*' && mon === '*' && dow === '*'

  if (restAny && hour === '*') {
    if (min === '*') return 'Every minute'
    const step = stepOf(min)
    if (step) return Number(step) === 1 ? 'Every minute' : `Every ${step} minutes`
    if (isNum(min)) return Number(min) === 0 ? 'Hourly' : `Hourly at :${pad2(Number(min))}`
    return undefined
  }
  const hourStep = stepOf(hour)
  if (restAny && hourStep && isNum(min)) {
    const every = Number(hourStep) === 1 ? 'Hourly' : `Every ${hourStep} hours`
    return Number(min) === 0 ? every : `${every} at :${pad2(Number(min))}`
  }
  if (!isNum(min) || !isNum(hour) || Number(min) > 59 || Number(hour) > 23) return undefined
  const time = `${pad2(Number(hour))}:${pad2(Number(min))}`

  if (dom === '*' && mon === '*') {
    if (dow === '*') return `Daily at ${time}`
    const days = parseDays(dow)
    return days ? `${daysPhrase(days)} at ${time}` : undefined
  }
  if (dow !== '*') return undefined
  const domStep = stepOf(dom)
  if (domStep && mon === '*') return Number(domStep) === 1 ? `Daily at ${time}` : `Every ${domStep} days at ${time}`
  if (!isNum(dom)) return undefined
  const day = ordinal(Number(dom))
  if (mon === '*') return `Monthly on the ${day} at ${time}`
  if (mon === '1,4,7,10') return `Quarterly on the ${day} at ${time}`
  const monStep = stepOf(mon)
  if (monStep) return `Every ${monStep} months on the ${day} at ${time}`
  if (isNum(mon) && Number(mon) >= 1 && Number(mon) <= 12) return `Yearly on ${MONTHS[Number(mon) - 1]} ${Number(dom)} at ${time}`
  return undefined
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

/** "github.pull_request.opened" → "When a pull request is opened"; unknown ids are phrased generically. */
export function describeEvent(event: string | undefined, integrationId?: string): string | undefined {
  if (event) {
    const known = EVENT_LABEL.get(event)
    if (known) return known
    const segments = event.split('.').filter(Boolean)
    if (segments.length >= 2) {
      const verb = segments[segments.length - 1].replace(/_/g, ' ')
      const objectWords = segments.slice(segments.length >= 3 ? 1 : 0, -1).join(' ').replace(/[_-]/g, ' ')
      const source = segments.length >= 3 ? getIntegration(segments[0])?.name ?? capitalize(segments[0].replace(/[_-]/g, ' ')) : ''
      const subject = source ? `${source} ${objectWords}` : objectWords
      const verbPhrase = verb === 'received' ? 'arrives' : /(?:ed|ing|ready)$/.test(verb) ? `is ${verb}` : `${verb}s`
      return `When ${article(subject)} ${subject} ${verbPhrase}`
    }
    return `When ${event} happens`
  }
  const def = getIntegration(integrationId)
  return def ? `When ${def.name} sends an event` : undefined
}

/** Short human text for a workflow trigger: "Mondays at 09:00", "When a Gmail message arrives", "Manual". */
export function describeTrigger(trigger: Pick<WorkflowTrigger, 'type'> & Partial<WorkflowTrigger>): string {
  switch (trigger.type) {
    case 'manual':
      return 'Manual'
    case 'schedule':
      if (trigger.cron) return describeCron(trigger.cron) ?? (trigger.label?.trim() || `On a schedule (${trigger.cron})`)
      return trigger.label?.trim() || 'On a schedule'
    case 'event':
      return describeEvent(trigger.event, trigger.integrationId) ?? (trigger.label?.trim() || 'When an event happens')
    case 'webhook':
      return 'When a webhook is received'
  }
}

import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { validateWorkflow } from '@/core/services/workflows'
import type { IntegrationConnection, WorkflowNode } from '@/core/types'
import { cast, demoConnections, fx } from './fixtures.test-utils'
import { DRAFT_LAYOUT, draftWorkflowFromText, splitClauses } from './workflowDraft'
import type { WorkflowDraft } from './types'

/** Structural validity: one trigger, unique ids, real endpoints, everything reachable, no loops, full conditions, grid layout. */
function expectValidGraph(d: WorkflowDraft): void {
  const triggers = d.nodes.filter((n) => n.type === 'trigger')
  expect(triggers).toHaveLength(1)
  expect(d.nodes[0].type).toBe('trigger')
  expect(triggers[0].config.type).toBe(d.trigger.type)
  expect(triggers[0].label).toBe(d.trigger.label)

  const ids = new Set(d.nodes.map((n) => n.id))
  expect(ids.size).toBe(d.nodes.length)
  expect(new Set(d.edges.map((e) => e.id)).size).toBe(d.edges.length)
  for (const e of d.edges) {
    expect(ids.has(e.source)).toBe(true)
    expect(ids.has(e.target)).toBe(true)
    expect(e.source).not.toBe(e.target)
  }

  // Everything reachable from the trigger, and no cycles (DFS with colors).
  const out = new Map<string, string[]>()
  for (const e of d.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  const seen = new Set<string>()
  const queue = [triggers[0].id]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    queue.push(...(out.get(id) ?? []))
  }
  expect([...ids].filter((id) => !seen.has(id))).toEqual([])
  const color = new Map<string, number>()
  const cyclic = (id: string): boolean => {
    color.set(id, 1)
    for (const next of out.get(id) ?? []) {
      if (color.get(next) === 1) return true
      if (!color.get(next) && cyclic(next)) return true
    }
    color.set(id, 2)
    return false
  }
  expect(cyclic(triggers[0].id)).toBe(false)

  for (const n of d.nodes) {
    const handles = d.edges.filter((e) => e.source === n.id).map((e) => e.sourceHandle)
    if (n.type === 'condition') expect([...new Set(handles)].sort()).toEqual(['false', 'true'])
    else expect(handles.every((h) => h === undefined)).toBe(true)
    expect(n.position.x % DRAFT_LAYOUT.columnWidth).toBe(0)
    expect(n.position.y % DRAFT_LAYOUT.laneHeight).toBe(0)
  }
  expect(new Set(d.nodes.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(d.nodes.length)
  expect(d.nodes.some((n) => n.type === 'output' && n.config.kind !== 'none')).toBe(true)
  expect(d.name.length).toBeGreaterThan(0)
  expect(d.description.length).toBeGreaterThan(0)
}

const shape = (d: WorkflowDraft) => d.nodes.map((n) => n.type)
const byLabel = (d: WorkflowDraft, label: string): WorkflowNode => {
  const node = d.nodes.find((n) => n.label === label)
  if (!node) throw new Error(`No node “${label}” in ${d.nodes.map((n) => n.label).join(', ')}`)
  return node
}
const branch = (d: WorkflowDraft, cond: WorkflowNode, handle: 'true' | 'false') =>
  d.edges.filter((e) => e.source === cond.id && e.sourceHandle === handle).map((e) => d.nodes.find((n) => n.id === e.target)!.label)

const agents = cast()
let connections: IntegrationConnection[] = demoConnections()
const draft = (text: string, conns: IntegrationConnection[] = connections) => draftWorkflowFromText(text, { agents, connections: conns })

beforeEach(() => {
  connections = demoConnections()
  db.replaceAll(emptyTables())
  db.insertMany('agents', agents)
})

/** The app's own validator must find nothing to complain about when the integrations are connected. */
function expectNoIssues(d: WorkflowDraft, conns: IntegrationConnection[] = connections): void {
  db.insertMany('connections', conns)
  expect(validateWorkflow(d)).toEqual([])
}

describe('draftWorkflowFromText', () => {
  it('1 · schedule → research agent → Slack post → notify', () => {
    const d = draft('Every Monday at 9am, research competitor pricing and post a summary to Slack')
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'schedule', label: 'Mondays at 09:00', cron: '0 9 * * 1' })
    expect(shape(d)).toEqual(['trigger', 'agent', 'action', 'output'])
    expect(d.nodes[1]).toMatchObject({ label: 'Research competitor pricing', agentId: 'agt_scout', capability: 'web.search', config: { prompt: 'Research competitor pricing.' } })
    expect(d.nodes[2]).toMatchObject({ integrationId: 'slack', capability: 'messages.send', config: { channel: '#product' }, label: 'Post to #product' })
    expect(d.nodes[3]).toMatchObject({ label: 'Notify me', config: { kind: 'notify' } })
    expect(d.name).toBe('Research competitor pricing')
    expect(d.description).toBe('Mondays at 09:00: research competitor pricing, then post to #product, then notify me.')
    expect(d.notes).toContain('Added a final “Notify me” step so you see each result.')
    expectNoIssues(d)
  })

  it('2 · email event → triage agent → urgent? → Slack alert / Linear issue', () => {
    const d = draft("When a new support email arrives, summarize it, and if it's urgent post it to #support-urgent, otherwise create a Linear ticket.")
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'event', label: 'When a Gmail message arrives', event: 'gmail.message.received', integrationId: 'gmail' })
    expect(shape(d)).toEqual(['trigger', 'agent', 'condition', 'action', 'action', 'output'])
    expect(byLabel(d, 'Summarize the email')).toMatchObject({ agentId: 'agt_sentinel' })
    const urgent = byLabel(d, 'Urgent?')
    expect(urgent.config).toEqual({ expression: 'priority is urgent' })
    expect(branch(d, urgent, 'true')).toEqual(['Post to #support-urgent'])
    expect(branch(d, urgent, 'false')).toEqual(['Create Linear issue'])
    expect(byLabel(d, 'Create Linear issue')).toMatchObject({ integrationId: 'linear', capability: 'tasks.manage', config: { team: 'SUP' } })
    // The false branch sits one lane below the true branch.
    expect(byLabel(d, 'Create Linear issue').position).toEqual({ x: 840, y: 150 })
    expect(byLabel(d, 'Post to #support-urgent').position).toEqual({ x: 840, y: 0 })
    expect(d.name).toBe('Summarize new support emails')
    expectNoIssues(d)
  })

  it('3 · PR event → code review agent → large? → approval before posting the review', () => {
    const d = draft("When a PR is opened, review it and if it's large ask me before posting the review")
    expectValidGraph(d)
    expect(d.trigger).toMatchObject({ type: 'event', event: 'github.pull_request.opened', integrationId: 'github' })
    expect(byLabel(d, 'Review the pull request')).toMatchObject({ agentId: 'agt_forge' })
    const large = byLabel(d, 'Large?')
    expect(branch(d, large, 'true')).toEqual(['Review before posting'])
    expect(byLabel(d, 'Review before posting')).toMatchObject({ type: 'approval', capability: 'repo.pull_request' })
    expect(byLabel(d, 'Post review on GitHub')).toMatchObject({ type: 'action', integrationId: 'github', capability: 'repo.pull_request' })
    expect(branch(d, large, 'false')).toEqual(['Notify me'])
    expectNoIssues(d)
  })

  it('4 · schedule with approval, Slack post and knowledge output (no extra notify)', () => {
    const d = draft('Draft a weekly product update every Friday at 4pm, ask me to approve it, then post it to #product and save it to Knowledge')
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'schedule', label: 'Fridays at 16:00', cron: '0 16 * * 5' })
    expect(d.nodes.map((n) => n.label)).toEqual(['Fridays at 16:00', 'Draft a weekly product update', 'Review before posting', 'Post to #product', 'Save to Knowledge'])
    expect(d.nodes[1].agentId).toBe('agt_herald')
    expect(d.nodes[4].config).toEqual({ kind: 'knowledge' })
    expectNoIssues(d)
  })

  it('5 · two sentences: condition branches end in an action and a knowledge note', () => {
    const d = draft('Every weekday at 8am, check the support queue; if anything is urgent, alert #support-urgent, otherwise add it to my notes')
    expectValidGraph(d)
    expect(d.trigger.cron).toBe('0 8 * * 1,2,3,4,5')
    expect(d.trigger.label).toBe('Weekdays at 08:00')
    const urgent = byLabel(d, 'Urgent?')
    expect(branch(d, urgent, 'true')).toEqual(['Post to #support-urgent'])
    expect(branch(d, urgent, 'false')).toEqual(['Save to Knowledge'])
    expect(d.nodes.filter((n) => n.label === 'Notify me')).toEqual([])
    expectNoIssues(d)
  })

  it('6 · "send me a daily summary … at 8am" → writer agent + in-app notification at 08:00', () => {
    const d = draft('Send me a daily summary of failed runs at 8am')
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'schedule', label: 'Daily at 08:00', cron: '0 8 * * *' })
    expect(d.nodes.map((n) => [n.type, n.label])).toEqual([
      ['trigger', 'Daily at 08:00'], ['agent', 'Write a daily summary of failed runs'], ['output', 'Notify me'],
    ])
    expect(d.nodes[1].agentId).toBe('agt_herald')
    expectNoIssues(d)
  })

  it('7 · manual: research agent → Atrium task output', () => {
    const d = draft('Research the top 5 freight portal competitors and create a task to review the findings')
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'manual', label: 'Manual' })
    expect(d.nodes.map((n) => n.type)).toEqual(['trigger', 'agent', 'output'])
    expect(d.nodes[2]).toMatchObject({ label: 'Create a task', config: { kind: 'task' } })
    expect(d.description).toBe('When you run it: research the top 5 freight portal competitors, then create a task.')
    expect(draft("When a PR is opened, review it and if it's large ask me before posting the review").description).toBe(
      'When a pull request is opened: review the pull request, then check “Large?” (yes: review before posting and post review on GitHub; no: continue), then notify me.',
    )
    expectNoIssues(d)
  })

  it('8 · Jira event with a high-priority branch; notes the Jira connection problem', () => {
    const d = draft("When a new Jira ticket is created, triage it and if it's high priority notify #oncall on Slack")
    expectValidGraph(d)
    expect(d.trigger).toMatchObject({ event: 'jira.issue.created', integrationId: 'jira', label: 'When a Jira issue is created' })
    const high = byLabel(d, 'High priority?')
    expect(high.config).toEqual({ expression: 'priority is high or urgent' })
    expect(branch(d, high, 'true')).toEqual(['Post to #oncall'])
    expect(branch(d, high, 'false')).toEqual(['Notify me'])
    expect(d.notes).toContain('Jira is not connected yet; connect it in Integrations before this can run.')
    expectNoIssues(d, [...connections.filter((c) => c.id !== 'jira'), fx.connection('jira')])
  })

  it('9 · webhook trigger', () => {
    const d = draft('When a webhook is received, run the deploy checklist and notify me')
    expectValidGraph(d)
    expect(d.trigger).toEqual({ type: 'webhook', label: 'When a webhook is received' })
    expect(shape(d)).toEqual(['trigger', 'agent', 'output'])
    expectNoIssues(d)
  })

  it('10 · trailing "when a PR is merged" clause; release notes get a writer step', () => {
    const d = draft('Post the release notes to #releases when a PR is merged')
    expectValidGraph(d)
    expect(d.trigger).toMatchObject({ event: 'github.pull_request.merged', label: 'When a pull request is merged' })
    expect(d.nodes.map((n) => n.label)).toEqual(['When a pull request is merged', 'Write the release notes', 'Post to #releases', 'Notify me'])
    expect(d.nodes[1].agentId).toBe('agt_herald')
    expectNoIssues(d)
  })

  it('11 · "unless" puts the step on the false branch', () => {
    const d = draft("Every morning, summarize overnight support emails and post them to #support unless it's spam")
    expectValidGraph(d)
    const spam = byLabel(d, 'Spam?')
    expect(branch(d, spam, 'false')).toEqual(['Post to #support'])
    expect(branch(d, spam, 'true')).toEqual(['Notify me'])
    expectNoIssues(d)
  })

  it('12 · "Otherwise" in the next sentence continues the condition', () => {
    const d = draft("When a new email arrives, classify it. If it's urgent, alert #oncall. Otherwise, file a Linear issue.")
    expectValidGraph(d)
    expect(byLabel(d, 'Classify the email').agentId).toBe('agt_sentinel')
    const urgent = byLabel(d, 'Urgent?')
    expect(branch(d, urgent, 'true')).toEqual(['Post to #oncall'])
    expect(branch(d, urgent, 'false')).toEqual(['Create Linear issue'])
    expectNoIssues(d)
  })

  it('13 · delay and email action after a failed payment', () => {
    const conns = [...connections, fx.connection('stripe')]
    const d = draft('When a payment fails, wait 2 hours, then email the customer', conns)
    expectValidGraph(d)
    expect(d.trigger).toMatchObject({ event: 'stripe.payment.failed', label: 'When a Stripe payment fails' })
    expect(d.nodes.map((n) => [n.type, n.label])).toEqual([
      ['trigger', 'When a Stripe payment fails'], ['delay', 'Wait 2 hours'], ['action', 'Send email'], ['output', 'Notify me'],
    ])
    expect(d.nodes[1].config).toEqual({ hours: 2 })
    expect(d.nodes[2]).toMatchObject({ integrationId: 'gmail', capability: 'messages.send' })
    expectNoIssues(d, conns)
  })

  it('14 · "…, but ask me first" moves the approval in front of the send', () => {
    const d = draft('Draft a reply to the latest customer email and send it, but ask me first')
    expectValidGraph(d)
    expect(d.nodes.map((n) => n.type)).toEqual(['trigger', 'agent', 'approval', 'action', 'output'])
    expect(d.nodes[2].label).toBe('Review before sending')
    expect(d.nodes[3]).toMatchObject({ integrationId: 'gmail', label: 'Send email' })
    expectNoIssues(d)
  })

  it('15 · "every new …" noun-phrase trigger', () => {
    const d = draft('Summarize every new support email and post it to #support')
    expectValidGraph(d)
    expect(d.trigger.event).toBe('gmail.message.received')
    expect(d.nodes[1]).toMatchObject({ label: 'Summarize the email', agentId: 'agt_sentinel' })
    expect(d.name).toBe('Summarize new support emails')
    expectNoIssues(d)
  })

  it('16 · adjectives on the trigger become a filter that stops the run', () => {
    const d = draft('When an urgent email arrives, page the on-call engineer on Slack')
    expectValidGraph(d)
    const urgent = byLabel(d, 'Urgent?')
    // No channel named: the connection's default channel is used, and the notes say so.
    expect(branch(d, urgent, 'true')).toEqual(['Post to #product'])
    expect(d.notes).toContain('“page the on-call engineer on Slack” names no channel, so it posts to #product (your default Slack channel) — change it in the step settings.')
    expect(branch(d, urgent, 'false')).toEqual(['Skip'])
    expect(byLabel(d, 'Skip').config).toEqual({ kind: 'none' })
    // Skip ends the run; it does not flow into the final notification.
    expect(d.edges.filter((e) => e.source === byLabel(d, 'Skip').id)).toEqual([])
    expect(d.name).toBe('Page the on-call engineer on Slack')
  })

  it('17 · numeric conditions keep their wording', () => {
    const d = draft('Every day at 6pm, pull the revenue numbers and if revenue dropped more than 10%, alert #finance')
    expectValidGraph(d)
    expect(d.trigger.cron).toBe('0 18 * * *')
    expect(byLabel(d, 'Pull the revenue numbers').agentId).toBe('agt_ledger')
    const cond = byLabel(d, 'Revenue dropped more than 10%?')
    expect(cond.config).toEqual({ expression: 'revenue dropped more than 10%' })
    expect(branch(d, cond, 'true')).toEqual(['Post to #finance'])
    expectNoIssues(d)
  })

  it('18 · ticket steps fall back to an Atrium task when no tracker is connected', () => {
    const conns = connections.filter((c) => c.id !== 'linear' && c.id !== 'jira')
    const d = draft('When a new email arrives, file a ticket', conns)
    expectValidGraph(d)
    expect(d.nodes.map((n) => n.type)).toEqual(['trigger', 'output'])
    expect(d.nodes[1]).toMatchObject({ label: 'Create a task', config: { kind: 'task' } })
    expect(d.notes).toContain('No issue tracker (Linear or Jira) is connected, so the ticket step creates an Atrium task instead.')
    expectNoIssues(d, conns)
  })

  it('19 · one-off times start manually, and unknown text still yields a valid draft', () => {
    const once = draft('Tomorrow at noon, summarize the launch checklist')
    expectValidGraph(once)
    expect(once.trigger.type).toBe('manual')
    expect(once.notes.some((n) => n.includes('one-off time'))).toBe(true)
    const vague = draft('hello there')
    expectValidGraph(vague)
    expect(shape(vague)).toEqual(['trigger', 'output'])
    expect(vague.notes[0]).toBe('Skipped “hello there”: not sure which step that is — add it by hand if needed.')
  })

  it('20 · "ask me first" after a writing step reviews the draft (it does not move in front of the agent)', () => {
    const d = draft('Draft the board update, but ask me first')
    expectValidGraph(d)
    expect(d.nodes.map((n) => [n.type, n.label])).toEqual([
      ['trigger', 'Manual'], ['agent', 'Draft the board update'], ['approval', 'Ask me first'], ['output', 'Notify me'],
    ])
    // A cadence adjective sets the schedule and stays in the step text.
    const weekly = draft('Draft the weekly update, but ask me first')
    expect(weekly.trigger).toMatchObject({ type: 'schedule', cron: '0 9 * * 1' })
    expect(weekly.nodes[1].label).toBe('Draft the weekly update')
    // …but an adverb ("post the digest weekly and …") is removed from it.
    expect(draft('Post the digest to #product weekly and notify me').nodes.map((n) => n.label)).toEqual([
      'Mondays at 09:00', 'Write the digest', 'Post to #product', 'Notify me',
    ])
    expectNoIssues(d)
  })

  it('21 · "If it’s not urgent" in a later sentence is the other branch of the same condition', () => {
    const d = draft("When a new email arrives, triage it. If it's urgent, alert #oncall. If it's not urgent, add it to my notes.")
    expectValidGraph(d)
    expect(d.nodes.filter((n) => n.type === 'condition')).toHaveLength(1)
    const urgent = byLabel(d, 'Urgent?')
    expect(branch(d, urgent, 'true')).toEqual(['Post to #oncall'])
    expect(branch(d, urgent, 'false')).toEqual(['Save to Knowledge'])
    expectNoIssues(d)
  })

  it('leaves the agent empty (and says so) when no active agent fits', () => {
    const d = draftWorkflowFromText('Every day at 9am, generate a hero image', { agents: [fx.agent('agt_code', { name: 'Coder', role: 'Coding agent' })], connections })
    expectValidGraph(d)
    expect(d.nodes[1].type).toBe('agent')
    expect(d.nodes[1].agentId).toBeUndefined()
    expect(d.notes).toContain('“Generate a hero image”: no active agent clearly fits — choose one before running.')
  })

  it('is deterministic, with ids derived from the text or the given prefix', () => {
    const text = 'Every Monday at 9am, research competitor pricing and post a summary to Slack'
    expect(draft(text)).toEqual(draft(text))
    expect(draft(text).nodes[0].id).not.toBe(draft(`${text}!`).nodes[0].id)
    const prefixed = draftWorkflowFromText(text, { agents, connections, idPrefix: 'wf' })
    expect(prefixed.nodes.map((n) => n.id)).toEqual(['wf-n1', 'wf-n2', 'wf-n3', 'wf-n4'])
    expect(prefixed.edges.map((e) => e.id)).toEqual(['wf-e1', 'wf-e2', 'wf-e3'])
  })
})

describe('splitClauses', () => {
  it('splits on separators but keeps noun lists together', () => {
    expect(splitClauses('Research pricing and packaging, then post it to #product and save it').map((c) => [c.text, c.sep])).toEqual([
      ['Research pricing and packaging', 'start'],
      ['post it to #product', 'then'],
      ['save it', 'and'],
    ])
    expect(splitClauses('Summarize the PRs, issues and commits. Otherwise skip').map((c) => [c.text, c.sentence])).toEqual([
      ['Summarize the PRs, issues and commits', 0],
      ['Otherwise skip', 1],
    ])
  })
})

import type {
  ActivityEvent, ActorRef, Asset, EntityRef, ID, Investigation, KnowledgeItem, Link, LinkRel, Message, Notification,
  Project, Task,
} from '@/core/types'
import { AGENT, BOARD, INVESTIGATION, KNOWLEDGE, PROJECT, TASK, WORKFLOW } from '../ids'
import { agentActor, dayLabel, kref, ME, MINUTE, ref, SYSTEM, type SeedCtx } from './helpers'
import { ASSET, KNO, MILESTONE, MSG, TSK } from './keys'

interface GraphInput {
  projects: Record<ID, Project>
  tasks: Record<ID, Task>
  knowledge: Record<ID, KnowledgeItem>
  investigations: Record<ID, Investigation>
  assets: Record<ID, Asset>
  messages: Record<ID, Message>
}

const pad = (n: number, width: number) => String(n).padStart(width, '0')
const quote = (s: string) => `“${s}”`

/**
 * Links, activity and notifications for the content part's entities. Also fills in
 * `message.derived` from every derived_from link that points at a message, so both
 * directions of "created from this message" always agree.
 *
 * Run-level events (agent runs started, completed, cancelled) are logged by the
 * operations part; this module logs what happened to tasks, knowledge, research,
 * studio assets and projects.
 */
export function buildGraph(
  { clock, at }: SeedCtx,
  input: GraphInput,
): { links: Link[]; activity: ActivityEvent[]; notifications: Notification[] } {
  const { back, wd } = clock
  const { projects, tasks, knowledge, investigations, assets, messages } = input

  // ---------------------------------------------------------------- links
  const links: Link[] = []
  const addLink = (from: EntityRef, to: EntityRef, rel: LinkRel, createdAt: number) => {
    links.push({ id: `lnk_content_${pad(links.length + 1, 3)}`, from, to, rel, createdAt })
  }

  // Origin relationships, derived from the rows themselves.
  for (const t of Object.values(tasks)) if (t.origin) addLink(ref('task', t.id), t.origin, 'derived_from', t.createdAt)
  for (const inv of Object.values(investigations)) if (inv.origin) addLink(ref('investigation', inv.id), inv.origin, 'derived_from', inv.createdAt)
  for (const k of Object.values(knowledge)) {
    const r = k.source.ref
    if (r && (r.kind === 'message' || r.kind === 'investigation')) addLink(kref(k.id), r, 'derived_from', k.createdAt)
  }
  const heroCopy = assets[ASSET.heroCopy]
  if (heroCopy) addLink(ref('asset', heroCopy.id), ref('message', MSG.heroSaved), 'derived_from', heroCopy.createdAt)

  // Semantic links between related entities.
  const createdOf = (r: EntityRef): number => {
    const row =
      r.kind === 'task' ? tasks[r.id] : r.kind === 'knowledge' ? knowledge[r.id] : r.kind === 'asset' ? assets[r.id] : r.kind === 'investigation' ? investigations[r.id] : undefined
    return row?.createdAt ?? back(30)
  }
  const relate = (from: EntityRef, to: EntityRef, rel: LinkRel) => addLink(from, to, rel, Math.max(createdOf(from), createdOf(to)))
  relate(kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.personaOlivia), 'references')
  relate(kref(KNOWLEDGE.messagingHouse), kref(KNOWLEDGE.brandVoice), 'references')
  relate(kref(KNOWLEDGE.launchChecklist), kref(KNOWLEDGE.messagingHouse), 'references')
  relate(kref(KNOWLEDGE.triageRubric), kref(KNOWLEDGE.slaPolicy), 'references')
  relate(kref(KNO.lumenFaq), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(kref(KNOWLEDGE.okrsDraft), kref(KNOWLEDGE.lumenPrd), 'references')
  relate(kref(KNOWLEDGE.stripePlan), kref(KNOWLEDGE.incidentLatency), 'related')
  relate(kref(KNOWLEDGE.tidewellTeardown), kref(KNOWLEDGE.freightlyNotes), 'cites')
  relate(kref(KNOWLEDGE.tidewellTeardown), kref(KNOWLEDGE.marketSizing), 'cites')
  relate(ref('task', TASK.ssoFix), kref(KNOWLEDGE.adrSessions), 'references')
  relate(ref('task', TASK.stripeMigration), kref(KNOWLEDGE.stripePlan), 'references')
  relate(ref('task', TASK.competitorBrief), kref(KNOWLEDGE.tidewellTeardown), 'references')
  relate(ref('task', TSK.rateLimits), kref(KNOWLEDGE.rateLimits), 'references')
  relate(ref('task', TSK.meridianQuote), kref(KNOWLEDGE.meridianCall), 'references')
  relate(ref('task', TSK.pricingLock), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(ref('task', TSK.launchEmail), ref('asset', ASSET.launchEmail), 'references')
  relate(ref('task', TSK.keynoteReview), ref('asset', ASSET.keynote), 'references')
  relate(ref('task', TSK.heroCopy), ref('asset', ASSET.heroCopy), 'references')
  relate(ref('task', TSK.customerFollowUp), ref('task', TASK.ssoFix), 'related')
  relate(ref('task', TSK.sameDayTickets), ref('task', TASK.flakyTest), 'related')
  relate(ref('task', TSK.revenueModel), ref('task', TSK.pricingLock), 'related')
  relate(ref('asset', ASSET.storyboard), ref('task', TASK.heroVideo), 'derived_from')
  relate(ref('asset', ASSET.narration), ref('asset', ASSET.storyboard), 'part_of')
  relate(ref('asset', ASSET.cutdownQuote), ref('task', TSK.meridianQuote), 'related')
  relate(ref('investigation', INVESTIGATION.einvoicing), kref(KNOWLEDGE.stripePlan), 'related')

  // message.derived mirrors every derived_from link that points at a message.
  for (const l of links) {
    if (l.rel !== 'derived_from' || l.to.kind !== 'message') continue
    const m = messages[l.to.id]
    if (!m) continue
    m.derived = [...(m.derived ?? []), l.from]
  }

  // ---------------------------------------------------------------- activity
  const activity: ActivityEvent[] = []
  const log = (
    when: number,
    actor: ActorRef,
    verb: string,
    target: EntityRef,
    summary: string,
    projectId: ID | null,
    meta?: Record<string, unknown>,
  ) => {
    activity.push({ id: '', at: when, actor, verb, target, summary, projectId, ...(meta ? { meta } : {}) })
  }
  const FORGE = agentActor(AGENT.forge)
  const SCOUT = agentActor(AGENT.scout)
  const MUSE = agentActor(AGENT.muse)
  const HERALD = agentActor(AGENT.herald)
  const LEDGER = agentActor(AGENT.ledger)
  const SENTINEL = agentActor(AGENT.sentinel)
  const RADAR: ActorRef = { type: 'workflow', id: WORKFLOW.radar }

  const task = (id: ID) => tasks[id]
  const title = (id: ID) => quote(task(id)?.title ?? id)
  const taskEvent = (id: ID, verb: string, actor: ActorRef, when: number | undefined, summary: string, meta?: Record<string, unknown>) => {
    const t = task(id)
    if (t) log(when ?? t.createdAt, actor, verb, ref('task', id), summary, t.projectId, meta)
  }
  const created = (id: ID, suffix = '') => {
    const t = task(id)
    if (t) taskEvent(id, 'created', ME, t.createdAt, `Created task ${quote(t.title)}${suffix}`, t.origin ? { origin: t.origin } : undefined)
  }
  const completed = (id: ID, actor: ActorRef = ME) => {
    const t = task(id)
    if (t) taskEvent(id, 'completed', actor, t.completedAt ?? t.updatedAt, `Completed ${quote(t.title)}`)
  }
  const moved = (id: ID, actor: ActorRef, when: number, from: string, to: string, label: string) =>
    taskEvent(id, 'updated', actor, when, `Moved ${title(id)} to ${label}`, { field: 'status', from, to })
  const assigned = (id: ID, agentId: ID, name: string, when?: number) => {
    const t = task(id)
    if (t) taskEvent(id, 'assigned', ME, when ?? t.createdAt + MINUTE / 2, `Assigned ${quote(t.title)} to ${name}`, { assignee: agentId })
  }
  const kEvent = (id: ID, verb: string, actor: ActorRef, when: number | undefined, summary: string, meta?: Record<string, unknown>) => {
    const k = knowledge[id]
    if (k) log(when ?? k.createdAt, actor, verb, kref(id), summary, k.projectIds[0] ?? null, meta)
  }
  const kTitle = (id: ID) => quote(knowledge[id]?.title ?? id)
  const milestoneDone = (projectId: ID, milestoneId: ID) => {
    const p = projects[projectId]
    const ms = p?.milestones.find((m) => m.id === milestoneId)
    if (p && ms?.dueAt) log(ms.dueAt, ME, 'completed', ref('project', projectId), `Completed milestone ${quote(ms.title)}`, projectId, { milestoneId })
  }

  // Projects & milestones
  log(wd(9, 15, 5), ME, 'updated', ref('project', PROJECT.atlas), `Updated the AI instructions for ${quote(projects[PROJECT.atlas]?.name ?? 'Atlas Portal v2')}: pull requests under 600 lines`, PROJECT.atlas, { field: 'instructions' })
  milestoneDone(PROJECT.lumen, MILESTONE.lumenBeta)
  milestoneDone(PROJECT.atlas, MILESTONE.atlasAuth)
  milestoneDone(PROJECT.ops, MILESTONE.opsDigest)
  milestoneDone(PROJECT.landscape, MILESTONE.landTeardowns)

  // Tasks: Atlas Portal v2
  created(TASK.ssoFix, ' from chat')
  assigned(TASK.ssoFix, AGENT.forge, 'Forge')
  moved(TASK.ssoFix, FORGE, at.ssoTurn2 + 12 * MINUTE, 'in_progress', 'review', 'Review')
  taskEvent(TASK.stripeMigration, 'started', FORGE, at.stripeTurn1, `Started ${title(TASK.stripeMigration)}`, { status: 'in_progress' })
  completed(TASK.bundleSize, FORGE)
  moved(TASK.flakyTest, ME, at.flakyTurn2 + 20 * MINUTE, 'in_progress', 'todo', 'To do: the repeat run still failed')
  created(TSK.runbook, ' from chat')
  created(TSK.numbering, ' from chat')
  created(TSK.tokens, ' from chat')
  created(TSK.queryPlan, ' from chat')
  created(TSK.p95Alert, ' from chat')
  completed(TSK.p95Alert)
  taskEvent(TSK.canvasCharts, 'cancelled', ME, task(TSK.canvasCharts)?.updatedAt, `Cancelled ${title(TSK.canvasCharts)}`)
  created(TSK.prLimit, ' from chat')
  completed(TSK.prLimit)
  completed(TSK.sameDayTickets)
  created(TSK.focusMornings, ' from chat')

  // Tasks: Q4 Competitive Landscape
  created(TSK.battlecard, ' from chat')
  assigned(TASK.competitorBrief, AGENT.scout, 'Scout')
  moved(TASK.competitorBrief, SCOUT, at.scoutBrief + 15 * MINUTE, 'todo', 'review', 'Review with a first draft')
  completed(TSK.radar)
  taskEvent(TSK.analystReport, 'cancelled', ME, task(TSK.analystReport)?.updatedAt, `Cancelled ${title(TSK.analystReport)}`)
  created(TSK.churnReview, ' from a research draft')

  // Tasks: Lumen Launch
  taskEvent(TASK.heroVideo, 'started', MUSE, at.museBeats - 5 * MINUTE, `Started ${title(TASK.heroVideo)}`, { status: 'in_progress' })
  moved(TSK.launchEmail, ME, task(TSK.launchEmail)?.updatedAt ?? wd(1, 14, 5), 'in_progress', 'review', 'Review')
  created(TSK.salesBrief, ' from chat')
  created(TSK.webinar, ' from chat')
  completed(TSK.betaFixes)
  completed(TSK.launchDate)
  completed(TSK.betaUsage, LEDGER)
  assigned(TSK.revenueModel, AGENT.ledger, 'Ledger', task(TSK.revenueModel)?.updatedAt)

  // Tasks: Support Ops Automation
  taskEvent(TASK.weeklyDigest, 'started', HERALD, back(0, 0, 50), `Started ${title(TASK.weeklyDigest)}`, { status: 'in_progress' })
  created(TASK.triageRubric, ' from chat')
  assigned(TASK.triageRubric, AGENT.sentinel, 'Sentinel')
  taskEvent(TASK.triageRubric, 'assigned', SENTINEL, at.sentinelRubric + 15 * MINUTE, `Moved ${title(TASK.triageRubric)} to Review and assigned it to you`, { field: 'status', from: 'in_progress', to: 'review' })
  assigned(TSK.tagTickets, AGENT.sentinel, 'Sentinel')
  completed(TSK.supportInbox)
  completed(TSK.postmortem)

  // Tasks: Field Notes and unscoped
  completed(TSK.rustWeek1)
  created(TSK.okrReview, ' from chat')
  created(TSK.jobPost, ' from chat')
  completed(TSK.oneOnOne)

  // Knowledge
  kEvent(KNOWLEDGE.pricingMemo, 'updated', ME, knowledge[KNOWLEDGE.pricingMemo]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.pricingMemo)} with option B and the break-even question`)
  kEvent(KNOWLEDGE.lumenPrd, 'updated', ME, knowledge[KNOWLEDGE.lumenPrd]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.lumenPrd)} with the open beta`)
  kEvent(KNOWLEDGE.tidewellTeardown, 'saved', SCOUT, undefined, `Saved report ${kTitle(KNOWLEDGE.tidewellTeardown)} to Knowledge`, { investigationId: INVESTIGATION.tidewell })
  kEvent(KNOWLEDGE.tidewellTeardown, 'updated', RADAR, knowledge[KNOWLEDGE.tidewellTeardown]?.updatedAt, `Competitor radar added Tidewell's Pro price increase to ${kTitle(KNOWLEDGE.tidewellTeardown)}`)
  kEvent(KNOWLEDGE.freightlyNotes, 'updated', RADAR, knowledge[KNOWLEDGE.freightlyNotes]?.updatedAt, `Competitor radar added Freightly's carbon reporting to ${kTitle(KNOWLEDGE.freightlyNotes)}`)
  kEvent(KNOWLEDGE.marketSizing, 'updated', SCOUT, knowledge[KNOWLEDGE.marketSizing]?.updatedAt, `Refreshed ${kTitle(KNOWLEDGE.marketSizing)} with ranges and a top-down cross-check`)
  kEvent(KNOWLEDGE.syncOct28, 'imported', SYSTEM, undefined, `Meeting recorder imported ${kTitle(KNOWLEDGE.syncOct28)}`, { integrationId: 'meetings' })
  kEvent(KNOWLEDGE.meridianCall, 'imported', SYSTEM, undefined, `Meeting recorder imported ${kTitle(KNOWLEDGE.meridianCall)}`, { integrationId: 'meetings' })
  kEvent(KNOWLEDGE.incidentLatency, 'created', ME, undefined, `Wrote ${kTitle(KNOWLEDGE.incidentLatency)}`)
  kEvent(KNOWLEDGE.incidentLatency, 'updated', ME, knowledge[KNOWLEDGE.incidentLatency]?.updatedAt, `Turned ${kTitle(KNOWLEDGE.incidentLatency)} into a blameless postmortem`)
  kEvent(KNOWLEDGE.triageRubric, 'created', SENTINEL, undefined, `Drafted ${kTitle(KNOWLEDGE.triageRubric)} from last month's tickets`)
  kEvent(KNOWLEDGE.triageRubric, 'updated', ME, knowledge[KNOWLEDGE.triageRubric]?.updatedAt, `Added the billing rule to ${kTitle(KNOWLEDGE.triageRubric)}`)
  kEvent(KNOWLEDGE.csvAccounts, 'uploaded', ME, undefined, `Uploaded ${kTitle(KNOWLEDGE.csvAccounts)}`)
  kEvent(KNOWLEDGE.okrsDraft, 'updated', ME, knowledge[KNOWLEDGE.okrsDraft]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.okrsDraft)} with baselines from chat`)
  kEvent(KNO.lumenFaq, 'created', ME, undefined, `Created ${kTitle(KNO.lumenFaq)}`)
  kEvent(KNOWLEDGE.launchChecklist, 'updated', ME, knowledge[KNOWLEDGE.launchChecklist]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.launchChecklist)}`)
  kEvent(KNOWLEDGE.messagingHouse, 'updated', ME, knowledge[KNOWLEDGE.messagingHouse]?.updatedAt, `Set the tagline in ${kTitle(KNOWLEDGE.messagingHouse)}: “From tracking to knowing.”`)
  kEvent(KNOWLEDGE.rustPlan, 'saved', ME, undefined, `Saved ${kTitle(KNOWLEDGE.rustPlan)} from chat`)
  kEvent(KNOWLEDGE.stripePlan, 'updated', ME, knowledge[KNOWLEDGE.stripePlan]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.stripePlan)} with per-customer cutover and incident follow-ups`)

  // Research
  const inv = (id: ID) => investigations[id]
  const tidewell = inv(INVESTIGATION.tidewell)
  if (tidewell) log(tidewell.createdAt, ME, 'created', ref('investigation', tidewell.id), `Started research ${quote(tidewell.title)} from chat`, tidewell.projectId)
  const churn = inv(INVESTIGATION.churn)
  if (churn) log(churn.createdAt, ME, 'created', ref('investigation', churn.id), `Started research ${quote(churn.title)} from the churn interviews`, churn.projectId)
  const einvoicing = inv(INVESTIGATION.einvoicing)
  if (einvoicing) log(einvoicing.createdAt, ME, 'created', ref('investigation', einvoicing.id), `Drafted research question ${quote(einvoicing.title)}`, einvoicing.projectId)
  const pricing = inv(INVESTIGATION.pricingTrends)
  if (pricing) log(pricing.createdAt, ME, 'created', ref('investigation', pricing.id), `Started deep research ${quote(pricing.title)} from chat`, pricing.projectId)

  // Studio
  log(clock.day(19, 10, 0), ME, 'created', ref('board', BOARD.launch), `Created board ${quote('Lumen launch visuals')}`, PROJECT.lumen)
  const keyArt = assets[ASSET.keyArt]
  if (keyArt) log(at.studioKeyArt + 22 * 60 * MINUTE, ME, 'favorited', ref('asset', keyArt.id), `Picked direction 2 of ${quote(keyArt.title)} and marked it as a favorite`, keyArt.projectId)
  if (heroCopy) log(heroCopy.createdAt, ME, 'saved', ref('asset', heroCopy.id), `Saved ${quote(heroCopy.title)} to Studio from chat`, heroCopy.projectId)
  const keynote = assets[ASSET.keynote]
  if (keynote) log(keynote.updatedAt, ME, 'generated', ref('asset', keynote.id), `Generated version 2 of ${quote(keynote.title)}`, keynote.projectId, { version: 2 })

  activity.sort((a, b) => a.at - b.at || (a.summary < b.summary ? -1 : 1))
  activity.forEach((e, i) => { e.id = `act_content_${pad(i + 1, 3)}` })

  // ---------------------------------------------------------------- notifications
  const sla = tasks[TSK.slaUpdate]
  const syncNotes = knowledge[KNOWLEDGE.syncOct28]
  const call = knowledge[KNOWLEDGE.meridianCall]
  const teardown = knowledge[KNOWLEDGE.tidewellTeardown]
  const notifications: Notification[] = [
    {
      id: 'ntf_content_1', kind: 'knowledge.added', tone: 'info',
      title: `Meeting recorder added ${kTitle(KNOWLEDGE.syncOct28)}`,
      body: 'Notes from the weekly product sync are in Meetings.',
      ref: kref(KNOWLEDGE.syncOct28),
      createdAt: syncNotes?.createdAt ?? back(4),
      readAt: (syncNotes?.createdAt ?? back(4)) + 30 * MINUTE,
    },
    {
      id: 'ntf_content_2', kind: 'knowledge.added', tone: 'info',
      title: `New transcript: ${kTitle(KNOWLEDGE.meridianCall)}`,
      body: 'The meeting recorder imported a 42-minute call into Meetings.',
      ref: kref(KNOWLEDGE.meridianCall),
      createdAt: call?.createdAt ?? back(12),
      readAt: (call?.createdAt ?? back(12)) + 90 * MINUTE,
    },
    {
      id: 'ntf_content_3', kind: 'knowledge.added', tone: 'success',
      title: `Scout saved ${kTitle(KNOWLEDGE.tidewellTeardown)}`,
      body: `Report from ${quote('Tidewell positioning & pricing')} saved to the Research collection.`,
      ref: kref(KNOWLEDGE.tidewellTeardown),
      createdAt: teardown?.createdAt ?? back(18),
      readAt: (teardown?.createdAt ?? back(18)) + 45 * MINUTE,
    },
    {
      id: 'ntf_content_4', kind: 'task.due', tone: 'warning',
      title: `${title(TASK.triageRubric)} is due today`,
      body: 'Support Ops Automation · in review',
      ref: ref('task', TASK.triageRubric),
      createdAt: back(0, 2),
    },
    {
      id: 'ntf_content_5', kind: 'task.due', tone: 'danger',
      title: `${title(TSK.slaUpdate)} is overdue`,
      body: `Was due ${dayLabel(sla?.dueAt ?? back(2))} · Support Ops Automation`,
      ref: ref('task', TSK.slaUpdate),
      createdAt: (sla?.dueAt ?? back(2)) + 30 * MINUTE,
    },
  ]

  return { links, activity, notifications }
}

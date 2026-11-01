import type {
  ActivityEvent, ActorRef, Asset, EntityRef, ID, Investigation, KnowledgeItem, Link, LinkRel, Message, Notification,
  Project, Task,
} from '@/core/types'
import { AGENT, BOARD, INVESTIGATION, KNOWLEDGE, PROJECT, TASK } from '../ids'
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
 */
export function buildGraph(
  { clock }: SeedCtx,
  input: GraphInput,
): { links: Link[]; activity: ActivityEvent[]; notifications: Notification[] } {
  const { back } = clock
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
  const at = (r: EntityRef): number => {
    const row =
      r.kind === 'task' ? tasks[r.id] : r.kind === 'knowledge' ? knowledge[r.id] : r.kind === 'asset' ? assets[r.id] : r.kind === 'investigation' ? investigations[r.id] : undefined
    return row?.createdAt ?? back(30)
  }
  const relate = (from: EntityRef, to: EntityRef, rel: LinkRel) => addLink(from, to, rel, Math.max(at(from), at(to)))
  relate(kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.personaOlivia), 'references')
  relate(kref(KNOWLEDGE.messagingHouse), kref(KNOWLEDGE.brandVoice), 'references')
  relate(kref(KNOWLEDGE.launchChecklist), kref(KNOWLEDGE.messagingHouse), 'references')
  relate(kref(KNOWLEDGE.triageRubric), kref(KNOWLEDGE.slaPolicy), 'references')
  relate(kref(KNO.lumenFaq), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(kref(KNOWLEDGE.okrsDraft), kref(KNOWLEDGE.lumenPrd), 'references')
  relate(kref(KNOWLEDGE.stripePlan), kref(KNOWLEDGE.incidentLatency), 'related')
  relate(kref(KNOWLEDGE.portbaseTeardown), kref(KNO.winloss), 'cites')
  relate(kref(KNOWLEDGE.portbaseTeardown), kref(KNOWLEDGE.churnInterviews), 'cites')
  relate(ref('task', TASK.ssoFix), kref(KNOWLEDGE.adrSessions), 'references')
  relate(ref('task', TASK.stripeMigration), kref(KNOWLEDGE.stripePlan), 'references')
  relate(ref('task', TSK.rateLimits), kref(KNOWLEDGE.rateLimits), 'references')
  relate(ref('task', TSK.meridianQuote), kref(KNOWLEDGE.meridianCall), 'references')
  relate(ref('task', TSK.pricingLock), kref(KNOWLEDGE.pricingMemo), 'references')
  relate(ref('task', TSK.launchEmail), ref('asset', ASSET.launchEmail), 'references')
  relate(ref('task', TSK.keynoteReview), ref('asset', ASSET.keynote), 'references')
  relate(ref('task', TSK.haldenFollowUp), ref('task', TASK.ssoFix), 'related')
  relate(ref('task', TSK.flakyQuarantine), ref('task', TASK.flakyTest), 'related')
  relate(ref('task', TSK.revenueModel), ref('task', TSK.pricingLock), 'related')
  relate(ref('asset', ASSET.storyboard), ref('task', TASK.heroVideo), 'derived_from')
  relate(ref('asset', ASSET.narration), ref('asset', ASSET.storyboard), 'part_of')
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
  const ARCHIVIST = agentActor(AGENT.archivist)

  const task = (id: ID) => tasks[id]
  const taskEvent = (id: ID, verb: string, actor: ActorRef, when: number | undefined, summary: string, meta?: Record<string, unknown>) => {
    const t = task(id)
    if (!t) return
    log(when ?? t.createdAt, actor, verb, ref('task', id), summary, t.projectId, meta)
  }
  const created = (id: ID, suffix = '') => {
    const t = task(id)
    if (t) taskEvent(id, 'created', ME, t.createdAt, `Created task ${quote(t.title)}${suffix}`, t.origin ? { origin: t.origin } : undefined)
  }
  const completed = (id: ID, actor: ActorRef = ME) => {
    const t = task(id)
    if (t) taskEvent(id, 'completed', actor, t.completedAt ?? t.updatedAt, `Completed ${quote(t.title)}`)
  }
  const moved = (id: ID, actor: ActorRef, when: number, from: string, to: string, label: string) => {
    const t = task(id)
    if (t) taskEvent(id, 'updated', actor, when, `Moved ${quote(t.title)} to ${label}`, { field: 'status', from, to })
  }
  const assigned = (id: ID, agentId: ID, name: string, when?: number) => {
    const t = task(id)
    if (t) taskEvent(id, 'assigned', ME, when ?? t.createdAt + MINUTE / 2, `Assigned ${quote(t.title)} to ${name}`, { assignee: agentId })
  }
  const kEvent = (id: ID, verb: string, actor: ActorRef, when: number | undefined, summary: string, meta?: Record<string, unknown>) => {
    const k = knowledge[id]
    if (!k) return
    log(when ?? k.createdAt, actor, verb, kref(id), summary, k.projectIds[0] ?? null, meta)
  }
  const kTitle = (id: ID) => quote(knowledge[id]?.title ?? id)
  const milestoneDone = (projectId: ID, milestoneId: ID, when: number) => {
    const p = projects[projectId]
    const ms = p?.milestones.find((m) => m.id === milestoneId)
    if (p && ms) log(when, ME, 'completed', ref('project', projectId), `Completed milestone ${quote(ms.title)}`, projectId, { milestoneId })
  }

  // Projects & milestones
  const landscape = projects[PROJECT.landscape]
  if (landscape) log(landscape.createdAt, ME, 'created', ref('project', landscape.id), `Created project ${quote(landscape.name)}`, landscape.id)
  log(back(12, 2), ME, 'updated', ref('project', PROJECT.atlas), `Updated the AI instructions for ${quote(projects[PROJECT.atlas]?.name ?? 'Atlas Portal v2')}`, PROJECT.atlas, { field: 'instructions' })
  milestoneDone(PROJECT.lumen, MILESTONE.lumenBeta, back(20, 1))
  milestoneDone(PROJECT.atlas, MILESTONE.atlasAuth, back(12, 3))
  milestoneDone(PROJECT.ops, MILESTONE.opsDigest, back(10, 2))
  milestoneDone(PROJECT.landscape, MILESTONE.landTeardowns, back(8, 2))

  // Tasks: Atlas Portal v2
  created(TASK.ssoFix, ' from chat')
  assigned(TASK.ssoFix, AGENT.forge, 'Forge')
  moved(TASK.ssoFix, FORGE, back(0, 1, 30), 'in_progress', 'review', 'Review')
  taskEvent(TASK.stripeMigration, 'started', FORGE, back(3, 6), `Started ${quote(task(TASK.stripeMigration)?.title ?? '')}`, { status: 'in_progress' })
  completed(TASK.bundleSize, FORGE)
  moved(TASK.flakyTest, ME, back(1, 2), 'in_progress', 'todo', 'To do after a failed attempt')
  created(TSK.runbook, ' from chat')
  created(TSK.numbering, ' from chat')
  created(TSK.tokens, ' from chat')
  created(TSK.queryPlan, ' from chat')
  created(TSK.p95Alert, ' from chat')
  completed(TSK.p95Alert)
  taskEvent(TSK.canvasCharts, 'cancelled', ME, task(TSK.canvasCharts)?.updatedAt, `Cancelled ${quote(task(TSK.canvasCharts)?.title ?? '')}`)
  created(TSK.reviewSla, ' from chat')
  created(TSK.flakyQuarantine, ' from chat')

  // Tasks: Q4 Competitive Landscape
  created(TSK.battlecard, ' from chat')
  assigned(TASK.competitorBrief, AGENT.scout, 'Scout')
  completed(TSK.radar)
  taskEvent(TSK.analystReport, 'cancelled', ME, task(TSK.analystReport)?.updatedAt, `Cancelled ${quote(task(TSK.analystReport)?.title ?? '')}`)
  created(TSK.churnReview, ' from a research draft')

  // Tasks: Lumen Launch
  taskEvent(TASK.heroVideo, 'started', MUSE, back(4, 6), `Started ${quote(task(TASK.heroVideo)?.title ?? '')}`, { status: 'in_progress' })
  moved(TSK.launchEmail, ME, task(TSK.launchEmail)?.updatedAt ?? back(1, 3), 'in_progress', 'review', 'Review')
  created(TSK.salesBrief, ' from chat')
  created(TSK.webinar, ' from chat')
  completed(TSK.betaFixes)
  completed(TSK.launchDate)
  completed(TSK.betaUsage, LEDGER)
  assigned(TSK.revenueModel, AGENT.ledger, 'Ledger', back(3, 3))

  // Tasks: Support Ops Automation
  taskEvent(TASK.weeklyDigest, 'started', HERALD, back(0, 0, 50), `Started ${quote(task(TASK.weeklyDigest)?.title ?? '')}`, { status: 'in_progress' })
  created(TASK.triageRubric, ' from chat')
  moved(TASK.triageRubric, ME, back(0, 6), 'in_progress', 'review', 'Review')
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
  kEvent(KNOWLEDGE.lumenPrd, 'updated', ME, knowledge[KNOWLEDGE.lumenPrd]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.lumenPrd)}`)
  kEvent(KNOWLEDGE.portbaseTeardown, 'saved', SCOUT, undefined, `Saved report ${kTitle(KNOWLEDGE.portbaseTeardown)} to Knowledge`, { investigationId: INVESTIGATION.portbase })
  kEvent(KNOWLEDGE.syncOct28, 'imported', SYSTEM, undefined, `Notion sync imported ${kTitle(KNOWLEDGE.syncOct28)}`, { integrationId: 'notion' })
  kEvent(KNOWLEDGE.meridianCall, 'imported', SYSTEM, undefined, `Meeting recorder imported ${kTitle(KNOWLEDGE.meridianCall)}`, { integrationId: 'meetings' })
  kEvent(KNOWLEDGE.incidentLatency, 'saved', ME, undefined, `Saved ${kTitle(KNOWLEDGE.incidentLatency)} from chat`)
  kEvent(KNOWLEDGE.triageRubric, 'saved', ME, undefined, `Saved ${kTitle(KNOWLEDGE.triageRubric)} from chat`)
  kEvent(KNOWLEDGE.triageRubric, 'updated', ME, knowledge[KNOWLEDGE.triageRubric]?.updatedAt, `Added the billing urgency rule to ${kTitle(KNOWLEDGE.triageRubric)}`)
  kEvent(KNOWLEDGE.csvAccounts, 'uploaded', ME, undefined, `Uploaded ${kTitle(KNOWLEDGE.csvAccounts)}`)
  kEvent(KNOWLEDGE.okrsDraft, 'saved', ME, undefined, `Saved ${kTitle(KNOWLEDGE.okrsDraft)} from chat`)
  kEvent(KNOWLEDGE.glossary, 'tagged', ARCHIVIST, knowledge[KNOWLEDGE.glossary]?.updatedAt, `Tagged ${kTitle(KNOWLEDGE.glossary)} and 13 other items`, { count: 14 })
  kEvent(KNO.betaFeedback, 'merged', ARCHIVIST, knowledge[KNO.betaFeedback]?.updatedAt, `Merged duplicate entries in ${kTitle(KNO.betaFeedback)}`)
  kEvent(KNO.lumenFaq, 'created', ME, undefined, `Created ${kTitle(KNO.lumenFaq)}`)
  kEvent(KNOWLEDGE.launchChecklist, 'updated', ME, knowledge[KNOWLEDGE.launchChecklist]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.launchChecklist)}`)
  kEvent(KNOWLEDGE.rustPlan, 'saved', ME, undefined, `Saved ${kTitle(KNOWLEDGE.rustPlan)} from chat`)
  kEvent(KNOWLEDGE.stripePlan, 'updated', ME, knowledge[KNOWLEDGE.stripePlan]?.updatedAt, `Updated ${kTitle(KNOWLEDGE.stripePlan)} with incident follow-ups`)

  // Research
  const inv = (id: ID) => investigations[id]
  const portbase = inv(INVESTIGATION.portbase)
  if (portbase) {
    log(portbase.createdAt, ME, 'created', ref('investigation', portbase.id), `Started research ${quote(portbase.title)} from chat`, portbase.projectId)
    log(portbase.createdAt + 14 * MINUTE, SCOUT, 'completed', ref('investigation', portbase.id), `Completed research ${quote(portbase.title)} with ${portbase.sourceIds.length} sources`, portbase.projectId)
  }
  const churn = inv(INVESTIGATION.churn)
  if (churn) {
    log(churn.createdAt, ME, 'created', ref('investigation', churn.id), `Started research ${quote(churn.title)}`, churn.projectId)
    log(churn.updatedAt, SCOUT, 'drafted', ref('investigation', churn.id), `Drafted a report for ${quote(churn.title)}`, churn.projectId)
  }
  const einvoicing = inv(INVESTIGATION.einvoicing)
  if (einvoicing) log(einvoicing.createdAt, ME, 'created', ref('investigation', einvoicing.id), `Drafted research question ${quote(einvoicing.title)}`, einvoicing.projectId)
  const pricing = inv(INVESTIGATION.pricingTrends)
  if (pricing) log(pricing.createdAt, ME, 'created', ref('investigation', pricing.id), `Started deep research ${quote(pricing.title)} from chat`, pricing.projectId)

  // Studio
  log(back(19, 2), ME, 'created', ref('board', BOARD.launch), `Created board ${quote('Lumen launch visuals')}`, PROJECT.lumen)
  const hero = assets[ASSET.heroImage]
  if (hero) {
    const v3 = hero.versions[2]
    log(v3?.createdAt ?? hero.updatedAt, MUSE, 'generated', ref('asset', hero.id), `Generated version 3 of ${quote(hero.title)}`, hero.projectId, { version: 3 })
    log((v3?.createdAt ?? hero.updatedAt) + 40 * MINUTE, ME, 'favorited', ref('asset', hero.id), `Marked ${quote(hero.title)} as a favorite`, hero.projectId)
  }
  const storyboard = assets[ASSET.storyboard]
  if (storyboard) log(storyboard.createdAt, MUSE, 'generated', ref('asset', storyboard.id), `Generated ${quote(storyboard.title)} (8 shots)`, storyboard.projectId)
  const keynote = assets[ASSET.keynote]
  if (keynote) log(keynote.updatedAt, ME, 'generated', ref('asset', keynote.id), `Generated version 2 of ${quote(keynote.title)}`, keynote.projectId, { version: 2 })
  if (heroCopy) log(heroCopy.createdAt, ME, 'saved', ref('asset', heroCopy.id), `Saved ${quote(heroCopy.title)} to Studio from chat`, heroCopy.projectId)
  const failed = assets[ASSET.warehouseIso]
  if (failed) log(failed.createdAt, SYSTEM, 'failed', ref('asset', failed.id), `Image generation failed for ${quote(failed.title)}`, failed.projectId)

  activity.sort((a, b) => a.at - b.at)
  activity.forEach((e, i) => { e.id = `act_content_${pad(i + 1, 3)}` })

  // ---------------------------------------------------------------- notifications
  const sla = tasks[TSK.slaUpdate]
  const notifications: Notification[] = [
    {
      id: 'ntf_content_1', kind: 'knowledge.added', tone: 'info',
      title: `Notion sync added ${kTitle(KNOWLEDGE.syncOct28)}`,
      body: 'Imported into the Meetings collection.',
      ref: kref(KNOWLEDGE.syncOct28),
      createdAt: knowledge[KNOWLEDGE.syncOct28]?.createdAt ?? back(4, 1),
      readAt: back(4),
    },
    {
      id: 'ntf_content_2', kind: 'knowledge.added', tone: 'info',
      title: `New transcript: ${kTitle(KNOWLEDGE.meridianCall)}`,
      body: 'The meeting recorder imported a 42-minute call into Meetings.',
      ref: kref(KNOWLEDGE.meridianCall),
      createdAt: knowledge[KNOWLEDGE.meridianCall]?.createdAt ?? back(9, 3),
      readAt: back(9, 1),
    },
    {
      id: 'ntf_content_3', kind: 'knowledge.added', tone: 'success',
      title: `Scout saved ${kTitle(KNOWLEDGE.portbaseTeardown)}`,
      body: `Report from ${quote('Portbase positioning & pricing')} saved to the Research collection.`,
      ref: kref(KNOWLEDGE.portbaseTeardown),
      createdAt: knowledge[KNOWLEDGE.portbaseTeardown]?.createdAt ?? back(11, 2),
      readAt: back(11, 1),
    },
    {
      id: 'ntf_content_4', kind: 'task.due', tone: 'warning',
      title: `${quote(tasks[TASK.triageRubric]?.title ?? 'Finalize triage rubric v2')} is due today`,
      body: 'Support Ops Automation · in review',
      ref: ref('task', TASK.triageRubric),
      createdAt: back(0, 2),
    },
    {
      id: 'ntf_content_5', kind: 'task.due', tone: 'danger',
      title: `${quote(sla?.title ?? 'Update SLA policy for enterprise tier')} is overdue`,
      body: `Was due ${dayLabel(sla?.dueAt ?? back(2))} · Support Ops Automation`,
      ref: ref('task', TSK.slaUpdate),
      createdAt: (sla?.dueAt ?? back(2)) + 30 * MINUTE,
    },
  ]

  return { links, activity, notifications }
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  ArrowLeft, BookPlus, Check, Copy, CornerUpRight, Download, Layers, Link2, ListChecks, MessagesSquare, Orbit, PenLine, Presentation, RotateCcw,
  RotateCw, SquareTerminal, Telescope, Trash2, Workflow,
} from 'lucide-react'
import { Composer, ReadBackLine, useReadBack, type ComposerSubmitMeta } from '@/app/components'
import { useRegisterCommands } from '@/app/commands/registry'
import { openStartSheet, setSelection, useShellStore } from '@/app/shell/store'
import { Stage, StageHeader, useShellLayout } from '@/app/templates'
import type { Command } from '@/app/types'
import { estimateReferenceCost } from '@/core/ai'
import { useContextStore, useIsPinned } from '@/core/context'
import { db, useDB, useRow } from '@/core/db'
import {
  RESEARCH_AGENT_ID, askFollowUp, completeInvestigation, reopenInvestigation, saveReportToKnowledge, startInvestigation, updateInvestigation,
  useInvestigation, useSources, entityRoute,
} from '@/core/services'
import { STEP_PROFILE } from '@/core/sim/research'
import { useSettings } from '@/core/settings'
import { isRunActive, type EntityRef, type ID, type Investigation, type Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { timeAgo } from '@/lib/format'
import {
  AgentMark, Button, EmptyState, EntityChip, ErrorState, HUE_FILL, IconButton, IdCode, Menu, copyText, toast, useHotkey, type MenuItem,
} from '@/ui'
import { cancelQueuedFollowUp, confirmDelete, discussInChat, exportReport, makeDeck, queueFollowUp, sendFindingsToCode, useQueuedFollowUps } from './actions'
import { ActivityView } from './ActivityView'
import { Board } from './Board'
import { FindingsView } from './FindingsView'
import { Frontier } from './Frontier'
import { useBoardColumns, useReadingIds, useSelectSource, useSelectedSourceId, SOURCE_PARAM } from './hooks'
import { DEPTH_LABEL, openQuestions, sourceStats } from './logic'
import { MakeTasksDialog } from './MakeTasksDialog'
import { NewBrief } from './NewBrief'
import { InvestigationStatusChip, SectionLabel, TextButton, ViewBoundary } from './parts'
import { ReportView, SaveReportButton } from './ReportView'
import { SourceList, SourcesView } from './SourcesView'

type Tab = 'board' | 'report' | 'findings' | 'sources' | 'activity'
const SUB_TABS: readonly Tab[] = ['findings', 'sources', 'activity']

/** `/research/:investigationId/:tab?` */
export default function InvestigationStage() {
  const { investigationId = '', tab } = useParams()
  const inv = useInvestigation(investigationId)
  if (!inv) return <GoneStage />
  if (inv.status === 'draft') return <DraftStage key={inv.id} inv={inv} />
  return <InvestigationScreen key={inv.id} inv={inv} tabParam={tab} />
}

// ------------------------------------------------------------------------------------------------ screen

function InvestigationScreen({ inv, tabParam }: { inv: Investigation; tabParam?: string }) {
  const navigate = useNavigate()
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const [params] = useSearchParams()
  const sources = useSources(inv.id)
  // Narrow subscriptions: the screen re-renders when the run's status changes, not on every step update.
  const runId = inv.runIds[inv.runIds.length - 1]
  const runStatus = useDB((s) => (runId ? s.runs[runId]?.status : undefined))
  const runError = useDB((s) => (runId ? s.runs[runId]?.error : undefined))
  const runAgentId = useDB((s) => (runId ? s.runs[runId]?.agentId : undefined))
  const active = !!runStatus && isRunActive(runStatus)
  const runLite = useMemo(() => (runStatus ? { status: runStatus } : undefined), [runStatus])
  const selectSource = useSelectSource()
  const selectedId = useSelectedSourceId()
  const columns = useBoardColumns()
  const scopeRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [turnOpen, setTurnOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  const held = useIsPinned({ kind: 'investigation', id: inv.id })
  const ref: EntityRef = useMemo(() => ({ kind: 'investigation', id: inv.id }), [inv.id])

  const hasReport = !!inv.report?.trim()
  const boardMode = !hasReport && inv.status === 'running'
  const first: Tab = boardMode ? 'board' : 'report'
  const tab: Tab = SUB_TABS.includes(tabParam as Tab) ? (tabParam as Tab) : first
  const readingIds = useReadingIds(runId, sources)
  // Each view starts at the top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [tab])
  const stats = useMemo(() => sourceStats(sources), [sources])
  const questions = useMemo(() => openQuestions(inv.report).map((q) => ({ id: q.id, text: q.text, section: q.section })), [inv.report])

  // `?source=` selects a source (links from chips, ⌘K, the run timeline).
  const sourceParam = params.get(SOURCE_PARAM)
  useEffect(() => {
    if (!sourceParam || !inv.sourceIds.includes(sourceParam)) return
    if (useShellStore.getState().selection?.id === sourceParam) return
    setSelection({ kind: 'source', id: sourceParam })
    useShellStore.getState().setInspector('research', { open: true, tab: 'item' })
    // Only the parameter drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceParam])
  // A source selected in another investigation does not follow you here; leaving clears ours.
  useEffect(() => {
    const st = useShellStore.getState()
    if (st.selection?.kind === 'source' && !inv.sourceIds.includes(st.selection.id) && st.selection.id !== sourceParam) setSelection(null)
    return () => {
      const cur = useShellStore.getState().selection
      if (cur?.kind === 'source' && db.get('sources', cur.id)?.investigationId === inv.id) setSelection(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id])

  const goTab = useCallback(
    (t: Tab) => {
      const search = params.toString()
      navigate(`/research/${inv.id}${t === first ? '' : `/${t}`}${search ? `?${search}` : ''}`)
    },
    [navigate, inv.id, first, params],
  )

  // ---- actions
  const discuss = () => {
    const thread = discussInChat(inv.id)
    if (thread) navigate(`/chat/${thread}`)
  }
  const exportMd = () => {
    const { fileName } = exportReport(inv)
    toast({ title: `Exported ${fileName}` })
  }
  const markComplete = () => {
    completeInvestigation(inv.id)
    toast({ tone: 'success', title: 'Marked complete', action: { label: 'Undo', onClick: () => reopenInvestigation(inv.id) } })
  }
  const remove = async () => {
    if (await confirmDelete(inv)) navigate('/research')
  }
  const retry = () => {
    startInvestigation(inv.id)
    toast({ title: 'Research started again' })
  }
  const focusFollowUp = () => document.querySelector<HTMLTextAreaElement>('#main [data-composer-dock] [data-composer-input]')?.focus()
  const saveOrOpen = () => {
    const k = inv.knowledgeId ? db.get('knowledge', inv.knowledgeId) : undefined
    if (k) return navigate(entityRoute({ kind: 'knowledge', id: k.id }))
    const item = saveReportToKnowledge(inv.id)
    if (item) toast({ tone: 'success', title: 'Saved to Knowledge', action: { label: 'Open', onClick: () => navigate(entityRoute({ kind: 'knowledge', id: item.id })) } })
  }
  const toggleHold = () => {
    const st = useContextStore.getState()
    if (held) st.unpin(ref)
    else st.pin(ref)
    toast({ title: held ? 'Released' : 'Held', description: held ? 'It no longer rides along in new AI actions.' : 'The report rides along in every new AI action.' })
  }
  const codeFindings = () => {
    const pinned = inv.findings.filter((f) => f.pinned)
    sendFindingsToCode(inv, pinned.length ? pinned : inv.findings)
  }
  const copy = (text: string, what: string) => void copyText(text).then((ok) => toast(ok ? { title: `${what} copied` } : { tone: 'error', title: `Couldn’t copy the ${what.toLowerCase()}` }))

  // T opens Turn into, S saves the report (outside text fields; Settings › Keyboard can turn them off).
  useHotkey('t', () => setTurnOpen(true), { enabled: singleKeys && !phone })
  useHotkey('s', () => {
    if (hasReport) saveOrOpen()
  }, { enabled: singleKeys && hasReport })

  const turnInto: MenuItem[] = [
    { type: 'label', label: 'Turn into' },
    { id: 'chat', label: 'Discussion in Chat', icon: MessagesSquare, description: 'A new conversation with the report attached', onSelect: discuss },
    { id: 'tasks', label: 'Tasks from open questions…', icon: ListChecks, disabled: !hasReport, onSelect: () => setTasksOpen(true) },
    { id: 'code', label: 'Coding session with findings…', icon: SquareTerminal, disabled: !inv.findings.length, description: inv.findings.some((f) => f.pinned) ? 'Quotes the pinned findings' : 'Quotes the findings', onSelect: codeFindings },
    { id: 'deck', label: 'Deck from the report…', icon: Presentation, disabled: !hasReport, onSelect: () => makeDeck(inv) },
    { type: 'separator' },
    { id: 'task', label: 'Task…', icon: ListChecks, onSelect: () => openStartSheet('task', { source: ref }) },
    { id: 'research', label: 'New research…', icon: Telescope, onSelect: () => openStartSheet('research', { source: ref }) },
    { id: 'agent', label: 'Agent run…', icon: Orbit, onSelect: () => openStartSheet('agent', { source: ref }) },
    { id: 'workflow', label: 'Workflow run…', icon: Workflow, onSelect: () => openStartSheet('workflow', { source: ref }) },
  ]

  const menu: MenuItem[] = [
    ...(hasReport ? [{ id: 'follow', label: 'Ask a follow-up', icon: CornerUpRight, shortcut: '/', onSelect: focusFollowUp }] : []),
    { id: 'hold', label: held ? 'Release the report' : 'Hold the report', icon: Layers, shortcut: 'h', description: held ? undefined : 'It rides along in every new AI action', onSelect: toggleHold },
    ...(inv.status === 'failed' && !active && (phone || layout.docking.stageWidth < 900) ? [{ id: 'retry', label: 'Retry the research', icon: RotateCw, onSelect: retry }] : []),
    ...((phone || layout.docking.stageWidth < 1240) && hasReport ? [{ id: 'save', label: inv.knowledgeId ? 'Open in Knowledge' : 'Save to Knowledge', icon: BookPlus, shortcut: 's', onSelect: saveOrOpen }] : []),
    { id: 'export', label: 'Export Markdown', icon: Download, disabled: !hasReport, onSelect: exportMd },
    ...(inv.status === 'review' ? [{ id: 'complete', label: 'Mark complete', icon: Check, onSelect: markComplete }] : []),
    ...(inv.status === 'complete' ? [{ id: 'reopen', label: 'Reopen for review', icon: RotateCcw, onSelect: () => reopenInvestigation(inv.id) }] : []),
    { type: 'separator' },
    { id: 'rename', label: 'Rename', icon: PenLine, onSelect: () => setRenaming(true) },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => copy(`${window.location.origin}/research/${inv.id}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => copy(shortCode(inv.id), 'Handle') },
    { type: 'separator' },
    { id: 'delete', label: 'Delete investigation…', icon: Trash2, danger: true, onSelect: () => void remove() },
  ]

  const stageWidth = layout.docking.stageWidth
  // Phones keep the title readable (every action lives in ⋯); narrow stages show Turn into as an icon.
  const turnStyle: 'text' | 'icon' | 'menu' = phone ? 'menu' : stageWidth < 900 ? 'icon' : 'text'
  const turnMenu = (
    <Menu
      open={turnOpen}
      onOpenChange={setTurnOpen}
      items={turnInto}
      aria-label="Turn into"
      placement="bottom-end"
      trigger={
        turnStyle === 'icon' ? (
          <IconButton icon={CornerUpRight} label="Turn into…" shortcut="t" size="sm" tooltipPlacement="bottom" />
        ) : (
          <Button size="sm" variant="ghost" leadingIcon={CornerUpRight} aria-keyshortcuts="t">
            Turn into…
          </Button>
        )
      }
    />
  )
  // Header actions in priority order; how many fit depends on the stage (the title keeps its room).
  const actions: { key: string; node: ReactNode }[] = []
  if (inv.status === 'failed' && !active)
    actions.push({
      key: 'retry',
      node: (
        <Button key="retry" size="sm" variant="secondary" leadingIcon={RotateCw} onClick={retry}>
          Retry
        </Button>
      ),
    })
  if (inv.status === 'review' && !active)
    actions.push({
      key: 'complete',
      node: (
        <Button key="complete" size="sm" variant="secondary" leadingIcon={Check} onClick={markComplete}>
          Mark complete
        </Button>
      ),
    })
  if (hasReport) actions.push({ key: 'save', node: <SaveReportButton key="save" inv={inv} /> })
  const slots = phone || stageWidth < 900 ? 0 : stageWidth < 1240 ? 1 : 2
  const visibleActions = [...actions.slice(0, slots), ...(turnStyle === 'menu' ? [] : [{ key: 'turn', node: <span key="turn">{turnMenu}</span> }])]
  const turnHidden = turnStyle === 'menu'

  // ---- ⌘K: actions for this view
  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []
    const g = 'Research'
    if (hasReport) out.push({ id: 'research.save', title: inv.knowledgeId ? 'Open the report in Knowledge' : 'Save the report to Knowledge', icon: BookPlus, group: g, shortcut: 'S', run: (c) => (c.close(), saveOrOpen()) })
    if (hasReport) out.push({ id: 'research.export', title: 'Export the report as Markdown', icon: Download, group: g, keywords: ['download', 'md'], run: (c) => (c.close(), exportMd()) })
    if (inv.status === 'review') out.push({ id: 'research.complete', title: 'Mark the investigation complete', icon: Check, group: g, run: (c) => (c.close(), markComplete()) })
    out.push({ id: 'research.followup', title: 'Ask a follow-up', icon: CornerUpRight, group: g, run: (c) => {
      c.close()
      setTimeout(focusFollowUp, 60)
    } })
    out.push({ id: 'research.chat', title: 'Discuss the report in Chat', icon: MessagesSquare, group: g, run: (c) => (c.close(), discuss()) })
    if (hasReport) out.push({ id: 'research.tasks', title: 'Make tasks from open questions', icon: ListChecks, group: g, run: (c) => (c.close(), setTasksOpen(true)) })
    if (inv.findings.length) out.push({ id: 'research.code', title: 'Send findings to Code', icon: SquareTerminal, group: g, run: (c) => (c.close(), codeFindings()) })
    if (hasReport) out.push({ id: 'research.deck', title: 'Make a deck from the report', icon: Presentation, group: g, run: (c) => (c.close(), makeDeck(inv)) })
    out.push({ id: 'research.hold', title: held ? 'Release the report' : 'Hold the report', icon: Layers, group: g, shortcut: 'H', run: (c) => (c.close(), toggleHold()) })
    out.push({ id: 'research.delete', title: 'Delete this investigation', icon: Trash2, group: g, run: (c) => (c.close(), void remove()) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.id, inv.status, inv.knowledgeId, hasReport, inv.findings.length, held])
  useRegisterCommands(`research.investigation.${inv.id}`, commands)

  const isBoard = tab === 'board' && columns
  // Wide stages split the report: the document, and its sources beside it (§3.12).
  const split = tab === 'report' && hasReport && !phone && layout.docking.stageWidth >= 1480
  const column = isBoard ? 'max-w-[1280px]' : split ? 'max-w-[1148px]' : 'max-w-[720px]'

  return (
    <div ref={scopeRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <Stage
        primary={ref}
        bodyRef={bodyRef}
        measure="full"
        header={
          <StageHeader<Tab>
            title={
              renaming ? (
                <TitleEditor
                  value={inv.title}
                  onDone={(t) => {
                    setRenaming(false)
                    if (t && t !== inv.title) updateInvestigation(inv.id, { title: t })
                  }}
                />
              ) : (
                inv.title
              )
            }
            status={<InvestigationStatusChip inv={inv} run={runLite} />}
            tabs={{
              'aria-label': 'Investigation views',
              value: tab,
              onChange: goTab,
              items: [
                { value: first, label: first === 'board' ? 'Board' : 'Report' },
                { value: 'findings', label: 'Findings', count: inv.findings.length || undefined },
                { value: 'sources', label: 'Sources', count: stats.active || undefined },
                { value: 'activity', label: 'Activity' },
              ],
            }}
            actions={visibleActions.length ? <>{visibleActions.map((a) => a.node)}</> : undefined}
            menu={turnHidden ? [...turnInto.filter((i) => i.type !== 'label' && i.type !== 'separator').slice(0, 4), { type: 'separator' }, ...menu] : menu}
            backTo="/research"
          />
        }
        composer={
          <div className={cn('mx-auto w-full', split ? 'max-w-[1148px]' : 'max-w-[720px]')}>
            <div className="max-w-[720px]">
              <FollowUpComposer inv={inv} active={active} />
            </div>
          </div>
        }
      >
        <div className={cn('mx-auto flex w-full flex-col', column)}>
          <Masthead inv={inv} agentId={runAgentId} working={runStatus === 'running'} compact={tab === 'findings' || tab === 'sources' || tab === 'activity'} phone={phone} />
          {active && runId && <Frontier inv={inv} runId={runId} sources={sources} className="mb-6" />}
          <ViewBoundary name={tab === 'board' ? 'board' : tab} resetKey={`${inv.id}:${tab}`}>
            {tab === 'board' && (
              <Board inv={inv} runId={runId} sources={sources} selectedId={selectedId} readingIds={readingIds} onSelectSource={selectSource} columns={columns} />
            )}
            {tab === 'report' &&
              (hasReport ? (
                split ? (
                  <div className="grid grid-cols-[720px_380px] items-start gap-12">
                    <ReportView inv={inv} sources={sources} runId={runId} busy={active} onSelectSource={selectSource} hotkeyScope={scopeRef} />
                    <SourcesRail inv={inv} sources={sources} selectedId={selectedId} readingIds={readingIds} onSelect={selectSource} onAll={() => goTab('sources')} />
                  </div>
                ) : (
                  <ReportView inv={inv} sources={sources} runId={runId} busy={active} onSelectSource={selectSource} hotkeyScope={scopeRef} />
                )
              ) : inv.status === 'failed' ? (
                <ErrorState
                  title="Couldn’t finish this investigation"
                  message={runError ? `The run stopped: ${runError}` : 'The research run stopped before the report was drafted.'}
                  onRetry={retry}
                  retryLabel="Retry"
                  className="py-10"
                />
              ) : (
                <EmptyState
                  icon={Telescope}
                  title="No report yet"
                  description={stats.active ? 'The sources are here, but no report was drafted. Run the research again to draft it.' : 'No sources matched. Widen the sources or rephrase.'}
                  actions={
                    <Button variant="primary" leadingIcon={RotateCw} onClick={retry}>
                      Run the research again
                    </Button>
                  }
                />
              ))}
            {tab === 'findings' && <FindingsView inv={inv} sources={sources} onSelectSource={selectSource} running={active} />}
            {tab === 'sources' && <SourcesView inv={inv} sources={sources} selectedId={selectedId} readingIds={readingIds} onSelect={selectSource} />}
            {tab === 'activity' && <ActivityView inv={inv} />}
          </ViewBoundary>
        </div>
      </Stage>
      <MakeTasksDialog open={tasksOpen} onOpenChange={setTasksOpen} inv={inv} candidates={questions} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ masthead

/**
 * Who researches it, at what depth, in which project — and the question, in the document voice. The
 * list views (findings, sources, activity) get a compact version so the list starts high.
 */
function Masthead({ inv, agentId, working, compact, phone }: { inv: Investigation; agentId?: string; working: boolean; compact?: boolean; phone?: boolean }) {
  const agent = useRow('agents', agentId ?? RESEARCH_AGENT_ID)
  const project = useRow('projects', inv.projectId)
  const sourcesOff = inv.sources && (!inv.sources.web || !inv.sources.knowledge)
  return (
    <header className={cn('flex flex-col', compact ? 'mb-5 gap-1.5' : 'mb-6 gap-2.5')}>
      <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
        {agent ? (
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <AgentMark seed={agent.sigil} hue={agent.hue} size={16} live={working} label={`${agent.name}, ${agent.role}`} />
            {agent.name}
          </span>
        ) : (
          <span className="text-ink-2">Research simulator</span>
        )}
        <span aria-hidden>·</span>
        <span>{DEPTH_LABEL[inv.depth]} depth</span>
        {sourcesOff && (
          <>
            <span aria-hidden>·</span>
            <span>{inv.sources?.web ? 'Web only' : 'Knowledge only'}</span>
          </>
        )}
        {project && (
          <>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn('size-2 rounded-[2px]', HUE_FILL[project.hue])} />
              {project.name}
            </span>
          </>
        )}
        {!phone && (
          <>
            <span aria-hidden>·</span>
            <span>Started {timeAgo(inv.createdAt)}</span>
            <span aria-hidden>·</span>
            <IdCode id={inv.id} />
          </>
        )}
      </div>
      {compact ? (
        <h2 className="type-body-sm line-clamp-2 max-w-[760px] text-pretty text-ink-2">{inv.question}</h2>
      ) : (
        <h2 className={cn('max-w-[760px] text-pretty text-ink', phone ? 'type-doc-h3' : 'type-doc-h2')}>{inv.question}</h2>
      )}
      {inv.origin && !compact && (
        <div className="type-caption flex min-w-0 items-center gap-1.5 text-ink-3">
          <span>From</span>
          <EntityChip entity={inv.origin} size="sm" />
        </div>
      )}
    </header>
  )
}

// ------------------------------------------------------------------------------------------------ follow-up

/** Tokens of a follow-up run (plan, knowledge, search, read, write) at the middle of their ranges. */
const FOLLOW_UP_TOKENS = (['plan', 'knowledge', 'search', 'browse', 'draft'] as const).reduce((n, k) => n + (STEP_PROFILE[k].tokens[0] + STEP_PROFILE[k].tokens[1]) / 2, 0)

/**
 * The docked follow-up composer (§6.5): an in-place composer with a ReadBack line. A follow-up asked
 * while a run works is queued and starts when it ends — no steering mid-run (§8.1).
 */
function FollowUpComposer({ inv, active }: { inv: Investigation; active: boolean }) {
  const phone = useShellLayout().formFactor === 'phone'
  const queued = useQueuedFollowUps(inv.id)
  const tokens = Math.round(FOLLOW_UP_TOKENS)
  const usd = estimateReferenceCost(Math.round(tokens * 0.7), Math.round(tokens * 0.3))
  const base = useReadBack({ kind: 'research', title: 'Follow-up', projectId: inv.projectId, agentId: RESEARCH_AGENT_ID })
  const readBack = useMemo(() => ({ ...base, cost: { usd, tokens, simulated: true, basedOn: 0 } }), [base, usd, tokens])
  const submit = (text: string, meta: ComposerSubmitMeta) => {
    const item = { question: text.trim(), context: meta.context.all, memory: meta.context.projectMemory }
    if (active) {
      queueFollowUp(inv.id, item)
      return
    }
    const r = askFollowUp(inv.id, item.question, { context: item.context, memory: item.memory })
    if (!r) throw new Error('This investigation no longer exists.')
  }
  const above = queued.length ? (
    <ul className="mb-2 flex flex-col gap-1" aria-label="Queued follow-ups">
      {queued.map((q, i) => (
        <li key={`${i}:${q.question}`} role="status" className="flex min-h-8 min-w-0 items-center gap-3 rounded-sm border border-line-strong bg-canvas py-1 pr-1 pl-2.5">
          <span className="type-caption min-w-0 flex-1 truncate text-ink-2">
            <span className="text-ink">Queued</span> — starts when this run ends · <span className="text-ink-3">“{q.question}”</span>
          </span>
          <Button size="xs" variant="ghost" onClick={() => cancelQueuedFollowUp(inv.id, i)}>
            Cancel
          </Button>
        </li>
      ))}
    </ul>
  ) : undefined
  return (
    <Composer
      placeholder={phone ? 'Ask a follow-up' : inv.report ? 'Ask a follow-up — Scout searches again and adds a section' : 'Ask a follow-up — it starts when this run ends'}
      aria-label="Ask a follow-up"
      submitLabel={active ? 'Queue' : 'Ask'}
      size={phone ? 'compact' : 'default'}
      showModel={false}
      above={above}
      readBack={<ReadBackLine data={readBack} />}
      contextOptions={{ projectId: inv.projectId, label: `Research · ${inv.title}` }}
      onSubmit={submit}
    />
  )
}

// ------------------------------------------------------------------------------------------------ wide report: sources rail

/** Beside the report on wide stages: its sources in report order, the selected one highlighted. */
function SourcesRail({ inv, sources, selectedId, readingIds, onSelect, onAll }: {
  inv: Investigation
  sources: readonly Source[]
  selectedId: ID | null
  readingIds: ReadonlySet<ID>
  onSelect: (id: ID) => void
  onAll: () => void
}) {
  const numberOf = useMemo(() => new Map(inv.sourceIds.map((id, i) => [id, i + 1])), [inv.sourceIds])
  const shown = useMemo(() => sources.filter((s) => s.status !== 'discarded'), [sources])
  return (
    <aside aria-labelledby="rail-sources" className="sticky top-0 flex max-h-[calc(100dvh-280px)] min-h-0 flex-col">
      <SectionLabel id="rail-sources" count={shown.length} action={<TextButton onClick={onAll}>All sources</TextButton>}>
        Sources
      </SectionLabel>
      <div className="-mx-1.5 min-h-0 overflow-y-auto overscroll-contain">
        <SourceList sources={shown} numberOf={numberOf} selectedId={selectedId} readingIds={readingIds} onSelect={onSelect} compact />
      </div>
    </aside>
  )
}

/** Inline rename in the stage header (⋯ › Rename): ⏎ saves, Esc cancels, leaving the field saves. */
function TitleEditor({ value, onDone }: { value: string; onDone: (title: string | null) => void }) {
  const [draft, setDraft] = useState(value)
  const done = useRef(false)
  const finish = (title: string | null) => {
    if (done.current) return
    done.current = true
    onDone(title)
  }
  return (
    <input
      value={draft}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft.replace(/\s+/g, ' ').trim() || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(draft.replace(/\s+/g, ' ').trim() || null)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish(null)
        }
      }}
      aria-label="Investigation title"
      className="type-title-3 h-8 w-full min-w-0 rounded-sm border border-line-input bg-raised px-1.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--focus-ring)"
    />
  )
}

// ------------------------------------------------------------------------------------------------ draft and gone

function DraftStage({ inv }: { inv: Investigation }) {
  const navigate = useNavigate()
  const stageRef = useRef<HTMLDivElement>(null)
  const [renaming, setRenaming] = useState(false)
  return (
    <Stage
      primary={{ kind: 'investigation', id: inv.id }}
      measure={760}
      header={
        <StageHeader
          title={
            renaming ? (
              <TitleEditor
                value={inv.title}
                onDone={(t) => {
                  setRenaming(false)
                  if (t && t !== inv.title) updateInvestigation(inv.id, { title: t })
                }}
              />
            ) : (
              inv.title
            )
          }
          status={<InvestigationStatusChip inv={inv} />}
          menu={[
            { id: 'rename', label: 'Rename', icon: PenLine, onSelect: () => setRenaming(true) },
            { type: 'separator' },
            { id: 'delete', label: 'Delete draft…', icon: Trash2, danger: true, onSelect: () => void confirmDelete(inv).then((ok) => ok && navigate('/research')) },
          ]}
          backTo="/research"
        />
      }
    >
      <div ref={stageRef} className="flex flex-col pb-10">
        <p className="type-label text-ink-3">Draft · saved {timeAgo(inv.updatedAt)}</p>
        <h2 className="type-title-2 mt-1 text-ink">Finish the brief, then start the research.</h2>
        <p className="type-body mt-1 text-pretty text-ink-3">Nothing has run yet. Edit the question, angles and sources; Start research runs it, Save draft keeps your changes.</p>
        <div className="mt-5">
          <NewBrief draft={inv} dropTarget={stageRef} />
        </div>
      </div>
    </Stage>
  )
}

function GoneStage() {
  const navigate = useNavigate()
  return (
    <Stage header={<StageHeader title="Research" backTo="/research" />}>
      <EmptyState
        icon={Telescope}
        title="This investigation isn’t here"
        description="It may have been deleted on this device. Investigations live only in this browser."
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/research/new')}>
              New investigation
            </Button>
            <Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => navigate('/research')}>
              All investigations
            </Button>
          </>
        }
      />
    </Stage>
  )
}

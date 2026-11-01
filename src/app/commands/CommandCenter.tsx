import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { CircleStop, CornerDownLeft, MessagesSquare, Search, TriangleAlert } from 'lucide-react'
import { useDB } from '@/core/db'
import { useScope } from '@/core/context'
import { detectIntent, getModelInfo, type Intent } from '@/core/ai'
import { useSearch } from '@/core/search'
import { entityRoute, useProjects } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { EntityRef, ID } from '@/core/types'
import { refKey } from '@/core/types'
import { Button, Kbd, KbdCombo, Markdown, Portal, useLayer, useOverlayFocus, useReducedMotion, useScrollLock } from '@/ui'
import { ProvenanceLine, SimBadge } from '@/ui/signature'
import { cn } from '@/lib/cn'
import type { Command, CommandContext } from '../types'
import { attachRun, useShellStore } from '../shell/store'
import { useShellLayout } from '../shell/context'
import { switchScope } from '../shell/scope'
import { selectNeedsYou } from '../shell/signals'
import { ProjectMark } from '../shell/ProjectSwitcher'
import { announce } from '../shell/Announcer'
import { collectCommands, useCommandRegistryVersion } from './registry'
import {
  findByHandle,
  isStrongTitleMatch,
  matchText,
  mentionsFromReason,
  nextVerb,
  parseQuery,
  shouldShowIntent,
  type Match,
  type Mode,
  type Range,
} from './model'
import { runIntent } from './intents'
import { continueInChat, useQuickAsk } from './quickAsk'
import { CommandPreview, CommandRowContent, EntityPreview, EntityRowContent, IntentPreview, IntentRowContent } from './Rows'

// ------------------------------------------------------------------------------------------------ items

type Item =
  | { key: string; type: 'intent'; verb: Intent; text: string; mentions: string[]; reason: string; title?: string }
  | { key: string; type: 'command'; command: Command; ranges?: Range[] }
  | { key: string; type: 'entity'; ref: EntityRef; ranges?: Range[]; snippet?: string; snippetRanges?: Range[]; anchor?: EntityRef }
  | { key: string; type: 'project'; projectId: ID | null; name: string; ranges?: Range[] }
  | { key: string; type: 'ask'; text: string }
  | { key: string; type: 'continue' }

interface Section {
  id: string
  label?: string
  items: Item[]
}

const LIMITS = { actions: 5, workspaces: 4, items: 8, knowledge: 5, settings: 5 }

function rankCommands(commands: Command[], text: string, limit: number): Item[] {
  const scored: { c: Command; m: Match }[] = []
  for (const c of commands) {
    const m = matchText(text, c.title, [...(c.keywords ?? []), c.group, c.subtitle ?? ''])
    if (m) scored.push({ c, m })
  }
  return scored
    .sort((a, b) => b.m.score - a.m.score || (b.c.priority ?? 0) - (a.c.priority ?? 0))
    .slice(0, limit)
    .map(({ c, m }) => ({ key: `cmd:${c.id}`, type: 'command', command: c, ranges: m.ranges }))
}

const isSettings = (c: Command) => c.group === 'Settings'
const isGoTo = (c: Command) => c.group === 'Go to'

// ------------------------------------------------------------------------------------------------ component

/** The command center (⌘K, §3.7): search, commands, handle jumps, intents and quick ask. */
export function CommandCenter() {
  const open = useShellStore((s) => s.commandOpen)
  const setOpen = useShellStore((s) => s.setCommandOpen)
  const reduced = useReducedMotion()
  const { formFactor } = useShellLayout()
  const phone = formFactor === 'phone'
  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <div className="fixed inset-0 z-(--z-overlay)" data-layer="">
            <motion.div
              aria-hidden
              className="absolute inset-0 bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ duration: reduced ? 0.12 : 0.24 }}
            />
            <CommandPanel onClose={() => setOpen(false)} phone={phone} />
          </div>
        </Portal>
      )}
    </AnimatePresence>
  )
}

function CommandPanel({ onClose, phone }: { onClose: () => void; phone: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace, formFactor } = useShellLayout()
  const seed = useShellStore((s) => s.commandSeed)
  const scope = useScope()
  const recents = useShellStore((s) => s.recents)
  const projects = useProjects({ status: ['active', 'paused'] })
  const scopeProject = projects.find((p) => p.id === scope)
  const defaultModelId = useSettings((s) => s.ai.defaultModelId)
  const registryVersion = useCommandRegistryVersion()
  const reduced = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const [query, setQuery] = useState(seed)
  const [active, setActive] = useState(0)
  const [verbOverride, setVerbOverride] = useState<Intent | null>(null)
  const quick = useQuickAsk(scope)
  const wide = formFactor === 'large' || formFactor === 'wide' || formFactor === 'desktop'

  const layerId = useLayer({ open: true, modal: true, inside: [panelRef], onEscape: onClose, onOutside: onClose })
  useOverlayFocus({ open: true, container: panelRef, initialFocus: inputRef, trap: true, layerId })
  useScrollLock(true)

  const parsed = parseQuery(query)
  const mode: Mode = parsed.mode
  const text = parsed.text
  const ctx = useMemo<CommandContext>(
    () => ({ navigate, scopeProjectId: scope, pathname: location.pathname, close: onClose }),
    [navigate, scope, location.pathname, onClose],
  )
  const commands = useMemo(() => collectCommands(ctx, workspace), [ctx, workspace, registryVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // Search runs for plain queries and @ item queries (global; current project ranked first).
  const searchText = mode === 'search' || mode === 'item' ? text : ''
  const { results, ready } = useSearch(searchText, { limit: 24 })
  const handleKey = useDB((s) => {
    if (mode !== 'search' && mode !== 'item') return ''
    const ref = findByHandle(s, text)
    return ref ? refKey(ref) : ''
  })
  const handleRef = useMemo<EntityRef | null>(() => {
    if (!handleKey) return null
    const i = handleKey.indexOf(':')
    return { kind: handleKey.slice(0, i) as EntityRef['kind'], id: handleKey.slice(i + 1) }
  }, [handleKey])

  const intent = useMemo(() => (mode === 'search' && text ? detectIntent(text) : null), [mode, text])
  const showIntent = !!intent && shouldShowIntent(text, intent)
  const verb = verbOverride ?? intent?.intent ?? 'ask'
  useEffect(() => setVerbOverride(null), [text])

  const needs = useDB((s) => {
    const n = selectNeedsYou(s)
    return [...n.approvals.map((a) => `approval:${a.id}`), ...n.sessions.map((x) => `session:${x.id}`), ...n.tasks.map((t) => `task:${t.id}`)].slice(0, 3).join(',')
  })

  const sections = useMemo<Section[]>(() => {
    const out: Section[] = []
    const entityItem = (ref: EntityRef, extra: Partial<Extract<Item, { type: 'entity' }>> = {}): Item => ({ key: `ent:${refKey(ref)}`, type: 'entity', ref, ...extra })

    if (mode === 'ask') {
      if (quick.state.status !== 'idle' && quick.state.question === text && (quick.state.status === 'done' || quick.state.status === 'stopped')) {
        out.push({ id: 'continue', items: [{ key: 'continue', type: 'continue' }] })
      } else if (text) {
        out.push({ id: 'ask', items: [{ key: 'ask', type: 'ask', text }] })
      }
      return out
    }

    if (mode === 'project') {
      const items: Item[] = []
      const all = matchText(text, 'All work')
      if (all) items.push({ key: 'prj:all', type: 'project', projectId: null, name: 'All work', ranges: all.ranges })
      const scored = projects
        .map((p) => ({ p, m: matchText(text, p.name) }))
        .filter((x): x is { p: (typeof projects)[number]; m: Match } => !!x.m)
        .sort((a, b) => b.m.score - a.m.score)
      for (const { p, m } of scored) items.push({ key: `prj:${p.id}`, type: 'project', projectId: p.id, name: p.name, ranges: m.ranges })
      out.push({ id: 'projects', label: 'Switch project', items })
      return out
    }

    if (mode === 'command') {
      const pool = [...commands.view, ...commands.global, ...commands.goTo]
      if (!text) {
        if (commands.view.length) out.push({ id: 'view', label: 'Actions for this view', items: commands.view.map((c) => ({ key: `cmd:${c.id}`, type: 'command', command: c })) })
        const groups = new Map<string, Command[]>()
        for (const c of [...commands.global, ...commands.goTo]) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
        for (const [g, list] of groups) out.push({ id: `g:${g}`, label: g, items: list.map((c) => ({ key: `cmd:${c.id}`, type: 'command', command: c })) })
        return out
      }
      out.push({ id: 'commands', label: 'Commands', items: rankCommands(pool, text, 12) })
      return out
    }

    // Item results (shared by search and @ modes).
    const scoped = [...results].sort((a, b) => Number(b.projectId === scope && !!scope) - Number(a.projectId === scope && !!scope))
    const strong = mode === 'search' ? scoped.filter((r) => isStrongTitleMatch(text, r.title)).slice(0, 2) : []
    const strongKeys = new Set(strong.map((r) => refKey(r.ref)))
    const titleRanges = (title: string) => matchText(text, title)?.ranges
    const items = scoped.filter((r) => r.kind !== 'knowledge' && !strongKeys.has(refKey(r.ref)))
    const knowledge = scoped.filter((r) => r.kind === 'knowledge' && !strongKeys.has(refKey(r.ref)))

    if (mode === 'item') {
      if (handleRef) out.push({ id: 'handle', label: 'Jump to', items: [entityItem(handleRef)] })
      if (!text) {
        out.push({ id: 'recents', label: 'Resume', items: recents.slice(0, 8).map((r) => entityItem(r)) })
        return out
      }
      out.push({ id: 'items', label: 'Items', items: items.slice(0, 12).map((r) => entityItem(r.ref, { ranges: titleRanges(r.title), anchor: r.anchor })) })
      out.push({
        id: 'knowledge',
        label: 'Knowledge',
        items: knowledge.slice(0, 8).map((r) => entityItem(r.ref, { ranges: titleRanges(r.title), snippet: r.snippet, snippetRanges: r.highlights })),
      })
      return out.filter((s) => s.items.length)
    }

    // Plain search.
    if (!text) {
      const needItems = needs ? needs.split(',').map((k) => { const [kind, id] = k.split(':'); return entityItem({ kind: kind as EntityRef['kind'], id }) }) : []
      if (needItems.length) out.push({ id: 'needs', label: 'Needs you', items: needItems })
      if (recents.length) out.push({ id: 'recents', label: 'Resume', items: recents.slice(0, 5).map((r) => entityItem(r)) })
      if (commands.view.length) out.push({ id: 'view', label: 'Actions for this view', items: commands.view.slice(0, 6).map((c) => ({ key: `cmd:${c.id}`, type: 'command', command: c })) })
      out.push({ id: 'goto', label: 'Go to', items: commands.goTo.map((c) => ({ key: `cmd:${c.id}`, type: 'command', command: c })) })
      return out
    }

    if (handleRef) out.push({ id: 'handle', label: 'Jump to', items: [entityItem(handleRef)] })
    if (strong.length) out.push({ id: 'best', label: 'Best match', items: strong.map((r) => entityItem(r.ref, { ranges: titleRanges(r.title), anchor: r.anchor })) })
    if (showIntent && intent) {
      out.push({
        id: 'intent',
        items: [{ key: 'intent', type: 'intent', verb, text, mentions: mentionsFromReason(intent.reason), reason: intent.reason, title: intent.suggestions?.title }],
      })
    }
    const actions = rankCommands([...commands.view, ...commands.global].filter((c) => !isSettings(c) && !isGoTo(c)), text, LIMITS.actions)
    const workspaces = rankCommands(commands.goTo, text, LIMITS.workspaces)
    const settings = rankCommands(commands.global.filter(isSettings), text, LIMITS.settings)
    if (actions.length) out.push({ id: 'actions', label: 'Actions', items: actions })
    if (workspaces.length) out.push({ id: 'workspaces', label: 'Workspaces', items: workspaces })
    if (items.length) out.push({ id: 'items', label: 'Items', items: items.slice(0, LIMITS.items).map((r) => entityItem(r.ref, { ranges: titleRanges(r.title), anchor: r.anchor })) })
    if (knowledge.length) {
      out.push({
        id: 'knowledge',
        label: 'Knowledge',
        items: knowledge.slice(0, LIMITS.knowledge).map((r) => entityItem(r.ref, { ranges: titleRanges(r.title), snippet: r.snippet, snippetRanges: r.highlights })),
      })
    }
    if (settings.length) out.push({ id: 'settings', label: 'Settings', items: settings })
    return out
  }, [mode, text, quick.state.status, quick.state.question, projects, commands, results, scope, handleRef, recents, needs, showIntent, intent, verb])

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  useEffect(() => setActive(0), [query])
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1))
  const activeItem = flat[activeIndex]
  const optionId = (i: number) => `${listId}-opt-${i}`

  // Keep the active option in view.
  useEffect(() => {
    const el = document.getElementById(optionId(activeIndex))
    el?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  // ------------------------------------------------------------------------------------------ actions

  const openEntity = useCallback(
    (ref: EntityRef, anchor?: EntityRef) => {
      onClose()
      if (ref.kind === 'run') {
        navigate(entityRoute(ref))
        return
      }
      if (ref.kind === 'approval') {
        const st = useShellStore.getState()
        st.setNeedsYouTab('needs')
        st.setNeedsYouOpen(true)
        return
      }
      navigate(entityRoute(anchor && anchor.kind === 'message' ? anchor : ref))
    },
    [navigate, onClose],
  )

  const run = useCallback(
    async (item: Item | undefined, background: boolean) => {
      if (!item) return
      switch (item.type) {
        case 'entity':
          if (background && item.ref.kind === 'run') {
            attachRun(item.ref.id, workspace.id)
            onClose()
            return
          }
          openEntity(item.ref, item.anchor)
          return
        case 'command':
          onClose()
          try {
            await item.command.run(ctx)
          } catch (err) {
            console.error(err)
          }
          return
        case 'project':
          switchScope(item.projectId)
          onClose()
          if (background) navigate(item.projectId ? `/projects/${encodeURIComponent(item.projectId)}` : '/projects')
          announce(item.projectId ? `Switched to ${item.name}` : 'Showing all work')
          return
        case 'intent':
          onClose()
          try {
            await runIntent({ verb: item.verb, text: item.text, title: item.title, projectId: scope, background, navigate })
          } catch (err) {
            console.error(err)
          }
          return
        case 'ask':
          void quick.ask(item.text)
          return
        case 'continue': {
          const threadId = continueInChat(quick.state, scope)
          onClose()
          navigate(`/chat/${encodeURIComponent(threadId)}`)
          return
        }
      }
    },
    [ctx, navigate, onClose, openEntity, quick, scope, workspace.id],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      if (flat.length) setActive((i) => (Math.min(i, flat.length - 1) + 1) % flat.length)
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      if (flat.length) setActive((i) => (Math.min(i, flat.length - 1) - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'ask' && quick.state.status === 'streaming') return
      void run(activeItem, e.metaKey || e.ctrlKey)
    } else if (e.key === 'Tab' && showIntent && mode === 'search') {
      e.preventDefault()
      const nv = nextVerb(verb, e.shiftKey ? -1 : 1)
      setVerbOverride(nv)
      const idx = flat.findIndex((i) => i.type === 'intent')
      if (idx >= 0) setActive(idx)
      announce(`Run as ${nv}`)
    } else if (e.key === '.' && (e.metaKey || e.ctrlKey) && quick.state.status === 'streaming') {
      e.preventDefault()
      quick.stop()
    }
  }

  const mono = mode !== 'search'
  const showPreview = wide && !phone && !!activeItem && activeItem.type !== 'ask' && activeItem.type !== 'continue' && mode !== 'ask'
  const placeholder =
    mode === 'command' ? 'Run a command…' : mode === 'project' ? 'Switch project…' : mode === 'item' ? 'Find an item…' : mode === 'ask' ? 'Ask a quick question…' : 'Search or start…'
  const modelLabel = getModelInfo(defaultModelId)?.label ?? defaultModelId
  const simulatedModel = getModelInfo(defaultModelId)?.simulated ?? false
  const empty = flat.length === 0 && mode !== 'ask'

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Command center"
      tabIndex={-1}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: 4, scale: 0.985, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
      transition={{ duration: reduced ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'absolute flex flex-col overflow-hidden border border-line bg-overlay text-ink shadow-e2 outline-none',
        phone
          ? 'inset-0 rounded-none border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
          : 'top-[12vh] left-1/2 max-h-[70vh] w-[min(680px,calc(100vw-32px))] -translate-x-1/2 rounded-lg transition-[width] duration-(--dur-3) ease-standard',
        !phone && showPreview && 'w-[min(960px,calc(100vw-32px))]',
      )}
    >
      {/* Input row (52px) */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <Search aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="type-mono-sm hidden shrink-0 items-center gap-1 text-ink-3 sm:flex" title={scopeProject ? `Scoped to ${scopeProject.name}` : 'All work'}>
          {scopeProject ? <ProjectMark project={scopeProject} size={12} /> : null}
          {scopeProject ? scopeProject.name : 'All work'} ›
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeItem ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-label="Search or start"
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className={cn('min-w-0 flex-1 bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-3', mono ? 'font-mono' : 'font-sans')}
        />
        {mode === 'ask' && quick.state.status === 'streaming' ? (
          <Button size="xs" variant="ghost" leadingIcon={CircleStop} kbd="mod+." onClick={quick.stop}>
            Stop
          </Button>
        ) : (
          query && (
            <button type="button" onClick={() => setQuery('')} className="type-caption shrink-0 rounded-xs px-1.5 py-0.5 text-ink-3 hover:bg-hover hover:text-ink">
              Clear
            </button>
          )
        )}
        {phone && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>

      {mode === 'ask' && quick.state.status !== 'idle' && <AskAnswer state={quick.state} />}
      {mode === 'ask' && quick.state.status === 'idle' && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="type-caption text-ink-3">Answers come from your default model,</span>
          <span className="type-caption font-medium text-ink-2">{modelLabel}</span>
          {simulatedModel && <SimBadge size="xs" />}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className={cn('min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain py-1.5', showPreview && 'max-w-[680px]')}
        >
          {empty ? (
            <EmptyResults mode={mode} text={text} searching={!ready} />
          ) : (
            sections.map((section) => (
              <div key={section.id} role="group" aria-labelledby={section.label ? `${listId}-${section.id}` : undefined} aria-label={section.label ? undefined : 'Start'}>
                {section.label && (
                  <div id={`${listId}-${section.id}`} className="type-label px-4 pt-2.5 pb-1 text-ink-3">
                    {section.label}
                  </div>
                )}
                {section.items.map((item) => {
                  const index = flat.indexOf(item)
                  return (
                    <Row key={item.key} id={optionId(index)} selected={index === activeIndex} onHover={() => setActive(index)} onPick={(bg) => void run(item, bg)}>
                      <ItemContent item={item} projectName={scopeProject?.name} onPickVerb={() => setVerbOverride(nextVerb(verb))} modelLabel={modelLabel} simulated={simulatedModel} />
                    </Row>
                  )
                })}
              </div>
            ))
          )}
        </div>
        {showPreview && activeItem && (
          <aside aria-label="Preview" className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-line bg-canvas/40 p-4 xl:block">
            <Preview item={activeItem} projectName={scopeProject?.name} />
          </aside>
        )}
      </div>

      {!phone && (
        <footer className="type-meta flex h-8 shrink-0 items-center gap-3 overflow-hidden border-t border-line px-4 whitespace-nowrap text-ink-3">
          <Hint k="enter">open/run</Hint>
          <Hint k="mod+enter">background</Hint>
          <Hint k="tab">verb</Hint>
          <span className="flex items-center gap-1.5"><Kbd>#</Kbd> project</span>
          <span className="flex items-center gap-1.5"><Kbd>&gt;</Kbd> command</span>
          <span className="flex items-center gap-1.5"><Kbd>@</Kbd> item</span>
          <span className="flex items-center gap-1.5"><Kbd>?</Kbd> ask</span>
          <span className="ml-auto flex items-center gap-1.5"><Kbd>esc</Kbd></span>
        </footer>
      )}
    </motion.div>
  )
}

function Hint({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <KbdCombo combo={k} variant="plain" />
      {children}
    </span>
  )
}

function Row({ id, selected, onHover, onPick, children }: { id: string; selected: boolean; onHover: () => void; onPick: (background: boolean) => void; children: ReactNode }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onPointerMove={onHover}
      onClick={(e) => onPick(e.metaKey || e.ctrlKey)}
      className={cn(
        'mx-1.5 flex min-h-9 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-1.5 transition-colors duration-(--dur-1) pointer-coarse:min-h-11',
        selected ? 'bg-hover' : 'bg-transparent',
      )}
    >
      {children}
    </div>
  )
}

function ItemContent({ item, projectName, onPickVerb, modelLabel, simulated }: { item: Item; projectName?: string; onPickVerb: () => void; modelLabel: string; simulated: boolean }) {
  switch (item.type) {
    case 'entity':
      return <EntityRowContent entity={item.ref} titleRanges={item.ranges} snippet={item.snippet} snippetRanges={item.snippetRanges} />
    case 'command':
      return <CommandRowContent command={item.command} ranges={item.ranges} />
    case 'intent':
      return <IntentRowContent verb={item.verb} projectName={projectName} mentions={item.mentions} onPickVerb={onPickVerb} />
    case 'project':
      return <ProjectRow projectId={item.projectId} name={item.name} ranges={item.ranges} />
    case 'ask':
      return (
        <>
          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border border-line-strong text-ink-2">
            <CornerDownLeft className="size-3" strokeWidth={2} />
          </span>
          <span className="type-body-sm min-w-0 flex-1 truncate text-ink">
            Ask <span className="font-semibold">{modelLabel}</span>
            <span className="text-ink-3"> · {item.text}</span>
          </span>
          {simulated && <SimBadge size="xs" />}
        </>
      )
    case 'continue':
      return (
        <>
          <MessagesSquare aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="type-body-sm flex-1 font-medium text-ink">Continue in Chat</span>
          <KbdCombo combo="enter" variant="plain" />
        </>
      )
  }
}

function ProjectRow({ projectId, name, ranges }: { projectId: ID | null; name: string; ranges?: Range[] }) {
  const project = useDB((s) => (projectId ? s.projects[projectId] : undefined))
  const scope = useScope()
  return (
    <>
      <ProjectMark project={project ?? null} size={20} />
      <span className="type-body-sm flex-1 truncate font-medium text-ink">
        {ranges?.length ? <HighlightedName name={name} ranges={ranges} /> : name}
      </span>
      {scope === projectId && <span className="type-meta-caps text-ink-3">Current</span>}
    </>
  )
}

function HighlightedName({ name, ranges }: { name: string; ranges: Range[] }) {
  return (
    <>
      {ranges.reduce<ReactNode[]>((acc, [s, e], i) => {
        const prevEnd = i === 0 ? 0 : ranges[i - 1][1]
        acc.push(name.slice(prevEnd, s), <mark key={i} className="rounded-[2px] bg-highlight text-inherit">{name.slice(s, e)}</mark>)
        if (i === ranges.length - 1) acc.push(name.slice(e))
        return acc
      }, [])}
    </>
  )
}

function Preview({ item, projectName }: { item: Item; projectName?: string }) {
  switch (item.type) {
    case 'entity':
      return <EntityPreview entity={item.ref} />
    case 'command':
      return <CommandPreview command={item.command} />
    case 'intent':
      return <IntentPreview verb={item.verb} projectName={projectName} reason={item.reason} />
    case 'project':
      return (
        <div className="flex flex-col gap-2">
          <span className="type-label text-ink-3">Scope</span>
          <span className="type-body-sm font-semibold text-ink">{item.name}</span>
          <p className="type-caption text-ink-2">
            {item.projectId ? 'Lists, Home and new work file into this project. Its memory rides along in new runs.' : 'Show everything across projects.'}
          </p>
          <p className="type-caption text-ink-3">
            <KbdCombo combo="enter" variant="plain" /> switch · <KbdCombo combo="mod+enter" variant="plain" /> switch and open
          </p>
        </div>
      )
    default:
      return null
  }
}

function EmptyResults({ mode, text, searching }: { mode: Mode; text: string; searching: boolean }) {
  if (searching && text) return <p className="type-body-sm px-4 py-6 text-ink-3">Searching…</p>
  return (
    <div className="flex flex-col gap-1 px-4 py-6">
      <p className="type-body-sm font-medium text-ink">{text ? `Nothing matches “${text}”` : 'Nothing here yet'}</p>
      <p className="type-caption text-ink-3">
        {mode === 'command'
          ? 'Try another word, or clear the > to search everything.'
          : mode === 'project'
            ? 'Try another name, or create the project from the project switcher (P).'
            : 'Try fewer words, a handle like RUN-K3J9, or start with ? to ask.'}
      </p>
    </div>
  )
}

function AskAnswer({ state }: { state: ReturnType<typeof useQuickAsk>['state'] }) {
  const viewRun = () => {
    if (state.runId) attachRun(state.runId)
  }
  const streaming = state.status === 'streaming'
  const finished = state.status === 'done' || state.status === 'stopped'
  useEffect(() => {
    if (state.status === 'done') announce('Answer complete')
  }, [state.status])
  if (state.status === 'error') {
    return (
      <div role="alert" className="flex shrink-0 items-start gap-2.5 border-b border-line px-4 py-3">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-fail-ink" strokeWidth={1.75} />
        <div className="flex flex-col gap-2">
          <p className="type-body-sm text-ink">{state.error}</p>
          <QuickAskErrorActions />
        </div>
      </div>
    )
  }
  return (
    <section aria-label="Answer" aria-busy={streaming || undefined} className="flex shrink-0 gap-3 border-b border-line px-4 py-3">
      {state.simulated && <span aria-hidden className="sim-band shrink-0 self-stretch rounded-[1px]" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="type-label flex items-center gap-1.5 text-ink-3">
          {state.modelLabel}
          {state.simulated && <SimBadge size="xs" />}
        </div>
        <div className={cn('type-body-sm max-h-[32vh] overflow-y-auto overscroll-contain pr-1 text-ink', streaming && !state.answer && 'text-ink-3')}>
          {state.answer ? <Markdown prose="ui">{state.answer}</Markdown> : streaming ? 'Working on it…' : null}
        </div>
        {finished && (
          <ProvenanceLine
            modelLabel={state.modelLabel}
            simulated={state.simulated}
            usage={state.usage}
            durationMs={state.durationMs}
            costIsEstimate={state.simulated}
            stopped={state.status === 'stopped'}
            onViewRun={state.runId ? viewRun : undefined}
          />
        )}
      </div>
    </section>
  )
}

function QuickAskErrorActions() {
  const navigate = useNavigate()
  const setOpen = useShellStore((s) => s.setCommandOpen)
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="xs"
        variant="secondary"
        onClick={() => {
          setOpen(false)
          navigate('/integrations/anthropic')
        }}
      >
        Open Integrations
      </Button>
    </div>
  )
}

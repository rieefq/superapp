import { useNavigate, useLocation } from 'react-router'
import { useDB } from '@/core/db'
import { useContextStore } from '@/core/context'
import { stopGeneration } from '@/core/ai'
import { runEngine } from '@/core/runs'
import { useSettings } from '@/core/settings'
import type { EntityRef } from '@/core/types'
import { getTabbables, isTypingTarget, toast, useChord, useHotkey } from '@/ui'
import { MANIFESTS } from '../registry'
import type { CommandContext, WorkspaceId } from '../types'
import { keysFor } from '../shortcuts'
import { currentSegment, openStartSheet, useShellStore, type StartKind } from './store'
import { useShellLayout } from './context'
import { toggleHold } from './scope'
import { announce } from './Announcer'

const REGIONS = ['topbar', 'rail', 'list', 'stage', 'inspector', 'runline'] as const

/** F6 / ⇧F6: top bar → rail → list pane → stage → Inspector → Run Line (§3.11, §8.5). */
export function cycleRegion(direction: 1 | -1): void {
  const present = REGIONS.map((r) => {
    if (r === 'stage') return document.querySelector<HTMLElement>('[data-region="stage"]') ?? document.querySelector<HTMLElement>('[data-region="workspace"]')
    return document.querySelector<HTMLElement>(`[data-region="${r}"]`)
  }).filter((el): el is HTMLElement => !!el && el.getClientRects().length > 0)
  if (!present.length) return
  const active = document.activeElement as HTMLElement | null
  const current = present.findIndex((el) => el.contains(active))
  const next = present[(current + direction + present.length) % present.length]
  const target = getTabbables(next)[0]
  if (target) target.focus()
  else {
    if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1')
    next.focus()
  }
  const name = next.getAttribute('aria-label') ?? next.dataset.region ?? ''
  if (name) announce(name)
}

/** The item a single key acts on: the peeked item, else the selection, else the stage's primary object. */
export function currentItem(): EntityRef | null {
  const st = useShellStore.getState()
  const selection = st.selectionPath === currentSegment() ? st.selection : null
  return st.inspectStack[st.inspectStack.length - 1] ?? selection ?? st.stagePrimary ?? null
}

/** What `N` does in workspaces without a manifest `newAction`. */
const NEW_FALLBACK: Partial<Record<WorkspaceId, StartKind | string>> = {
  research: 'research',
  code: 'session',
  agents: 'agent',
  projects: 'task',
  knowledge: 'note',
  studio: 'studio',
  chat: '/chat',
  workflows: '/workflows/new',
}

/** Focus the workspace's composer, or its search field when it has none (`/`). */
function focusComposer(): boolean {
  const main = document.getElementById('main')
  if (!main) return false
  const target =
    main.querySelector<HTMLElement>('[data-composer-input]') ??
    main.querySelector<HTMLElement>('[data-composer] textarea, [data-composer] [contenteditable="true"]') ??
    main.querySelector<HTMLElement>('input[type="search"], [role="searchbox"], [data-search-input]')
  if (!target) return false
  target.focus()
  return true
}

/** Binds the global keyboard map (§3.11). Single keys respect settings.appearance.singleKeyShortcuts. */
export function ShellShortcuts() {
  const navigate = useNavigate()
  const location = useLocation()
  const layout = useShellLayout()
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  const scope = useContextStore((s) => s.scopeProjectId)
  const attachedRunId = useShellStore((s) => s.attachedRunId)
  const primary = useShellStore((s) => s.stagePrimary)
  const streamingInView = useDB((s) => {
    if (primary?.kind !== 'thread') return undefined
    const thread = s.threads[primary.id]
    if (!thread) return undefined
    for (let i = thread.messageIds.length - 1; i >= 0; i--) {
      const m = s.messages[thread.messageIds[i]]
      if (m?.status === 'streaming') return m.id
    }
    return undefined
  })
  const st = useShellStore.getState

  const ctx = (): CommandContext => ({
    navigate,
    scopeProjectId: scope,
    pathname: location.pathname,
    close: () => st().setCommandOpen(false),
  })

  // ---- global (work inside text fields too)
  useHotkey(keysFor('command'), () => {
    const s = st()
    if (s.commandOpen) s.setCommandOpen(false)
    else s.openCommand('')
  })
  // ⌘. — a focused composer stops its own streaming reply first; the shell handles what's left
  // (the streaming answer in view, otherwise the attached run).
  useHotkey(
    keysFor('stop'),
    (e) => {
      setTimeout(() => {
        if (e.defaultPrevented) return
        if (streamingInView) {
          stopGeneration(streamingInView)
          announce('Stopped the answer')
          return
        }
        const run = attachedRunId ? useDB.getState().runs[attachedRunId] : undefined
        if (run && (run.status === 'running' || run.status === 'queued' || run.status === 'waiting' || run.status === 'paused')) {
          runEngine.cancel(run.id, 'Stopped by you')
          toast(`Stopped “${run.title}”`)
          return
        }
        toast('Nothing to stop', { description: 'Attach a run to the Inspector, or stop a streaming answer in view.' })
      }, 0)
    },
    { preventDefault: false },
  )
  useHotkey(keysFor('inspector'), () => layout.toggleInspector())
  useHotkey(keysFor('sheet'), () => st().setShortcutsOpen(!st().shortcutsOpen))
  useHotkey(keysFor('region-next'), () => cycleRegion(1), { allowInInputs: true })
  useHotkey(keysFor('region-prev'), () => cycleRegion(-1), { allowInInputs: true })
  useHotkey(
    'escape',
    (e) => {
      const target = e.target as HTMLElement | null
      if (isTypingTarget(target)) {
        target?.blur()
        return
      }
      const s = st()
      if (s.selection) s.setSelection(null)
    },
    { allowInInputs: true, preventDefault: false },
  )

  // ---- single keys (outside text fields; can be turned off)
  const single = { enabled: singleKeys }
  for (const m of MANIFESTS) {
    // The manifest list is static, so the hook order is stable.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useChord(m.chord ?? ['', ''], () => navigate(m.path), { enabled: singleKeys && !!m.chord })
  }
  useHotkey(keysFor('focus-composer'), (e) => {
    if (!focusComposer()) {
      e.preventDefault()
      st().openCommand('')
    }
  }, single)
  // N — the manifest's newAction (a view that binds N itself wins: the shell acts only if it didn't).
  useHotkey(
    keysFor('new'),
    (e) => {
      setTimeout(() => {
        if (e.defaultPrevented) return
        const m = layout.workspace
        if (m.newAction) {
          m.newAction.run(ctx())
          return
        }
        const fallback = NEW_FALLBACK[m.id]
        if (!fallback) st().openCommand('')
        else if (fallback.startsWith('/')) navigate(fallback)
        else openStartSheet(fallback as StartKind)
      }, 0)
    },
    { ...single, preventDefault: false },
  )
  useHotkey(keysFor('projects'), () => st().setProjectSwitcherOpen(true), single)
  useHotkey(keysFor('needs-you'), () => {
    st().setNeedsYouTab('needs')
    st().setNeedsYouOpen(true)
  }, single)
  useHotkey(keysFor('list-pane'), () => layout.toggleListPane(), single)
  useHotkey(keysFor('inspector-key'), () => layout.toggleInspector(), single)
  useHotkey(keysFor('sheet-key'), () => st().setShortcutsOpen(true), single)

  // Item keys fall back to the shell only when the workspace did not handle the key itself.
  useHotkey(
    keysFor('hold'),
    (e) => {
      setTimeout(() => {
        if (e.defaultPrevented) return
        const ref = currentItem()
        if (ref) toggleHold(ref)
      }, 0)
    },
    { ...single, preventDefault: false },
  )
  useHotkey(
    keysFor('turn-into'),
    (e) => {
      setTimeout(() => {
        if (e.defaultPrevented) return
        const ref = currentItem()
        if (ref) openStartSheet('task', { source: ref })
      }, 0)
    },
    { ...single, preventDefault: false },
  )

  return null
}

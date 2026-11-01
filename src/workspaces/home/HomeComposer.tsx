import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Composer, startEvents, toChatSelection, useComposerContext, type ComposerSubmitMeta } from '@/app/components'
import { openStartSheet } from '@/app/shell/store'
import { sendMessage, suggestTitle } from '@/core/ai'
import { draftWorkflowFromText, kindFromCreateText, pickAgentForInstruction } from '@/core/assist'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { createWorkflow, generateAsset, updateWorkflow } from '@/core/services'
import type { EntityRef, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { Kbd, KbdCombo, toast } from '@/ui'
import { cycleVerb, HOME_VERBS, INTENT_LABEL, routeLine, routeVerb, SHEET_KIND, type HomeVerb } from './verbs'

/**
 * Home's hero composer (§6.1): verb chips, the router's reason under the input, ⏎ starts attached
 * (you go to the work), ⌘⏎ starts in the background (you stay on Home; a toast offers Open).
 */
export function HomeComposer({ dropTarget }: { dropTarget?: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate()
  const scope = useScope()
  const projectName = useDB((s: Tables) => (scope ? (s.projects[scope]?.name ?? null) : null))
  const [verb, setVerb] = useState<HomeVerb>('auto')
  const [draft, setDraft] = useState('')
  const ctx = useComposerContext({ label: 'Home' })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const routed = routeVerb(verb, draft)
  const line = routeLine(routed, projectName)
  // A draft handed to the Start sheet stays here until the sheet starts it.
  const handedOff = useRef<string | null>(null)

  useEffect(
    () =>
      startEvents.on('started', () => {
        if (handedOff.current !== null) {
          handedOff.current = null
          setDraft('')
        }
      }),
    [],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⇥ changes the verb while there is a draft (an empty composer lets Tab move focus on; an open
    // @ or / menu keeps Tab for picking).
    const menuOpen = e.currentTarget.getAttribute('aria-expanded') === 'true'
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && draft.trim() && !menuOpen) {
      e.preventDefault()
      setVerb((v) => cycleVerb(v, e.shiftKey ? -1 : 1))
    }
  }

  const backgroundToast = (runId: ID | undefined, route: string, what?: string) => {
    toast({
      title: runId ? `Started in background · ${shortCode(runId)}` : (what ?? 'Started in background'),
      action: { label: 'Open', onClick: () => navigate(route) },
    })
  }

  const onSubmit = async (text: string, meta: ComposerSubmitMeta) => {
    const { intent } = routeVerb(verb, text)
    const projectId = meta.context.projectId
    const attached: EntityRef[] = meta.context.attached
    const sheetKind = SHEET_KIND[intent]

    if (sheetKind) {
      const agentId = intent === 'delegate' ? pickAgentForInstruction(text, db.all('agents'), { runs: db.all('runs') })?.agentId : undefined
      openStartSheet(sheetKind, {
        prefill: {
          // Titles are derived from the brief by the services; a task needs one up front.
          ...(intent === 'organize' ? { title: suggestTitle(text, undefined, 8) ?? text.slice(0, 80) } : {}),
          brief: text,
          projectId,
          attached,
          ...(agentId ? { agentId } : {}),
        },
        background: meta.background,
      })
      // Keep the draft until the sheet starts the work (cancelling the sheet keeps it).
      handedOff.current = text
      setDraft(text)
      return
    }

    if (intent === 'ask') {
      const result = await sendMessage({
        text,
        projectId,
        contextRefs: attached,
        attachments: meta.attachments,
        modelId: meta.modelId,
        ...toChatSelection(meta.context),
      })
      const route = `/chat/${encodeURIComponent(result.threadId)}`
      if (meta.background) backgroundToast(db.get('messages', result.assistantMessageId)?.runId, route, 'Asked in a new conversation')
      else navigate(route)
      return
    }

    if (intent === 'create') {
      const { kind, prompt } = kindFromCreateText(text)
      const asset = generateAsset({ kind, prompt, projectId })
      const route = `/studio/${encodeURIComponent(asset.id)}`
      if (meta.background) backgroundToast(db.get('assets', asset.id)?.runId ?? asset.runId, route)
      else navigate(route)
      return
    }

    // Automate: a rule-based draft from the text (not AI), opened for review before it is turned on.
    const draftWf = draftWorkflowFromText(text, { agents: db.all('agents'), connections: db.all('connections'), runs: db.all('runs') })
    const wf = createWorkflow({ name: draftWf.name, description: draftWf.description, projectId, trigger: draftWf.trigger })
    updateWorkflow(wf.id, { nodes: draftWf.nodes, edges: draftWf.edges })
    const route = `/workflows/${encodeURIComponent(wf.id)}`
    if (meta.background) {
      toast({
        title: 'Workflow draft created',
        description: 'A rule-based draft. Review it before you turn it on.',
        action: { label: 'Open', onClick: () => navigate(route) },
      })
    } else navigate(route)
  }

  const submitLabel = INTENT_LABEL[routed.intent]

  return (
    <div className="w-full max-w-[760px]">
      <Composer
        size="hero"
        context={ctx}
        value={draft}
        onValueChange={(t) => {
          setDraft(t)
          if (handedOff.current !== null && t !== handedOff.current) handedOff.current = null
        }}
        textareaRef={inputRef}
        dropTarget={dropTarget}
        backgroundable
        submitLabel={submitLabel}
        placeholder="Start anything — ask, research, build or delegate. @ adds context"
        aria-label="Start anything"
        onKeyDown={onKeyDown}
        onSubmit={onSubmit}
        above={<VerbChips value={verb} onChange={setVerb} routed={verb === 'auto' && draft.trim() ? routed.intent : null} />}
        below={
          <p aria-live="polite" className="type-caption mt-1 flex h-4 min-w-0 items-center gap-1.5 px-0.5 text-ink-3">
            {draft.trim() ? (
              <>
                <span className="truncate">
                  {line.reading && <>{line.reading} → </>}
                  <span className="text-ink-2">{line.target}</span>
                </span>
                <span aria-hidden>·</span>
                <span className="inline-flex shrink-0 items-center gap-1 pointer-coarse:hidden">
                  <Kbd>⇥</Kbd> to change
                </span>
              </>
            ) : (
              <span className="hidden min-w-0 items-center gap-1.5 truncate sm:flex pointer-coarse:hidden">
                <KbdCombo combo="enter" variant="plain" /> starts it here
                <span aria-hidden>·</span>
                <KbdCombo combo="mod+enter" variant="plain" /> in the background
                <span aria-hidden>·</span>
                <KbdCombo combo="/" variant="plain" /> focuses this field
              </span>
            )}
          </p>
        }
      />
    </div>
  )
}

function VerbChips({ value, onChange, routed }: { value: HomeVerb; onChange: (v: HomeVerb) => void; routed: string | null }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = HOME_VERBS.findIndex((v) => v.id === value)
  const move = (to: number) => {
    const n = HOME_VERBS.length
    const i = (to + n) % n
    onChange(HOME_VERBS[i].id)
    refs.current[i]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="What to do" className="-mx-0.5 mb-1.5 flex flex-wrap items-center gap-1">
      {HOME_VERBS.map((v, i) => {
        const selected = v.id === value
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(v.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                move(index + 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                move(index - 1)
              }
            }}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-sm border px-2 text-xs font-medium transition-colors duration-(--dur-1) ease-standard focus-visible:outline-offset-1 pointer-coarse:h-8',
              selected ? 'border-line-strong bg-press text-ink' : 'border-transparent text-ink-3 hover:bg-hover hover:text-ink-2',
            )}
          >
            {v.label}
            {v.id === 'auto' && selected && routed && <span className="font-normal text-ink-3">· {INTENT_LABEL[routed as keyof typeof INTENT_LABEL]}</span>}
          </button>
        )
      })}
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { ClipboardList, FlaskConical, SearchCheck } from 'lucide-react'
import { Composer, ReadBackLine, useComposerContext, useReadBack, type ComposerSubmitMeta } from '@/app/components'
import type { SlashCommand } from '@/app/types'
import { useDB, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import { activeSessionRun, continueSession } from '@/core/services'
import { isRunActive, type CodeSession } from '@/core/types'
import { toast } from '@/ui'
import { useSessionDrafts } from '../drafts'
import { slashInstruction } from '../logic'

export const SESSION_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'plan', args: '<what>', description: 'Plan the next step without changing code yet', icon: ClipboardList },
  { name: 'test', args: '<what>', description: 'Add or update tests, then run them', icon: FlaskConical },
  { name: 'review', args: '<focus>', description: 'Review the current changes and fix what is risky', icon: SearchCheck },
]

/**
 * The session's follow-up composer (§6.3): "Instruct Forge…", `/plan /test /review`, the Context Line
 * and the inline ReadBack line (§8.1: follow-ups inside a session do not open the Start sheet). While a
 * turn runs the submit control is Stop ⌘. and a message sent then is queued as the next turn.
 */
export function SessionComposer({ session }: { session: CodeSession }) {
  const agent = useDB((s: Tables) => (session.agentId ? s.agents[session.agentId] : undefined))
  const repo = useDB((s: Tables) => s.repos[session.repoId])
  const latestRunId = session.turns[session.turns.length - 1]?.runId
  const latestStatus = useDB((s: Tables) => (latestRunId ? s.runs[latestRunId]?.status : undefined))
  const turnActive = !!latestStatus && isRunActive(latestStatus)
  const draft = useSessionDrafts((s) => s.drafts[session.id] ?? '')
  const setDraft = useSessionDrafts((s) => s.set)
  const focusTick = useSessionDrafts((s) => s.focusTick)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ctx = useComposerContext({ projectId: session.projectId, label: `Code · ${session.title}` })
  const readBack = useReadBack({ kind: 'session', agentId: session.agentId ?? null, autonomy: session.autonomy, repoId: session.repoId, projectId: session.projectId })
  const archived = session.status === 'archived'
  const missingRepo = !repo

  // Something was inserted (Ask about this file, a diff line): focus the composer at the end.
  const firstTick = useRef(focusTick)
  useEffect(() => {
    if (focusTick === firstTick.current) return
    const el = inputRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [focusTick])

  const send = (text: string, meta: ComposerSubmitMeta) => {
    const run = continueSession(session.id, text, { contextRefs: meta.context.all })
    if (!run) throw new Error('This session can’t take new instructions right now.')
    const latest = useDB.getState().sessions[session.id]
    const started = latest?.turns[latest.turns.length - 1]?.runId === run.id
    if (!started) toast({ title: 'A turn is still running', description: 'Your message waits until it finishes.' })
  }

  const stop = () => {
    const run = activeSessionRun(session)
    if (run) runEngine.cancel(run.id, 'Stopped by you')
  }

  const name = agent?.name ?? 'the agent'
  return (
    <Composer
      context={ctx}
      textareaRef={inputRef}
      size="compact"
      showModel={false}
      placeholder={`Instruct ${name}… — / for actions, @ to add context`}
      aria-label={`Instruct ${name}`}
      slashCommands={SESSION_SLASH_COMMANDS}
      onSlashCommand={(cmd, args, meta) => send(slashInstruction(cmd.name, args), meta)}
      value={draft}
      onValueChange={(text) => setDraft(session.id, text)}
      streaming={turnActive}
      onStop={stop}
      readBack={<ReadBackLine data={readBack} />}
      disabled={archived || missingRepo}
      reason={archived ? 'This session is archived. Restore it to give new instructions.' : missingRepo ? 'Its repository was disconnected. Connect it again to continue.' : undefined}
      onSubmit={send}
    />
  )
}

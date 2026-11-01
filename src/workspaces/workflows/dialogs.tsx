import { useMemo, useRef } from 'react'
import { create } from 'zustand'
import { Play, Power } from 'lucide-react'
import { ReadBack, useReadBack, type ReadBackData } from '@/app/components'
import { attachRun } from '@/app/shell/store'
import { useRow } from '@/core/db'
import { isInternalEvent, nextScheduledRun, runWorkflow, setWorkflowEnabled, soleAgentId } from '@/core/services/workflows'
import type { ID, Workflow } from '@/core/types'
import { formatDateTime } from '@/lib/format'
import { Button, Dialog, toast } from '@/ui'
import { workflowCapabilities } from './capabilities'
import { useEditorStore } from './editorStore'

/**
 * The two ReadBack confirms (docs/DESIGN.md §6.6): turning a workflow on, and Test run. Both read the
 * plan back — what runs, on which engine, what it may do (decisions from the live permission policy,
 * decided the way the run will decide them) and what it is likely to cost — before anything happens.
 */

interface DialogState {
  enableId: ID | null
  testRunId: ID | null
  requestEnable: (id: ID) => void
  requestTestRun: (id: ID) => void
  close: () => void
}

export const useWorkflowDialogs = create<DialogState>()((set) => ({
  enableId: null,
  testRunId: null,
  requestEnable: (id) => set({ enableId: id, testRunId: null }),
  requestTestRun: (id) => set({ testRunId: id, enableId: null }),
  close: () => set({ enableId: null, testRunId: null }),
}))

/** Turn on (asks with a ReadBack) or off (immediately). */
export function toggleEnabled(wf: Pick<Workflow, 'id' | 'enabled'>, next: boolean): void {
  if (next && !wf.enabled) useWorkflowDialogs.getState().requestEnable(wf.id)
  else if (!next && wf.enabled) setWorkflowEnabled(wf.id, false)
}

function useWorkflowReadBack(wf: Workflow | undefined): ReadBackData {
  const base = useReadBack({ kind: 'workflow', title: wf?.name, projectId: wf?.projectId ?? null, workflowId: wf?.id ?? null, agentId: wf ? (soleAgentId(wf) ?? null) : null })
  const capabilities = useMemo(() => (wf ? workflowCapabilities(wf) : []), [wf])
  return { ...base, capabilities }
}

function triggerSentence(wf: Workflow): string {
  const t = wf.trigger
  switch (t.type) {
    case 'manual':
      return 'Manual: it runs only when you start it, so turning it on changes nothing until then.'
    case 'schedule': {
      const next = nextScheduledRun(t)
      return `${t.label}. Runs only while Atrium is open${next ? `; next ${formatDateTime(next)}` : ''}.`
    }
    case 'event':
      return isInternalEvent(t.event)
        ? `${t.label}. Atrium’s own events are real; it starts on its own while Atrium is open.`
        : `${t.label}. Events from this service are simulated in this build: they don’t arrive by themselves, so it runs when you test it.`
    case 'webhook':
      return 'Webhook: the address is simulated and nothing can call it in this build. Use Send test event.'
  }
}

export function EnableDialog() {
  const enableId = useWorkflowDialogs((s) => s.enableId)
  const close = useWorkflowDialogs((s) => s.close)
  const wf = useRow('workflows', enableId)
  const data = useWorkflowReadBack(wf)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const confirm = () => {
    if (!wf) return close()
    setWorkflowEnabled(wf.id, true)
    close()
    toast.success(`“${wf.name}” is on`, { description: wf.trigger.type === 'schedule' ? 'Runs only while Atrium is open.' : undefined })
  }
  return (
    <Dialog
      open={!!enableId && !!wf}
      onOpenChange={(o) => !o && close()}
      title={wf ? `Turn on “${wf.name}”?` : 'Turn on'}
      description={wf ? triggerSentence(wf) : undefined}
      size="md"
      initialFocus={confirmRef}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button ref={confirmRef} variant="primary" leadingIcon={Power} onClick={confirm}>
            Turn on
          </Button>
        </>
      }
    >
      {wf && <ReadBack data={data} className="rounded-sm border border-line bg-sunken px-3 py-2.5" />}
    </Dialog>
  )
}

export function TestRunDialog() {
  const testRunId = useWorkflowDialogs((s) => s.testRunId)
  const close = useWorkflowDialogs((s) => s.close)
  const wf = useRow('workflows', testRunId)
  const data = useWorkflowReadBack(wf)
  const runRef = useRef<HTMLButtonElement>(null)
  const start = () => {
    if (!wf) return close()
    try {
      const run = runWorkflow(wf.id, { trigger: 'manual' })
      useEditorStore.getState().setOverlayRun(run.id)
      attachRun(run.id, 'workflows')
    } catch (error) {
      toast.error('Couldn’t start the run', { description: error instanceof Error ? error.message : String(error) })
    }
    close()
  }
  const sample =
    wf?.trigger.type === 'schedule'
      ? `Starts now as if it were ${wf.trigger.label.toLowerCase().startsWith('every') ? wf.trigger.label.toLowerCase() : wf.trigger.label}.`
      : wf?.trigger.type === 'event'
        ? isInternalEvent(wf.trigger.event)
          ? 'Uses the latest matching item in Atrium as the event.'
          : 'Uses a simulated sample event.'
        : wf?.trigger.type === 'webhook'
          ? 'Uses a simulated test payload.'
          : 'Starts now.'
  return (
    <Dialog
      open={!!testRunId && !!wf}
      onOpenChange={(o) => !o && close()}
      title={wf ? `Test run “${wf.name}”` : 'Test run'}
      description={`${sample} Steps run in the simulator; approval steps still wait for you.`}
      size="md"
      initialFocus={runRef}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button ref={runRef} variant="primary" leadingIcon={Play} kbd="enter" onClick={start}>
            Run
          </Button>
        </>
      }
    >
      {wf && <ReadBack data={data} className="rounded-sm border border-line bg-sunken px-3 py-2.5" />}
    </Dialog>
  )
}

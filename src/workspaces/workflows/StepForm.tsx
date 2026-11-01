import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, Copy, Send, Trash2, X } from 'lucide-react'
import { AgentPicker, CollectionPicker, Picker, PickerTrigger, type PickerOption } from '@/app/components'
import { describeCron } from '@/core/assist'
import { useDB, type Tables } from '@/core/db'
import { getIntegration, INTEGRATIONS } from '@/core/integrations/catalog'
import { CAPABILITIES, evaluatePermission } from '@/core/permissions'
import { guardedAction } from '@/core/runs/factories/workflow'
import {
  INTEGRATION_EVENTS, INTERNAL_EVENTS, isInternalEvent, isValidCron, nextScheduledRun, WORKFLOW_SCHEDULE_PRESETS, sendTestEvent, setWorkflowTrigger,
  soleAgentId, webhookUrl, type WorkflowIssue,
} from '@/core/services/workflows'
import { configNumber, configString } from '@/core/sim/params'
import type { Capability, Hue, RunStep, Workflow, WorkflowNode, WorkflowTriggerType } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import {
  Button, EntityChip, Field, IconButton, Input, LiveBadge, MonogramMark, SegmentedControl, Select, SimBadge, StatusGlyph, StepStatusGlyph, Tag, Textarea, toast,
} from '@/ui'
import { connectSteps, deleteStep, disconnect, updateStep, updateStepConfig } from './actions'
import { connectionProblem } from './graph'
import { delayWords, NODE_TYPES, OUTPUT_KINDS, outputKindOf, TRIGGER_ICON } from './nodeMeta'
import { useEditorStore } from './editorStore'
import { useShowRun } from './hooks'

/**
 * The step settings shown in Inspector › Item (docs/DESIGN.md §6.6: "The Inspector shows node
 * configuration"). Every field autosaves. The trigger step gets the trigger form: manual (real),
 * schedule presets (a real in-app timer, only while Atrium is open), events (Atrium's own: live;
 * connected services: simulated) and a simulated webhook with "Send test event".
 */

export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3 border-b border-line px-4 py-3.5 last:border-b-0', className)}>
      {title && <h3 className="type-label text-ink-3">{title}</h3>}
      {children}
    </section>
  )
}

export function IssueLines({ issues }: { issues: WorkflowIssue[] }) {
  if (!issues.length) return null
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Problems">
      {issues.map((i, k) => (
        <li key={k} className={cn('type-body-sm flex gap-2', i.severity === 'error' ? 'text-fail-ink' : 'text-ink-2')}>
          <span className="mt-[3px] shrink-0">
            {i.severity === 'error' ? <StatusGlyph shape="cross" tone="fail" size={12} label="Error" /> : <span aria-label="Warning" className="inline-grid size-3 place-items-center font-semibold">!</span>}
          </span>
          <span className="text-pretty">{i.message}</span>
        </li>
      ))}
    </ul>
  )
}

/** The step's part of the run drawn on the canvas: status, output and error, read from the run. */
function StepRunState({ steps }: { steps: RunStep[] }) {
  if (!steps.length) return null
  return (
    <Section title="In this run">
      <ul className="flex flex-col gap-2.5">
        {steps.map((s) => (
          <li key={s.id} className="flex flex-col gap-1">
            <span className="type-body-sm flex items-center gap-2 font-medium text-ink">
              <StepStatusGlyph status={s.status} size={12} />
              <span className="min-w-0 truncate">{s.title}</span>
            </span>
            {s.error && <p className="type-body-sm rounded-sm border border-fail/30 bg-fail-tint/40 px-2.5 py-1.5 text-fail-ink">{s.error}</p>}
            {s.output && !s.error && (
              <p className="type-mono-sm line-clamp-4 rounded-sm border border-dashed border-line-input bg-sim-tint px-2.5 py-1.5 whitespace-pre-wrap text-ink-2">{s.output}</p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ text

function TextSetting({ label, value, onChange, placeholder, hint, multiline, mono, fallback, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: ReactNode
  multiline?: boolean
  mono?: boolean
  /** Restored on blur when the field is left empty. */
  fallback?: string
  error?: ReactNode
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {multiline ? (
        <Textarea value={value} onValueChange={onChange} placeholder={placeholder} autosize minRows={3} maxRows={10} mono={mono} />
      ) : (
        <Input
          value={value}
          onValueChange={onChange}
          placeholder={placeholder}
          className={mono ? 'font-mono' : undefined}
          onBlur={() => {
            if (fallback && !value.trim()) onChange(fallback)
          }}
        />
      )}
    </Field>
  )
}

// ------------------------------------------------------------------------------------------------ node form

export interface StepFormProps {
  wf: Workflow
  node: WorkflowNode
  issues: WorkflowIssue[]
  /** Steps of the overlaid run that executed this node. */
  runSteps?: RunStep[]
}

export function StepForm({ wf, node, issues, runSteps = [] }: StepFormProps) {
  const meta = NODE_TYPES[node.type]
  const Icon = node.type === 'trigger' ? TRIGGER_ICON[wf.trigger.type] : meta.icon
  const select = useEditorStore((s) => s.select)
  const index = wf.nodes.findIndex((n) => n.id === node.id) + 1
  const setLabel = (label: string) => updateStep(wf.id, node.id, { label })

  return (
    <div className="flex flex-col" data-testid="step-form">
      <Section className="pb-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-sm border bg-raised', node.integrationId && getIntegration(node.integrationId)?.support === 'simulated' ? 'border-dashed border-line-input' : 'border-line-strong')}>
            <Icon className="size-4 text-ink-2" strokeWidth={1.75} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="type-label text-ink-3">
              Step {index} · {meta.label}
            </span>
            <span className="type-body-sm truncate font-medium text-ink">{node.label || meta.label}</span>
          </div>
          <IconButton
            icon={Trash2}
            label="Delete step"
            size="sm"
            onClick={() => {
              deleteStep(wf.id, node.id, { onUndo: (id) => select(wf.id, id) })
              select(wf.id, null)
            }}
          />
        </div>
        <IssueLines issues={issues} />
        <TextSetting label="Name" value={node.label} onChange={setLabel} fallback={NODE_TYPES[node.type].create().label} />
      </Section>
      <StepRunState steps={runSteps} />
      {node.type === 'trigger' && <TriggerSettings wf={wf} />}
      {node.type === 'agent' && <AgentSettings wf={wf} node={node} />}
      {node.type === 'action' && <ActionSettings wf={wf} node={node} />}
      {node.type === 'condition' && <ConditionSettings wf={wf} node={node} />}
      {node.type === 'transform' && <TransformSettings wf={wf} node={node} />}
      {node.type === 'approval' && <ApprovalSettings wf={wf} node={node} />}
      {node.type === 'delay' && <DelaySettings wf={wf} node={node} />}
      {node.type === 'output' && <OutputSettings wf={wf} node={node} />}
      <ConnectionsSection wf={wf} node={node} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ connections

/**
 * Connections without dragging (the keyboard way to edit the graph): where this step goes next — for
 * a condition, its Yes and No — and where it is reached from.
 */
function ConnectionsSection({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const label = (id: string) => wf.nodes.find((n) => n.id === id)?.label ?? 'A deleted step'
  const outgoing = wf.edges.filter((e) => e.source === node.id)
  const incoming = wf.edges.filter((e) => e.target === node.id)
  const graph = { nodes: wf.nodes, edges: wf.edges }
  const candidates = (handle?: 'true' | 'false') =>
    wf.nodes
      .filter((n) => n.id !== node.id && !connectionProblem(graph, node.id, n.id, handle ?? null))
      .map((n) => ({ value: n.id, label: n.label || NODE_TYPES[n.type].label, description: NODE_TYPES[n.type].label }))
  const connectTo = (target: string, handle?: 'true' | 'false') => {
    const problem = connectSteps(wf.id, node.id, target, handle ?? null)
    if (problem) toast.error('Couldn’t connect these steps', { description: problem })
  }
  const Row = ({ edgeId, text }: { edgeId: string; text: string }) => (
    <li className="flex min-h-8 items-center gap-2 rounded-sm px-1 hover:bg-hover">
      <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2">{text}</span>
      <IconButton icon={X} label={`Remove the connection to ${text}`} size="xs" onClick={() => disconnect(wf.id, edgeId)} />
    </li>
  )
  return (
    <Section title="Connections">
      {node.type === 'condition' ? (
        (['true', 'false'] as const).map((h) => {
          const edge = outgoing.find((e) => (e.sourceHandle ?? 'true') === h)
          return (
            <Field key={h} label={h === 'true' ? 'If yes, go to' : 'If no, go to'}>
              <Select
                aria-label={h === 'true' ? 'If yes, go to' : 'If no, go to'}
                value={edge?.target ?? '__none__'}
                onValueChange={(v) => {
                  if (v === '__none__') {
                    if (edge) disconnect(wf.id, edge.id)
                  } else connectTo(v, h)
                }}
                options={[{ value: '__none__', label: 'Nowhere — the run stops' }, ...(edge ? [{ value: edge.target, label: label(edge.target) }] : []), ...candidates(h).filter((c) => c.value !== edge?.target)]}
              />
            </Field>
          )
        })
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="type-caption text-ink-3">Goes to</span>
          {outgoing.length ? (
            <ul className="flex flex-col">
              {outgoing.map((e) => (
                <Row key={e.id} edgeId={e.id} text={label(e.target)} />
              ))}
            </ul>
          ) : (
            <p className="type-caption text-ink-3">Nothing — the run ends here.</p>
          )}
          {candidates().length > 0 && (
            <Select
              aria-label="Connect to another step"
              placeholder="Connect to…"
              value={null}
              onValueChange={(v) => connectTo(v)}
              options={candidates()}
              size="sm"
            />
          )}
        </div>
      )}
      {node.type !== 'trigger' && (
        <div className="flex flex-col gap-1.5">
          <span className="type-caption text-ink-3">Comes from</span>
          {incoming.length ? (
            <ul className="flex flex-col">
              {incoming.map((e) => (
                <Row key={e.id} edgeId={e.id} text={`${label(e.source)}${e.sourceHandle ? ` (${e.sourceHandle === 'false' ? 'No' : 'Yes'})` : ''}`} />
              ))}
            </ul>
          ) : (
            <p className="type-caption text-ink-3">Nothing — this step never runs.</p>
          )}
        </div>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ trigger

const TRIGGER_TYPES: { value: WorkflowTriggerType; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'event', label: 'Event' },
  { value: 'webhook', label: 'Webhook' },
]

export function TriggerSettings({ wf }: { wf: Workflow }) {
  const t = wf.trigger
  const connections = useDB(useShallow((s: Tables) => s.connections))
  const [customCron, setCustomCron] = useState(() => (t.cron && !WORKFLOW_SCHEDULE_PRESETS.some((p) => p.cron === t.cron) ? t.cron : ''))
  const preset = t.type === 'schedule' && t.cron && WORKFLOW_SCHEDULE_PRESETS.some((p) => p.cron === t.cron) ? t.cron : t.type === 'schedule' ? 'custom' : ''
  const next = nextScheduledRun(t)
  const setType = (type: WorkflowTriggerType) => {
    if (type === t.type) return
    if (type === 'schedule') setWorkflowTrigger(wf.id, { type, cron: t.cron ?? '0 9 * * 1' })
    else if (type === 'event') setWorkflowTrigger(wf.id, { type, event: t.event ?? 'knowledge.created' })
    else setWorkflowTrigger(wf.id, { type })
  }
  const cronValid = !customCron || isValidCron(customCron)

  return (
    <>
      <Section title="Trigger">
        <SegmentedControl aria-label="Trigger type" options={TRIGGER_TYPES} value={t.type} onValueChange={setType} fullWidth size="sm" />
        {t.type === 'manual' && <p className="type-body-sm text-ink-2">Runs when you start it: Test run here, or Run a workflow from ⌘K and the Start sheet.</p>}

        {t.type === 'schedule' && (
          <div className="flex flex-col gap-3">
            <Field label="Repeats">
              <Select
                aria-label="Schedule"
                value={preset}
                onValueChange={(v) => {
                  if (v === 'custom') {
                    const cron = customCron && isValidCron(customCron) ? customCron : (t.cron ?? '0 9 * * 1')
                    setCustomCron(cron)
                    setWorkflowTrigger(wf.id, { type: 'schedule', cron })
                  } else setWorkflowTrigger(wf.id, { type: 'schedule', cron: v })
                }}
                options={[...WORKFLOW_SCHEDULE_PRESETS.map((p) => ({ value: p.cron, label: p.label, meta: p.cron })), { value: 'custom', label: 'Custom (cron)', meta: '' }]}
              />
            </Field>
            {preset === 'custom' && (
              <Field
                label="Cron expression"
                hint={cronValid && customCron ? (describeCron(customCron) ?? 'A valid schedule') : 'minute hour day month weekday, in local time'}
                error={cronValid ? undefined : 'That isn’t a cron expression Atrium can read, e.g. 0 9 * * 1-5.'}
              >
                <Input
                  value={customCron}
                  onValueChange={(v) => {
                    setCustomCron(v)
                    if (isValidCron(v)) setWorkflowTrigger(wf.id, { type: 'schedule', cron: v.trim() })
                  }}
                  className="font-mono"
                  placeholder="0 9 * * 1-5"
                  invalid={!cronValid}
                />
              </Field>
            )}
            <p className="type-caption text-ink-3">
              Runs only while Atrium is open.{next ? <> Next: <span className="type-meta text-ink-2">{formatDateTime(next)}</span>{wf.enabled ? '' : ' (when enabled)'}</> : null}
            </p>
          </div>
        )}

        {t.type === 'event' && (
          <div className="flex flex-col gap-3">
            <EventList
              title="In Atrium"
              badge={<LiveBadge size="xs" />}
              note="Real events; they fire while Atrium is open."
              options={INTERNAL_EVENTS.map((e) => ({ event: e.event, label: e.label, description: e.description }))}
              value={t.event}
              onPick={(event) => setWorkflowTrigger(wf.id, { type: 'event', event })}
            />
            <EventList
              title="From connected services"
              badge={<SimBadge size="xs" />}
              note="Simulated in this build: these events don’t arrive by themselves. Test run sends a sample."
              options={INTEGRATION_EVENTS.map((e) => {
                const conn = e.integrationId ? connections[e.integrationId] : undefined
                return { event: e.event, label: e.label, description: getIntegration(e.integrationId)?.name, status: conn?.status === 'connected' ? undefined : 'Not connected' }
              })}
              value={t.event}
              onPick={(event) => setWorkflowTrigger(wf.id, { type: 'event', event })}
            />
          </div>
        )}

        {t.type === 'webhook' && <WebhookSettings wf={wf} />}
      </Section>
      <Section title="Automatic runs">
        <p className="type-body-sm text-ink-2">
          {t.type === 'manual'
            ? 'A manual trigger never starts on its own.'
            : wf.enabled
              ? t.type === 'event' && !isInternalEvent(t.event)
                ? 'Enabled, but events from this service are simulated: it runs when you send a test.'
                : t.type === 'webhook'
                  ? 'Enabled. Nothing can call the simulated address; use Send test event.'
                  : 'Enabled: it starts on its own while Atrium is open.'
              : 'Off: it runs only when you start it. Turn it on with the Enabled switch.'}
        </p>
      </Section>
    </>
  )
}

function EventList({ title, badge, note, options, value, onPick }: {
  title: string
  badge: ReactNode
  note: string
  options: { event: string; label: string; description?: string; status?: string }[]
  value?: string
  onPick: (event: string) => void
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="type-caption mb-1.5 flex items-center gap-2 font-medium text-ink-2">
        {title} {badge}
      </legend>
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {options.map((o) => {
          const checked = o.event === value
          return (
            <button
              key={o.event}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onPick(o.event)}
              className={cn(
                'flex min-h-9 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-(--dur-1) pointer-coarse:min-h-11',
                checked ? 'bg-accent-tint' : 'hover:bg-hover',
              )}
            >
              <span aria-hidden className={cn('grid size-3.5 shrink-0 place-items-center rounded-full border', checked ? 'border-ink' : 'border-line-input')}>
                {checked && <span className="size-1.5 rounded-full bg-ink" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="type-body-sm text-ink">{o.label}</span>
                <span className="type-meta truncate text-ink-3">{o.event}{o.description ? ` · ${o.description}` : ''}</span>
              </span>
              {o.status && <span className="type-meta shrink-0 text-ink-3">{o.status}</span>}
            </button>
          )
        })}
      </div>
      <p className="type-caption text-ink-3">{note}</p>
    </fieldset>
  )
}

function WebhookSettings({ wf }: { wf: Workflow }) {
  const url = webhookUrl(wf)
  const showRun = useShowRun()
  return (
    <div className="flex flex-col gap-3">
      <Field label="Address" hint="Simulated — nothing listens at this address in this build.">
        <Input
          value={url}
          readOnly
          className="font-mono text-ink-2"
          suffix={
            <IconButton
              icon={Copy}
              label="Copy address"
              size="xs"
              onClick={() => {
                void navigator.clipboard?.writeText(url).then(
                  () => toast.success('Address copied'),
                  () => toast.error('Couldn’t copy the address'),
                )
              }}
            />
          }
        />
      </Field>
      <div className="flex items-center gap-2">
        <SimBadge size="sm" />
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={Send}
          onClick={() => {
            const run = sendTestEvent(wf.id)
            useEditorStore.getState().setOverlayRun(run.id)
            showRun(run.id)
            toast('Test event sent', { description: 'A simulated webhook payload started a run.' })
          }}
        >
          Send test event
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ agent

function AgentSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const agent = useDB((s: Tables) => (node.agentId ? s.agents[node.agentId] : undefined))
  const prompt = configString(node.config, 'prompt', 'instructions', 'task') ?? ''
  return (
    <Section title="Agent">
      <Field label="Agent" hint={agent ? `${agent.role} · ${agent.autonomy} autonomy` : 'Who does this step'}>
        <AgentPicker value={node.agentId ?? null} onChange={(agentId) => updateStep(wf.id, node.id, { agentId })} />
      </Field>
      <TextSetting
        label="Instructions"
        value={prompt}
        onChange={(v) => updateStepConfig(wf.id, node.id, { prompt: v, instructions: undefined, task: undefined })}
        placeholder="What should the agent do with the input?"
        hint="Sent with the previous step’s output. Workflow runs are simulated in this build — no model is called."
        multiline
      />
      {agent && (
        <div className="flex items-center gap-2">
          <span className="type-caption text-ink-3">Agent</span>
          <EntityChip entity={{ kind: 'agent', id: agent.id }} size="sm" />
        </div>
      )}
      {agent && (
        <p className="type-caption text-ink-3">
          {agent.name} can: {agent.capabilities.length ? agent.capabilities.map((g) => `${CAPABILITIES[g.capability].label}${g.mode === 'ask' ? ' (asks)' : g.mode === 'deny' ? ' (blocked)' : ''}`).join(' · ') : 'nothing granted yet'}.{' '}
          <Link to={`/agents/${encodeURIComponent(agent.id)}/configure`} className="text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
            Abilities
          </Link>
        </p>
      )}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ action

/** Destination field per capability (what the action needs to know). */
const DESTINATION: Partial<Record<Capability, { key: string; label: string; placeholder: string }>> = {
  'tasks.manage': { key: 'team', label: 'Team or project', placeholder: 'SUP' },
  'files.write': { key: 'folder', label: 'Folder', placeholder: 'Marketing / Launch' },
  'repo.pull_request': { key: 'repo', label: 'Repository', placeholder: 'northwind/atlas-portal' },
  'repo.write': { key: 'repo', label: 'Repository', placeholder: 'northwind/atlas-portal' },
  'calendar.manage': { key: 'calendar', label: 'Calendar', placeholder: 'Product team' },
  'data.query': { key: 'query', label: 'Query', placeholder: 'select count(*) from shipments where …' },
}

function IntegrationPicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const connections = useDB(useShallow((s: Tables) => s.connections))
  const options = useMemo<PickerOption[]>(() => {
    const usable = INTEGRATIONS.filter((d) => d.category !== 'models' && d.capabilities.length > 0 && d.id !== 'webhooks')
    const rank = (id: string) => (connections[id]?.status === 'connected' ? 0 : 1)
    return usable
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
      .map((d) => {
        const conn = connections[d.id]
        const status = conn?.status === 'connected' ? 'Connected' : conn?.status === 'error' ? 'Error' : 'Not connected'
        return {
          value: d.id,
          label: d.name,
          group: conn?.status === 'connected' ? 'Connected' : 'Not connected',
          description: d.capabilities.map((c) => CAPABILITIES[c].label).join(' · '),
          leading: <MonogramMark text={d.monogram} hue={d.hue as Hue} size={20} variant="ring" simulated={d.support === 'simulated'} />,
          meta: (
            <span className="flex items-center gap-1.5">
              <span className={cn('type-meta', status === 'Error' ? 'text-fail-ink' : 'text-ink-3')}>{status}</span>
              {d.support === 'simulated' ? <SimBadge size="xs" noTooltip /> : <LiveBadge size="xs" noTooltip />}
            </span>
          ),
          keywords: `${d.category} ${d.description}`,
        }
      })
  }, [connections])
  const def = getIntegration(value)
  return (
    <Picker
      label="Integrations"
      placeholder="Find an integration…"
      options={options}
      value={value ?? null}
      onSelect={onChange}
      width={360}
      trigger={(props) => (
        <PickerTrigger {...props} leading={def ? <MonogramMark text={def.monogram} hue={def.hue as Hue} size={16} variant="ring" simulated={def.support === 'simulated'} /> : null} placeholder={!def}>
          {def?.name ?? 'Choose an integration'}
        </PickerTrigger>
      )}
    />
  )
}

function ActionSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const def = getIntegration(node.integrationId)
  const conn = useDB((s: Tables) => (node.integrationId ? s.connections[node.integrationId] : undefined))
  const runAgentId = soleAgentId(wf)
  // Re-read the policy when the acting agent's permissions change.
  useDB((s: Tables) => (runAgentId ? s.agents[runAgentId] : undefined))
  const capability = node.capability ?? def?.capabilities[0]
  const covered = wf.nodes.some((n) => n.type === 'approval' && guardedAction(n, wf.nodes, wf.edges)?.id === node.id)
  const decision = capability && conn?.status === 'connected' ? evaluatePermission({ capability, risk: CAPABILITIES[capability].risk, agentId: runAgentId, integrationId: node.integrationId }) : null
  const dest = capability ? DESTINATION[capability] : undefined
  const isMessage = capability === 'messages.send'
  const channel = configString(node.config, 'channel') ?? ''
  const to = configString(node.config, 'to', 'recipient') ?? ''
  const message = configString(node.config, 'message', 'template', 'body', 'text', 'comment') ?? ''

  const pickIntegration = (id: string) => {
    const d = getIntegration(id)
    if (!d) return
    const cap = node.capability && d.capabilities.includes(node.capability) ? node.capability : d.capabilities[0]
    const generic = node.label === 'New action' || /^(Post to|Send|Email|Create|Upload to|Save to|Do something)/.test(node.label)
    const defaultChannel = useDB.getState().connections[id]?.config.defaultChannel
    const label = cap === 'messages.send' && id === 'slack' ? `Post to ${channel || defaultChannel || 'Slack'}` : cap === 'messages.send' ? 'Send email' : cap === 'tasks.manage' ? `Create ${d.name} issue` : cap === 'files.write' ? `Upload to ${d.name}` : `${CAPABILITIES[cap].label} in ${d.name}`
    updateStep(wf.id, node.id, { integrationId: id, capability: cap, ...(generic ? { label } : {}) })
    if (cap === 'messages.send' && id === 'slack' && !channel && defaultChannel) updateStepConfig(wf.id, node.id, { channel: defaultChannel })
  }

  return (
    <Section title="Action">
      <Field label="Integration" hint={def ? (def.support === 'simulated' ? 'Simulated — nothing leaves your browser.' : 'Live service.') : undefined}>
        <IntegrationPicker value={node.integrationId} onChange={pickIntegration} />
      </Field>
      {def && conn?.status !== 'connected' && (
        <p className="type-body-sm rounded-sm border border-line px-3 py-2 text-ink-2">
          {def.name} is {conn?.status === 'error' ? `in error${conn.error ? `: ${conn.error}` : ''}` : 'not connected'}. Runs fail at this step until you{' '}
          <Link to={`/integrations/${encodeURIComponent(def.id)}`} className="font-medium text-ink underline decoration-line-input underline-offset-2">
            connect it in Integrations
          </Link>
          .
        </p>
      )}
      {def && (
        <Field label="What it does">
          <Select
            aria-label="Capability"
            value={capability ?? null}
            onValueChange={(c) => updateStep(wf.id, node.id, { capability: c as Capability })}
            options={def.capabilities.map((c) => ({ value: c, label: CAPABILITIES[c].label, description: CAPABILITIES[c].description, meta: CAPABILITIES[c].risk.toUpperCase() }))}
          />
        </Field>
      )}
      {capability && (decision || covered) && (
        <div className="type-caption flex flex-col gap-0.5 text-ink-3">
          <span>
            <span className="text-ink-2">Policy: </span>
            {covered ? (
              <span className="text-attn-ink">you decide at the approval step ◆</span>
            ) : decision?.outcome === 'ask' ? (
              <span className="text-attn-ink">asks you ◆</span>
            ) : decision?.outcome === 'deny' ? (
              <span className="text-ink-2">blocked ⊘</span>
            ) : (
              <span className="text-ink-2">allowed</span>
            )}
          </span>
          {!covered && decision && <span className="text-pretty">{decision.reason}.</span>}
        </div>
      )}
      {isMessage && node.integrationId === 'slack' && (
        <TextSetting label="Channel" value={channel} onChange={(v) => updateStepConfig(wf.id, node.id, { channel: v })} placeholder="#product" mono />
      )}
      {isMessage && node.integrationId !== 'slack' && (
        <TextSetting label="To" value={to} onChange={(v) => updateStepConfig(wf.id, node.id, { to: v, recipient: undefined })} placeholder="team@northwind.example" />
      )}
      {dest && (
        <TextSetting label={dest.label} value={configString(node.config, dest.key) ?? ''} onChange={(v) => updateStepConfig(wf.id, node.id, { [dest.key]: v })} placeholder={dest.placeholder} mono={dest.key === 'query'} multiline={dest.key === 'query'} />
      )}
      {(isMessage || capability === 'repo.pull_request') && (
        <TextSetting
          label={isMessage ? 'Message' : 'Comment'}
          value={message}
          onChange={(v) => updateStepConfig(wf.id, node.id, { [isMessage ? 'message' : 'comment']: v })}
          placeholder="Leave empty to send the previous step’s output"
          hint={<>Use <code className="type-meta">{'{{subject}}'}</code>, <code className="type-meta">{'{{summary}}'}</code> or <code className="type-meta">{'{{output}}'}</code>.</>}
          multiline
        />
      )}
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ condition

const EXAMPLES = ['priority is urgent', 'sentiment is negative', 'score > 0.6', 'subject contains "refund"']

function ConditionSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const expression = configString(node.config, 'expression', 'condition', 'rule') ?? ''
  const forced = configString(node.config, 'branch')
  const target = (h: 'true' | 'false') => {
    const e = wf.edges.find((x) => x.source === node.id && (x.sourceHandle ?? 'true') === h)
    return e ? wf.nodes.find((n) => n.id === e.target)?.label : undefined
  }
  return (
    <Section title="Condition">
      <TextSetting
        label="Condition"
        value={expression}
        onChange={(v) => updateStepConfig(wf.id, node.id, { expression: v, condition: undefined, rule: undefined })}
        placeholder="priority is urgent"
        mono
        hint="Read by simple rules over the run’s data (priority, sentiment, score, subject) — not by a model."
      />
      <div className="flex flex-wrap gap-1.5" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <Tag key={ex} size="md" onClick={() => updateStepConfig(wf.id, node.id, { expression: ex })} className="font-mono">
            {ex}
          </Tag>
        ))}
      </div>
      <dl className="type-body-sm grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="text-ink-3">Yes</dt>
        <dd className="min-w-0 truncate text-ink-2">{target('true') ? `→ ${target('true')}` : 'Not connected — drag from the Yes port'}</dd>
        <dt className="text-ink-3">No</dt>
        <dd className="min-w-0 truncate text-ink-2">{target('false') ? `→ ${target('false')}` : 'Not connected — drag from the No port'}</dd>
      </dl>
      <Field label="In test runs" hint="Fix the branch to test one path.">
        <SegmentedControl
          aria-label="Branch in test runs"
          size="sm"
          fullWidth
          value={forced === 'true' || forced === 'false' ? forced : 'evaluate'}
          onValueChange={(v) => updateStepConfig(wf.id, node.id, { branch: v === 'evaluate' ? undefined : v })}
          options={[
            { value: 'evaluate', label: 'Evaluate' },
            { value: 'true', label: 'Always Yes' },
            { value: 'false', label: 'Always No' },
          ]}
        />
      </Field>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ transform, approval, delay, output

function TransformSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const def = getIntegration(node.integrationId)
  const op = configString(node.config, 'operation', 'template', 'expression', 'format', 'lookup') ?? ''
  return (
    <Section title="Transform">
      <TextSetting
        label="Operation"
        value={op}
        onChange={(v) => updateStepConfig(wf.id, node.id, { operation: v, template: undefined, expression: undefined, format: undefined, lookup: undefined })}
        placeholder="Format for Slack · Shorten to a summary"
        hint="“Format for Slack” and “Shorten to a summary” reshape the previous output; other text is kept as a note."
        multiline
      />
      {def && (
        <p className="type-caption flex items-center gap-1.5 text-ink-3">
          Reads from {def.name} {def.support === 'simulated' ? <SimBadge size="xs" /> : <LiveBadge size="xs" />}
        </p>
      )}
    </Section>
  )
}

function ApprovalSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const guarded = guardedAction(node, wf.nodes, wf.edges)
  const def = getIntegration(guarded?.integrationId)
  const instructions = configString(node.config, 'instructions', 'description', 'message') ?? ''
  return (
    <Section title="Approval">
      <p className="type-body-sm text-ink-2">
        {guarded ? (
          <>
            You decide here whether <span className="text-ink">{guarded.label}</span> runs{def ? ` (${def.name}${def.support === 'simulated' ? ', simulated' : ''})` : ''}. It then runs without asking again.
          </>
        ) : (
          'The run stops here until you approve. Nothing after this step is guarded yet.'
        )}
      </p>
      <TextSetting
        label="What to check"
        value={instructions}
        onChange={(v) => updateStepConfig(wf.id, node.id, { instructions: v, description: undefined, message: undefined })}
        placeholder="Check the numbers before it is posted."
        hint="Shown on the approval card. Approval steps always ask you."
        multiline
      />
    </Section>
  )
}

function DelaySettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const hours = configNumber(node.config, 'hours')
  const minutes = configNumber(node.config, 'minutes')
  const unit: 'minutes' | 'hours' | 'days' = hours && hours >= 24 && hours % 24 === 0 ? 'days' : hours ? 'hours' : 'minutes'
  const amount = unit === 'days' ? (hours ?? 24) / 24 : unit === 'hours' ? (hours ?? 1) : (minutes ?? 1)
  const write = (n: number, u: typeof unit) => {
    const value = Math.max(1, Math.round(n))
    const config = u === 'minutes' ? { minutes: value, hours: undefined } : { hours: u === 'days' ? value * 24 : value, minutes: undefined }
    updateStepConfig(wf.id, node.id, { ...config, duration: undefined, delay: undefined })
  }
  return (
    <Section title="Delay">
      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
        <Field label="Wait">
          <Input type="number" min={1} value={String(amount)} onValueChange={(v) => write(Number(v) || 1, unit)} className="tabular" />
        </Field>
        <Field label="Unit">
          <Select aria-label="Unit" value={unit} onValueChange={(u) => write(amount, u as typeof unit)} options={[{ value: 'minutes', label: 'Minutes' }, { value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }]} />
        </Field>
      </div>
      <p className="type-caption text-ink-3">Waits {delayWords(node)} in production; simulated runs shorten it to a few seconds.</p>
    </Section>
  )
}

function OutputSettings({ wf, node }: { wf: Workflow; node: WorkflowNode }) {
  const kind = outputKindOf(node)
  const value = OUTPUT_KINDS.some((k) => k.value === kind) ? kind : 'notify'
  const title = configString(node.config, 'title', 'name') ?? ''
  const priority = configString(node.config, 'priority') ?? 'auto'
  const collectionId = configString(node.config, 'collectionId') ?? null
  return (
    <Section title="Output">
      <Field label="Result">
        <Select
          aria-label="Output"
          value={value}
          onValueChange={(k) => updateStepConfig(wf.id, node.id, { kind: k, output: undefined, type: undefined })}
          options={OUTPUT_KINDS.map((k) => ({ value: k.value, label: k.label, description: k.description }))}
        />
      </Field>
      {value !== 'none' && (
        <TextSetting
          label="Title"
          value={title}
          onChange={(v) => updateStepConfig(wf.id, node.id, { title: v })}
          placeholder={`${wf.name} — date`}
          hint={<>Empty uses the workflow name and date. <code className="type-meta">{'{{subject}}'}</code> works here.</>}
        />
      )}
      {value === 'knowledge' && (
        <Field label="Collection" optional>
          <CollectionPicker value={collectionId} onChange={(id) => updateStepConfig(wf.id, node.id, { collectionId: id ?? undefined })} />
        </Field>
      )}
      {value === 'task' && (
        <Field label="Priority">
          <Select
            aria-label="Priority"
            value={priority}
            onValueChange={(p) => updateStepConfig(wf.id, node.id, { priority: p === 'auto' ? undefined : p })}
            options={[
              { value: 'auto', label: 'From the run', description: 'Urgent and high stay urgent and high' },
              { value: 'urgent', label: 'Urgent' },
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
        </Field>
      )}
      <p className="type-caption text-ink-3">
        {value === 'knowledge'
          ? 'Creates a real note in Knowledge, linked to the run and marked simulated.'
          : value === 'task'
            ? 'Creates a real task in the workflow’s project, with the run as its origin.'
            : value === 'none'
              ? 'The run ends here without leaving anything behind.'
              : 'Posts a quiet update in Atrium with the result.'}
      </p>
    </Section>
  )
}

/** "Open the workflow" link used by the lens outside the editor. */
export function OpenWorkflowLink({ id }: { id: string }) {
  return (
    <Link to={`/workflows/${encodeURIComponent(id)}`} className="type-caption inline-flex items-center gap-1 text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
      Open in the editor <ArrowUpRight aria-hidden className="size-3" />
    </Link>
  )
}

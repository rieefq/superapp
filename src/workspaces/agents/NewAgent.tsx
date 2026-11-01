import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Check, Shuffle } from 'lucide-react'
import { ModelPicker, ReadBack, budgetState, capabilityRows, estimateRunCost, type ReadBackData } from '@/app/components'
import { SessionTemplate, StageHeader, useShellLayout } from '@/app/templates'
import { getModel } from '@/core/ai/models'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { agentExecutorModel, createAgent, getAgentTemplate, randomSigil } from '@/core/services'
import { useSettings } from '@/core/settings'
import { HUES, type Agent, type Autonomy, type CapabilityGrant, type Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Field, Input, SegmentedControl, Textarea, toast } from '@/ui'
import { summarizeAbilities, useAbilityRows } from './abilities'
import { AgentCardView } from './AgentCard'
import { AgentsList } from './AgentsList'
import { AbilitiesEditor } from './agent/Abilities'
import { HueOption, KnowledgeScopeEditor } from './agent/ConfigureTab'
import { AUTONOMY_COPY, AUTONOMY_ORDER, count } from './logic'
import { TemplateGallery, templateSeed } from './TemplateGallery'

type Step = 'identity' | 'abilities' | 'brief' | 'review'
const STEPS: { id: Step; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'brief', label: 'Brief' },
  { id: 'review', label: 'Review' },
]

interface Draft {
  name: string
  role: string
  description: string
  hue: Hue
  sigil: number
  modelId: string
  instructions: string
  capabilities: CapabilityGrant[]
  knowledgeScope: Agent['knowledgeScope']
  autonomy: Autonomy
  template?: string
}

const DRAFT_ID = 'agt_draft'

function draftFor(templateId: string | null, defaults: { modelId: string; autonomy: Autonomy; hue: Hue }): Draft {
  const t = getAgentTemplate(templateId ?? undefined)
  if (!t) {
    return {
      name: '',
      role: '',
      description: '',
      hue: defaults.hue,
      sigil: randomSigil(),
      modelId: defaults.modelId,
      instructions: '',
      capabilities: [{ capability: 'knowledge.read', mode: 'allow' }],
      knowledgeScope: { all: true, collectionIds: [], projectIds: [] },
      autonomy: defaults.autonomy,
    }
  }
  return {
    name: t.name,
    role: t.role,
    description: t.description,
    hue: t.hue,
    sigil: templateSeed(t.id),
    modelId: defaults.modelId,
    instructions: t.instructions,
    capabilities: t.capabilities.map((g) => ({ ...g })),
    knowledgeScope: { all: true, collectionIds: [], projectIds: [] },
    autonomy: t.autonomy,
    template: t.id,
  }
}

const asAgent = (d: Draft): Agent => ({
  id: DRAFT_ID,
  name: d.name.trim() || 'New agent',
  role: d.role.trim() || 'Assistant',
  description: d.description,
  hue: d.hue,
  sigil: d.sigil,
  modelId: d.modelId,
  instructions: d.instructions,
  capabilities: d.capabilities,
  knowledgeScope: d.knowledgeScope,
  autonomy: d.autonomy,
  status: 'active',
  template: d.template,
  createdAt: 0,
  updatedAt: 0,
})

/**
 * New agent (§6.4): a template (or Blank), then Identity → Abilities → Brief with a live card preview,
 * and Review: a read-back of the effective policy before anything is created. Creating lands on the
 * agent with its first instruction ready to run.
 */
export default function NewAgentView() {
  const [params, setParams] = useSearchParams()
  const templateId = params.get('template')
  const step = (STEPS.find((s) => s.id === params.get('step'))?.id ?? 'identity') as Step
  const { formFactor } = useShellLayout()
  const go = (next: { template?: string | null; step?: Step }) =>
    setParams((p) => {
      const n = new URLSearchParams(p)
      if (next.template === null) n.delete('template')
      else if (next.template) n.set('template', next.template)
      if (next.step) n.set('step', next.step)
      if (next.template === null) n.delete('step')
      return n
    })
  return (
    <SessionTemplate
      list={formFactor === 'phone' ? undefined : <AgentsList />}
      phoneView="stage"
      measure={templateId ? 1040 : 1120}
      header={<StageHeader title={templateId ? (getAgentTemplate(templateId) ? `New agent · ${getAgentTemplate(templateId)!.role}` : 'New agent · Blank') : 'New agent'} backTo="/agents/roster" />}
    >
      {templateId ? (
        <Wizard key={templateId} templateId={templateId} step={step} onStep={(s) => go({ step: s })} onRestart={() => go({ template: null })} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="type-title-2 text-ink">Start from a template</h2>
            <p className="type-body text-ink-2">Each template sets a role, instructions and abilities. You can change everything before and after creating it.</p>
          </div>
          <TemplateGallery onPick={(id) => go({ template: id, step: 'identity' })} />
        </div>
      )}
    </SessionTemplate>
  )
}

function Wizard({ templateId, step, onStep, onRestart }: { templateId: string; step: Step; onStep: (s: Step) => void; onRestart: () => void }) {
  const navigate = useNavigate()
  const defaultModelId = useSettings((s) => s.ai.defaultModelId)
  const defaultAutonomy = useSettings((s) => s.safety.defaultAutonomy)
  const usedHues = useDB((s: Tables) => Object.values(s.agents).filter((a) => a.status !== 'archived').map((a) => a.hue).join(','))
  const [draft, setDraft] = useState<Draft>(() => {
    const used = usedHues.split(',')
    const free = HUES.filter((h) => h !== 'volt').find((h) => !used.includes(h)) ?? 'sky'
    return draftFor(templateId === 'blank' ? null : templateId, { modelId: defaultModelId, autonomy: defaultAutonomy, hue: free })
  })
  const [touched, setTouched] = useState(false)
  const agent = useMemo(() => asAgent(draft), [draft])
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const nameError = !draft.name.trim() ? 'Give the agent a name.' : undefined
  const index = STEPS.findIndex((s) => s.id === step)

  // A step after Identity needs a name; send people back to fix it.
  useEffect(() => {
    if (nameError && step !== 'identity') onStep('identity')
  }, [nameError, step, onStep])

  const next = () => {
    if (step === 'identity' && nameError) {
      setTouched(true)
      return
    }
    if (step === 'review') return create()
    onStep(STEPS[index + 1].id)
  }
  const create = () => {
    try {
      const created = createAgent({
        name: draft.name,
        role: draft.role,
        description: draft.description,
        hue: draft.hue,
        sigil: draft.sigil,
        modelId: draft.modelId,
        instructions: draft.instructions,
        capabilities: draft.capabilities,
        knowledgeScope: draft.knowledgeScope,
        autonomy: draft.autonomy,
        template: draft.template,
      })
      const example = getAgentTemplate(draft.template)?.exampleInstruction
      toast.success(`Created ${created.name}`, { description: example ? 'Its first instruction is ready below. Edit it or run it.' : `Give ${created.name} its first instruction.` })
      navigate(`/agents/${encodeURIComponent(created.id)}`, { state: { draft: example ?? '' } })
    } catch (err) {
      toast.error('Couldn’t create the agent', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    const isText = t instanceof HTMLTextAreaElement
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!isText && t instanceof HTMLInputElement))) {
      e.preventDefault()
      next()
    }
  }

  return (
    <div className="@container/wizard flex flex-col gap-6" onKeyDown={onKeyDown}>
      <Stepper step={step} onStep={(s) => (!nameError || s === 'identity' ? onStep(s) : setTouched(true))} />
      <div className="grid gap-8 @min-[860px]/wizard:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          {step === 'identity' && <IdentityStep draft={draft} set={set} nameError={touched ? nameError : undefined} onBlurName={() => setTouched(true)} />}
          {step === 'abilities' && <AbilitiesStep draft={draft} set={set} agent={agent} />}
          {step === 'brief' && <BriefStep draft={draft} set={set} />}
          {step === 'review' && <ReviewStep draft={draft} agent={agent} />}
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {index > 0 ? (
              <Button variant="ghost" leadingIcon={ArrowLeft} onClick={() => onStep(STEPS[index - 1].id)}>
                Back
              </Button>
            ) : (
              <Button variant="ghost" leadingIcon={ArrowLeft} onClick={onRestart}>
                Templates
              </Button>
            )}
            <span className="flex-1" />
            {step === 'review' ? (
              <Button variant="primary" leadingIcon={Check} kbd="mod+enter" onClick={create}>
                Create agent
              </Button>
            ) : (
              <Button variant="primary" kbd="mod+enter" onClick={next}>
                Continue
              </Button>
            )}
          </div>
        </div>
        <Preview agent={agent} />
      </div>
    </div>
  )
}

function Stepper({ step, onStep }: { step: Step; onStep: (s: Step) => void }) {
  const index = STEPS.findIndex((s) => s.id === step)
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {STEPS.map((s, i) => {
          const done = i < index
          const current = i === index
          return (
            <li key={s.id} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden className="mx-1 hidden h-px w-5 bg-line-strong sm:block" />}
              <button
                type="button"
                aria-current={current ? 'step' : undefined}
                onClick={() => onStep(s.id)}
                className={cn(
                  'type-body-sm inline-flex h-8 items-center gap-2 rounded-sm px-2 transition-colors duration-(--dur-1) hover:bg-hover',
                  current ? 'font-medium text-ink' : done ? 'text-ink-2' : 'text-ink-3',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'type-meta grid size-5 place-items-center rounded-full border',
                    current ? 'border-ink bg-inverse text-inverse-ink' : done ? 'border-line-strong text-ink-2' : 'border-line-strong text-ink-3',
                  )}
                >
                  {done ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
                </span>
                {s.label}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="type-title-2 text-ink">{title}</h2>
      <p className="type-body-sm max-w-[60ch] text-ink-2">{children}</p>
    </div>
  )
}

function IdentityStep({ draft, set, nameError, onBlurName }: { draft: Draft; set: (p: Partial<Draft>) => void; nameError?: string; onBlurName: () => void }) {
  return (
    <>
      <StepIntro title="Identity">How the agent shows up in the roster, in runs and in every approval it asks for.</StepIntro>
      <div className="grid gap-4 @min-[560px]/wizard:grid-cols-2">
        <Field label="Name" required error={nameError}>
          <Input value={draft.name} onValueChange={(name) => set({ name })} onBlur={onBlurName} autoFocus placeholder="e.g. Iris" />
        </Field>
        <Field label="Role">
          <Input value={draft.role} onValueChange={(role) => set({ role })} placeholder="e.g. Research analyst" />
        </Field>
        <Field label="Description" optional className="@min-[560px]/wizard:col-span-2">
          <Textarea value={draft.description} onValueChange={(description) => set({ description })} autosize minRows={2} maxRows={5} placeholder="What it is for, in a sentence or two" />
        </Field>
        <Field label="Mark" className="@min-[560px]/wizard:col-span-2" hint="Its sigil and color identify it everywhere. Color never means status.">
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="radiogroup" aria-label="Mark color" className="flex flex-wrap items-center gap-1">
              {HUES.filter((h) => h !== 'volt').map((h) => (
                <HueOption key={h} hue={h} checked={draft.hue === h} sigil={draft.sigil} onSelect={() => set({ hue: h })} />
              ))}
            </div>
            <Button size="sm" variant="ghost" leadingIcon={Shuffle} onClick={() => set({ sigil: randomSigil() })}>
              New mark
            </Button>
          </div>
        </Field>
      </div>
    </>
  )
}

function AbilitiesStep({ draft, set, agent }: { draft: Draft; set: (p: Partial<Draft>) => void; agent: Agent }) {
  return (
    <>
      <StepIntro title="Abilities">What {agent.name} may do and through which service. “Ask” raises an approval card; “Deny” means it never tries.</StepIntro>
      <div className="flex flex-col gap-2">
        <span className="type-label text-ink-3">Autonomy</span>
        <SegmentedControl
          aria-label="Autonomy"
          value={draft.autonomy}
          onValueChange={(v) => set({ autonomy: v as Autonomy })}
          options={AUTONOMY_ORDER.map((a) => ({ value: a, label: AUTONOMY_COPY[a].label }))}
        />
        <p className="type-caption text-ink-3">{AUTONOMY_COPY[draft.autonomy].effect}</p>
      </div>
      <AbilitiesEditor agent={agent} onChange={(capabilities) => set({ capabilities })} />
    </>
  )
}

function BriefStep({ draft, set }: { draft: Draft; set: (p: Partial<Draft>) => void }) {
  const name = draft.name.trim() || 'The agent'
  const executor = getModel(agentExecutorModel({ modelId: draft.modelId }))
  const configured = getModel(draft.modelId)
  return (
    <>
      <StepIntro title="Brief">Standing instructions and what it may read. Instructions describe how it works; each run gets its own request.</StepIntro>
      <Field label="Instructions" hint={`${count(draft.instructions.split('\n').filter((l) => l.trim()).length, 'line')}`}>
        <Textarea value={draft.instructions} onValueChange={(instructions) => set({ instructions })} autosize minRows={6} maxRows={16} placeholder="Who it is, how it works, what it must never do" />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="type-label text-ink-3">Knowledge scope</span>
        <KnowledgeScopeEditor name={name} scope={draft.knowledgeScope} onChange={(knowledgeScope) => set({ knowledgeScope })} />
      </div>
      <Field label="Model" hint={configured && !configured.simulated ? `Agent runs are simulated in this build: they execute on ${executor?.label} and no model is called.` : 'Runs locally on the simulator. No model is called.'}>
        <ModelPicker value={draft.modelId} onChange={(modelId) => set({ modelId })} className="max-w-[340px]" />
      </Field>
    </>
  )
}

function ReviewStep({ draft, agent }: { draft: Draft; agent: Agent }) {
  const scope = useScope()
  const project = useDB((s: Tables) => (scope ? s.projects[scope] : undefined))
  const connections = useDB((s: Tables) => s.connections)
  const safety = useSettings((s) => s.safety)
  const example = getAgentTemplate(draft.template)?.exampleInstruction
  const data: ReadBackData = useMemo(() => {
    const s = useDB.getState()
    const snapshot = { ...s, agents: { ...s.agents, [agent.id]: agent } }
    const executor = getModel(agentExecutorModel(agent))
    return {
      verb: `Agent run · ${agent.name}`,
      title: example,
      projectName: project?.name ?? null,
      model: executor ? { label: executor.label, simulated: executor.simulated } : null,
      context: null,
      capabilities: capabilityRows(snapshot, { kind: 'agent', agentId: agent.id }, { agent, safety }),
      cost: estimateRunCost(s, 'agent', agentExecutorModel(agent)),
      budget: budgetState(s, safety),
    }
    // connections change the decisions (an integration connected or not)
  }, [agent, example, project, safety, connections])
  const scopeText = draft.knowledgeScope.all
    ? 'All knowledge'
    : `${count(draft.knowledgeScope.collectionIds.length, 'collection')} and ${count(draft.knowledgeScope.projectIds.length, 'project')}`
  return (
    <>
      <StepIntro title="Review">This is what {agent.name} will be able to do, read back from the live permission policy before anything is created.</StepIntro>
      <dl className="grid gap-x-6 gap-y-3 rounded-md border border-line p-4 @min-[560px]/wizard:grid-cols-2">
        <ReviewItem label="Name">{agent.name}</ReviewItem>
        <ReviewItem label="Role">{agent.role}</ReviewItem>
        <ReviewItem label="Autonomy">{AUTONOMY_COPY[agent.autonomy].label}</ReviewItem>
        <ReviewItem label="Knowledge">{scopeText}</ReviewItem>
        <ReviewItem label="Abilities">{count(draft.capabilities.length, 'ability', 'abilities')}</ReviewItem>
        <ReviewItem label="Instructions">{count(draft.instructions.split('\n').filter((l) => l.trim()).length, 'line')}</ReviewItem>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="type-label text-ink-3">A first run would read back as</span>
        <div className="rounded-md border border-line bg-raised p-4">
          <ReadBack data={data} />
        </div>
        <p className="type-caption text-ink-3">Each capability row opens to show the reason. Nothing runs until you give it work.</p>
      </div>
    </>
  )
}

function ReviewItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="type-label text-ink-3">{label}</dt>
      <dd className="type-body-sm truncate text-ink">{children}</dd>
    </div>
  )
}

function Preview({ agent }: { agent: Agent }) {
  const summary = summarizeAbilities(useAbilityRows(agent))
  return (
    <aside aria-label="Preview" className="flex flex-col gap-2 @min-[860px]/wizard:sticky @min-[860px]/wizard:top-0 @min-[860px]/wizard:self-start">
      <span className="type-label text-ink-3">Preview</span>
      <AgentCardView agent={agent} status="idle" line="Ready · no runs yet" asks={summary.asks} />
      {summary.blocked.length > 0 && (
        <p className="type-caption text-ink-3">
          Blocked right now: {summary.blocked.join(', ')}. Connect the service or change the ability to use it.
        </p>
      )}
    </aside>
  )
}

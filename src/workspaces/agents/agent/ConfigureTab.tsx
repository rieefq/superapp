import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Check, Shuffle } from 'lucide-react'
import { ModelPicker } from '@/app/components'
import { getModel } from '@/core/ai/models'
import { useDB, type Tables } from '@/core/db'
import {
  SCHEDULE_PRESETS,
  agentExecutorModel,
  nextCronRun,
  randomSigil,
  updateAgent,
  useAgentSpend,
  type AgentPatch,
} from '@/core/services'
import { HUES, type Agent, type Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, Button, Checkbox, Field, HUE_FILL, Input, RadioGroup, Select, Switch, Textarea, formatCost } from '@/ui'
import { AUTONOMY_COPY, count, formatWhen } from '../logic'
import { AbilitiesEditor } from './Abilities'

/** A section that confirms its own saves with an inline "Saved ✓" (§6.12 behavior, reused here). */
function useSaved(): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    saved,
    () => {
      setSaved(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setSaved(false), 2200)
    },
  ]
}

function Section({ id, title, description, saved, children }: { id: string; title: string; description?: ReactNode; saved?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-4 flex-col gap-3 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="type-body flex items-center gap-2 font-semibold text-ink">
          {title}
          {saved && (
            <span role="status" className="type-meta inline-flex items-center gap-1 font-normal text-ink-3">
              Saved <Check aria-hidden className="size-3" strokeWidth={2.25} />
            </span>
          )}
        </h3>
        {description && <p className="type-caption max-w-[64ch] text-ink-3 text-pretty">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Configure (§6.4): identity, instructions, model, abilities, knowledge scope, schedule and the
 * monthly budget. Discrete controls save instantly; text saves on blur (instructions on Save).
 */
export default function ConfigureTab({ agent }: { agent: Agent }) {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(`configure-${hash.slice(1)}`)
    el?.scrollIntoView({ block: 'start' })
  }, [hash])
  return (
    <div className="flex flex-col gap-8">
      <IdentitySection agent={agent} />
      <InstructionsSection agent={agent} />
      <ModelSection agent={agent} />
      <AbilitiesSection agent={agent} />
      <KnowledgeSection agent={agent} />
      <ScheduleSection agent={agent} />
      <BudgetSection agent={agent} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ identity

function IdentitySection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  const [name, setName] = useState(agent.name)
  const [role, setRole] = useState(agent.role)
  const [description, setDescription] = useState(agent.description)
  useEffect(() => setName(agent.name), [agent.name])
  useEffect(() => setRole(agent.role), [agent.role])
  useEffect(() => setDescription(agent.description), [agent.description])
  const save = (patch: AgentPatch) => {
    const before = JSON.stringify([agent.name, agent.role, agent.description, agent.hue, agent.sigil])
    const next = updateAgent(agent.id, patch)
    if (next && JSON.stringify([next.name, next.role, next.description, next.hue, next.sigil]) !== before) flash()
  }
  const hues = HUES.filter((h) => h !== 'volt' || agent.hue === 'volt')
  return (
    <Section id="configure-identity" title="Identity" description="How the agent appears everywhere: its name, mark, role and a short description." saved={saved}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onValueChange={setName} onBlur={() => save({ name })} onKeyDown={(e) => e.key === 'Enter' && save({ name })} />
        </Field>
        <Field label="Role">
          <Input value={role} onValueChange={setRole} onBlur={() => save({ role })} onKeyDown={(e) => e.key === 'Enter' && save({ role })} />
        </Field>
        <Field label="Mark" className="sm:col-span-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div role="radiogroup" aria-label="Mark color" className="flex flex-wrap items-center gap-1">
              {hues.map((h) => (
                <HueOption key={h} hue={h} checked={agent.hue === h} sigil={agent.sigil} onSelect={() => save({ hue: h })} />
              ))}
            </div>
            <Button size="sm" variant="ghost" leadingIcon={Shuffle} onClick={() => save({ sigil: randomSigil() })}>
              New mark
            </Button>
          </div>
        </Field>
        <Field label="Description" optional className="sm:col-span-2">
          <Textarea value={description} onValueChange={setDescription} onBlur={() => save({ description })} autosize minRows={2} maxRows={5} placeholder="What this agent is for, in a sentence or two" />
        </Field>
      </div>
    </Section>
  )
}

function HueOption({ hue, checked, sigil, onSelect }: { hue: Hue; checked: boolean; sigil: number; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={hue}
      onClick={onSelect}
      className={cn('grid size-8 place-items-center rounded-full transition-colors duration-(--dur-1) pointer-coarse:size-11', checked ? 'bg-press ring-1 ring-ink' : 'hover:bg-hover')}
    >
      <AgentMark seed={sigil} hue={hue} size={24} />
    </button>
  )
}

export { HueOption }

// ------------------------------------------------------------------------------------------------ instructions

function InstructionsSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  const [draft, setDraft] = useState(agent.instructions)
  useEffect(() => setDraft(agent.instructions), [agent.instructions])
  const dirty = draft !== agent.instructions
  const save = () => {
    updateAgent(agent.id, { instructions: draft })
    flash()
  }
  const lines = draft.split('\n').filter((l) => l.trim()).length
  return (
    <Section
      id="configure-instructions"
      title="Instructions"
      saved={saved}
      description={`${agent.name}’s standing brief. A live model would receive it at the start of every run; agent runs are simulated in this build, so the simulator plans from your request instead.`}
    >
      <Textarea
        value={draft}
        onValueChange={setDraft}
        autosize
        minRows={6}
        maxRows={18}
        aria-label={`Instructions for ${agent.name}`}
        placeholder="Who the agent is, how it works, what it must never do"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && dirty) {
            e.preventDefault()
            save()
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-meta text-ink-3">
          {count(lines, 'line')} · {count(draft.length, 'character')}
        </span>
        <span className="flex-1" />
        {dirty && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDraft(agent.instructions)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" kbd="mod+enter" onClick={save}>
              Save instructions
            </Button>
          </>
        )}
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ model

function ModelSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  const executor = getModel(agentExecutorModel(agent))
  const configured = getModel(agent.modelId)
  return (
    <Section id="configure-model" title="Model" saved={saved}>
      <div className="flex flex-col gap-2">
        <Field label="Model" hideLabel>
          <ModelPicker
            value={agent.modelId}
            onChange={(modelId) => {
              updateAgent(agent.id, { modelId })
              flash()
            }}
            className="max-w-[340px]"
          />
        </Field>
        <p className="type-caption text-ink-3">
          {configured && !configured.simulated
            ? `Agent runs are simulated in this build: ${agent.name}’s runs execute on ${executor?.label ?? 'the simulator'} and no model is called, even with ${configured.label} set here.`
            : `${agent.name}’s runs execute on ${executor?.label ?? 'the simulator'}, locally. No model is called.`}
        </p>
      </div>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ abilities

function AbilitiesSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  return (
    <Section
      id="configure-abilities"
      title="Abilities"
      saved={saved}
      description={
        <>
          What {agent.name} may do, and through which service. Autonomy is <span className="text-ink-2">{AUTONOMY_COPY[agent.autonomy].label.toLowerCase()}</span>:{' '}
          {AUTONOMY_COPY[agent.autonomy].effect.charAt(0).toLowerCase() + AUTONOMY_COPY[agent.autonomy].effect.slice(1)} Change it at the top of this page.
        </>
      }
    >
      <AbilitiesEditor
        agent={agent}
        onChange={(capabilities) => {
          updateAgent(agent.id, { capabilities })
          flash()
        }}
      />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ knowledge scope

export function KnowledgeScopeEditor({ scope, onChange, name }: { scope: Agent['knowledgeScope']; onChange: (next: Agent['knowledgeScope']) => void; name: string }) {
  const collections = useDB(useShallow((s: Tables) => Object.values(s.collections).sort((a, b) => a.name.localeCompare(b.name))))
  const projects = useDB(useShallow((s: Tables) => Object.values(s.projects).filter((p) => p.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const knowledge = useDB((s: Tables) => s.knowledge)
  const counts = useMemo(() => {
    const byCollection: Record<string, number> = {}
    const byProject: Record<string, number> = {}
    for (const k of Object.values(knowledge)) {
      if (k.collectionId) byCollection[k.collectionId] = (byCollection[k.collectionId] ?? 0) + 1
      for (const p of k.projectIds) byProject[p] = (byProject[p] ?? 0) + 1
    }
    const all = Object.values(knowledge)
    const readable = scope.all ? all.length : all.filter((k) => (k.collectionId && scope.collectionIds.includes(k.collectionId)) || k.projectIds.some((p) => scope.projectIds.includes(p))).length
    return { byCollection, byProject, total: all.length, readable }
  }, [knowledge, scope])
  const toggle = (key: 'collectionIds' | 'projectIds', id: string, on: boolean) =>
    onChange({ ...scope, [key]: on ? [...scope[key], id] : scope[key].filter((x) => x !== id) })
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        aria-label="Knowledge scope"
        value={scope.all ? 'all' : 'some'}
        onValueChange={(v) => onChange({ ...scope, all: v === 'all' })}
        options={[
          { value: 'all', label: 'All knowledge', description: `${name} can retrieve anything in Knowledge that is available to AI.` },
          { value: 'some', label: 'Only some collections and projects', description: 'Retrieval stays inside the ones you check.' },
        ]}
      />
      {!scope.all && (
        <div className="grid gap-4 pl-6 sm:grid-cols-2">
          <fieldset className="flex flex-col gap-1.5">
            <legend className="type-label mb-1 text-ink-3">Collections</legend>
            {collections.map((c) => (
              <Checkbox
                key={c.id}
                checked={scope.collectionIds.includes(c.id)}
                onCheckedChange={(on) => toggle('collectionIds', c.id, on)}
                label={
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className={cn('size-2.5 rounded-[3px]', HUE_FILL[c.hue])} />
                    {c.name}
                    <span className="type-meta text-ink-3">{counts.byCollection[c.id] ?? 0}</span>
                  </span>
                }
              />
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="type-label mb-1 text-ink-3">Projects</legend>
            {projects.map((p) => (
              <Checkbox
                key={p.id}
                checked={scope.projectIds.includes(p.id)}
                onCheckedChange={(on) => toggle('projectIds', p.id, on)}
                label={
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className={cn('size-2.5 rounded-[3px]', HUE_FILL[p.hue])} />
                    {p.name}
                    <span className="type-meta text-ink-3">{counts.byProject[p.id] ?? 0}</span>
                  </span>
                }
              />
            ))}
          </fieldset>
        </div>
      )}
      <p className="type-meta text-ink-3">
        Can read {counts.readable} of {counts.total} items · retrieval is real and local
      </p>
    </div>
  )
}

function KnowledgeSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  return (
    <Section id="configure-knowledge" title="Knowledge scope" saved={saved} description="Which knowledge the agent searches when it reads Knowledge. Items set to “Never” are never retrieved.">
      <KnowledgeScopeEditor
        name={agent.name}
        scope={agent.knowledgeScope}
        onChange={(knowledgeScope) => {
          updateAgent(agent.id, { knowledgeScope })
          flash()
        }}
      />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ schedule

function ScheduleSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  const schedule = agent.schedule
  const enabled = !!schedule?.enabled
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === schedule?.cron) ?? SCHEDULE_PRESETS[0]
  const options = SCHEDULE_PRESETS.map((p) => ({ value: p.cron, label: p.label }))
  if (schedule && !SCHEDULE_PRESETS.some((p) => p.cron === schedule.cron)) options.unshift({ value: schedule.cron, label: schedule.label })
  const next = enabled && schedule ? nextCronRun(schedule.cron, Date.now()) : undefined
  const set = (patch: Partial<NonNullable<Agent['schedule']>>) => {
    const base = schedule ?? { cron: preset.cron, label: preset.label, enabled: false }
    updateAgent(agent.id, { schedule: { ...base, ...patch } })
    flash()
  }
  return (
    <Section id="configure-schedule" title="Schedule" saved={saved} description="Scheduled runs work through the agent’s standing instructions. Runs only while Atrium is open: missed times are not made up.">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Switch checked={enabled} onCheckedChange={(on) => set({ enabled: on })} label="Run on a schedule" />
        <Select
          aria-label="Schedule"
          value={schedule?.cron ?? preset.cron}
          onValueChange={(cron) => set({ cron, label: options.find((o) => o.value === cron)?.label ?? cron })}
          options={options}
          disabled={!enabled}
          className="w-[220px]"
        />
      </div>
      <p className="type-meta text-ink-3">
        {enabled && schedule
          ? agent.status !== 'active'
            ? `Held while ${agent.name} is ${agent.status}.`
            : next
              ? `Next run ${formatWhen(next, Date.now())} · runs only while Atrium is open`
              : 'No upcoming time matches this schedule.'
          : 'Off. The agent runs only when you give it work.'}
      </p>
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ budget

function BudgetSection({ agent }: { agent: Agent }) {
  const [saved, flash] = useSaved()
  const spend = useAgentSpend(agent.id)
  const [value, setValue] = useState(agent.monthlyBudgetUsd ? String(agent.monthlyBudgetUsd) : '')
  useEffect(() => setValue(agent.monthlyBudgetUsd ? String(agent.monthlyBudgetUsd) : ''), [agent.monthlyBudgetUsd])
  const parsed = value.trim() === '' ? undefined : Number(value)
  const invalid = parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)
  const save = () => {
    if (invalid) return
    const next = parsed && parsed > 0 ? Math.round(parsed * 100) / 100 : undefined
    if (next === agent.monthlyBudgetUsd) return
    updateAgent(agent.id, { monthlyBudgetUsd: next })
    flash()
  }
  return (
    <Section
      id="configure-budget"
      title="Monthly budget"
      saved={saved}
      description="New runs don’t start once the agent’s counted spend this month reaches the budget. Simulated runs are estimates and count only when Settings › Budgets says so."
    >
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Budget in USD" hideLabel error={invalid ? 'Enter an amount of zero or more.' : undefined}>
          <Input
            inputMode="decimal"
            prefix="$"
            value={value}
            onValueChange={setValue}
            onBlur={save}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="No limit"
            wrapperClassName="w-[160px]"
            aria-label="Monthly budget in US dollars"
          />
        </Field>
        {agent.monthlyBudgetUsd ? (
          <Button size="md" variant="ghost" onClick={() => {
            setValue('')
            updateAgent(agent.id, { monthlyBudgetUsd: undefined })
            flash()
          }}>
            Remove limit
          </Button>
        ) : null}
      </div>
      <p className="type-meta text-ink-3">
        This month: {formatCost(spend.liveUsd)} live
        {spend.estimatedUsd > 0 && ` · est. ${formatCost(spend.estimatedUsd)} simulated${spend.countsEstimates ? ' (counted)' : ' (not counted)'}`}
      </p>
    </Section>
  )
}

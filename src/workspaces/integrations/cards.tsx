import { memo, type ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { OAI_PLACEHOLDER_ID, useModels } from '@/core/ai'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { useSettings } from '@/core/settings'
import type { IntegrationListItem, IntegrationStatus } from '@/core/services/integrations'
import { cn } from '@/lib/cn'
import { Card, Tag } from '@/ui'
import { categoryLabel, statusWord, usageLine, STATUS_SPEC } from './logic'
import { IntegrationMark, ModeBadge, SimulatorMark, StatusMark } from './parts'

/*
 * Catalog cards (§6.11): ring monogram (dashed when simulated), name, category, LIVE or SIMULATED,
 * capability chips, status and usage. The whole card is a link to the detail; the grid adds arrow keys
 * and Space-to-inspect (useGridKeys). Model-provider cards list the models they enable.
 */

const MAX_CHIPS = 3

function Chips({ labels, max = MAX_CHIPS, label }: { labels: string[]; max?: number; label: string }) {
  if (!labels.length) return null
  const shown = labels.slice(0, max)
  const more = labels.length - shown.length
  return (
    <ul aria-label={label} className="flex min-w-0 flex-wrap gap-1">
      {shown.map((l) => (
        <li key={l} className="min-w-0">
          <Tag size="sm" className="max-w-[200px] text-ink-2">
            {l}
          </Tag>
        </li>
      ))}
      {more > 0 && (
        <li className="type-meta self-center pl-0.5 text-ink-3" aria-label={`and ${more} more`}>
          +{more}
        </li>
      )}
    </ul>
  )
}

interface FrameProps {
  id: string
  to: string
  inspect?: string
  mark: ReactNode
  name: string
  category: string
  badge: ReactNode
  description: string
  chips?: ReactNode
  footer: ReactNode
  /** The Simulator card is hatched along its edge and dashed. */
  simulator?: boolean
  label: string
}

function CardFrame({ id, to, inspect, mark, name, category, badge, description, chips, footer, simulator, label }: FrameProps) {
  return (
    <li className="min-w-0">
      <Card
        to={to}
        padding="none"
        data-card={id}
        data-inspect={inspect}
        aria-label={label}
        className={cn(
          'group/card relative flex h-full min-h-[172px] flex-col overflow-hidden focus-visible:outline-offset-2',
          simulator && 'border-dashed border-line-input pl-1',
        )}
      >
        {simulator && <span aria-hidden className="sim-band absolute inset-y-0 left-0" />}
        <div className="flex items-start gap-3 px-4 pt-4">
          {mark}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="type-body truncate font-semibold text-ink">{name}</span>
            <span className="type-caption truncate text-ink-3">{category}</span>
          </div>
          <span className="flex shrink-0 items-center pt-0.5">{badge}</span>
        </div>
        <p className="type-body-sm mt-2.5 line-clamp-2 px-4 text-pretty text-ink-2">{description}</p>
        {chips && <div className="mt-3 px-4">{chips}</div>}
        <div className="mt-auto flex h-10 min-w-0 items-center gap-2 border-t border-line px-4 pt-px">{footer}</div>
      </Card>
    </li>
  )
}

function StatusLine({ status, word, detail, tone }: { status: IntegrationStatus | 'always'; word: string; detail?: string; tone?: 'fail' }) {
  return (
    <span className="type-caption flex min-w-0 flex-1 items-center gap-1.5">
      <StatusMark status={status} />
      <span className={cn('shrink-0 font-medium', tone === 'fail' ? 'text-fail-ink' : 'text-ink-2')}>{word}</span>
      {detail && (
        <>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <span className="min-w-0 truncate text-ink-3">{detail}</span>
        </>
      )}
    </span>
  )
}

type CardProps = Pick<IntegrationListItem, 'def' | 'connection' | 'status'>

/** A catalog service (Slack, GitHub…). Re-renders only when its own connection row changes. */
export const IntegrationCard = memo(function IntegrationCard({ def, connection, status }: CardProps) {
  const connected = status === 'connected' || status === 'connecting'
  const detail = status === 'error' ? (connection?.error ?? 'Reconnect to resume') : connected ? connection?.account : undefined
  const usage = connection ? usageLine(connection.usageCount, connection.lastUsedAt) : undefined
  const word = statusWord(def, status)
  return (
    <CardFrame
      id={def.id}
      to={`/integrations/${def.id}`}
      inspect={`integration:${def.id}`}
      label={`${def.name}, ${categoryLabel(def.category)}, ${def.support === 'live' ? 'live' : 'simulated'}, ${word}`}
      mark={<IntegrationMark def={def} />}
      name={def.name}
      category={categoryLabel(def.category)}
      badge={<ModeBadge support={def.support} />}
      description={def.description}
      chips={<Chips label="Capabilities" labels={def.capabilities.map((c) => CAPABILITIES[c].label)} />}
      footer={
        <>
          <StatusLine status={status} word={word} detail={detail} tone={status === 'error' ? 'fail' : undefined} />
          {usage && status === 'connected' && <span className="type-meta shrink-0 text-ink-3 tabular">{usage}</span>}
        </>
      }
    />
  )
})

/** Anthropic or the OpenAI-compatible endpoint: lists the models it enables in every model picker. */
export const ModelProviderCard = memo(function ModelProviderCard({ def, connection, status }: CardProps) {
  const models = useModels()
  const defaultModelId = useSettings((s) => s.ai.defaultModelId)
  const providerId = def.id === 'anthropic' ? 'anthropic' : 'openai-compatible'
  const mine = models.filter((m) => m.model.providerId === providerId)
  const available = mine.filter((m) => m.available)
  const isDefault = mine.some((m) => m.model.id === defaultModelId && m.available)
  const connected = status === 'connected' || status === 'connecting' || status === 'error'
  const chips =
    providerId === 'openai-compatible' && !available.length
      ? ['Ollama', 'LM Studio', 'OpenRouter', 'vLLM']
      : mine.filter((m) => m.model.id !== OAI_PLACEHOLDER_ID).map((m) => m.model.label.replace(/ · custom endpoint$/, ''))
  const word = statusWord(def, status)
  const cta = providerId === 'anthropic' ? 'Add API key' : 'Add endpoint'
  return (
    <CardFrame
      id={def.id}
      to={`/integrations/${def.id}`}
      inspect={`integration:${def.id}`}
      label={`${def.name}, AI models, live, ${word}`}
      mark={<IntegrationMark def={def} />}
      name={def.name}
      category="AI models"
      badge={<ModeBadge support="live" />}
      description={def.description}
      chips={<Chips label={providerId === 'anthropic' ? 'Models' : 'Works with'} labels={chips} max={2} />}
      footer={
        <>
          <StatusLine
            status={status}
            word={word}
            detail={status === 'error' ? connection?.error : connected ? connection?.account : undefined}
            tone={status === 'error' ? 'fail' : undefined}
          />
          {connected ? (
            <span className="type-meta shrink-0 text-ink-3">
              {isDefault ? 'Default' : `${available.length} ${available.length === 1 ? 'model' : 'models'}`}
            </span>
          ) : (
            <span className="type-caption inline-flex shrink-0 items-center gap-1 font-medium text-ink-2 group-hover/card:text-ink">
              {cta}
              <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.75} />
            </span>
          )}
        </>
      }
    />
  )
})

/** The local Simulator: always on, hatched (§6.11). */
export function SimulatorCard() {
  const defaultModelId = useSettings((s) => s.ai.defaultModelId)
  const speed = useSettings((s) => s.simulation.speed)
  const isDefault = defaultModelId.startsWith('sim-')
  return (
    <CardFrame
      id="simulator"
      to="/integrations/simulator"
      simulator
      label="Simulator, AI models, simulated, always on"
      mark={<SimulatorMark />}
      name="Simulator"
      category="AI models"
      badge={<ModeBadge support="simulated" />}
      description="Local template engine. Answers are generated in your browser — no model is called."
      chips={<Chips label="Models" labels={['Simulator · Swift', 'Simulator · Deep']} max={2} />}
      footer={
        <>
          <StatusLine status="always" word={STATUS_SPEC.always.word} detail={`${speed}× speed`} />
          {isDefault && <span className="type-meta shrink-0 text-ink-3">Default</span>}
        </>
      }
    />
  )
}

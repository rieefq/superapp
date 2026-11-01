import type { ReactNode } from 'react'
import { useRow } from '@/core/db'
import { ModelPicker } from '@/app/components'
import { getModelInfo, useModelAvailability, unavailableMessage } from '@/core/ai'
import { useHasSecret } from '@/core/secrets'
import { useSettings } from '@/core/settings'
import type { Effort } from '@/core/types'
import { LiveBadge, MonogramMark, SegmentedControl, SimBadge, Switch, useBreakpointUp } from '@/ui'
import { Group, InlineLink, Row, SectionBody, SettingRow, useSaveSetting } from '../parts'
import { getSection } from '../sections'

const EFFORTS: readonly { value: Effort; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** Models (§6.12): default model, effort, reasoning, auto-retrieve; providers link to Integrations. */
export default function ModelsSection() {
  const ai = useSettings((s) => s.ai)
  const save = useSaveSetting()
  const narrow = !useBreakpointUp('sm')
  const check = useModelAvailability(ai.defaultModelId)
  const model = check.model ?? getModelInfo(ai.defaultModelId)
  const reasons = !!model?.capabilities.includes('reasoning')

  const modelHint = !check.available ? (
    <span className="text-fail-ink">{unavailableMessage(ai.defaultModelId)}</span>
  ) : model?.simulated ? (
    'Used for new conversations and quick asks. Simulator answers are generated locally. No model is called.'
  ) : (
    `Used for new conversations and quick asks. ${model?.label ?? 'This model'} is called live from your browser with your key.`
  )
  const effortHint = reasons
    ? 'How much the model thinks before it answers. Higher takes longer and, on live models, costs more.'
    : `${model?.label ?? 'This model'} doesn’t reason, so effort applies once you pick a model that does.`

  return (
    <SectionBody lead={getSection('models')!.lead}>
      <Group label="Default">
        <SettingRow id="default-model" label="Default model" hint={modelHint}>
          <ModelPicker
            value={ai.defaultModelId}
            onChange={(defaultModelId) => save('default-model', 'Default model', 'ai', { defaultModelId })}
            className="w-64 max-sm:w-full"
          />
        </SettingRow>
        <SettingRow id="effort" label="Effort" hint={effortHint}>
          <SegmentedControl options={EFFORTS} value={ai.effort} onValueChange={(effort) => save('effort', 'Effort', 'ai', { effort })} fullWidth={narrow} />
        </SettingRow>
        <SettingRow
          id="reasoning"
          label="Show reasoning"
          hint="Keep a summary of the model’s reasoning above its answer, when the model gives one."
        >
          <Switch checked={ai.showReasoning} onCheckedChange={(showReasoning) => save('reasoning', 'Show reasoning', 'ai', { showReasoning })} />
        </SettingRow>
        <SettingRow
          id="auto-retrieve"
          label="Auto-retrieve knowledge"
          hint="Suggest matching knowledge as Likely chips while you type, and send the ones you keep. Items set to “Never” are never retrieved."
        >
          <Switch checked={ai.autoRetrieve} onCheckedChange={(autoRetrieve) => save('auto-retrieve', 'Auto-retrieve knowledge', 'ai', { autoRetrieve })} />
        </SettingRow>
      </Group>

      <Group label="Delegated runs" id="delegated">
        <Row className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <span className="text-sm font-medium text-ink">Research, coding sessions, agent runs and workflows</span>
            <span className="type-meta inline-flex items-center gap-1.5 text-ink-2">
              <SimBadge size="xs" />
              Simulator · Deep
            </span>
          </div>
          <p className="text-xs text-ink-3 text-pretty">
            Delegated runs are simulated in this build. Their steps, tool calls and terminal output are generated locally, every one is labeled
            SIM, and their costs are estimates.
          </p>
        </Row>
      </Group>

      <Providers />
    </SectionBody>
  )
}

function Providers() {
  const anthropicKey = useHasSecret('anthropic', 'apiKey')
  const oai = useRow('connections', 'openai-compatible')
  const oaiConfigured = !!oai && oai.status !== 'disconnected' && !!oai.config.baseUrl?.trim() && !!oai.config.model?.trim()
  return (
    <Group label="Providers and keys" id="providers" aside={<InlineLink to="/integrations">Manage keys in Integrations</InlineLink>}>
      <ProviderRow
        mark={<MonogramMark text="A" hue="amber" variant="ring" size={24} />}
        name="Anthropic"
        badge={<LiveBadge size="xs" />}
        status={anthropicKey ? 'Key set on this device' : 'No key yet. Claude models are unavailable.'}
        to="/integrations/anthropic"
        action={anthropicKey ? 'Manage' : 'Add key'}
      />
      <ProviderRow
        mark={<MonogramMark text="OC" hue="mint" variant="ring" size={24} />}
        name="OpenAI-compatible endpoint"
        badge={<LiveBadge size="xs" />}
        status={oaiConfigured ? `${oai!.config.model} at ${oai!.config.baseUrl}` : 'Not configured. Ollama, LM Studio, vLLM or OpenRouter.'}
        to="/integrations/openai-compatible"
        action={oaiConfigured ? 'Manage' : 'Connect'}
      />
      <ProviderRow
        mark={<MonogramMark text="S" hue="volt" variant="ring" size={24} simulated />}
        name="Simulator"
        badge={<SimBadge size="xs" />}
        status="Always on. Answers come from local templates; no model is called."
      />
    </Group>
  )
}

function ProviderRow({
  mark,
  name,
  badge,
  status,
  to,
  action,
}: {
  mark: ReactNode
  name: string
  badge: ReactNode
  status: string
  to?: string
  action?: string
}) {
  return (
    <Row className="flex items-center gap-3">
      <span className="flex shrink-0">{mark}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className="truncate">{name}</span>
          {badge}
        </span>
        <span className="truncate text-xs text-ink-3">{status}</span>
      </div>
      {to && action && (
        <InlineLink to={to} className="shrink-0">
          {action}
          <span className="sr-only"> {name}</span>
        </InlineLink>
      )}
    </Row>
  )
}

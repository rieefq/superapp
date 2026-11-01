import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { RotateCcw } from 'lucide-react'
import { version } from '../../../../package.json'
import { ModelLabel } from '@/app/components'
import { getModelInfo } from '@/core/ai'
import { SCHEMA_VERSION, useRow } from '@/core/db'
import { INTEGRATIONS } from '@/core/integrations/catalog'
import { useHasSecret } from '@/core/secrets'
import { updateSettings, useSettings } from '@/core/settings'
import type { Hue } from '@/core/types'
import { AtriumMark, Button, LiveBadge, MonogramMark, SimBadge, useActivityState } from '@/ui'
import { Group, Leader, Row, SectionBody } from '../parts'
import { getSection } from '../sections'

interface RealRow {
  id: string
  title: string
  live: boolean
  note: ReactNode
}

/** About (§6.12, §1.3): version, the honesty statement and the "What's real in this build" table. */
export default function AboutSection() {
  const navigate = useNavigate()
  const activity = useActivityState()
  const modelId = useSettings((s) => s.ai.defaultModelId)
  const anthropicKey = useHasSecret('anthropic', 'apiKey')
  const oai = useRow('connections', 'openai-compatible')
  const oaiUrl = oai && oai.status !== 'disconnected' ? oai.config.baseUrl?.trim() : undefined

  const rows: RealRow[] = [
    {
      id: 'claude',
      title: 'Claude models',
      live: true,
      note: `Chat turns and quick asks go from your browser to api.anthropic.com with your key. ${anthropicKey ? 'A key is set on this device.' : 'No key is set yet.'}`,
    },
    {
      id: 'oai',
      title: 'OpenAI-compatible endpoints',
      live: true,
      note: `Ollama, LM Studio, vLLM, OpenRouter… ${oaiUrl ? `Configured: ${oaiUrl}.` : 'None configured yet.'}`,
    },
    { id: 'github', title: 'GitHub reads', live: true, note: 'Repositories, files and history through the GitHub REST API. Public repositories need no token.' },
    { id: 'search', title: 'Search and retrieval', live: true, note: 'Full-text search and knowledge retrieval run locally, in this browser.' },
    { id: 'files', title: 'Your files', live: true, note: 'Files you add are read and indexed locally. They never leave this device.' },
    { id: 'storage', title: 'Storage, export and import', live: true, note: 'Everything is stored in this browser. Export JSON downloads a real file without your API keys.' },
    { id: 'simulator', title: 'Simulator models', live: false, note: 'Simulator · Swift and Deep answer from local templates. No model was called.' },
    { id: 'delegated', title: 'Delegated runs', live: false, note: 'Research, coding sessions, agent runs and workflows play locally scripted steps.' },
    { id: 'web', title: 'Web search and browsing', live: false, note: 'Web results are simulated in this build, on fictional .example domains.' },
    { id: 'terminal', title: 'Code execution and checks', live: false, note: 'Simulated terminal — nothing was executed. Test results are generated.' },
    { id: 'sends', title: 'Pull requests, pushes and messages', live: false, note: 'Marked “(simulated)” everywhere: Pull request #48 (simulated).' },
    { id: 'media', title: 'Images, video, decks and voice', live: false, note: 'Simulated preview — no image model was called.' },
    { id: 'schedules', title: 'Schedules and triggers', live: false, note: 'Runs only while Atrium is open. Webhook triggers accept test events.' },
    { id: 'costs', title: 'Costs of simulated runs', live: false, note: 'Estimated at reference pricing; no money was spent. Shown with est.' },
  ]

  return (
    <SectionBody lead={getSection('about')!.lead}>
      <div className="flex flex-col gap-4">
        <AtriumMark size="lg" wordmark state={activity} />
        <p className="type-body-lg max-w-[56ch] text-ink-2 text-pretty">
          One environment for thinking, delegating and reviewing. Every AI action is a visible, stoppable Run that shares your project’s context.
        </p>
      </div>

      <Group label="This build" id="version">
        <Row className="py-2">
          <dl className="flex flex-col">
            <Fact label="Version">{version}</Fact>
            <Fact label="Data format">{SCHEMA_VERSION}</Fact>
            <Fact label="Mode">{import.meta.env.DEV ? 'Development' : 'Production'}</Fact>
            <Fact label="Runs in">This browser. No account, no server, nothing synced.</Fact>
            <Fact label="Default model">
              <ModelLabel model={getModelInfo(modelId)} />
            </Fact>
          </dl>
        </Row>
      </Group>

      <Group label="Honesty" id="honesty">
        <Row className="flex flex-col gap-3 py-4">
          <p className="type-doc text-ink text-pretty">
            Atrium never pretends. Anything the local simulator produces carries a visible <SimBadge size="xs" /> tag with a hatch or a dashed edge,
            every estimate says est., and nothing claims that a model, a web search, a command or an integration ran when it didn’t.
          </p>
          <p className="text-xs text-ink-3">No setting can hide these labels. They show in screenshots and in exports too.</p>
        </Row>
      </Group>

      <Group
        label="What’s real in this build"
        id="whats-real"
        aside={
          <span className="type-meta text-ink-3">
            {rows.filter((r) => r.live).length} live · {rows.filter((r) => !r.live).length} simulated
          </span>
        }
      >
        <div role="table" aria-label="What’s real in this build" className="flex flex-col divide-y divide-line">
          <div role="row" className="sr-only">
            <span role="columnheader">Capability</span>
            <span role="columnheader">Live or simulated</span>
            <span role="columnheader">What happens</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} role="row" className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[200px_44px_minmax(0,1fr)] sm:items-baseline">
              <span role="rowheader" className="flex items-center gap-2 text-sm font-medium text-ink">
                <span className="sm:hidden">{r.live ? <LiveBadge size="xs" /> : <SimBadge size="xs" />}</span>
                {r.title}
              </span>
              <span role="cell" className="max-sm:hidden">
                {r.live ? <LiveBadge size="xs" /> : <SimBadge size="xs" />}
              </span>
              <span role="cell" className="text-xs text-ink-3 text-pretty">
                {r.note}
              </span>
            </div>
          ))}
        </div>
      </Group>

      <IntegrationsMatrix />

      <Group label="Getting started">
        <Row className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">Show the welcome again</span>
            <span className="text-xs text-ink-3">The first-run boot log and primers return to the top of Home.</span>
          </div>
          <Button
            variant="secondary"
            leadingIcon={RotateCcw}
            onClick={() => {
              updateSettings('onboarded', false)
              navigate('/')
            }}
          >
            Show welcome
          </Button>
        </Row>
      </Group>
    </SectionBody>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-baseline gap-3 py-1">
      <dt className="type-body-sm shrink-0 text-ink-2">{label}</dt>
      <Leader />
      <dd className="type-mono-sm min-w-0 text-right text-ink">{children}</dd>
    </div>
  )
}

/** Every integration in the catalog with its honest support level (ring monogram, dashed when simulated). */
function IntegrationsMatrix() {
  const sorted = useMemo(
    () => [...INTEGRATIONS].sort((a, b) => Number(b.support === 'live') - Number(a.support === 'live') || a.name.localeCompare(b.name)),
    [],
  )
  const live = sorted.filter((i) => i.support === 'live').length
  return (
    <Group
      label="Integrations"
      id="integrations"
      aside={
        <span className="type-meta text-ink-3">
          {live} live · {sorted.length - live} simulated
        </span>
      }
      footnote="Simulated integrations connect instantly and say so: “Simulated — nothing leaves your browser”."
    >
      <ul className="grid grid-cols-1 gap-x-4 px-4 py-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Integrations by support level">
        {sorted.map((i) => (
          <li key={i.id} className="flex h-9 min-w-0 items-center gap-2.5">
            <MonogramMark text={i.monogram} hue={i.hue as Hue} variant="ring" size={20} simulated={i.support === 'simulated'} />
            <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2">{i.name}</span>
            {i.support === 'live' ? <LiveBadge size="xs" /> : <SimBadge size="xs" noTooltip />}
          </li>
        ))}
      </ul>
    </Group>
  )
}

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useRow } from '@/core/db'
import { useHasSecret } from '@/core/secrets'
import { INTEGRATIONS } from '@/core/integrations/catalog'
import { Button, Dialog } from '@/ui'
import { LiveBadge, SimBadge } from '@/ui/signature'
import { useShellStore } from './store'

function Row({ tag, title, children }: { tag: 'live' | 'sim'; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="mt-0.5 w-10 shrink-0">{tag === 'live' ? <LiveBadge size="xs" /> : <SimBadge size="xs" />}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="type-body-sm font-medium text-ink">{title}</span>
        <span className="type-caption text-ink-3">{children}</span>
      </div>
    </li>
  )
}

/** "What's real in this build" (user menu): an honest list of live and simulated capabilities (§1.3, §8.4). */
export function WhatsRealDialog() {
  const open = useShellStore((s) => s.whatsRealOpen)
  const setOpen = useShellStore((s) => s.setWhatsRealOpen)
  const navigate = useNavigate()
  const anthropicKey = useHasSecret('anthropic', 'apiKey')
  const oai = useRow('connections', 'openai-compatible')
  const simulatedIntegrations = INTEGRATIONS.filter((i) => i.support === 'simulated').map((i) => i.name)

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="lg"
      title="What’s real in this build"
      description="Atrium runs entirely in your browser. Some capabilities are live; the rest are simulated by a local engine and labeled SIM wherever they appear."
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setOpen(false)
              navigate('/integrations')
            }}
          >
            Open Integrations
          </Button>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6 pb-2">
        <section aria-label="Live">
          <h3 className="type-label pb-1 text-ink-3">Live</h3>
          <ul>
            <Row tag="live" title="Claude models (Anthropic)">
              Requests go from your browser to api.anthropic.com with your key. {anthropicKey ? 'A key is set on this device.' : 'No key is set yet, so Claude models are unavailable.'}
            </Row>
            <Row tag="live" title="OpenAI-compatible endpoints">
              Any server you configure (Ollama, LM Studio, OpenRouter…). {oai?.config?.baseUrl ? `Configured: ${oai.config.baseUrl}.` : 'None configured yet.'}
            </Row>
            <Row tag="live" title="GitHub repository reads">Repositories, files and history through the GitHub REST API. Public repositories work without a token.</Row>
            <Row tag="live" title="Search and retrieval">Full-text search and knowledge retrieval run locally in your browser.</Row>
            <Row tag="live" title="Your files">Files you import are read locally and indexed for retrieval. They never leave this device.</Row>
            <Row tag="live" title="Storage and export">Everything is stored in this browser. Export data downloads a real JSON file (API keys excluded).</Row>
          </ul>
        </section>
        <section aria-label="Simulated">
          <h3 className="type-label pb-1 text-ink-3">Simulated</h3>
          <ul>
            <Row tag="sim" title="Simulator models (Swift, Deep)">Answers are generated locally from templates. No model was called.</Row>
            <Row tag="sim" title="Web search and browsing">Web results are simulated in this build. Sources live on fictional .example domains.</Row>
            <Row tag="sim" title="Code execution, terminals and checks">Simulated terminal — nothing was executed. Test results are generated.</Row>
            <Row tag="sim" title="Pull requests, pushes and messages">Pull requests, pushes, Slack and Gmail sends are marked “(simulated)” everywhere.</Row>
            <Row tag="sim" title="Images, video, decks and voice">Simulated preview — no image model was called.</Row>
            <Row tag="sim" title="Integrations">{simulatedIntegrations.join(', ')}. Simulated — nothing leaves your browser.</Row>
            <Row tag="sim" title="Schedules and triggers">Runs only while Atrium is open. Webhook triggers accept test events.</Row>
            <Row tag="sim" title="Costs of simulated runs">Estimated at reference pricing; no money was spent. Excluded from budgets unless you count them in Settings.</Row>
          </ul>
        </section>
      </div>
    </Dialog>
  )
}

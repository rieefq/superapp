import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { Activity, ArrowUpRight, BookOpen, CornerUpRight, KeyRound, Link2, Plug, RotateCw, ShieldCheck, Unplug } from 'lucide-react'
import { TurnIntoMenu } from '@/app/components'
import { useShellStore } from '@/app/shell/store'
import { useRegisterCommands } from '@/app/commands/registry'
import { Stage, StageHeader, useShellLayout } from '@/app/templates'
import { useScope } from '@/core/context'
import { getIntegration } from '@/core/integrations/catalog'
import { maskSecret, useSecretsStore } from '@/core/secrets'
import {
  connect,
  diagnoseConnection,
  disconnect,
  forgetSecrets,
  useConnection,
  useIntegrationUsage,
  type IntegrationStatus,
} from '@/core/services/integrations'
import { useSettings } from '@/core/settings'
import type { IntegrationDef } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDate } from '@/lib/format'
import { Button, ButtonLink, EmptyState, IconButton, StatusGlyph, toast, type MenuItem } from '@/ui'
import type { Command } from '@/app/types'
import { SectionBoundary } from './Catalog'
import { ConnectForm } from './ConnectForm'
import { SIMULATED_LINE, configLabel, connectedToast, editLabel, modelsFact, whatsRealBody } from './copy'
import { DisconnectDialog } from './DisconnectDialog'
import { categoryLabel, isConnectedLike, statusWord, usageLine } from './logic'
import { IntegrationMark, KeyRow, ModeBadge, SectionHead, SimulatorMark, StatusChip } from './parts'
import { Permissions } from './Permissions'
import { TestConnection } from './TestConnection'
import { ActivityList, ModelRuns, ModelsList, RecentSteps, UsageScope, UsedBy } from './Usage'

const MEASURE = 880

function Section({ id, title, count, action, children }: { id: string; title: string; count?: string | number; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <SectionHead id={id} title={title} count={count} action={action} />
      <SectionBoundary name={title.toLowerCase()}>{children}</SectionBoundary>
    </section>
  )
}

/** The honest note (§8.4): solid for live services; dashed with a hatched band when simulated. */
function WhatsReal({ simulated, children }: { simulated: boolean; children: ReactNode }) {
  return (
    <section
      aria-label="What’s real"
      className={cn('relative overflow-hidden rounded-md border px-4 py-3.5', simulated ? 'border-dashed border-line-input pl-6' : 'border-line bg-raised')}
    >
      {simulated && <span aria-hidden className="sim-band absolute inset-y-0 left-0" />}
      <h2 className="type-label pb-1.5 text-ink-3">What’s real</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Intro({ kicker, badge, description, facts }: { kicker: string; badge: ReactNode; description: string; facts: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <span className="type-label text-ink-3">{kicker}</span>
        {badge}
      </div>
      <p className="type-body-lg max-w-[62ch] text-pretty text-ink-2">{description}</p>
      {facts.length > 0 && <p className="type-meta flex flex-wrap gap-x-1.5 text-ink-3">{facts.join(' · ')}</p>}
    </div>
  )
}

function copyLink(path: string) {
  navigator.clipboard
    .writeText(`${window.location.origin}${path}`)
    .then(() => toast.success('Link copied'))
    .catch(() => toast.error('Couldn’t copy the link'))
}

// ------------------------------------------------------------------------------------------------ integration detail

function IntegrationDetail({ def }: { def: IntegrationDef }) {
  const connection = useConnection(def.id)
  const status: IntegrationStatus = connection?.status ?? 'available'
  const usage = useIntegrationUsage(def.id)
  const scope = useScope()
  const [showAll, setShowAll] = useState(false)
  const usageScope = showAll ? null : scope
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const focusForm = useRef<(() => void) | null>(null)
  const registerFocus = useCallback((fn: () => void) => {
    focusForm.current = fn
  }, [])
  const setWhatsRealOpen = useShellStore((s) => s.setWhatsRealOpen)
  const vault = useSecretsStore((s) => s.secrets[def.id])
  const fields = def.fields ?? []
  const hasFields = fields.length > 0
  const isModel = def.category === 'models'
  const connectedLike = isConnectedLike(status)
  const storedOptional = fields.filter((f) => f.secret && f.optional && vault?.[f.key]?.trim())
  const requiredSecret = fields.some((f) => f.secret && !f.optional)
  const word = statusWord(def, status)
  const ref = useMemo(() => ({ kind: 'integration' as const, id: def.id }), [def.id])
  const phone = useShellLayout().formFactor === 'phone'
  // Connected model providers and GitHub keep the form folded behind "Replace key" / "Edit endpoint".
  const [editing, setEditing] = useState(false)
  const showForm = !connectedLike || status === 'error' || editing

  const connectNow = async () => {
    if (hasFields && status !== 'error') {
      setEditing(true)
      // The form mounts on this render when it was folded.
      setTimeout(() => focusForm.current?.(), 0)
      return
    }
    setConnecting(true)
    try {
      const conn = await connect(def.id)
      if (conn.status === 'connected') {
        const t = connectedToast(def, conn)
        toast.success(t.title, { description: t.description })
      }
    } catch (err) {
      // Missing fields: take the user to the form instead.
      if (hasFields) focusForm.current?.()
      else toast.error(`Couldn’t connect ${def.name}`, { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setConnecting(false)
    }
  }

  const doDisconnect = () => {
    disconnect(def.id)
    toast(`${def.name} disconnected`, {
      description: requiredSecret ? 'The key was removed from this browser.' : 'Runs that need it are blocked until you reconnect.',
      action: requiredSecret ? undefined : { label: 'Reconnect', onClick: () => void connect(def.id).catch(() => undefined) },
    })
  }

  const doForget = () => {
    const labels = storedOptional.map((f) => f.label.toLowerCase())
    forgetSecrets(def.id)
    toast(`Forgot the ${labels.join(' and ')}`, {
      description: def.id === 'github' ? 'GitHub reads continue with public access.' : 'It was removed from this browser.',
    })
  }

  // ⌘K "Actions for this view".
  const commands = useMemo<Command[]>(() => {
    const out: Command[] = []
    if (connectedLike) {
      out.push({ id: `integrations.test.${def.id}`, title: `Test the ${def.name} connection`, icon: Activity, group: 'Integrations', run: (c) => (c.close(), void diagnoseConnection(def.id)) })
      out.push({ id: `integrations.disconnect.${def.id}`, title: `Disconnect ${def.name}…`, icon: Unplug, group: 'Integrations', run: (c) => (c.close(), setDisconnectOpen(true)) })
    }
    if (!connectedLike || status === 'error') {
      out.push({ id: `integrations.connect.${def.id}`, title: `${status === 'error' ? 'Reconnect' : 'Connect'} ${def.name}`, icon: Plug, group: 'Integrations', run: (c) => (c.close(), void connectNow()) })
    }
    return out
    // connectNow is stable enough for a command (it reads current state when it runs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, def.name, connectedLike, status])
  useRegisterCommands(`integrations.detail.${def.id}`, commands)

  const menu: MenuItem[] = [
    ...(connectedLike ? [{ id: 'test', label: 'Test connection', icon: Activity, onSelect: () => void diagnoseConnection(def.id) }] : []),
    ...(status === 'connected' && !hasFields ? [{ id: 'reconnect', label: 'Reconnect', icon: RotateCw, onSelect: () => void connectNow() }] : []),
    ...(storedOptional.length ? [{ id: 'forget', label: `Forget ${storedOptional[0].label.toLowerCase()}`, icon: KeyRound, onSelect: doForget }] : []),
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => copyLink(`/integrations/${def.id}`) },
    ...(def.docsUrl ? [{ id: 'docs', label: `${def.name} documentation`, icon: BookOpen, onSelect: () => void window.open(def.docsUrl, '_blank', 'noopener,noreferrer') }] : []),
    { id: 'real', label: 'What’s real in this build', icon: ShieldCheck, onSelect: () => setWhatsRealOpen(true) },
    ...(connectedLike ? [{ type: 'separator' as const }, { id: 'disconnect', label: `Disconnect ${def.name}…`, icon: Unplug, danger: true, onSelect: () => setDisconnectOpen(true) }] : []),
  ]

  const primary =
    status === 'connecting' ? (
      <Button size="sm" variant="secondary" loading>
        Connecting
      </Button>
    ) : status === 'error' ? (
      <Button size="sm" variant="primary" leadingIcon={RotateCw} loading={connecting} onClick={() => void connectNow()}>
        Reconnect
      </Button>
    ) : !connectedLike ? (
      <Button size="sm" variant="primary" leadingIcon={Plug} loading={connecting} onClick={() => void connectNow()}>
        Connect
      </Button>
    ) : null

  const facts: string[] = []
  if (connectedLike && connection?.account) facts.push(`Connected as ${connection.account}`)
  if (connectedLike && connection?.connectedAt) facts.push(`since ${formatDate(connection.connectedAt)}`)
  if (isModel && !connectedLike) facts.push(modelsFact(def))
  else if (status === 'disconnected') facts.push('Disconnected · permissions and history kept')
  else if (status === 'available') facts.push('Never connected')
  if (!isModel && (connectedLike || usage.usageCount)) facts.push(usageLine(usage.usageCount, usage.lastUsedAt))

  return (
    <Stage
      primary={ref}
      measure={MEASURE}
      header={
        <StageHeader
          leading={<IntegrationMark def={def} size={24} />}
          title={def.name}
          status={<StatusChip status={status} word={word} />}
          actions={
            <>
              {primary}
              <TurnIntoMenu
                entity={ref}
                kinds={['task', 'agent', 'note']}
                trigger={phone ? <IconButton icon={CornerUpRight} label="Turn into…" size="sm" /> : undefined}
              />
            </>
          }
          menu={menu}
        />
      }
    >
      <div className="flex flex-col gap-10 pb-12">
        <div className="flex flex-col gap-5">
          <Intro kicker={categoryLabel(def.category)} badge={<ModeBadge support={def.support} />} description={def.description} facts={facts} />
          {status === 'error' && (
            <div className="flex flex-wrap items-start gap-3 rounded-md border border-fail/40 bg-fail-tint/40 px-4 py-3">
              <span className="pt-[3px]">
                <StatusGlyph shape="cross" tone="fail" word="Error" decorative />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="type-body-sm font-medium text-fail-ink">{def.name} reported an error</p>
                <p className="type-body-sm text-pretty text-ink-2">{connection?.error ?? 'The last check failed.'}</p>
              </div>
              <Button size="sm" variant="secondary" leadingIcon={RotateCw} loading={connecting} onClick={() => void connectNow()}>
                Reconnect
              </Button>
            </div>
          )}
          <WhatsReal simulated={def.support === 'simulated'}>
            {def.support === 'simulated' && <p className="type-body-sm font-medium text-ink">{SIMULATED_LINE}</p>}
            <p className="type-body-sm text-pretty text-ink-2">{whatsRealBody(def)}</p>
          </WhatsReal>
        </div>

        <Section id={`int-${def.id}-connection`} title="Connection">
          <div className="flex flex-col gap-5">
            {connectedLike && (!hasFields || !showForm) && (
              <dl className="flex flex-col">
                {connection?.account && <KeyRow label="Account">{connection.account}</KeyRow>}
                {connection?.connectedAt && <KeyRow label="Connected">{formatDate(connection.connectedAt, { month: 'short', day: 'numeric', year: 'numeric' })}</KeyRow>}
                {hasFields
                  ? fields.map((f) =>
                      f.secret ? (
                        <KeyRow key={f.key} label={f.label}>
                          {vault?.[f.key]?.trim() ? `Stored in this browser · ${maskSecret(vault[f.key])}` : <span className="text-ink-3">Not set</span>}
                        </KeyRow>
                      ) : (
                        <KeyRow key={f.key} label={f.label}>
                          {connection?.config[f.key] || <span className="text-ink-3">Not set</span>}
                        </KeyRow>
                      ),
                    )
                  : Object.entries(connection?.config ?? {}).map(([k, v]) => (
                      <KeyRow key={k} label={configLabel(k)}>
                        {v}
                      </KeyRow>
                    ))}
                <KeyRow label="Mode">{def.support === 'live' ? 'Live requests from this browser' : 'Simulated locally'}</KeyRow>
              </dl>
            )}
            {hasFields && connectedLike && !showForm && (
              <div>
                <Button size="sm" variant="secondary" leadingIcon={KeyRound} onClick={() => setEditing(true)}>
                  {editLabel(def, !!storedOptional.length || requiredSecret)}
                </Button>
              </div>
            )}
            {hasFields ? (
              showForm && (
                <ConnectForm
                  def={def}
                  connection={connection}
                  status={status}
                  onFocusRequest={registerFocus}
                  onSaved={() => setEditing(false)}
                  onCancel={connectedLike && status !== 'error' ? () => setEditing(false) : undefined}
                />
              )
            ) : (
              !connectedLike && (
                <div className="flex flex-col gap-3">
                  <p className="type-body-sm text-pretty text-ink-2">
                    {status === 'disconnected'
                      ? `Reconnect to let agents and workflows use ${def.name} again. Your permissions are kept.`
                      : `Connect to let agents and workflows use ${def.name}. It connects instantly — no account or sign-in is needed.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="primary" leadingIcon={Plug} loading={connecting} onClick={() => void connectNow()}>
                      Connect {def.name}
                    </Button>
                    <span className="type-caption text-ink-3">{SIMULATED_LINE}</span>
                  </div>
                </div>
              )
            )}
            <TestConnection def={def} enabled={connectedLike && status !== 'connecting'} className="border-t border-line pt-5" />
            {connectedLike && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
                <Button size="sm" variant="danger" leadingIcon={Unplug} onClick={() => setDisconnectOpen(true)}>
                  Disconnect {def.name}
                </Button>
                {storedOptional.length > 0 && (
                  <Button size="sm" variant="ghost" leadingIcon={KeyRound} onClick={doForget}>
                    Forget {storedOptional[0].label.toLowerCase()}
                  </Button>
                )}
                <span className="type-caption text-ink-3">{requiredSecret ? 'Disconnecting removes the key from this browser.' : 'Permissions and history are kept.'}</span>
              </div>
            )}
          </div>
        </Section>

        {isModel && (
          <Section id={`int-${def.id}-models`} title="Models">
            <ModelsList providerId={def.id === 'anthropic' ? 'anthropic' : 'openai-compatible'} />
          </Section>
        )}

        {def.capabilities.length > 0 && (
          <Section id={`int-${def.id}-permissions`} title="Permissions">
            <Permissions def={def} connection={connection} status={status} />
          </Section>
        )}

        <Section id={`int-${def.id}-usage`} title="Usage" count={isModel ? undefined : usageLine(usage.usageCount, usage.lastUsedAt)}>
          <div className="flex flex-col gap-4">
            <UsageScope showAll={showAll} onShowAll={() => setShowAll(true)} onFilter={() => setShowAll(false)} />
            {isModel ? (
              <ModelRuns providerId={def.id === 'anthropic' ? 'anthropic' : 'openai-compatible'} scope={usageScope} label={def.id === 'anthropic' ? 'Claude models' : 'your endpoint'} />
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <h3 className="type-caption font-medium text-ink-2">Used by</h3>
                  <UsedBy def={def} workflowsInScope={usageScope} />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="type-caption font-medium text-ink-2">Recent steps</h3>
                  <RecentSteps def={def} scope={usageScope} />
                </div>
              </>
            )}
          </div>
        </Section>

        <Section id={`int-${def.id}-activity`} title="Activity">
          <ActivityList id={def.id} />
        </Section>
      </div>

      <DisconnectDialog
        def={def}
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        onConfirm={doDisconnect}
      />
    </Stage>
  )
}

// ------------------------------------------------------------------------------------------------ simulator detail

function SimulatorDetail() {
  const scope = useScope()
  const [showAll, setShowAll] = useState(false)
  const speed = useSettings((s) => s.simulation.speed)
  const setWhatsRealOpen = useShellStore((s) => s.setWhatsRealOpen)
  return (
    <Stage
      measure={MEASURE}
      header={
        <StageHeader
          leading={<SimulatorMark size={24} />}
          title="Simulator"
          status={<StatusChip status="always" />}
          menu={[
            { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => copyLink('/integrations/simulator') },
            { id: 'real', label: 'What’s real in this build', icon: ShieldCheck, onSelect: () => setWhatsRealOpen(true) },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-10 pb-12">
        <div className="flex flex-col gap-5">
          <Intro
            kicker="AI models"
            badge={<ModeBadge support="simulated" />}
            description="Atrium’s local template engine. It answers chat turns and runs delegated work in this build, entirely in your browser."
            facts={['Always on', `${speed}× speed`, 'Free']}
          />
          <WhatsReal simulated>
            <p className="type-body-sm font-medium text-ink">No model is called.</p>
            <p className="type-body-sm text-pretty text-ink-2">
              Answers are generated locally from templates and carry a SIM tag and a Colophon that says “No model was called”. Research, coding, agent, workflow and Studio runs
              in this build are executed by the same engine, and their costs are estimates. Connect Anthropic or an OpenAI-compatible endpoint for real model answers.
            </p>
          </WhatsReal>
        </div>

        <Section id="int-simulator-models" title="Models">
          <ModelsList providerId="simulator" />
        </Section>

        <Section id="int-simulator-settings" title="Settings">
          <dl className="flex flex-col">
            <KeyRow label="Speed">
              <span className="flex flex-wrap items-baseline gap-x-3">
                {speed}×
                <ButtonLink to="/settings/simulator" variant="link" className="type-caption">
                  Change in Settings › Simulator
                </ButtonLink>
              </span>
            </KeyRow>
            <KeyRow label="Status">Always on — it can’t be disconnected</KeyRow>
          </dl>
        </Section>

        <Section id="int-simulator-usage" title="Usage">
          <div className="flex flex-col gap-4">
            <UsageScope showAll={showAll} onShowAll={() => setShowAll(true)} onFilter={() => setShowAll(false)} />
            <ModelRuns providerId="simulator" scope={showAll ? null : scope} label="the Simulator" />
          </div>
        </Section>
      </div>
    </Stage>
  )
}

// ------------------------------------------------------------------------------------------------ route

function NotFound({ id }: { id: string }) {
  return (
    <Stage header={<StageHeader title="Integration not found" />}>
      <EmptyState
        icon={Plug}
        title={`No integration called “${id}”`}
        description="It may have been renamed or removed from the catalog."
        actions={
          <ButtonLink to="/integrations" variant="primary" trailingIcon={ArrowUpRight}>
            Back to the catalog
          </ButtonLink>
        }
      />
    </Stage>
  )
}

/** `/integrations/:integrationId` — an integration's detail, the Simulator, or a not-found state. */
export function DetailView() {
  const { integrationId = '' } = useParams()
  if (integrationId === 'simulator') return <SimulatorDetail />
  const def = getIntegration(integrationId)
  if (!def) return <NotFound id={integrationId} />
  return <IntegrationDetail key={def.id} def={def} />
}

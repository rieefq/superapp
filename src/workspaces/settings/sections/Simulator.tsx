import { memo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { entityRoute } from '@/core/services'
import { useSettings } from '@/core/settings'
import { isRunActive, type Run } from '@/core/types'
import { LiveBadge, RunRow, SegmentedControl, SimBadge, useBreakpointUp } from '@/ui'
import { speedLabel, speedOptions } from '../logic'
import { Group, InlineLink, Row, SectionBody, SettingRow, useSaveSetting } from '../parts'
import { getSection } from '../sections'

const IN_FLIGHT_SHOWN = 3

/** Simulated runs in flight, newest first (only rows whose status or steps change re-render). */
function useSimulatedInFlight(): Run[] {
  return useDB(
    useShallow((s: Tables) =>
      Object.values(s.runs)
        .filter((r) => r.simulated && isRunActive(r.status))
        .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)),
    ),
  )
}

/** Simulator (§6.12): speed, the simulated runs playing right now, and what is simulated vs live. */
export default function SimulatorSection() {
  const speed = useSettings((s) => s.simulation.speed)
  const save = useSaveSetting()
  const narrow = !useBreakpointUp('sm')
  const runs = useSimulatedInFlight()
  const options = speedOptions(speed).map((v) => ({ value: String(v), label: speedLabel(v) }))

  return (
    <SectionBody lead={getSection('simulator')!.lead}>
      <Group label="Pacing">
        <SettingRow
          id="speed"
          label="Simulation speed"
          hint="How fast simulated steps play out. 1× is realistic pacing; 4× is quick for demos. Applies from each run’s next step."
        >
          <SegmentedControl
            aria-label="Simulation speed"
            options={options}
            value={String(speed)}
            onValueChange={(v) => save('speed', 'Simulation speed', 'simulation', { speed: Number(v) })}
            fullWidth={narrow}
          />
        </SettingRow>
      </Group>

      <Group
        label="Playing now"
        id="in-flight"
        aside={runs.length > 0 ? <InlineLink to="/agents?status=running">All runs</InlineLink> : undefined}
      >
        {runs.length === 0 ? (
          <Row>
            <p className="text-sm text-ink-3">No simulated runs in flight. Start research or delegate a task to watch one play.</p>
          </Row>
        ) : (
          <div className="flex flex-col py-1">
            {runs.slice(0, IN_FLIGHT_SHOWN).map((run) => (
              <InFlight key={run.id} run={run} />
            ))}
            {runs.length > IN_FLIGHT_SHOWN && (
              <p className="type-meta px-4 pt-1 pb-2 text-ink-3">+{runs.length - IN_FLIGHT_SHOWN} more simulated runs in flight</p>
            )}
          </div>
        )}
      </Group>

      <Group
        label="What is simulated"
        id="what-is-simulated"
        aside={<InlineLink to="/settings/about#whats-real">Full table in About</InlineLink>}
        footnote="Simulated work is always labeled SIM, with a hatch or a dashed edge. No setting can hide those labels."
      >
        <div className="grid sm:grid-cols-2 sm:divide-x sm:divide-line max-sm:divide-y max-sm:divide-line">
          <Column title="Live" badge={<LiveBadge size="xs" />}>
            <li>Chat with Claude (your Anthropic key) or an OpenAI-compatible endpoint you set up</li>
            <li>GitHub reads: repositories, files and history</li>
            <li>Search, knowledge retrieval and your files, all inside this browser</li>
            <li>Storage, Export JSON and Import</li>
          </Column>
          <Column title="Simulated" badge={<SimBadge size="xs" />}>
            <li>Simulator · Swift and Deep answers. No model was called.</li>
            <li>Delegated runs: research, coding sessions, agent runs and workflows</li>
            <li>Web search, terminals and tests (“Simulated terminal — nothing was executed”)</li>
            <li>Pull requests, pushes, Slack and email sends, marked “(simulated)”</li>
            <li>Images, video, decks and voice, and the costs of simulated runs (est.)</li>
          </Column>
        </div>
      </Group>
    </SectionBody>
  )
}

function Column({ title, badge, children }: { title: string; badge: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-medium text-ink">
        {badge}
        {title}
      </h3>
      <ul className="type-body-sm flex list-none flex-col gap-1.5 text-ink-2 [&>li]:text-pretty">{children}</ul>
    </div>
  )
}

const InFlight = memo(function InFlight({ run }: { run: Run }) {
  const navigate = useNavigate()
  const agent = useDB((s: Tables) => (run.agentId ? s.agents[run.agentId] : undefined))
  const open = () => navigate(entityRoute({ kind: 'run', id: run.id }))
  return (
    <RunRow
      run={run}
      agent={agent ? { name: agent.name, hue: agent.hue, sigil: agent.sigil } : undefined}
      onSelect={open}
      onOpen={open}
      className="mx-1.5"
    />
  )
})

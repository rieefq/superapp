import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { ReadBack, useReadBack } from '@/app/components'
import { GENERATOR_INTEGRATION } from '@/core/services/studio'
import type { AssetKind, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Popover, SimBadge } from '@/ui'
import { KINDS } from './kinds'

/*
 * Honest labeling for Studio (§8.4): every generated output carries a visible SIM tag and the exact
 * simulated line; the explainer says what a real generator connection would change.
 */

const MEDIA: Partial<Record<AssetKind, string>> = { image: 'image', video: 'video', audio: 'voice' }

/** What happens in this build, and what a connected generator would change — per kind. */
export function GeneratorExplainer({ kind, children }: { kind: AssetKind; children?: ReactNode }) {
  const info = KINDS[kind]
  const integration = GENERATOR_INTEGRATION[kind]
  const media = MEDIA[kind]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <SimBadge size="xs" />
        <h3 className="type-body-sm font-semibold text-ink">Simulated generator</h3>
      </div>
      <p className="type-body-sm text-ink-2">
        {kind === 'image' &&
          'Previews are procedural art, drawn in your browser from the prompt’s colors, mood and style. No image model was called and nothing left this device.'}
        {kind === 'video' &&
          'Storyboards are written locally and each shot is a procedural frame. No video model was called and no footage exists.'}
        {kind === 'audio' && 'A narration script is written locally and its waveform is drawn from the words. No voice model was called and no audio file exists.'}
        {(kind === 'presentation' || kind === 'document') &&
          'Slides and copy are written by Atrium’s local simulator from your prompt and the context it shows. No model was called, even when a model key is set.'}
      </p>
      <div className="flex flex-col gap-1.5">
        <p className="type-label text-ink-3">With a real generator connected</p>
        <ul className="type-body-sm flex flex-col gap-1 text-ink-2">
          {media ? (
            <li>
              · Each take would be a model-generated {kind === 'audio' ? 'recording' : media === 'image' ? 'image' : 'clip'} instead of a{' '}
              {kind === 'audio' ? 'script and drawn waveform' : 'procedural render'}.
            </li>
          ) : (
            <li>· The words would come from the connected model, grounded in the same context.</li>
          )}
          <li>· Runs would call the provider: the Colophon would show its name, real duration and cost instead of SIM and est.</li>
          <li>· Versions, takes, boards, compare, edits and downloads would work exactly as they do now.</li>
        </ul>
      </div>
      {children}
      {integration ? (
        <Link
          to={`/integrations/${integration}`}
          className="type-caption inline-flex w-fit items-center gap-1 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
        >
          {info.label === 'Audio' ? 'Voice synthesis' : `${info.label} generator`} in Integrations
          <ArrowUpRight aria-hidden className="size-3" strokeWidth={2} />
        </Link>
      ) : (
        <Link
          to="/settings/models"
          className="type-caption inline-flex w-fit items-center gap-1 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
        >
          Models in Settings
          <ArrowUpRight aria-hidden className="size-3" strokeWidth={2} />
        </Link>
      )}
    </div>
  )
}

/** The prompt bar's generator chip: `SIM Procedural preview ▾` → what runs, and what would change. */
export function GeneratorChip({ kind, projectId, className }: { kind: AssetKind; projectId: ID | null; className?: string }) {
  const raw = useReadBack({ kind: 'studio', studioKind: kind, projectId })
  // Images and storyboards are drawn from the prompt alone: their runs never read knowledge.
  const visual = kind === 'image' || kind === 'video'
  const readBack = visual ? { ...raw, capabilities: raw.capabilities.filter((c) => c.capability !== 'knowledge.read') } : raw
  return (
    <Popover
      placement="top-start"
      aria-label="About this generator"
      className="w-[min(420px,calc(100vw-16px))] p-4"
      trigger={
        <button
          type="button"
          aria-label={`Generator: ${KINDS[kind].generator}, simulated. What this means`}
          className={cn(
            'inline-flex h-7 min-w-0 shrink items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press data-[state=open]:text-ink',
            'pointer-coarse:h-11',
            className,
          )}
        >
          <SimBadge size="xs" noTooltip />
          <span className="truncate">{KINDS[kind].generator}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
        </button>
      }
    >
      <GeneratorExplainer kind={kind}>
        <div className="border-t border-line pt-3">
          <ReadBack data={readBack} />
        </div>
      </GeneratorExplainer>
    </Popover>
  )
}

/**
 * The persistent label under generated media: `SIM Simulated generator · Simulated preview — no image
 * model was called · What would change?`. Never hover-only.
 */
export function SimulatedNote({ kind, className }: { kind: AssetKind; className?: string }) {
  return (
    <p className={cn('type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3', className)} data-testid="studio-sim-note">
      <SimBadge size="xs" />
      <span className="text-ink-2">Simulated generator</span>
      <span aria-hidden>·</span>
      <span>{KINDS[kind].simulatedLine}</span>
      <span aria-hidden>·</span>
      <Popover
        placement="top-start"
        aria-label="What a real generator would change"
        className="w-[min(400px,calc(100vw-16px))] p-4"
        trigger={
          <button type="button" className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
            What would change?
          </button>
        }
      >
        <GeneratorExplainer kind={kind} />
      </Popover>
    </p>
  )
}

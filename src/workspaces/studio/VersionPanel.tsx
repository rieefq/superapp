import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { announce } from '@/app/shell/Announcer'
import { useRow } from '@/core/db'
import { useRun } from '@/core/runs'
import { editAsset, stopGeneration, versionAt, versionParams, type StudioVersion } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, ProvenanceLine, SimBadge, StepTape, runCurrentLine, toast } from '@/ui'
import { KINDS, PARAM_LABELS, paramDisplay } from './kinds'

/**
 * What one version is: its note, prompt, params and Colophon (the run that made it, or a plain
 * simulated line for versions that predate run tracking).
 */
export function VersionDetails({ asset, index }: { asset: Asset; index: number }) {
  const v = versionAt(asset, index)
  const runId = v?.runId ?? (index === asset.versions.length - 1 ? asset.runId : undefined)
  const run = useRow('runs', runId)
  const [open, setOpen] = useState(false)
  if (!v) return null
  const params = versionParams(asset, index)
  const facts = Object.keys(PARAM_LABELS)
    .filter((k) => k !== 'takes')
    .map((k) => [PARAM_LABELS[k], paramDisplay(k, params[k])] as const)
    .filter((x): x is readonly [string, string] => !!x[1])
  const long = v.prompt.length > 220
  return (
    <section aria-label={`Version ${index + 1}`} className="flex min-w-0 flex-col gap-2">
      <div className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
        <span className="text-ink-2">v{index + 1}</span>
        {index === asset.currentVersion && (
          <>
            <span aria-hidden>·</span>
            <span>Current</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>{timeAgo(v.createdAt)}</span>
        {(v as StudioVersion).editedAt && (
          <>
            <span aria-hidden>·</span>
            <span>edited by you {timeAgo((v as StudioVersion).editedAt!)}</span>
          </>
        )}
      </div>
      {v.note && <p className="type-body-sm max-w-[80ch] text-ink">{v.note}</p>}
      <p className={cn('type-body-sm max-w-[80ch] text-ink-2', !open && long && 'line-clamp-2')}>
        <span className="text-ink-3">Prompt · </span>
        {v.prompt}
      </p>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="type-caption self-start rounded-xs text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink">
          {open ? 'Show less' : 'Show the whole prompt'}
        </button>
      )}
      {facts.length > 0 && (
        <dl className="type-meta flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-1">
              <dt>{label}</dt>
              <dd className="text-ink-2">{value}</dd>
            </div>
          ))}
          {v.preview.type === 'procedural' && (
            <div className="flex gap-1">
              <dt>Seed</dt>
              <dd className="text-ink-2 tabular">#{v.preview.seed}</dd>
            </div>
          )}
        </dl>
      )}
      {run ? (
        <ProvenanceLine run={run} onViewRun={() => attachRun(run.id, 'studio')} />
      ) : (
        <ProvenanceLine simulated={asset.generator.simulated} modelLabel={`Simulator · ${asset.generator.label}`} />
      )}
    </section>
  )
}

/**
 * The Iterate composer (§6.8): an instruction becomes a new version, never an overwrite. While a
 * generation runs it shows the run's tape and Stop; instructions typed then wait for it to finish.
 */
export function IterateBar({ asset }: { asset: Asset }) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const generating = asset.status === 'generating'
  const run = useRun(generating ? asset.runId : undefined)
  const next = asset.versions.length + (generating ? 2 : 1)
  const from = asset.currentVersion + 1
  const info = KINDS[asset.kind]

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(40, el.scrollHeight)}px`
  }, [text])

  const [queued, setQueued] = useState<string | null>(null)

  const start = (instruction: string) => {
    const r = editAsset(asset.id, instruction)
    if (!r) {
      toast({ tone: 'error', title: 'Couldn’t start the edit', description: asset.versions.length ? undefined : 'There is no version to edit yet.' })
      return false
    }
    announce(`Generating a new version of “${asset.title}” with your instruction`)
    return true
  }

  // No steering mid-run: an instruction typed while generating waits for the run, then starts.
  useEffect(() => {
    if (generating || !queued) return
    const q = queued
    setQueued(null)
    start(q)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, queued])

  const submit = () => {
    const instruction = text.trim()
    if (!instruction) return
    if (generating) {
      setQueued(instruction)
      setText('')
      return
    }
    if (start(instruction)) setText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') inputRef.current?.blur()
  }

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col rounded-md border border-line-input bg-raised p-2.5 pl-3',
        'has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-(--focus-ring)',
      )}
      role="group"
      aria-label="Iterate"
    >
      {queued && (
        <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-line-strong bg-canvas py-1 pr-1 pl-2.5" role="status">
          <span className="type-caption min-w-0 flex-1 truncate text-ink-2">
            <span className="text-ink">Queued</span> — runs when this generation finishes · <span className="text-ink-3">“{queued}”</span>
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              if (!text.trim()) setText(queued)
              setQueued(null)
              inputRef.current?.focus()
            }}
          >
            Cancel
          </Button>
        </div>
      )}
      <div className="flex min-w-0 items-end gap-2">
        <textarea
          ref={inputRef}
          data-composer-input=""
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={generating ? `Generating v${asset.versions.length + 1}… type the next change` : asset.versions.length ? info.iteratePlaceholder : 'No version to iterate on yet'}
          disabled={!generating && !asset.versions.length}
          aria-label="Instruction for a new version"
          className="type-body block max-h-[160px] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2.5 text-ink outline-none placeholder:text-ink-3 pointer-coarse:text-[16px]"
        />
        {generating && !text.trim() ? (
          <Button size="sm" variant="secondary" leadingIcon={Square} onClick={() => stopGeneration(asset.id)} className="mb-1.5">
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" trailingIcon={ArrowUp} kbd="enter" disabled={!text.trim() || !asset.versions.length && !generating} onClick={submit} className="mb-1.5">
            {generating ? 'Queue' : 'Iterate'}
          </Button>
        )}
      </div>
      <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-0.5 pt-1 text-ink-3">
        {generating && run ? (
          <>
            <StepTape run={run} size="sm" max={10} />
            <span className="min-w-0 truncate text-live-ink">{runCurrentLine(run)}</span>
            <span aria-hidden>·</span>
            <button type="button" onClick={() => attachRun(run.id, 'studio')} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
              View run
            </button>
          </>
        ) : !asset.versions.length ? (
          <span>Iterate starts from a version — retry the first generation above.</span>
        ) : (
          <>
            <span>
              Makes v{next} from v{from} — never overwrites
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <SimBadge size="xs" /> no model is called
            </span>
          </>
        )}
      </div>
    </div>
  )
}

import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { versionContent, versionParams } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, ProceduralArt, SimBadge, useReducedMotion, type ProceduralSpec } from '@/ui'
import { aspectRatio, formatClock, parseShots, shotAt, storyboardDuration, type Shot } from '../logic'
import { previewSpec, shotSpec } from '../previews'
import { FailedCard, GeneratingCard, SideLabel } from './common'

/*
 * Video in this build is a storyboard: one procedural frame per shot. The player cycles through the
 * shots on their timecodes with a slow push-in on each frame (static under reduced motion), with the
 * voice-over line as a caption, and the shot list below. No video exists — and the UI says so.
 */

const Frame = memo(function Frame({ spec, label }: { spec: ProceduralSpec; label: string }) {
  return <ProceduralArt spec={spec} title={label} className="absolute inset-0" />
})

export function StoryboardPlayer({ asset, index, compact, overlay = true }: { asset: Asset; index: number; compact?: boolean; overlay?: boolean }) {
  const reduced = useReducedMotion()
  const generating = overlay && asset.status === 'generating'
  const spec = previewSpec(asset.versions[index]?.preview)
  const params = versionParams(asset, index)
  const durationSec = typeof params.durationSec === 'number' ? params.durationSec : undefined
  const { slides } = versionContent(asset, index)
  const shots = useMemo(() => parseShots(slides ?? [], durationSec ?? 30), [slides, durationSec])
  const total = storyboardDuration(shots, durationSec)
  const ratio = aspectRatio(params.aspect, 16 / 9)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const timeRef = useRef(0)
  const motionRef = useRef<HTMLDivElement>(null)
  const shotIndex = shotAt(shots, time)
  const shot = shots[shotIndex]

  // Reset when the version changes.
  useEffect(() => {
    timeRef.current = 0
    setTime(0)
    setPlaying(false)
  }, [asset.versions[index]?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The push-in: written straight to the frame's transform every animation frame (no React re-render).
  const applyMotion = useCallback(
    (t: number) => {
      const el = motionRef.current
      if (!el) return
      if (reduced) {
        el.style.transform = ''
        return
      }
      const i = shotAt(shots, t)
      const s = shots[i]
      if (!s) return
      const p = Math.min(1, Math.max(0, (t - s.start) / Math.max(0.5, s.end - s.start)))
      const dir = i % 2 === 0 ? 1 : -1
      el.style.transform = `scale(${(1.03 + 0.07 * p).toFixed(4)}) translate3d(${(dir * p * 1.8).toFixed(3)}%, ${(-p * 0.8).toFixed(3)}%, 0)`
    },
    [shots, reduced],
  )

  useEffect(() => {
    applyMotion(timeRef.current)
  }, [applyMotion, shotIndex])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let shown = Math.floor(timeRef.current * 4)
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const t = Math.min(total, timeRef.current + dt)
      timeRef.current = t
      applyMotion(t)
      const q = Math.floor(t * 4)
      if (q !== shown) {
        shown = q
        setTime(t)
      }
      if (t >= total) {
        setTime(total)
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, applyMotion])

  const seek = (t: number) => {
    const clamped = Math.max(0, Math.min(total, t))
    timeRef.current = clamped
    setTime(clamped)
    applyMotion(clamped)
  }
  const toggle = () => {
    if (!playing && timeRef.current >= total - 0.05) seek(0)
    setPlaying((p) => !p)
  }
  const go = (delta: -1 | 1) => {
    const target = shots[Math.max(0, Math.min(shots.length - 1, shotIndex + delta))]
    if (target) seek(target.start + 0.001)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target !== e.currentTarget) return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      toggle()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      go(e.key === 'ArrowRight' ? 1 : -1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      seek(0)
    }
  }

  if (!spec || !shots.length) {
    return (
      <div className="sim-hatch relative grid w-full max-w-[960px] place-items-center rounded-md border border-dashed border-line-input" style={{ aspectRatio: String(ratio) }}>
        {asset.status === 'generating' ? <GeneratingCard asset={asset} /> : asset.status === 'failed' ? <FailedCard asset={asset} /> : <p className="type-body-sm text-ink-3">This storyboard has no shots yet.</p>}
      </div>
    )
  }

  const ended = time >= total - 0.05
  return (
    <div className={cn('flex w-full flex-col gap-3', compact && 'max-w-[640px]')} style={compact ? undefined : { maxWidth: `min(960px, calc(max(220px, min(100dvh - 420px, 560px)) * ${ratio}))` }}>
      <div className="sim-hatch rounded-md border border-dashed border-line-input p-2">
        <div
          role="region"
          aria-roledescription="storyboard player"
          aria-label={`Storyboard player: ${shots.length} shots, ${formatClock(total)}. Space plays or pauses, arrow keys change shots.`}
          tabIndex={0}
          data-studio-keys-local=""
          onKeyDown={onKeyDown}
          className="relative w-full overflow-hidden rounded-sm bg-black outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
          style={{ aspectRatio: String(ratio) }}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={shotIndex}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: generating ? 0.35 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.32 }}
            >
              <div ref={motionRef} className="absolute inset-0 will-change-transform" style={{ transformOrigin: shotIndex % 2 === 0 ? '30% 40%' : '70% 60%' }}>
                <Frame spec={shotSpec(spec, shotIndex)} label={`${shot.label} · ${shot.beat}: procedural storyboard frame (simulated, no video was rendered)`} />
              </div>
            </motion.div>
          </AnimatePresence>
          <span className="absolute bottom-2 left-2">
            <SimBadge size="sm" label="Simulated storyboard" />
          </span>
          <span className="type-meta absolute top-2 right-2 rounded-xs bg-overlay px-1.5 py-0.5 text-ink-2">
            {shot.label} · {shot.beat}
          </span>
          {generating && (
            <div className="absolute inset-0 grid place-items-center p-4">
              <GeneratingCard asset={asset} />
            </div>
          )}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <IconButton icon={SkipBack} label="Previous shot" size="sm" onClick={() => go(-1)} disabled={shotIndex === 0} />
        <IconButton
          icon={playing ? Pause : ended ? RotateCcw : Play}
          label={playing ? 'Pause' : ended ? 'Play from the start' : 'Play'}
          shortcut="space"
          size="sm"
          variant="secondary"
          onClick={toggle}
        />
        <IconButton icon={SkipForward} label="Next shot" size="sm" onClick={() => go(1)} disabled={shotIndex >= shots.length - 1} />
        <Scrubber shots={shots} total={total} time={time} onSeek={seek} />
        <span className="type-meta shrink-0 text-ink-3 tabular" aria-live="off">
          {formatClock(time)} / {formatClock(total)}
        </span>
      </div>
      <p className="type-body min-h-6 font-serif text-ink-2 italic" aria-live={playing ? 'off' : 'polite'}>
        {shot.vo ? `“${shot.vo}”` : (shot.note ?? shot.description ?? '')}
      </p>
    </div>
  )
}

function Scrubber({ shots, total, time, onSeek }: { shots: Shot[]; total: number; time: number; onSeek: (t: number) => void }) {
  return (
    <div className="mx-2 flex h-8 min-w-0 flex-1 items-center gap-[3px]" role="group" aria-label="Shots">
      {shots.map((s) => {
        const width = ((s.end - s.start) / total) * 100
        const filled = time >= s.end ? 1 : time <= s.start ? 0 : (time - s.start) / (s.end - s.start)
        return (
          <button
            key={s.index}
            type="button"
            onClick={() => onSeek(s.start + 0.001)}
            aria-label={`Go to ${s.label}, ${formatClock(s.start)}`}
            className="group/seg relative flex h-8 min-w-1.5 items-center outline-none focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
            style={{ width: `${width}%` }}
          >
            <span className="relative block h-1 w-full overflow-hidden rounded-full bg-line-strong transition-[height] duration-(--dur-1) group-hover/seg:h-1.5">
              <span className="absolute inset-y-0 left-0 bg-ink-2" style={{ width: `${filled * 100}%` }} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The shot list: frame, label, timecode, framing · motion, the voice-over line. Click seeks. */
export function ShotList({ asset, index }: { asset: Asset; index: number }) {
  const spec = previewSpec(asset.versions[index]?.preview)
  const params = versionParams(asset, index)
  const { slides } = versionContent(asset, index)
  const shots = useMemo(() => parseShots(slides ?? [], typeof params.durationSec === 'number' ? params.durationSec : 30), [slides, params.durationSec])
  if (!shots.length) return null
  return (
    <section aria-label="Shot list" className="flex w-full min-w-0 flex-col gap-2">
      <h2 className="type-label text-ink-3">Shot list · {shots.length}</h2>
      <ol className="flex flex-col divide-y divide-line rounded-md border border-line">
        {shots.map((s) => (
          <li key={s.index} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
            <span className="type-meta w-5 shrink-0 pt-1 text-right text-ink-3 tabular">{s.index + 1}</span>
            <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-[3px] bg-sunken ring-1 ring-line-strong">
              {spec && <ProceduralArt spec={shotSpec(spec, s.index)} title={`${s.label}: procedural frame (simulated)`} className="absolute inset-0" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="type-body-sm font-medium text-ink">
                  {s.label} · {s.beat}
                </span>
                <span className="type-meta text-ink-3 tabular">
                  {formatClock(s.start)}–{formatClock(s.end)}
                </span>
              </span>
              {(s.framing || s.motion) && <span className="type-caption text-ink-3">{[s.framing, s.motion].filter(Boolean).join(' · ')}</span>}
              {s.description && <span className="type-caption text-ink-2">{s.description}</span>}
              {(s.vo || s.note) && <span className="type-body-sm font-serif text-ink-2 italic">{s.vo ? `“${s.vo}”` : s.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function VideoStage({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number | null }) {
  if (compareIndex === null) return <StoryboardPlayer asset={asset} index={index} />
  return (
    <div className="grid w-full max-w-[1400px] grid-cols-1 gap-6 lg:grid-cols-2" aria-label="Compare versions">
      <div className="flex min-w-0 flex-col items-center gap-2">
        <StoryboardPlayer asset={asset} index={index} compact />
        <SideLabel side="A" index={index} current />
      </div>
      <div className="flex min-w-0 flex-col items-center gap-2">
        <StoryboardPlayer asset={asset} index={compareIndex} compact overlay={false} />
        <SideLabel side="B" index={compareIndex} />
      </div>
    </div>
  )
}

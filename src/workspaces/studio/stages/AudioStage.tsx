import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { versionContent, versionParams } from '@/core/services/studio'
import { spokenText } from '@/core/sim/studio'
import type { Asset } from '@/core/types'
import { Button, Markdown, SimBadge, Tooltip } from '@/ui'
import { formatClock } from '../logic'
import { Waveform } from '../previews'
import { FailedCard, GeneratingCard, UnrecordedCard, isUnrecorded } from './common'
import { TextCompare } from './DocStage'

/*
 * Narration: no audio exists in this build. The stage shows the script, a waveform drawn from its
 * words, and "Preview with browser voice" — the browser's own speech synthesis (Web Speech API)
 * reading the script, labeled as a browser voice preview, never as the generated voice.
 */

const RATE: Record<string, number> = { 'Calm guide': 0.9, 'Warm narrator': 0.97, 'Clear presenter': 1, 'Bright host': 1.08 }

function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

/** The browser's voices, updated when they load (Chrome loads them asynchronously). */
function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (speechSupported() ? window.speechSynthesis.getVoices() : []))
  useEffect(() => {
    if (!speechSupported()) return
    const synth = window.speechSynthesis
    const update = () => setVoices(synth.getVoices())
    update()
    synth.addEventListener?.('voiceschanged', update)
    return () => synth.removeEventListener?.('voiceschanged', update)
  }, [])
  return voices
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
  return voices.find((v) => v.lang === lang && v.default) ?? voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith('en')) ?? voices[0]
}

export function BrowserVoice({ script, voiceLabel, durationSec }: { script: string; voiceLabel: string; durationSec: number }) {
  const supported = speechSupported()
  const voices = useVoices()
  const voice = pickVoice(voices)
  const text = useMemo(() => spokenText(script), [script])
  const [speaking, setSpeaking] = useState(false)
  const [progress, setProgress] = useState(0)
  const utterance = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    if (!supported) return
    utterance.current = null
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [supported])

  // Never keep talking after leaving the page or switching versions.
  useEffect(() => stop, [stop, script])

  const play = () => {
    if (!supported || !text) return
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'en-US'
    u.rate = RATE[voiceLabel] ?? 1
    u.onstart = () => setSpeaking(true)
    u.onboundary = (e) => {
      if (utterance.current === u) setProgress(Math.min(1, (e.charIndex + (e.charLength ?? 0)) / Math.max(1, text.length)))
    }
    u.onend = () => {
      if (utterance.current !== u) return
      utterance.current = null
      setSpeaking(false)
      setProgress(1)
    }
    u.onerror = () => {
      if (utterance.current !== u) return
      utterance.current = null
      setSpeaking(false)
    }
    utterance.current = u
    setProgress(0)
    setSpeaking(true)
    synth.speak(u)
  }

  return (
    <section aria-label="Narration preview" className="flex w-full flex-col gap-3 rounded-md border border-line bg-raised p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {supported ? (
          speaking ? (
            <Button size="md" variant="secondary" leadingIcon={Square} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button size="md" variant="primary" leadingIcon={Play} onClick={play} disabled={!text}>
              Preview with browser voice
            </Button>
          )
        ) : (
          <Tooltip content="This browser has no built-in speech synthesis.">
            <span tabIndex={0}>
              <Button size="md" variant="secondary" leadingIcon={Play} disabled>
                Preview with browser voice
              </Button>
            </span>
          </Tooltip>
        )}
        <span className="type-meta text-ink-3">
          {voiceLabel} · ~{formatClock(durationSec)}
        </span>
      </div>
      <div className="h-14 w-full" role="img" aria-label="Waveform drawn from the script (no audio was synthesized)">
        <Waveform script={script} bars={96} progress={speaking || progress >= 1 ? progress : 0} />
      </div>
      <p className="type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3" role="status">
        <span className="text-ink-2">Browser voice preview</span>
        <span aria-hidden>·</span>
        {supported ? (
          <span>
            {voice ? `${voice.name} (${voice.lang})` : 'Your browser’s default voice'} reads the script — not the {voiceLabel.toLowerCase()} voice, which was not synthesized.
          </span>
        ) : (
          <span>Unavailable in this browser. The script and the waveform still show the narration.</span>
        )}
      </p>
    </section>
  )
}

export function AudioStage({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number | null }) {
  const { content } = versionContent(asset, index)
  const params = versionParams(asset, index)
  if (compareIndex !== null) return <TextCompare asset={asset} index={index} compareIndex={compareIndex} />
  if (!content?.trim()) {
    return (
      <div className="sim-hatch grid min-h-[240px] w-full max-w-[760px] place-items-center rounded-md border border-dashed border-line-input">
        {asset.status === 'generating' ? (
          <GeneratingCard asset={asset} />
        ) : asset.status === 'failed' ? (
          <FailedCard asset={asset} />
        ) : isUnrecorded(asset, index) ? (
          <UnrecordedCard asset={asset} index={index} />
        ) : (
          <p className="type-body-sm text-ink-3">No script yet.</p>
        )}
      </div>
    )
  }
  return (
    <div className="flex w-full max-w-[760px] flex-col gap-5">
      {asset.status === 'generating' && (
        <div className="flex justify-center">
          <GeneratingCard asset={asset} />
        </div>
      )}
      <BrowserVoice script={content} voiceLabel={String(params.voice ?? 'Narrator')} durationSec={typeof params.durationSec === 'number' ? params.durationSec : 45} />
      <article className="relative min-w-0 pl-5" aria-label="Narration script">
        <span aria-hidden className="sim-band absolute top-0 bottom-0 left-0 w-1 rounded-full" />
        <div className="mb-2 flex items-center gap-2">
          <h2 className="type-label text-ink-3">Script</h2>
          <SimBadge size="xs" />
        </div>
        <Markdown prose="doc">{content}</Markdown>
      </article>
    </div>
  )
}

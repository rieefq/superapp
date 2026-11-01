import { useMemo, useRef, useState } from 'react'
import { BookOpenText, Copy, PenLine } from 'lucide-react'
import { SelectionActions } from '@/app/components'
import { updateAssetContent, versionContent } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, DiffView, Markdown, SegmentedControl, Textarea, toast, useBreakpointUp } from '@/ui'
import { FailedCard, GeneratingCard, SideLabel, UnrecordedCard, isUnrecorded } from './common'
import { useVersionDraft } from './useVersionDraft'

/*
 * Docs (copy): the version's Markdown in the document voice at the 720 measure, with a sim band
 * for simulated drafts. Edit switches to a Markdown editor (side by side with the preview on wide
 * stages). Variants are versions — the filmstrip switches them, A/B compare diffs them.
 */

export function DocStage({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number | null }) {
  const version = asset.versions[index]
  const text = versionContent(asset, index)
  if (compareIndex !== null) return <TextCompare asset={asset} index={index} compareIndex={compareIndex} />
  if (!text.content?.trim()) {
    return (
      <div className="sim-hatch grid min-h-[320px] w-full max-w-[720px] place-items-center rounded-md border border-dashed border-line-input">
        {asset.status === 'generating' ? (
          <GeneratingCard asset={asset} />
        ) : asset.status === 'failed' ? (
          <FailedCard asset={asset} />
        ) : isUnrecorded(asset, index) ? (
          <UnrecordedCard asset={asset} index={index} />
        ) : (
          <p className="type-body-sm text-ink-3">No text yet.</p>
        )}
      </div>
    )
  }
  return <DocEditor key={version?.id ?? 'working'} asset={asset} versionId={version?.id} initial={text.content} />
}

function words(text: string): number {
  return (text.match(/[\p{L}\p{N}’']+/gu) ?? []).length
}

function DocEditor({ asset, versionId, initial }: { asset: Asset; versionId: string | undefined; initial: string }) {
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [content, setContent] = useVersionDraft<string>(initial, (value) => updateAssetContent(asset.id, { content: value }, { versionId }))
  const readRef = useRef<HTMLElement>(null)
  const sideBySide = useBreakpointUp('2xl')
  const generating = asset.status === 'generating'
  const count = useMemo(() => words(content), [content])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      toast({ title: 'Copied the Markdown' })
    } catch {
      toast({ tone: 'error', title: 'Couldn’t copy' })
    }
  }

  const reader = (
    <article ref={readRef} className="relative min-w-0 pl-5" aria-label="Document">
      {asset.generator.simulated && <span aria-hidden className="sim-band absolute top-0 bottom-0 left-0 w-1 rounded-full" />}
      <Markdown prose="doc">{content}</Markdown>
    </article>
  )

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-4', mode === 'edit' && sideBySide ? 'max-w-[1440px]' : 'max-w-[760px]')}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SegmentedControl<'read' | 'edit'>
          size="sm"
          aria-label="Mode"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'read', label: 'Read', icon: BookOpenText },
            { value: 'edit', label: 'Edit', icon: PenLine },
          ]}
        />
        <span className="type-meta text-ink-3 tabular">{count} words</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" leadingIcon={Copy} onClick={() => void copy()}>
          Copy Markdown
        </Button>
      </div>
      {generating && (
        <div className="flex justify-center">
          <GeneratingCard asset={asset} />
        </div>
      )}
      {mode === 'read' ? (
        <>
          {reader}
          <SelectionActions containerRef={readRef} source={{ kind: 'asset', id: asset.id }} />
        </>
      ) : (
        <div className={cn('grid min-w-0 gap-6', sideBySide && 'grid-cols-2')}>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="type-caption text-ink-3">Markdown · edits apply to this version and save as you type</span>
            <Textarea
              mono
              autosize
              minRows={16}
              maxRows={60}
              value={content}
              onValueChange={setContent}
              disabled={generating}
              aria-label="Markdown source"
              className="type-mono"
            />
          </label>
          {sideBySide && <div className="min-w-0 pt-6">{reader}</div>}
        </div>
      )}
    </div>
  )
}

/** A/B for text kinds: a diff of B (older or other take) → A (current). */
export function TextCompare({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number }) {
  const a = versionContent(asset, index)
  const b = versionContent(asset, compareIndex)
  const wide = useBreakpointUp('xl')
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-3" aria-label="Compare versions">
      <div className="flex items-center gap-3">
        <SideLabel side="B" index={compareIndex} />
        <span aria-hidden className="text-ink-3">→</span>
        <SideLabel side="A" index={index} current />
      </div>
      {b.known ? (
        <DiffView oldText={b.content ?? ''} newText={a.content ?? ''} path={`v${compareIndex + 1} → v${index + 1}.md`} mode={wide ? 'split' : 'unified'} syntax={false} />
      ) : (
        <p className="type-body-sm text-ink-3">v{compareIndex + 1} predates per-version text in this build, so only its preview was kept. Compare it with a newer version.</p>
      )}
    </div>
  )
}

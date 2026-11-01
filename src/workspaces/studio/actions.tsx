import { useEffect, useMemo, useState } from 'react'
import { FileCode2, FileJson, FileText, ImageDown } from 'lucide-react'
import { announce } from '@/app/shell/Announcer'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { createBoard, deleteAsset, moveToBoard, versionContent, versionParams } from '@/core/services/studio'
import { getSettings } from '@/core/settings'
import type { Asset, ID } from '@/core/types'
import { Button, Dialog, Input, RadioGroup, confirm, downloadArt, toast, type MenuItem } from '@/ui'
import { KINDS } from './kinds'
import { aspectRatio, boardsInScope, deckToHtml, deckToJson, deckToMarkdown, downloadText, exportSize, fileSlug, textToHtml, textToMarkdown } from './logic'
import { previewSpec } from './previews'

/*
 * Asset actions shared by tiles, the asset view, ⌘K and the Lens: delete (confirmed), downloads
 * (real files: the procedural render as PNG/SVG, decks and copy as Markdown/HTML/JSON) and Move to board.
 */

/** Delete with the plain confirm (when `confirmDestructive` is on). Resolves true when deleted. */
export async function confirmDeleteAsset(asset: Asset): Promise<boolean> {
  if (getSettings().safety.confirmDestructive) {
    const versions = asset.versions.length
    const ok = await confirm({
      title: `Delete “${asset.title}”?`,
      description: `${versions ? `Its ${versions === 1 ? 'version' : `${versions} versions`} and their` : 'Its'} history will be removed from Studio. Links to it elsewhere will show “Deleted item”. This can’t be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
    })
    if (!ok) return false
  }
  deleteAsset(asset.id)
  announce(`Deleted “${asset.title}”`)
  toast({ title: `Deleted “${asset.title}”` })
  return true
}

export type ExportFormat = 'png' | 'svg' | 'md' | 'html' | 'json'

/** Formats a kind can be downloaded as (§6.8 Exports). */
export function exportFormats(asset: Asset): ExportFormat[] {
  if (!asset.versions.length && asset.kind !== 'presentation' && asset.kind !== 'document') return []
  switch (asset.kind) {
    case 'image':
      return ['png', 'svg']
    case 'presentation':
      return ['md', 'html', 'json']
    case 'document':
    case 'audio':
    case 'video':
      return ['md', 'html']
  }
}

const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG image',
  svg: 'SVG image',
  md: 'Markdown',
  html: 'HTML page',
  json: 'JSON',
}

/** Download a version of an asset as a real file. */
export async function downloadAsset(asset: Asset, format: ExportFormat, index = asset.currentVersion): Promise<void> {
  const at = Date.now()
  const v = index + 1
  const base = `${fileSlug(asset.title)}-v${v}`
  const simulated = asset.generator.simulated
  try {
    if (format === 'png' || format === 'svg') {
      const spec = previewSpec(asset.versions[index]?.preview)
      if (!spec) throw new Error('This version has no preview to export yet.')
      const size = exportSize(aspectRatio(versionParams(asset, index).aspect, 1), format === 'png' ? 2048 : 1600)
      await downloadArt(spec, { ...size, format, filename: `${base}.${format}` })
    } else {
      const text = versionContent(asset, index)
      if (asset.kind === 'presentation') {
        const slides = text.slides ?? []
        if (!slides.length) throw new Error('This deck has no slides yet.')
        const palette = previewSpec(asset.versions[index]?.preview)?.palette ?? []
        if (format === 'md') downloadText(`${base}.md`, deckToMarkdown(asset.title, slides, { simulated, at }), 'text/markdown;charset=utf-8')
        else if (format === 'html') downloadText(`${base}.html`, deckToHtml(asset.title, slides, palette, { simulated, at }), 'text/html;charset=utf-8')
        else downloadText(`${base}.json`, deckToJson(asset, slides, at), 'application/json;charset=utf-8')
      } else {
        const content = text.content ?? ''
        if (!content.trim()) throw new Error('There is no text to export yet.')
        if (format === 'md') downloadText(`${base}.md`, textToMarkdown(content, { simulated, at }), 'text/markdown;charset=utf-8')
        else downloadText(`${base}.html`, textToHtml(asset.title, content, { simulated, at }), 'text/html;charset=utf-8')
      }
    }
    toast({ title: `Downloaded ${FORMAT_LABEL[format]}`, description: simulated ? 'The file says it is simulated content.' : undefined })
  } catch (err) {
    toast({ tone: 'error', title: 'Couldn’t download', description: err instanceof Error ? err.message : String(err) })
  }
}

const FORMAT_ICON = { png: ImageDown, svg: FileCode2, md: FileText, html: FileCode2, json: FileJson } as const

/** Download menu items for an asset ("Download PNG image"…). */
export function downloadItems(asset: Asset, index = asset.currentVersion): MenuItem[] {
  return exportFormats(asset).map((f) => ({
    id: `download-${f}`,
    label: `Download ${FORMAT_LABEL[f]}`,
    icon: FORMAT_ICON[f],
    description: f === 'png' ? 'The procedural render, 2048 px' : f === 'svg' ? 'Vector, the same render' : f === 'json' ? 'Slides and notes' : undefined,
    onSelect: () => void downloadAsset(asset, f, index),
  }))
}

// ------------------------------------------------------------------------------------------------ move to board

/** "Move to board" as a small dialog: radio list of boards (scope-aware), "No board", or a new board. */
export function MoveToBoardDialog({ assetId, onClose }: { assetId: ID | null; onClose: () => void }) {
  const asset = useDB((s: Tables) => (assetId ? s.assets[assetId] : undefined))
  const scope = useScope()
  const boards = useDB((s: Tables) => s.boards)
  const list = useMemo(() => boardsInScope(Object.values(boards), asset?.projectId ?? scope), [boards, asset?.projectId, scope])
  const [value, setValue] = useState<string>('__none__')
  const [name, setName] = useState('')
  useEffect(() => {
    if (asset) {
      setValue(asset.boardId ?? '__none__')
      setName('')
    }
  }, [asset?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!asset) return
    let target: ID | null = value === '__none__' ? null : value
    if (value === '__new__') {
      const clean = name.trim()
      if (!clean) return
      target = createBoard({ name: clean, projectId: asset.projectId }).id
    }
    moveToBoard(asset.id, target)
    const label = target ? (db.get('boards', target)?.name ?? 'the board') : 'no board'
    toast({ title: target ? `Moved to “${label}”` : 'Removed from its board' })
    onClose()
  }

  return (
    <Dialog
      open={!!asset}
      onOpenChange={(o) => !o && onClose()}
      title={asset ? `Move “${asset.title}”` : 'Move to board'}
      description="Boards group work on the contact sheet. Moving keeps every version."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={value === '__new__' && !name.trim()}>
            Move
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-3"
      >
        <RadioGroup
          aria-label="Board"
          value={value}
          onValueChange={setValue}
          options={[
            { value: '__none__', label: 'No board' },
            ...list.map((b) => ({ value: b.id, label: b.name, description: b.description })),
            { value: '__new__', label: 'New board…' },
          ]}
        />
        {value === '__new__' && <Input autoFocus placeholder="Board name" aria-label="New board name" value={name} onValueChange={setName} />}
        {asset && <p className="type-caption text-ink-3">{KINDS[asset.kind].label} · {asset.versions.length} {asset.versions.length === 1 ? 'version' : 'versions'}</p>}
      </form>
    </Dialog>
  )
}

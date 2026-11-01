import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Check, Link2 } from 'lucide-react'
import { CollectionPicker } from '@/app/components'
import { useScope } from '@/core/context'
import { db } from '@/core/db'
import { createCollection, createLink, entityRoute, normalizeUrl, renameTag, titleFromUrl, updateCollection } from '@/core/services'
import { HUES, type Collection, type Hue, type ID } from '@/core/types'
import { Button, Dialog, Field, HUE_FILL, Input, Textarea, toast } from '@/ui'
import { cn } from '@/lib/cn'
import { sectionHref } from './model'

const HUE_NAME: Record<Hue, string> = {
  volt: 'Volt',
  sky: 'Sky',
  violet: 'Violet',
  coral: 'Coral',
  amber: 'Amber',
  mint: 'Mint',
  rose: 'Rose',
  cyan: 'Cyan',
}

/** Identity hue swatches (a radio group: arrows move and select, like native radios). */
function HuePicker({ value, onChange, labelledBy }: { value: Hue; onChange: (hue: Hue) => void; labelledBy: string }) {
  const refs = useRef<Partial<Record<Hue, HTMLButtonElement | null>>>({})
  const move = (dir: number) => {
    const next = HUES[(HUES.indexOf(value) + dir + HUES.length) % HUES.length]
    onChange(next)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-wrap gap-1.5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {HUES.map((h) => {
        const on = h === value
        return (
          <button
            key={h}
            ref={(el) => {
              refs.current[h] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={HUE_NAME[h]}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(h)}
            className={cn(
              'relative grid size-7 place-items-center rounded-sm border transition-colors duration-(--dur-1)',
              on ? 'border-ink' : 'border-transparent hover:border-line-strong',
              'pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-[""]',
            )}
          >
            <span aria-hidden className={cn('grid size-4.5 place-items-center rounded-[4px]', HUE_FILL[h])}>
              {on && <Check className="size-3 text-canvas" strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ collection

export function CollectionDialog({
  open,
  onOpenChange,
  collection,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this collection (create when absent). */
  collection?: Collection
  onSaved?: (id: ID) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hue, setHue] = useState<Hue>('sky')
  const [error, setError] = useState<string | null>(null)
  const colorLabel = useId()

  useEffect(() => {
    if (!open) return
    setName(collection?.name ?? '')
    setDescription(collection?.description ?? '')
    setError(null)
    if (collection) setHue(collection.hue)
    else {
      // Offer the least used hue (the service would pick it too).
      const used = db.all('collections').map((c) => c.hue)
      setHue(HUES.find((h) => !used.includes(h)) ?? 'sky')
    }
  }, [open, collection])

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim()) {
      setError('Give the collection a name.')
      return
    }
    if (collection) {
      updateCollection(collection.id, { name, description, hue })
      toast({ tone: 'success', title: `Saved “${name.trim()}”` })
      onOpenChange(false)
      onSaved?.(collection.id)
      return
    }
    const created = createCollection({ name, description, hue })
    toast({ tone: 'success', title: `Created “${created.name}”`, description: 'Move items into it from the library, or upload straight into it.' })
    onOpenChange(false)
    onSaved?.(created.id)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={collection ? 'Edit collection' : 'New collection'}
      description={collection ? undefined : 'Collections group related knowledge. Every AI action can still draw on all of it.'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => submit()} kbd="enter">
            {collection ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" required error={error ?? undefined}>
          <Input value={name} onValueChange={(v) => { setName(v); setError(null) }} placeholder="e.g. Customer research" data-autofocus autoComplete="off" />
        </Field>
        <Field label="Description" optional>
          <Textarea value={description} onValueChange={setDescription} placeholder="What belongs here" autosize minRows={2} maxRows={5} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id={colorLabel} className="text-sm font-medium text-ink-2">
            Color
          </span>
          <HuePicker value={hue} onChange={setHue} labelledBy={colorLabel} />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------------ link

export function AddLinkDialog({ open, onOpenChange, collectionId }: { open: boolean; onOpenChange: (open: boolean) => void; collectionId?: ID | null }) {
  const navigate = useNavigate()
  const scope = useScope()
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [collection, setCollection] = useState<ID | null>(collectionId ?? null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setTitle('')
    setNotes('')
    setError(null)
    setCollection(collectionId ?? null)
  }, [open, collectionId])

  const normalized = normalizeUrl(url)
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!normalized) {
      setError(url.trim() ? 'That doesn’t look like a web address. Try something like https://example.com/page.' : 'Paste the address of the page.')
      return
    }
    try {
      const item = createLink({ url: normalized, title, notes, collectionId: collection, projectIds: scope ? [scope] : [] })
      onOpenChange(false)
      navigate(entityRoute({ kind: 'knowledge', id: item.id }))
      toast({ tone: 'success', title: 'Link saved', description: 'Only the address, title and your notes are stored — the page isn’t fetched.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a link"
      description="Atrium saves the address, a title and your notes. The page itself isn’t fetched in this build, so your notes are what makes it searchable."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" leadingIcon={Link2} onClick={() => submit()} kbd="enter">
            Save link
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Address" required error={error ?? undefined}>
          <Input
            value={url}
            onValueChange={(v) => {
              setUrl(v)
              setError(null)
            }}
            placeholder="https://"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            data-autofocus
          />
        </Field>
        <Field label="Title" optional hint={normalized && !title.trim() ? `Saved as “${titleFromUrl(normalized)}”` : undefined}>
          <Input value={title} onValueChange={setTitle} placeholder={normalized ? titleFromUrl(normalized) : 'What the page is'} autoComplete="off" />
        </Field>
        <Field label="Notes" optional hint="Key points, quotes or why it matters. Markdown works.">
          <Textarea value={notes} onValueChange={setNotes} autosize minRows={3} maxRows={8} />
        </Field>
        <Field label="Collection">
          <CollectionPicker value={collection} onChange={setCollection} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------------ tag

export function RenameTagDialog({ open, onOpenChange, tag }: { open: boolean; onOpenChange: (open: boolean) => void; tag: string }) {
  const navigate = useNavigate()
  const [value, setValue] = useState(tag)
  useEffect(() => {
    if (open) setValue(tag)
  }, [open, tag])
  const next = value.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-')
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!next || next === tag) {
      onOpenChange(false)
      return
    }
    const merged = db.all('knowledge').some((k) => k.tags.includes(next))
    const n = renameTag(tag, next)
    onOpenChange(false)
    navigate(sectionHref({ type: 'tag', tag: next }), { replace: true })
    toast({ tone: 'success', title: `Renamed #${tag} to #${next}`, description: `${n} item${n === 1 ? '' : 's'} updated${merged ? ' — merged with the existing tag' : ''}.` })
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Rename #${tag}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => submit()} kbd="enter">
            Rename
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="New name" hint={next && next !== value.trim() ? `Saved as #${next}` : 'Renaming onto an existing tag merges the two.'}>
          <Input value={value} onValueChange={setValue} prefix={<span className="text-ink-3">#</span>} data-autofocus autoComplete="off" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

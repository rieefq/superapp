import { useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { Plus } from 'lucide-react'
import { CollectionPicker, ProjectPicker } from '@/app/components'
import { useDB, type Tables } from '@/core/db'
import { updateKnowledge, useTags } from '@/core/services'
import type { KnowledgeItem } from '@/core/types'
import { Button, Input, SegmentedControl, Tag, toast } from '@/ui'
import { cn } from '@/lib/cn'
import { setAvailability } from './actions'
import { parseTagInput, sectionHref } from './model'
import { AVAILABILITY_EFFECT, AVAILABILITY_OPTIONS } from './parts'

/**
 * Inline editors for an item's properties — shared by the reader's About section and the Inspector lens,
 * so both edit the same way. Every change goes through the knowledge service (activity is logged).
 */

export function AvailabilityControl({ item, size = 'sm', showEffect = true }: { item: KnowledgeItem; size?: 'sm' | 'md'; showEffect?: boolean }) {
  const value = item.aiAvailability ?? 'always'
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <SegmentedControl
        size={size}
        aria-label="Available to AI"
        value={value}
        onValueChange={(v) => setAvailability(item.id, v)}
        options={AVAILABILITY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        className="self-start"
      />
      {showEffect && <p className="type-caption text-pretty text-ink-3">{AVAILABILITY_EFFECT[value]}</p>}
    </div>
  )
}

export function CollectionControl({ item }: { item: KnowledgeItem }) {
  return (
    <CollectionPicker
      variant="chip"
      value={item.collectionId}
      onChange={(collectionId) => {
        updateKnowledge(item.id, { collectionId })
      }}
      aria-label="Collection"
      className="-ml-1.5 max-w-full"
    />
  )
}

export function ProjectsControl({ item }: { item: KnowledgeItem }) {
  const projects = useDB((s: Tables) => s.projects)
  const remove = (id: string) => {
    const name = projects[id]?.name ?? 'the project'
    updateKnowledge(item.id, { projectIds: item.projectIds.filter((p) => p !== id) })
    toast({
      title: `Removed from ${name}`,
      action: { label: 'Undo', onClick: () => updateKnowledge(item.id, { projectIds: [...new Set([...item.projectIds])] }) },
    })
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {item.projectIds.map((id) => {
        const p = projects[id]
        if (!p) return null
        return (
          <Tag key={id} hue={p.hue} onRemove={() => remove(id)} removeLabel={`Remove from ${p.name}`}>
            {p.name}
          </Tag>
        )
      })}
      <ProjectPicker
        value={null}
        allowNone={false}
        onChange={(id) => {
          if (!id || item.projectIds.includes(id)) return
          updateKnowledge(item.id, { projectIds: [...item.projectIds, id] })
        }}
        trigger={
          <Button size="xs" variant="ghost" leadingIcon={Plus} className="text-ink-3">
            {item.projectIds.length ? 'Add' : 'Add to a project'}
          </Button>
        }
        aria-label="Add to a project"
      />
    </div>
  )
}

export function TagsControl({ item, linkTags = true, className }: { item: KnowledgeItem; linkTags?: boolean; className?: string }) {
  const navigate = useNavigate()
  const all = useTags()
  const [adding, setAdding] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestions = value.trim()
    ? all
        .filter((t) => t.tag.startsWith(value.trim().replace(/^#/, '').toLowerCase()) && !item.tags.includes(t.tag))
        .slice(0, 5)
    : []

  const add = (raw: string) => {
    const next = parseTagInput(raw).filter((t) => !item.tags.includes(t))
    if (next.length) updateKnowledge(item.id, { tags: [...item.tags, ...next] })
    setValue('')
  }
  const remove = (tag: string) => {
    updateKnowledge(item.id, { tags: item.tags.filter((t) => t !== tag) })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setValue('')
      setAdding(false)
    } else if (e.key === 'Backspace' && !value && item.tags.length) {
      e.preventDefault()
      remove(item.tags[item.tags.length - 1])
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', className)}>
      {item.tags.map((t) =>
        linkTags ? (
          <span key={t} className="inline-flex">
            <Tag
              onRemove={() => remove(t)}
              removeLabel={`Remove #${t}`}
              onClick={() => navigate(sectionHref({ type: 'tag', tag: t }))}
              title={`Show everything tagged #${t}`}
              className="cursor-pointer"
            >
              #{t}
            </Tag>
          </span>
        ) : (
          <Tag key={t} onRemove={() => remove(t)} removeLabel={`Remove #${t}`}>
            #{t}
          </Tag>
        ),
      )}
      {adding ? (
        <div className="relative">
          <Input
            ref={inputRef}
            size="sm"
            value={value}
            onValueChange={setValue}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (value.trim()) add(value)
              setAdding(false)
            }}
            placeholder="tag, another"
            aria-label="Add tags"
            autoFocus
            wrapperClassName="h-6 w-40"
          />
          {suggestions.length > 0 && (
            <div role="listbox" aria-label="Matching tags" className="absolute top-full left-0 z-(--z-popover) mt-1 flex w-48 flex-col rounded-sm border border-line bg-overlay p-1 shadow-e1">
              {suggestions.map((s) => (
                <button
                  key={s.tag}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    add(s.tag)
                    inputRef.current?.focus()
                  }}
                  className="type-caption flex h-7 items-center justify-between rounded-xs px-2 text-left text-ink-2 hover:bg-hover hover:text-ink"
                >
                  #{s.tag}
                  <span className="type-meta text-ink-3">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <Button size="xs" variant="ghost" leadingIcon={Plus} onClick={() => setAdding(true)} className="text-ink-3">
          {item.tags.length ? 'Tag' : 'Add tags'}
        </Button>
      )}
    </div>
  )
}

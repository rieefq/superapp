import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { switchScope } from '@/app/shell/scope'
import { createProject, updateProject } from '@/core/services'
import { HUES, type Hue, type Project } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Checkbox, Dialog, Field, getIcon, HUE_FILL, Input, Popover, PICKABLE_ICONS, Textarea, toast, Tooltip } from '@/ui'
import { ProjectMark } from './parts'

/*
 * New project (dialog, also `/projects?new=1`) and Edit details (⋯ › Edit details…). Goal and AI
 * instructions are edited where the AI reads them — Projects › Memory — and asked for once here.
 */

const HUE_WORD: Record<Hue, string> = {
  volt: 'Volt',
  sky: 'Sky',
  violet: 'Violet',
  coral: 'Coral',
  amber: 'Amber',
  mint: 'Mint',
  rose: 'Rose',
  cyan: 'Cyan',
}

/** Project hues: every identity hue except volt, which belongs to your profile (§4.4). */
export const PROJECT_HUES: readonly Hue[] = HUES.filter((h) => h !== 'volt')

const humanize = (name: string) => name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/(\d)/g, ' $1').replace(/\s+/g, ' ').trim()

// ------------------------------------------------------------------------------------------------ hue

/** A radio group of hue swatches: one tab stop, arrows move and select. */
export function HueField({ value, onChange, labelledBy }: { value: Hue; onChange: (hue: Hue) => void; labelledBy?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const hues = PROJECT_HUES.includes(value) ? PROJECT_HUES : [value, ...PROJECT_HUES]
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? hues.length - 1 : (i + dir + hues.length) % hues.length
    onChange(hues[next])
    refs.current[next]?.focus()
  }
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-1">
      {hues.map((hue, i) => {
        const checked = hue === value
        return (
          <Tooltip key={hue} content={HUE_WORD[hue]}>
            <button
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={HUE_WORD[hue]}
              tabIndex={checked ? 0 : -1}
              onClick={() => onChange(hue)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                'relative grid size-8 place-items-center rounded-sm transition-colors duration-(--dur-1) hover:bg-hover',
                checked && 'bg-press',
                "pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']",
              )}
            >
              <span aria-hidden className={cn('size-4 rounded-[4px]', HUE_FILL[hue], checked && 'ring-2 ring-ink ring-offset-2 ring-offset-press')} />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ icon

/** The project's mark preview plus a grid of icons in a popover. */
export function IconField({ value, hue, name, onChange }: { value: string; hue: Hue; name: string; onChange: (icon: string) => void }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const cols = 8
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0
    if (!delta) return
    e.preventDefault()
    items[Math.min(items.length - 1, Math.max(0, i + delta))]?.focus()
  }
  return (
    <Popover
      placement="bottom-start"
      aria-label="Choose an icon"
      className="p-2"
      trigger={
        <button
          type="button"
          className="flex h-10 items-center gap-2.5 rounded-sm border border-line-input bg-sunken pr-2.5 pl-1.5 text-left text-sm text-ink transition-[border-color] duration-(--dur-1) hover:border-ink-3"
        >
          <ProjectMark project={{ name: name || 'Project', hue, icon: value }} size={28} />
          <span className="text-ink-2">{humanize(value)}</span>
          <ChevronDown aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />
        </button>
      }
    >
      {({ close }) => (
        <div ref={gridRef} role="group" aria-label="Icons" onKeyDown={move} className="grid grid-cols-8 gap-0.5">
          {PICKABLE_ICONS.map((icon) => {
            const Icon = getIcon(icon)
            const selected = icon === value
            return (
              <Tooltip key={icon} content={humanize(icon)}>
                <button
                  type="button"
                  aria-label={humanize(icon)}
                  aria-pressed={selected}
                  data-autofocus={selected ? '' : undefined}
                  onClick={() => {
                    onChange(icon)
                    close()
                  }}
                  className={cn(
                    'grid size-8 place-items-center rounded-sm text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
                    selected && 'bg-press text-ink',
                  )}
                >
                  {Icon && <Icon aria-hidden className="size-4" strokeWidth={1.75} />}
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------------ new project

interface Draft {
  name: string
  goal: string
  description: string
  instructions: string
  hue: Hue
  icon: string
  scope: boolean
}

const blankDraft = (): Draft => ({ name: '', goal: '', description: '', instructions: '', hue: 'sky', icon: 'Folder', scope: false })

/** The hue a new project gets by default: the least used among active projects (never volt). */
function suggestedHue(projects: readonly Pick<Project, 'hue' | 'status'>[]): Hue {
  const counts = new Map<Hue, number>(PROJECT_HUES.map((h) => [h, 0]))
  for (const p of projects) if (p.status !== 'archived' && counts.has(p.hue)) counts.set(p.hue, (counts.get(p.hue) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'sky'
}

export function NewProjectDialog({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (open: boolean) => void; projects: readonly Project[] }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [error, setError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const hueLabel = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setDraft({ ...blankDraft(), hue: suggestedHue(projects) })
    setError(null)
    setMoreOpen(false)
    // The project list only seeds the default hue when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const submit = () => {
    const name = draft.name.trim()
    if (!name) {
      setError('Give the project a name.')
      nameRef.current?.focus()
      return
    }
    try {
      const project = createProject({
        name,
        goal: draft.goal,
        description: draft.description,
        instructions: draft.instructions,
        hue: draft.hue,
        icon: draft.icon,
      })
      if (draft.scope) switchScope(project.id)
      onOpenChange(false)
      navigate(`/projects/${encodeURIComponent(project.id)}`)
      toast({
        title: `Created “${project.name}”`,
        description: draft.scope ? 'You are working in it: new work is filed here.' : 'Add tasks and milestones, or work in it to file new work here.',
      })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t create the project', description: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New project"
      description="A project is a scope with its own goal, memory, tasks and history."
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" kbd="mod+enter" onClick={submit}>
            Create project
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pt-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      >
        <Field label="Name" error={error ?? undefined} required>
          <Input
            ref={nameRef}
            value={draft.name}
            onValueChange={(v) => {
              set('name', v)
              if (error && v.trim()) setError(null)
            }}
            placeholder="Atlas Portal v3"
            autoComplete="off"
          />
        </Field>
        <Field label="Goal" optional hint="The outcome this project exists to achieve. Every AI action in it sees the goal.">
          <Textarea value={draft.goal} onValueChange={(v) => set('goal', v)} autosize minRows={2} maxRows={5} placeholder="Every customer on v3 by March, with p95 page loads under 1 s." />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <div className="flex flex-col gap-1.5">
            <span className="type-caption font-medium text-ink-2">Icon</span>
            <IconField value={draft.icon} hue={draft.hue} name={draft.name} onChange={(v) => set('icon', v)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span id={hueLabel} className="type-caption font-medium text-ink-2">
              Color
            </span>
            <HueField value={draft.hue} onChange={(v) => set('hue', v)} labelledBy={hueLabel} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className="type-caption -mx-1 inline-flex h-7 items-center gap-1 self-start rounded-sm px-1 font-medium text-ink-2 hover:bg-hover hover:text-ink"
          >
            {moreOpen ? <ChevronDown aria-hidden className="size-3.5" strokeWidth={1.75} /> : <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.75} />}
            Description and AI instructions
          </button>
          {moreOpen && (
            <>
              <Field label="Description" optional>
                <Textarea value={draft.description} onValueChange={(v) => set('description', v)} autosize minRows={2} maxRows={6} />
              </Field>
              <Field label="AI instructions" optional hint="Prepended to every AI request in this project.">
                <Textarea
                  value={draft.instructions}
                  onValueChange={(v) => set('instructions', v)}
                  autosize
                  minRows={3}
                  maxRows={8}
                  placeholder={'- Cite every claim.\n- Write for a busy executive: summary first.'}
                />
              </Field>
            </>
          )}
        </div>
        <Checkbox
          checked={draft.scope}
          onCheckedChange={(v) => set('scope', v)}
          label="Work in this project now"
          description="Sets it as your scope: lists filter to it and new work is filed in it."
        />
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------------ edit details

export function ProjectDetailsDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description)
  const [hue, setHue] = useState<Hue>(project.hue)
  const [icon, setIcon] = useState(project.icon || 'Folder')
  const [error, setError] = useState<string | null>(null)
  const hueLabel = useId()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(project.name)
    setDescription(project.description)
    setHue(project.hue)
    setIcon(project.icon || 'Folder')
    setError(null)
    // Reset the draft each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const save = () => {
    if (!name.trim()) {
      setError('Give the project a name.')
      nameRef.current?.focus()
      return
    }
    updateProject(project.id, { name, description, hue, icon })
    onOpenChange(false)
    toast({ title: 'Project details saved' })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit details"
      description="Name, description and the project’s mark. The goal and AI instructions live in Memory."
      initialFocus={nameRef}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" kbd="mod+enter" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4 pt-2 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            save()
          }
        }}
      >
        <Field label="Name" error={error ?? undefined} required>
          <Input ref={nameRef} value={name} onValueChange={(v) => setName(v)} autoComplete="off" />
        </Field>
        <Field label="Description" optional>
          <Textarea value={description} onValueChange={setDescription} autosize minRows={2} maxRows={6} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
          <div className="flex flex-col gap-1.5">
            <span className="type-caption font-medium text-ink-2">Icon</span>
            <IconField value={icon} hue={hue} name={name} onChange={setIcon} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span id={hueLabel} className="type-caption font-medium text-ink-2">
              Color
            </span>
            <HueField value={hue} onChange={setHue} labelledBy={hueLabel} />
          </div>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  )
}

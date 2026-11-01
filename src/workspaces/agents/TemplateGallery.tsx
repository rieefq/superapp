import { Plus } from 'lucide-react'
import { CAPABILITIES } from '@/core/permissions'
import { AGENT_TEMPLATES, type AgentTemplate } from '@/core/services'
import { cn } from '@/lib/cn'
import { AgentMark } from '@/ui'
import { AUTONOMY_COPY } from './logic'

/** A stable sigil seed per template, so each template always shows the same mark. */
export function templateSeed(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return Math.abs(h) % 0x7fffffff
}

function abilitiesLine(t: AgentTemplate): string {
  return t.capabilities
    .filter((g) => g.mode !== 'deny')
    .map((g) => CAPABILITIES[g.capability].label + (g.mode === 'ask' ? ' (asks)' : ''))
    .join(' · ')
}

/**
 * The template gallery (§6.4 New agent; also the roster when there are no agents): eight starting
 * points plus Blank. Each card is one button.
 */
export function TemplateGallery({ onPick, className }: { onPick: (templateId: string) => void; className?: string }) {
  return (
    <ul aria-label="Templates" className={cn('grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-3', className)}>
      {AGENT_TEMPLATES.map((t) => (
        <li key={t.id} className="flex">
          <button
            type="button"
            onClick={() => onPick(t.id)}
            className="group/tpl flex w-full flex-col gap-3 rounded-md border border-line bg-canvas p-4 text-left transition-colors duration-(--dur-1) hover:border-line-strong hover:bg-hover"
          >
            <span className="flex items-center gap-3">
              <AgentMark seed={templateSeed(t.id)} hue={t.hue} size={32} />
              <span className="flex min-w-0 flex-col">
                <span className="type-body font-semibold text-ink">{t.role}</span>
                <span className="type-caption text-ink-3">Suggested name: {t.name}</span>
              </span>
            </span>
            <span className="type-body-sm line-clamp-2 text-ink-2">{t.description}</span>
            <span className="type-caption mt-auto line-clamp-2 text-ink-3">{abilitiesLine(t)}</span>
            <span className="type-meta text-ink-3">{AUTONOMY_COPY[t.autonomy].label}</span>
          </button>
        </li>
      ))}
      <li className="flex">
        <button
          type="button"
          onClick={() => onPick('blank')}
          className="flex w-full flex-col gap-3 rounded-md border border-line bg-canvas p-4 text-left transition-colors duration-(--dur-1) hover:border-line-strong hover:bg-hover"
        >
          <span className="flex items-center gap-3">
            <span aria-hidden className="grid size-8 place-items-center rounded-full border border-line-strong text-ink-3">
              <Plus className="size-4" strokeWidth={1.75} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="type-body font-semibold text-ink">Blank</span>
              <span className="type-caption text-ink-3">No abilities to start</span>
            </span>
          </span>
          <span className="type-body-sm text-ink-2">Start from nothing: choose the name, abilities and brief yourself.</span>
        </button>
      </li>
    </ul>
  )
}

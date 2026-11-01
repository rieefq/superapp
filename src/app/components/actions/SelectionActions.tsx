import type { RefObject } from 'react'
import { useNavigate } from 'react-router'
import { BookmarkPlus, ListChecks, MessageSquareText, Telescope } from 'lucide-react'
import { openStartSheet } from '@/app/shell/store'
import { sendMessage } from '@/core/ai'
import { resolveEntity, toKnowledge } from '@/core/services'
import type { EntityRef } from '@/core/types'
import { toast } from '@/ui'
import { SelectionToolbar, type SelectionAction } from '../sig'

export interface SelectionActionsProps {
  /** Selections inside this element show the toolbar (a transcript, report or document). */
  containerRef: RefObject<HTMLElement | null>
  /** The entity the text belongs to (message, report, knowledge item…); results link back to it. */
  source: EntityRef
  /** Replace "Ask about this" (e.g. Chat quotes the selection into its own composer). */
  onAsk?: (text: string) => void
  'aria-label'?: string
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')

const clip = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/**
 * The selection toolbar (§5.4.15) wired for a container: Ask about this · Research · Make task ·
 * Save snippet · Copy. Research and Make task open the Start sheet with the selection as the brief
 * and the container's entity as the source; Save snippet saves a Knowledge snippet with provenance.
 */
export function SelectionActions({ containerRef, source, onAsk, ...aria }: SelectionActionsProps) {
  const navigate = useNavigate()
  const actions: SelectionAction[] = [
    {
      id: 'ask',
      label: 'Ask about this',
      icon: MessageSquareText,
      onSelect: (text) => {
        if (onAsk) {
          onAsk(text)
          return
        }
        const projectId = resolveEntity(source).projectId ?? null
        sendMessage({ text: `About this passage:\n\n${quote(text)}\n\nWhat should I know about it?`, contextRefs: [source], projectId })
          .then((r) => navigate(`/chat/${encodeURIComponent(r.threadId)}`))
          .catch((err) => toast({ tone: 'error', title: 'Couldn’t start the conversation', description: err instanceof Error ? err.message : String(err) }))
      },
    },
    {
      id: 'research',
      label: 'Research',
      icon: Telescope,
      onSelect: (text) => openStartSheet('research', { source, prefill: { brief: text } }),
    },
    {
      id: 'task',
      label: 'Make task',
      icon: ListChecks,
      onSelect: (text) => openStartSheet('task', { source, prefill: { title: clip(text, 72), brief: text } }),
    },
    {
      id: 'snippet',
      label: 'Save snippet',
      icon: BookmarkPlus,
      onSelect: (text) => {
        try {
          const r = toKnowledge(source, { title: clip(text, 64), content: quote(text), kind: 'snippet' })
          toast({ tone: 'success', title: 'Snippet saved to Knowledge', action: { label: 'Open', onClick: () => navigate(r.route) } })
        } catch (err) {
          toast({ tone: 'error', title: 'Couldn’t save the snippet', description: err instanceof Error ? err.message : String(err) })
        }
      },
    },
  ]
  return <SelectionToolbar containerRef={containerRef} actions={actions} aria-label={aria['aria-label'] ?? 'Selection actions'} />
}

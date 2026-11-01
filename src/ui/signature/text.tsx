import { Fragment } from 'react'
import { cn } from '@/lib/cn'

export { stripTicks } from './tense'

/** Render `code` spans in engine-written titles ("Run `npm test`") as quiet inline mono. */
export function CodeSpans({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/`([^`]+)`/g)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code key={i} className={cn('rounded-xs bg-hover px-1 py-px font-mono text-[0.92em] font-normal [overflow-wrap:anywhere]', className)}>
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}

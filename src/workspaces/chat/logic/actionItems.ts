import type { ID, Message } from '@/core/types'
import { clipLine, plainText } from '@/core/services/serviceHelpers'

/**
 * "Tasks from action items" (§6.2, journey 4): rule-based extraction of the action items in an
 * answer — open checklist items first, then list items under a "Next steps"-style heading, then a
 * short numbered list. Not AI: the review sheet shows exactly what was found before anything is created.
 */

const MAX_ITEMS = 12
const TITLE_MAX = 110

const ACTION_HEADING =
  /\b(next steps?|action items?|actions|to-?dos?|follow[- ]?ups?|what i'?d do|what to do|recommendations?|recommended|fixes|plan of action|steps)\b/i

const CHECKBOX_OPEN = /^\s{0,6}[-*+]\s+\[ \]\s+(.+)$/
const BULLET = /^\s{0,3}(?:[-*+]|\d{1,2}[.)])\s+(?!\[[ xX]\]\s)(.+)$/
const NUMBERED = /^\s{0,3}\d{1,2}[.)]\s+(.+)$/
const HEADING = /^\s{0,3}(?:#{1,6}\s+(.+?)\s*#*\s*$|\*\*(.+?)\*\*:?\s*$)/
const FENCE = /^\s{0,3}(`{3,}|~{3,})/

/** One clean task title from a markdown list item. */
export function cleanItem(raw: string): string {
  const text = plainText(raw)
    .replace(/\s+/g, ' ')
    .replace(/^[-–—:\s]+/, '')
    .replace(/[\s.;,]+$/, '')
    .trim()
  return clipLine(text.charAt(0).toUpperCase() + text.slice(1), TITLE_MAX)
}

/** Lines outside code fences (action items never come from inside code). */
function proseLines(markdown: string): string[] {
  const out: string[] = []
  let fence: string | null = null
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const m = FENCE.exec(line)
    if (m) {
      if (!fence) fence = m[1][0]
      else if (m[1][0] === fence) fence = null
      out.push('')
      continue
    }
    out.push(fence ? '' : line)
  }
  return out
}

const uniq = (items: string[]) => [...new Set(items.filter(Boolean))].slice(0, MAX_ITEMS)

/** Action items in one answer, best rule first. */
export function extractActionItems(markdown: string): string[] {
  const lines = proseLines(markdown)

  // 1. Open checklist items: "- [ ] Write the regression test".
  const checks = lines.map((l) => CHECKBOX_OPEN.exec(l)?.[1]).filter((t): t is string => !!t)
  if (checks.length) return uniq(checks.map(cleanItem))

  // 2. List items under a "Next steps" / "Action items" / "What I'd do" heading (or bold line).
  const underHeading: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i])
    const title = h?.[1] ?? h?.[2]
    if (!title || !ACTION_HEADING.test(title)) continue
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (HEADING.test(line)) break
      const item = BULLET.exec(line)?.[1]
      if (item) underHeading.push(item)
      else if (line.trim() && underHeading.length && !/^\s{2,}\S/.test(line)) break
    }
  }
  if (underHeading.length) return uniq(underHeading.map(cleanItem))

  // 3. A short numbered list (2–8 items) reads as steps.
  const numbered = lines.map((l) => NUMBERED.exec(l)?.[1]).filter((t): t is string => !!t)
  if (numbered.length >= 2 && numbered.length <= 8) return uniq(numbered.map(cleanItem))
  return []
}

export interface FoundActionItems {
  messageId: ID
  items: string[]
}

/** The latest answer in the conversation that has action items (newest first). */
export function actionItemsFor(messages: readonly (Message | undefined)[]): FoundActionItems | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m || m.role !== 'assistant' || m.status === 'streaming') continue
    const items = extractActionItems(m.content)
    if (items.length) return { messageId: m.id, items }
  }
  return null
}

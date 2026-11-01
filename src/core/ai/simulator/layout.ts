import type { Block, ComposedParts, Depth } from './types'
import { countWords } from './text'

/** Target answer length in words per simulator model. */
export const LENGTH: Record<Depth, { min: number; max: number }> = {
  swift: { min: 120, max: 250 },
  deep: { min: 250, max: 450 },
}

export const heading = (text: string): string => `## ${text}\n\n`
export const bullets = (items: readonly string[]): string => items.map((i) => `- ${i}`).join('\n')
export const numbered = (items: readonly string[]): string => items.map((i, n) => `${n + 1}. ${i}`).join('\n')

/** Markdown table from a header row and body rows (cells must already be escaped). */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

const wordsOf = (blocks: readonly Block[]) => blocks.reduce((n, b) => n + countWords(b.md), 0)

/**
 * Fit composed blocks into the target range: drop the lowest-priority blocks while too long,
 * insert extras (before closing lines) while too short. Never drops priority-Infinity blocks.
 */
export function assemble(parts: ComposedParts, depth: Depth): string {
  const { min, max } = LENGTH[depth]
  const blocks = parts.blocks.filter((b) => b.md.trim())
  let total = wordsOf(blocks)

  while (total > max) {
    let drop = -1
    for (let i = 0; i < blocks.length; i++) {
      const p = blocks[i].priority
      if (p === Infinity) continue
      if (drop === -1 || p <= blocks[drop].priority) drop = i
    }
    if (drop === -1) break
    total -= countWords(blocks[drop].md)
    blocks.splice(drop, 1)
  }

  if (!parts.noPadding) {
    for (const extra of parts.extras ?? []) {
      if (total >= min) break
      const n = countWords(extra.md)
      if (total + n > max) continue
      const firstClosing = blocks.findIndex((b) => b.closing)
      blocks.splice(firstClosing === -1 ? blocks.length : firstClosing, 0, extra)
      total += n
    }
  }
  return blocks.map((b) => b.md.trim()).join('\n\n')
}

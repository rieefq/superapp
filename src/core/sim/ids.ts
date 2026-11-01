import { hashString } from '@/lib/rng'

/**
 * Deterministic id from a prefix and key parts: `stableId('src', runId, 'web', 3)`.
 *
 * Simulation scripts may re-run step side effects after a reload, so anything they insert
 * uses an id derived from stable inputs (run id, investigation id, index…) and checks for
 * existence first. Same shape as `newId` (`prefix_` + 10 base-36 chars).
 */
export function stableId(prefix: string, ...parts: Array<string | number>): string {
  const key = parts.join('|')
  const a = hashString(key).toString(36).padStart(7, '0')
  const b = hashString(`${key}#${parts.length}`).toString(36).padStart(7, '0')
  return `${prefix}_${(a + b).slice(0, 10)}`
}

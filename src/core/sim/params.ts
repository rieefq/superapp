/**
 * Typed readers for run-factory params (`Record<string, unknown>` persisted with the run).
 */

export function paramString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key]
  return typeof v === 'string' && v.trim() ? v : undefined
}

export function paramNumber(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

export function paramOneOf<T extends string>(params: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const v = params[key]
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/** Read a string from a node/asset config bag. */
export function configString(config: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!config) return undefined
  for (const key of keys) {
    const v = config[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return undefined
}

export function configNumber(config: Record<string, unknown> | undefined, ...keys: string[]): number | undefined {
  if (!config) return undefined
  for (const key of keys) {
    const v = config[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

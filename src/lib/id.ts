import { hashString } from './rng'

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Random, URL-safe, prefixed id: `newId('tsk')` → `tsk_k3j9x0q2ab`. */
export function newId(prefix: string, length = 10): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${prefix}_${out}`
}

/**
 * Short display handle for an id, e.g. `RUN-4F2A` (derived, never stored).
 * Random ids (`run_4f2a9x…`) use their first four characters; readable ids such as seed data
 * (`run_seed_inv_pricing`) use a stable hash so handles stay unique.
 */
export function shortCode(id: string, label?: string): string {
  const i = id.indexOf('_')
  const prefix = i === -1 ? '' : id.slice(0, i)
  const rest = i === -1 ? id : id.slice(i + 1)
  const code = /^[a-z0-9]{8,}$/.test(rest) ? rest.slice(0, 4) : hashString(id).toString(36).padStart(4, '0').slice(-4)
  return `${(label ?? prefix).toUpperCase()}-${code.toUpperCase()}`
}

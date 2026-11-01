const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Random, URL-safe, prefixed id: `newId('tsk')` → `tsk_k3j9x0q2ab`. */
export function newId(prefix: string, length = 10): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${prefix}_${out}`
}

/** Short display code for an id, e.g. `RUN-4F2A`. */
export function shortCode(id: string, label?: string): string {
  const [prefix, rest = id] = id.includes('_') ? id.split('_') : ['', id]
  return `${(label ?? prefix).toUpperCase()}-${rest.slice(0, 4).toUpperCase()}`
}

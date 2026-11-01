/**
 * Tiny in-memory LRU cache bounded by entry count and total weight (characters for
 * file contents). Map iteration order is insertion order, so the first key is the
 * least recently used one.
 */
export class LruCache<V> {
  private readonly map = new Map<string, { value: V; weight: number }>()
  private totalWeight = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxWeight: number = Number.POSITIVE_INFINITY,
    private readonly weigh: (value: V) => number = () => 1,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.value
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, value: V): void {
    const weight = this.weigh(value)
    this.delete(key)
    if (weight > this.maxWeight) return
    this.map.set(key, { value, weight })
    this.totalWeight += weight
    while (this.map.size > this.maxEntries || this.totalWeight > this.maxWeight) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.delete(oldest.value)
    }
  }

  delete(key: string): void {
    const hit = this.map.get(key)
    if (!hit) return
    this.totalWeight -= hit.weight
    this.map.delete(key)
  }

  /** Remove every entry whose key starts with `prefix`. */
  deletePrefix(prefix: string): void {
    for (const key of [...this.map.keys()]) if (key.startsWith(prefix)) this.delete(key)
  }

  clear(): void {
    this.map.clear()
    this.totalWeight = 0
  }

  get size(): number {
    return this.map.size
  }
}

/**
 * In-memory BM25 inverted index with incremental updates.
 *
 * - Terms are stems; each document stores weighted term frequencies, so a title token
 *   with weight 3 counts three times (a simple BM25F-style field boost).
 * - Surfaces (folded, unstemmed tokens) are kept in a lazily merged sorted list for
 *   as-you-type prefix expansion: "migr" → surface "migration" → stem "migration".
 * - Each document can carry a phrase string (" stem stem | stem … ") for exact-phrase checks.
 */

export interface IndexTerm {
  stem: string
  surface: string
  weight: number
}

/** One query position: alternative stems with weights (exact = 1, prefix completions < 1). */
export interface QueryGroup {
  terms: Map<string, number>
  /** Optional groups (e.g. a stopword being typed) do not count against coverage. */
  required: boolean
}

export interface DocScore {
  score: number
  /** Number of required groups that matched. */
  matchedRequired: number
}

interface DocEntry {
  length: number
  terms: Map<string, number>
  surfaces: string[]
  phrase: string
}

export class Bm25Index {
  private readonly docs = new Map<string, DocEntry>()
  private readonly postings = new Map<string, Map<string, number>>()
  private readonly surfaceInfo = new Map<string, { stem: string; refs: number }>()
  private sortedSurfaces: string[] = []
  private pendingSurfaces: string[] = []
  private removedSurfaces = 0
  private totalLength = 0
  private readonly k1: number
  private readonly b: number

  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1
    this.b = b
  }

  get size(): number {
    return this.docs.size
  }

  has(key: string): boolean {
    return this.docs.has(key)
  }

  /** Number of documents containing a stem. */
  docFreq(stem: string): number {
    return this.postings.get(stem)?.size ?? 0
  }

  /** Inverse document frequency (BM25, always positive). */
  idf(stem: string): number {
    const n = this.docFreq(stem)
    const total = this.docs.size
    return Math.log(1 + (total - n + 0.5) / (n + 0.5))
  }

  /** Add or replace a document. Documents without terms are not stored. */
  set(key: string, terms: readonly IndexTerm[], phrase = ''): void {
    this.delete(key)
    if (!terms.length) return
    const tf = new Map<string, number>()
    const surfaces = new Map<string, string>()
    let length = 0
    for (const t of terms) {
      tf.set(t.stem, (tf.get(t.stem) ?? 0) + t.weight)
      length += t.weight
      surfaces.set(t.surface, t.stem)
    }
    this.docs.set(key, { length, terms: tf, surfaces: [...surfaces.keys()], phrase })
    this.totalLength += length
    for (const [stem, weight] of tf) {
      let posting = this.postings.get(stem)
      if (!posting) this.postings.set(stem, (posting = new Map()))
      posting.set(key, weight)
    }
    for (const [surface, stem] of surfaces) {
      const info = this.surfaceInfo.get(surface)
      if (info) info.refs++
      else {
        this.surfaceInfo.set(surface, { stem, refs: 1 })
        this.pendingSurfaces.push(surface)
      }
    }
  }

  delete(key: string): void {
    const entry = this.docs.get(key)
    if (!entry) return
    this.docs.delete(key)
    this.totalLength -= entry.length
    for (const stem of entry.terms.keys()) {
      const posting = this.postings.get(stem)
      if (!posting) continue
      posting.delete(key)
      if (!posting.size) this.postings.delete(stem)
    }
    for (const surface of entry.surfaces) {
      const info = this.surfaceInfo.get(surface)
      if (info && --info.refs <= 0) {
        this.surfaceInfo.delete(surface)
        this.removedSurfaces++
      }
    }
  }

  clear(): void {
    this.docs.clear()
    this.postings.clear()
    this.surfaceInfo.clear()
    this.sortedSurfaces = []
    this.pendingSurfaces = []
    this.removedSurfaces = 0
    this.totalLength = 0
  }

  /** True when the document's phrase string contains the (space-delimited) phrase. */
  hasPhrase(key: string, phrase: string): boolean {
    return this.docs.get(key)?.phrase.includes(phrase) ?? false
  }

  /** Merge newly seen surfaces into the sorted list and drop removed ones. */
  private ensureSorted(): void {
    if (!this.pendingSurfaces.length && !this.removedSurfaces) return
    const fresh = this.pendingSurfaces.filter((s) => this.surfaceInfo.has(s)).sort()
    const current = this.sortedSurfaces
    const merged: string[] = []
    let i = 0
    let j = 0
    while (i < current.length || j < fresh.length) {
      const next = j >= fresh.length || (i < current.length && current[i] <= fresh[j]) ? current[i++] : fresh[j++]
      if (merged[merged.length - 1] !== next && this.surfaceInfo.has(next)) merged.push(next)
    }
    this.sortedSurfaces = merged
    this.pendingSurfaces = []
    this.removedSurfaces = 0
  }

  /** Stems of indexed surfaces starting with `prefix`, most common first. */
  expandPrefix(prefix: string, max = 50): string[] {
    if (!prefix) return []
    this.ensureSorted()
    const list = this.sortedSurfaces
    let lo = 0
    let hi = list.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (list[mid] < prefix) lo = mid + 1
      else hi = mid
    }
    const stems = new Map<string, number>()
    for (let i = lo; i < list.length && list[i].startsWith(prefix); i++) {
      const stem = this.surfaceInfo.get(list[i])?.stem
      if (stem !== undefined && !stems.has(stem)) stems.set(stem, this.docFreq(stem))
    }
    return [...stems.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, max)
      .map(([stem]) => stem)
  }

  /**
   * Score every document matching at least one group. Within a group the best
   * alternative counts (a prefix that expands to many words is not rewarded for each).
   */
  score(groups: readonly QueryGroup[]): Map<string, DocScore> {
    const out = new Map<string, DocScore>()
    const total = this.docs.size
    if (!total || !groups.length) return out
    const avgLength = this.totalLength / total || 1
    const { k1, b } = this
    const perDoc = new Map<string, Float64Array>()
    groups.forEach((group, gi) => {
      for (const [stem, weight] of group.terms) {
        const posting = this.postings.get(stem)
        if (!posting) continue
        const idf = Math.log(1 + (total - posting.size + 0.5) / (posting.size + 0.5))
        for (const [key, tf] of posting) {
          const doc = this.docs.get(key)
          if (!doc) continue
          const s = (weight * idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / avgLength))
          let acc = perDoc.get(key)
          if (!acc) perDoc.set(key, (acc = new Float64Array(groups.length)))
          if (s > acc[gi]) acc[gi] = s
        }
      }
    })
    for (const [key, acc] of perDoc) {
      let score = 0
      let matchedRequired = 0
      for (let gi = 0; gi < acc.length; gi++) {
        if (acc[gi] <= 0) continue
        score += acc[gi]
        if (groups[gi].required) matchedRequired++
      }
      out.set(key, { score, matchedRequired })
    }
    return out
  }
}

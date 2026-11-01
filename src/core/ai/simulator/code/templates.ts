/**
 * Vetted code templates for common requests. Sources use two markers so one TypeScript
 * source also yields JavaScript:
 * - `⟨…⟩` wraps TypeScript-only fragments (types, generics, modifiers),
 * - a line starting with `«` is TypeScript-only.
 * Placeholders `⟦NAME⟧`-style are filled by the composer. Generated code avoids backticks
 * and `${` so it can live in String.raw literals.
 */

export type TemplateFamily = 'ts' | 'tsx' | 'python' | 'go' | 'sql' | 'bash'

export interface CodeTemplate {
  id: string
  match: RegExp
  /** Completes "Here's a TypeScript implementation of …". */
  title: string
  sources: Partial<Record<TemplateFamily, string>>
  notes: string[]
  usage?: Partial<Record<'ts' | 'python', string>>
  tests: string[]
}

/** Strip the TypeScript markers for a TS (keep) or JS (drop) rendering. */
export function renderTsSource(src: string, flavor: 'ts' | 'js'): string {
  const lines = src.split('\n').flatMap((line) => {
    if (line.startsWith('«')) return flavor === 'ts' ? [line.slice(1)] : []
    return [line]
  })
  const out = lines.join('\n').replace(/⟨([^⟩]*)⟩/g, (_m, inner: string) => (flavor === 'ts' ? inner : ''))
  // Collapse blank-line runs left behind by removed TS-only lines.
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

export const TEMPLATES: CodeTemplate[] = [
  {
    id: 'debounce',
    match: /\bdebounc/i,
    title: 'a debounce helper',
    sources: {
      ts: String.raw`export function debounce⟨<A extends unknown[]>⟩(fn⟨: (...args: A) => void⟩, waitMs⟨: number⟩)⟨: ((...args: A) => void) & { cancel: () => void }⟩ {
  let timer⟨: ReturnType<typeof setTimeout> | undefined⟩
  const debounced = (...args⟨: A⟩) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, waitMs)
  }
  return Object.assign(debounced, {
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  })
}`,
      python: String.raw`import threading
from functools import wraps
from typing import Any, Callable, Optional


def debounce(wait_seconds: float) -> Callable[[Callable[..., Any]], Callable[..., None]]:
    """Delay calls until wait_seconds have passed without another call."""

    def decorator(fn: Callable[..., Any]) -> Callable[..., None]:
        timer: Optional[threading.Timer] = None
        lock = threading.Lock()

        @wraps(fn)
        def debounced(*args: Any, **kwargs: Any) -> None:
            nonlocal timer
            with lock:
                if timer is not None:
                    timer.cancel()
                timer = threading.Timer(wait_seconds, fn, args, kwargs)
                timer.start()

        return debounced

    return decorator`,
    },
    notes: [
      'Each call resets the timer, so the wrapped function runs once after calls stop for the wait period.',
      'The latest arguments win; earlier pending calls are discarded.',
      'cancel() drops a pending call — useful when a component unmounts.',
    ],
    usage: { ts: "const save = debounce((text: string) => persist(text), 300)\nsave('draft')", python: '@debounce(0.3)\ndef save(text: str) -> None:\n    persist(text)' },
    tests: ['Fires once after rapid calls stop.', 'Uses the arguments of the last call.', 'cancel() prevents the pending call.'],
  },
  {
    id: 'throttle',
    match: /\bthrottl/i,
    title: 'a throttle helper',
    sources: {
      ts: String.raw`export function throttle⟨<A extends unknown[]>⟩(fn⟨: (...args: A) => void⟩, intervalMs⟨: number⟩)⟨: (...args: A) => void⟩ {
  let last = 0
  let timer⟨: ReturnType<typeof setTimeout> | undefined⟩
  let pending⟨: A | undefined⟩
  return (...args⟨: A⟩) => {
    const now = Date.now()
    const remaining = intervalMs - (now - last)
    if (remaining <= 0) {
      last = now
      fn(...args)
      return
    }
    pending = args
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        last = Date.now()
        if (pending) fn(...pending)
        pending = undefined
      }, remaining)
    }
  }
}`,
      python: String.raw`import time
from functools import wraps
from typing import Any, Callable, Optional


def throttle(interval_seconds: float) -> Callable[[Callable[..., Any]], Callable[..., Optional[Any]]]:
    """Run the wrapped function at most once per interval; extra calls are dropped."""

    def decorator(fn: Callable[..., Any]) -> Callable[..., Optional[Any]]:
        last_call = 0.0

        @wraps(fn)
        def throttled(*args: Any, **kwargs: Any) -> Optional[Any]:
            nonlocal last_call
            now = time.monotonic()
            if now - last_call < interval_seconds:
                return None
            last_call = now
            return fn(*args, **kwargs)

        return throttled

    return decorator`,
    },
    notes: [
      'Runs immediately on the first call, then at most once per interval.',
      'The TypeScript version schedules one trailing call with the latest arguments so the final state is not lost.',
      'The Python version drops calls inside the interval, which suits rate-limited side effects.',
    ],
    tests: ['First call runs immediately.', 'Calls inside the interval are coalesced.', 'A trailing call runs with the latest arguments.'],
  },
  {
    id: 'retry',
    match: /\b(retr(?:y|ies)|backoff|back-off)\b/i,
    title: 'retry with exponential backoff',
    sources: {
      ts: String.raw`«export interface RetryOptions {
«  retries?: number
«  baseDelayMs?: number
«  maxDelayMs?: number
«  shouldRetry?: (error: unknown) => boolean
«}
«
const sleep = (ms⟨: number⟩) => new Promise⟨<void>⟩((resolve) => setTimeout(resolve, ms))

export async function retry⟨<T>⟩(task⟨: () => Promise<T>⟩, options⟨: RetryOptions⟩ = {})⟨: Promise<T>⟩ {
  const { retries = 3, baseDelayMs = 250, maxDelayMs = 5000, shouldRetry = () => true } = options
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const jitter = Math.random() * backoff * 0.2
      await sleep(backoff + jitter)
    }
  }
}`,
      python: String.raw`import random
import time
from typing import Callable, TypeVar

T = TypeVar("T")


def retry(task: Callable[[], T], retries: int = 3, base_delay: float = 0.25, max_delay: float = 5.0) -> T:
    """Call task, retrying with exponential backoff and jitter when it raises."""
    for attempt in range(retries + 1):
        try:
            return task()
        except Exception:
            if attempt == retries:
                raise
            backoff = min(max_delay, base_delay * (2 ** attempt))
            time.sleep(backoff + random.uniform(0, backoff * 0.2))
    raise RuntimeError("unreachable")`,
      go: String.raw`package retry

import (
	"context"
	"math/rand"
	"time"
)

// Do calls fn until it succeeds, the context is cancelled, or attempts run out.
func Do(ctx context.Context, attempts int, base time.Duration, fn func() error) error {
	var err error
	for i := 0; i < attempts; i++ {
		if err = fn(); err == nil {
			return nil
		}
		backoff := base * time.Duration(1<<i)
		jitter := time.Duration(rand.Int63n(int64(backoff)/5 + 1))
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff + jitter):
		}
	}
	return err
}`,
    },
    notes: [
      'Delays double on each attempt (capped), with a little random jitter so many clients do not retry in lockstep.',
      'Only retry errors that can succeed later — timeouts, 429s and 5xx responses — not validation errors.',
      'The final error is re-thrown unchanged so callers can still inspect it.',
    ],
    usage: { ts: "const data = await retry(() => fetchJson('/api/report'), { retries: 4 })", python: 'report = retry(lambda: fetch_report(), retries=4)' },
    tests: ['Returns the first successful result.', 'Re-throws after the last attempt.', 'Does not retry when shouldRetry returns false.'],
  },
  {
    id: 'fetch',
    match: /\b(fetch|http request|api call|call (?:an|the) api|get json|download json|request with (?:a )?timeout)\b/i,
    title: 'a JSON fetch with a timeout',
    sources: {
      ts: String.raw`export class HttpError extends Error {
«  readonly status: number
  constructor(status⟨: number⟩, message⟨: string⟩) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export async function fetchJson⟨<T>⟩(url⟨: string⟩, init⟨: RequestInit⟩ = {}, timeoutMs = 10000)⟨: Promise<T>⟩ {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal })
    if (!res.ok) throw new HttpError(res.status, 'Request failed: ' + res.status + ' ' + res.statusText)
    return (await res.json())⟨ as T⟩
  } finally {
    clearTimeout(timer)
  }
}`,
      python: String.raw`import json
import urllib.request
from typing import Any


def fetch_json(url: str, timeout: float = 10.0) -> Any:
    """GET url and decode the JSON body. Raises urllib.error.HTTPError on non-2xx responses."""
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset))`,
    },
    notes: [
      'An AbortController enforces the timeout, and the timer is always cleared.',
      'Non-2xx responses throw an HttpError carrying the status, so callers can branch on 404 versus 500.',
      'The response is typed by the caller; validate it at the boundary if the API is not yours.',
    ],
    tests: ['Resolves with parsed JSON on 200.', 'Throws HttpError with the status on 404.', 'Aborts after the timeout.'],
  },
  {
    id: 'slugify',
    match: /\bslug/i,
    title: 'a slugify function',
    sources: {
      ts: String.raw`export function slugify(input⟨: string⟩, maxLength = 80)⟨: string⟩ {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
}`,
      python: String.raw`import re
import unicodedata


def slugify(value: str, max_length: int = 80) -> str:
    """Lowercase ASCII slug: accents removed, runs of other characters become single hyphens."""
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value.lower()).strip("-")
    return slug[:max_length].rstrip("-")`,
    },
    notes: ['Accents are folded to ASCII first, so “Café Menu” becomes “cafe-menu”.', 'Runs of punctuation and spaces collapse to one hyphen; leading and trailing hyphens are trimmed.', 'Length is capped without leaving a dangling hyphen.'],
    tests: ['Folds accents.', 'Collapses punctuation runs.', 'Never ends with a hyphen after truncation.'],
  },
  {
    id: 'chunk',
    match: /\b(chunk|batch(?:es)? of|split (?:an? )?(?:array|list) into)\b/i,
    title: 'a chunk helper',
    sources: {
      ts: String.raw`export function chunk⟨<T>⟩(items⟨: readonly T[]⟩, size⟨: number⟩)⟨: T[][]⟩ {
  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be a positive integer')
  const out⟨: T[][]⟩ = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}`,
      python: String.raw`from typing import List, Sequence, TypeVar

T = TypeVar("T")


def chunk(items: Sequence[T], size: int) -> List[List[T]]:
    """Split items into consecutive lists of at most size elements."""
    if size < 1:
        raise ValueError("size must be a positive integer")
    return [list(items[i : i + size]) for i in range(0, len(items), size)]`,
    },
    notes: ['The last chunk holds the remainder, so no items are dropped.', 'Invalid sizes fail loudly instead of looping forever.'],
    tests: ['Splits evenly divisible input.', 'Keeps the remainder in the last chunk.', 'Rejects a size of 0.'],
  },
  {
    id: 'groupby',
    match: /\bgroup(?:ing)?[ -]?by\b|\bgroup (?:items|records|rows|objects)\b/i,
    title: 'a groupBy helper',
    sources: {
      ts: String.raw`export function groupBy⟨<T, K extends PropertyKey>⟩(items⟨: Iterable<T>⟩, keyOf⟨: (item: T) => K⟩)⟨: Record<K, T[]>⟩ {
  const groups = {}⟨ as Record<K, T[]>⟩
  for (const item of items) {
    const key = keyOf(item)
    ;(groups[key] ??= []).push(item)
  }
  return groups
}`,
      python: String.raw`from collections import defaultdict
from typing import Callable, Dict, Hashable, Iterable, List, TypeVar

T = TypeVar("T")
K = TypeVar("K", bound=Hashable)


def group_by(items: Iterable[T], key: Callable[[T], K]) -> Dict[K, List[T]]:
    """Group items by key(item), preserving input order within each group."""
    groups: Dict[K, List[T]] = defaultdict(list)
    for item in items:
        groups[key(item)].append(item)
    return dict(groups)`,
    },
    notes: ['One pass over the input; order inside each group follows the input.', 'Keys come from your function, so you can group by derived values like month or status.'],
    tests: ['Groups by a simple property.', 'Preserves order within a group.', 'Returns an empty object for empty input.'],
  },
  {
    id: 'unique',
    match: /\b(dedupe|de-dupe|deduplicate|remove duplicates|unique(?:ly)?|distinct)\b/i,
    title: 'a de-duplication helper',
    sources: {
      ts: String.raw`export function uniqueBy⟨<T, K>⟩(items⟨: Iterable<T>⟩, keyOf⟨: (item: T) => K⟩)⟨: T[]⟩ {
  const seen = new Set⟨<K>⟩()
  const out⟨: T[]⟩ = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}`,
      python: String.raw`from typing import Callable, Hashable, Iterable, List, TypeVar

T = TypeVar("T")


def unique_by(items: Iterable[T], key: Callable[[T], Hashable]) -> List[T]:
    """Return items with duplicate keys removed, keeping the first occurrence."""
    seen = set()
    result: List[T] = []
    for item in items:
        k = key(item)
        if k in seen:
            continue
        seen.add(k)
        result.append(item)
    return result`,
    },
    notes: ['Keeps the first occurrence of each key and preserves order.', 'Pass a key function (for example a normalized email) to define what “duplicate” means.'],
    tests: ['Removes exact duplicates.', 'Keeps the first occurrence.', 'Respects a custom key.'],
  },
  {
    id: 'memoize',
    match: /\b(memoi[sz]e|cache (?:the )?results?|caching wrapper)\b/i,
    title: 'a memoize helper',
    sources: {
      ts: String.raw`export function memoize⟨<A extends unknown[], R>⟩(
  fn⟨: (...args: A) => R⟩,
  keyOf⟨: (...args: A) => string⟩ = (...args) => JSON.stringify(args),
)⟨: (...args: A) => R⟩ {
  const cache = new Map⟨<string, R>⟩()
  return (...args⟨: A⟩) => {
    const key = keyOf(...args)
    if (cache.has(key)) return cache.get(key)⟨ as R⟩
    const value = fn(...args)
    cache.set(key, value)
    return value
  }
}`,
      python: String.raw`from functools import lru_cache


@lru_cache(maxsize=1024)
def expensive_lookup(key: str) -> str:
    """Results are cached per argument; call expensive_lookup.cache_clear() to reset."""
    # Replace the body with the real computation.
    return key.upper()`,
    },
    notes: ['Results are cached by a key derived from the arguments (JSON by default).', 'Only memoize pure functions — cached results ignore later changes to outside state.', 'The cache is unbounded in the TypeScript version; use an LRU if inputs vary widely.'],
    tests: ['Calls the function once for repeated arguments.', 'Distinguishes different arguments.', 'Uses a custom key when provided.'],
  },
  {
    id: 'csv',
    match: /\bcsv\b/i,
    title: 'CSV parsing',
    sources: {
      ts: String.raw`/** Parse CSV text (RFC 4180 quoting) into rows of fields. */
export function parseCsv(text⟨: string⟩, delimiter = ',')⟨: string[][]⟩ {
  const rows⟨: string[][]⟩ = []
  let row⟨: string[]⟩ = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}`,
      python: String.raw`import csv
from pathlib import Path
from typing import Dict, List


def read_csv(path: str) -> List[Dict[str, str]]:
    """Read a CSV file with a header row into a list of dicts."""
    with Path(path).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def sum_column(rows: List[Dict[str, str]], column: str) -> float:
    """Sum a numeric column, skipping blank cells."""
    total = 0.0
    for row in rows:
        value = (row.get(column) or "").strip()
        if value:
            total += float(value.replace(",", ""))
    return total


if __name__ == "__main__":
    data = read_csv("data.csv")
    print(f"{len(data)} rows, total amount: {sum_column(data, 'amount'):.2f}")`,
    },
    notes: ['Quoted fields may contain commas, newlines and escaped quotes ("").', 'Both \\n and \\r\\n line endings are handled.', 'For large files, stream rows instead of loading everything into memory.'],
    tests: ['Parses quoted fields with commas.', 'Handles escaped quotes.', 'Handles CRLF line endings.'],
  },
  {
    id: 'email',
    match: /\b(e-?mail)\b.*\b(valid|check|verify|regex)|\b(valid|check|verify)\w*\b.*\be-?mail/i,
    title: 'an email validator',
    sources: {
      ts: String.raw`const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Pragmatic syntax check. Confirm real ownership by sending a verification link. */
export function isValidEmail(value⟨: string⟩)⟨: boolean⟩ {
  const email = value.trim()
  return email.length <= 254 && EMAIL_PATTERN.test(email)
}`,
      python: String.raw`import re

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def is_valid_email(value: str) -> bool:
    """Pragmatic syntax check; confirm ownership by sending a verification link."""
    email = value.strip()
    return len(email) <= 254 and EMAIL_PATTERN.match(email) is not None`,
    },
    notes: ['Deliberately pragmatic: one @, no spaces, a dot in the domain.', 'A fully RFC-compliant regex rejects few real mistakes and confuses users; verification emails are the real check.'],
    tests: ['Accepts a normal address.', 'Rejects missing @ or domain dot.', 'Trims surrounding whitespace.'],
  },
  {
    id: 'lru',
    match: /\blru\b|least recently used/i,
    title: 'an LRU cache',
    sources: {
      ts: String.raw`export class LruCache⟨<K, V>⟩ {
«  readonly capacity: number
  ⟨private readonly ⟩entries = new Map⟨<K, V>⟩()

  constructor(capacity⟨: number⟩) {
    if (capacity < 1) throw new RangeError('capacity must be at least 1')
    this.capacity = capacity
  }

  get(key⟨: K⟩)⟨: V | undefined⟩ {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key)⟨ as V⟩
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key⟨: K⟩, value⟨: V⟩)⟨: void⟩ {
    if (this.entries.has(key)) this.entries.delete(key)
    this.entries.set(key, value)
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value⟨ as K⟩
      this.entries.delete(oldest)
    }
  }

  get size()⟨: number⟩ {
    return this.entries.size
  }
}`,
      python: String.raw`from collections import OrderedDict
from typing import Generic, Hashable, Optional, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class LRUCache(Generic[K, V]):
    """Fixed-size cache that evicts the least recently used entry."""

    def __init__(self, capacity: int) -> None:
        if capacity < 1:
            raise ValueError("capacity must be at least 1")
        self.capacity = capacity
        self._entries: "OrderedDict[K, V]" = OrderedDict()

    def get(self, key: K) -> Optional[V]:
        if key not in self._entries:
            return None
        self._entries.move_to_end(key)
        return self._entries[key]

    def put(self, key: K, value: V) -> None:
        self._entries[key] = value
        self._entries.move_to_end(key)
        if len(self._entries) > self.capacity:
            self._entries.popitem(last=False)`,
    },
    notes: ['Relies on insertion order: reading an entry moves it to the end, so the first entry is always the least recently used.', 'Both get and set are O(1).'],
    tests: ['Evicts the least recently used entry at capacity.', 'get() refreshes recency.', 'Overwriting a key does not grow the cache.'],
  },
  {
    id: 'ratelimit',
    match: /\b(rate[- ]?limit(?:er|ing)?|token bucket)\b/i,
    title: 'a token-bucket rate limiter',
    sources: {
      ts: String.raw`export class TokenBucket {
«  private tokens: number
«  private lastRefill: number
«  private readonly capacity: number
«  private readonly refillPerSecond: number

  constructor(capacity⟨: number⟩, refillPerSecond⟨: number⟩) {
    this.capacity = capacity
    this.refillPerSecond = refillPerSecond
    this.tokens = capacity
    this.lastRefill = Date.now()
  }

  /** Take cost tokens if available. Returns false when the caller should back off. */
  tryRemove(cost = 1)⟨: boolean⟩ {
    this.refill()
    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }

  ⟨private ⟩refill()⟨: void⟩ {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond)
    this.lastRefill = now
  }
}`,
      python: String.raw`import threading
import time


class TokenBucket:
    """Allow bursts up to capacity, refilling at rate tokens per second."""

    def __init__(self, capacity: float, rate: float) -> None:
        self.capacity = capacity
        self.rate = rate
        self._tokens = capacity
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def try_acquire(self, cost: float = 1.0) -> bool:
        with self._lock:
            now = time.monotonic()
            self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
            self._last = now
            if self._tokens < cost:
                return False
            self._tokens -= cost
            return True`,
    },
    notes: ['Allows short bursts up to the capacity, then a steady rate.', 'Refill is computed lazily from elapsed time, so no background timer is needed.', 'For limits shared across servers, keep the bucket in a shared store such as Redis.'],
    tests: ['Allows a burst up to capacity.', 'Rejects when empty.', 'Refills over time.'],
  },
  {
    id: 'binarysearch',
    match: /\bbinary search\b/i,
    title: 'binary search',
    sources: {
      ts: String.raw`/** Index of target in an ascending array, or -1 when absent. */
export function binarySearch(sorted⟨: readonly number[]⟩, target⟨: number⟩)⟨: number⟩ {
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] === target) return mid
    if (sorted[mid] < target) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}`,
      python: String.raw`from bisect import bisect_left
from typing import Sequence


def binary_search(sorted_items: Sequence[int], target: int) -> int:
    """Return the index of target in sorted_items, or -1 if absent."""
    i = bisect_left(sorted_items, target)
    return i if i < len(sorted_items) and sorted_items[i] == target else -1`,
    },
    notes: ['Requires ascending input; runs in O(log n).', 'The unsigned shift avoids overflow-style mistakes when computing the midpoint.'],
    tests: ['Finds the first, middle and last elements.', 'Returns -1 for missing values.', 'Handles an empty array.'],
  },
  {
    id: 'endpoint',
    match: /\b(endpoint|rest api|api route|route handler|crud api|http server|web server|express|fastapi|handler)\b/i,
    title: 'a small REST endpoint',
    sources: {
      ts: String.raw`import express⟨, { type Request, type Response }⟩ from 'express'
import { randomUUID } from 'node:crypto'

«interface Item {
«  id: string
«  name: string
«}
«
const app = express()
app.use(express.json())
const items = new Map⟨<string, Item>⟩()

app.get('/api/⟦ROUTE⟧', (_req⟨: Request⟩, res⟨: Response⟩) => {
  res.json([...items.values()])
})

app.post('/api/⟦ROUTE⟧', (req⟨: Request⟩, res⟨: Response⟩) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    res.status(400).json({ error: 'name is required' })
    return
  }
  const item⟨: Item⟩ = { id: randomUUID(), name }
  items.set(item.id, item)
  res.status(201).json(item)
})

app.listen(3000, () => console.log('Listening on http://localhost:3000'))`,
      python: String.raw`from typing import Dict, List
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


class ItemIn(BaseModel):
    name: str


class Item(ItemIn):
    id: str


items: Dict[str, Item] = {}


@app.get("/api/⟦ROUTE⟧")
def list_items() -> List[Item]:
    return list(items.values())


@app.post("/api/⟦ROUTE⟧", status_code=201)
def create_item(payload: ItemIn) -> Item:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    item = Item(id=str(uuid4()), name=name)
    items[item.id] = item
    return item`,
      go: String.raw`package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
)

type Item struct {
	ID   int
	Name string
}

type store struct {
	mu     sync.Mutex
	nextID int
	items  []Item
}

func (s *store) list(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, s.items)
}

func (s *store) create(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || strings.TrimSpace(in.Name) == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.nextID++
	item := Item{ID: s.nextID, Name: strings.TrimSpace(in.Name)}
	s.items = append(s.items, item)
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, item)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func main() {
	s := &store{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/⟦ROUTE⟧", s.list)
	mux.HandleFunc("POST /api/⟦ROUTE⟧", s.create)
	log.Println("listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}`,
    },
    notes: ['List and create routes with input validation and proper status codes (400, 201).', 'Storage is in memory to keep the example self-contained — swap in your database layer.', 'Add authentication before exposing it beyond localhost.'],
    tests: ['GET returns an empty list initially.', 'POST with a name returns 201 and the item.', 'POST without a name returns 400.'],
  },
  {
    id: 'react-list',
    match: /\b(react|component)\b.*\b(list|table|search|filter|items)\b|\b(list|table)\b.*\bcomponent\b/i,
    title: 'a filterable list component',
    sources: {
      tsx: String.raw`import { useMemo, useState } from 'react'

«export interface ListItem {
«  id: string
«  title: string
«}
«
«interface ⟦PASCAL⟧Props {
«  items: ListItem[]
«  onSelect?: (item: ListItem) => void
«}
«
export function ⟦PASCAL⟧({ items, onSelect }⟨: ⟦PASCAL⟧Props⟩) {
  const [query, setQuery] = useState('')
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((item) => item.title.toLowerCase().includes(q)) : items
  }, [items, query])

  return (
    <section aria-label="⟦LABEL⟧">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter…"
        aria-label="Filter ⟦LABEL_LOWER⟧"
      />
      {visible.length === 0 ? (
        <p>No matches.</p>
      ) : (
        <ul>
          {visible.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSelect?.(item)}>
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}`,
    },
    notes: ['Filtering is memoized and case-insensitive.', 'Items render as real buttons, so the list is keyboard accessible.', 'An empty state is shown when nothing matches.'],
    tests: ['Renders all items initially.', 'Filters as you type.', 'Calls onSelect with the clicked item.'],
  },
  {
    id: 'react-form',
    match: /\b(react|component)\b.*\b(form|sign ?up|login|log in|contact)\b|\b(form)\b.*\bcomponent\b/i,
    title: 'a validated form component',
    sources: {
      tsx: String.raw`import { useState⟨, type FormEvent⟩ } from 'react'

«interface ⟦PASCAL⟧Props {
«  onSubmit: (values: { name: string; email: string }) => Promise<void> | void
«}
«
export function ⟦PASCAL⟧({ onSubmit }⟨: ⟦PASCAL⟧Props⟩) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState⟨<string | null>⟩(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event⟨: FormEvent<HTMLFormElement>⟩) {
    event.preventDefault()
    if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Please enter your name and a valid email.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), email: email.trim() })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Sending…' : 'Submit'}
      </button>
    </form>
  )
}`,
    },
    notes: ['Labels wrap their inputs, so each field is announced correctly by screen readers.', 'Validation runs on submit and reports errors with role="alert".', 'The button is disabled while submitting to prevent double sends.'],
    tests: ['Shows an error for an invalid email.', 'Calls onSubmit with trimmed values.', 'Disables the button while submitting.'],
  },
  {
    id: 'react-hook-storage',
    match: /\b(local ?storage|persist(?:ed)? state)\b/i,
    title: 'a useLocalStorage hook',
    sources: {
      tsx: String.raw`import { useCallback, useState } from 'react'

export function useLocalStorage⟨<T>⟩(key⟨: string⟩, initial⟨: T⟩)⟨: [T, (value: T) => void]⟩ {
  const [value, setValue] = useState⟨<T>⟩(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw)⟨ as T⟩)
    } catch {
      return initial
    }
  })

  const update = useCallback(
    (next⟨: T⟩) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Storage can be full or blocked (private mode); keep the in-memory value.
      }
    },
    [key],
  )

  return [value, update]
}`,
    },
    notes: ['Reads storage once, lazily, on first render.', 'Every storage access is wrapped in try/catch because storage can be blocked or full.', 'Values are JSON-serialized, so store plain data only.'],
    tests: ['Returns the initial value when storage is empty.', 'Persists updates.', 'Falls back gracefully when storage throws.'],
  },
  {
    id: 'react-hook-debounce',
    match: /\bhook\b.*\bdebounc|\bdebounc\w*\b.*\bhook\b|\buse ?debounce|\bdebounced value\b/i,
    title: 'a useDebouncedValue hook',
    sources: {
      tsx: String.raw`import { useEffect, useState } from 'react'

export function useDebouncedValue⟨<T>⟩(value⟨: T⟩, delayMs = 300)⟨: T⟩ {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}`,
    },
    notes: ['Returns the value only after it has stopped changing for the delay.', 'The effect cleanup cancels the pending timer on every change and on unmount.'],
    tests: ['Returns the initial value immediately.', 'Updates after the delay.', 'Ignores intermediate values.'],
  },
]

/** Generic SQL by intent; table names are assumptions the prose calls out. */
export function sqlTemplate(text: string, table: string, joinTable: string | undefined, limit: number): { title: string; sql: string } {
  if (/\b(duplicate|dupes?)\b/i.test(text)) {
    return {
      title: 'a duplicate finder',
      sql: `-- Rows that share the same email\nSELECT email, COUNT(*) AS occurrences\nFROM ${table}\nGROUP BY email\nHAVING COUNT(*) > 1\nORDER BY occurrences DESC;`,
    }
  }
  if (/\b(active users|mau|dau|wau)\b/i.test(text)) {
    const period = /\b(dau|daily)\b/i.test(text) ? 'day' : /\b(wau|weekly)\b/i.test(text) ? 'week' : 'month'
    return {
      title: `${period}ly active users`,
      sql: `-- Distinct active users per ${period}, last 12 months\nSELECT DATE_TRUNC('${period}', occurred_at) AS ${period}, COUNT(DISTINCT user_id) AS active_users\nFROM events\nWHERE occurred_at >= CURRENT_DATE - INTERVAL '12 months'\nGROUP BY 1\nORDER BY 1;`,
    }
  }
  if (/\b(top|highest|most|largest|best)\b/i.test(text) && joinTable) {
    return {
      title: `the top ${limit} ${table} by total`,
      sql: `-- Top ${limit} ${table} by total amount\nSELECT t.id, t.name, SUM(j.amount) AS total_amount\nFROM ${table} AS t\nJOIN ${joinTable} AS j ON j.${singular(table)}_id = t.id\nGROUP BY t.id, t.name\nORDER BY total_amount DESC\nLIMIT ${limit};`,
    }
  }
  if (/\b(per|by|each)\s+(day|week|month|year)\b|\b(daily|weekly|monthly|trend|over time)\b/i.test(text)) {
    const period = /\b(day|daily)\b/i.test(text) ? 'day' : /\b(week|weekly)\b/i.test(text) ? 'week' : /\b(year)\b/i.test(text) ? 'year' : 'month'
    return {
      title: `${table} per ${period}`,
      sql: `-- New ${table} per ${period}\nSELECT DATE_TRUNC('${period}', created_at) AS ${period}, COUNT(*) AS total\nFROM ${table}\nGROUP BY 1\nORDER BY 1;`,
    }
  }
  if (/\b(count|how many|number of)\b/i.test(text)) {
    return {
      title: `a count of ${table} by status`,
      sql: `-- ${capitalizeFirst(table)} by status\nSELECT status, COUNT(*) AS total\nFROM ${table}\nGROUP BY status\nORDER BY total DESC;`,
    }
  }
  return {
    title: `the most recent ${table}`,
    sql: `-- Most recent ${table}\nSELECT *\nFROM ${table}\nWHERE created_at >= CURRENT_DATE - INTERVAL '30 days'\nORDER BY created_at DESC\nLIMIT ${limit};`,
  }
}

function singular(table: string): string {
  return table.endsWith('ies') ? `${table.slice(0, -3)}y` : table.replace(/s$/, '')
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Bash scripts by intent. */
export function bashTemplate(text: string): { title: string; script: string } {
  if (/\bbackup|back up|archive\b/i.test(text)) {
    return {
      title: 'a timestamped backup script',
      script: String.raw`#!/usr/bin/env bash
# Back up a directory into a timestamped .tar.gz archive.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <source-dir> [dest-dir]" >&2
  exit 1
fi

src="$1"
dest="./backups"
if [[ $# -ge 2 ]]; then
  dest="$2"
fi

mkdir -p "$dest"
stamp="$(date +%Y%m%d-%H%M%S)"
archive="$dest/$(basename "$src")-$stamp.tar.gz"

tar -czf "$archive" -C "$(dirname "$src")" "$(basename "$src")"
echo "Created $archive"`,
    }
  }
  if (/\b(clean ?up|delete|remove|prune)\b.*\b(old|older)\b/i.test(text)) {
    return {
      title: 'an old-file cleanup script (dry run by default)',
      script: String.raw`#!/usr/bin/env bash
# Delete files older than N days. Dry run unless --apply is passed.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <directory> <days> [--apply]" >&2
  exit 1
fi

dir="$1"
days="$2"
apply="no"
if [[ $# -ge 3 && "$3" == "--apply" ]]; then
  apply="yes"
fi

while IFS= read -r -d '' file; do
  if [[ "$apply" == "yes" ]]; then
    rm -- "$file"
    echo "Deleted $file"
  else
    echo "Would delete $file"
  fi
done < <(find "$dir" -type f -mtime +"$days" -print0)`,
    }
  }
  return {
    title: 'a script that processes files in a directory',
    script: String.raw`#!/usr/bin/env bash
# Process every matching file in a directory.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <directory> [pattern]" >&2
  exit 1
fi

dir="$1"
pattern="*"
if [[ $# -ge 2 ]]; then
  pattern="$2"
fi

process_file() {
  local file="$1"
  # TODO: replace with the real work for each file.
  echo "Processing $file"
}

count=0
while IFS= read -r -d '' file; do
  process_file "$file"
  count=$((count + 1))
done < <(find "$dir" -type f -name "$pattern" -print0)

echo "Done: $count file(s)."`,
  }
}

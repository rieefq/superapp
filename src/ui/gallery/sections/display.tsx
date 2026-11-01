import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, CircleDashed, CircleX, Loader } from 'lucide-react'
import {
  ActivityFeed,
  CodeBlock,
  DataTable,
  DiffView,
  InlineCode,
  LogView,
  Markdown,
  Meter,
  Pagination,
  Stat,
  Terminal,
  Tree,
  paginate,
  type ActivityItem,
  type Citation,
  type DataColumn,
  type TerminalLine,
  type TreeNode,
} from '@/ui/display'
import {
  BarChart,
  DonutChart,
  Heatmap,
  Sparkline,
  TimeSeriesChart,
  type CalendarCell,
  type TimeSeries,
  type WeekdayHourCell,
} from '@/ui/charts'
import { cn } from '@/lib/cn'
import { createRng } from '@/lib/rng'
import { formatCompact, formatDuration, formatUsd } from '@/lib/format'

/* ------------------------------------------------------------------------------------------ */
/* Gallery scaffolding                                                                        */
/* ------------------------------------------------------------------------------------------ */

function Demo({ title, note, children, className }: { title: string; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex min-w-0 flex-col gap-4', className)} aria-label={title}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-2">
        <h3 className="font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase">{title}</h3>
        {note && <span className="truncate text-xs text-ink-4">{note}</span>}
      </div>
      {children}
    </section>
  )
}

function GButton({ children, onClick, pressed }: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="inline-flex h-7 items-center rounded-sm border border-line-strong px-2.5 text-xs text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink aria-pressed:bg-press aria-pressed:text-ink pointer-coarse:h-11"
    >
      {children}
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-10">
      <h3 className="font-serif text-2xl text-ink">{title}</h3>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Fixtures                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const NOW = Date.now()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const MEMO = `# Retrieval latency budget

The assistant answers in **under 1.2 s p95** when retrieval stays inside its slice of the budget [1]. Our last three regressions all came from the re-ranker, not the index [2, 3].

## Where the time goes

| Stage | p50 | p95 | Budget |
| :-- | --: | --: | --: |
| Query embedding | 18 ms | 41 ms | 60 ms |
| Vector search (HNSW) | 9 ms | 22 ms | 40 ms |
| Re-rank (cross-encoder) | 140 ms | 410 ms | 300 ms |
| Prompt assembly | 4 ms | 9 ms | 20 ms |

> Caching re-rank scores per \`(query, chunk)\` pair would remove most of the p95 tail without touching quality.

The fix is small — memoize scores and cap candidates at 48:

\`\`\`ts
const cache = new Map<string, number>()

export async function rerank(query: string, chunks: Chunk[]): Promise<Chunk[]> {
  const top = chunks.slice(0, 48) // cap the candidate set
  const scores = await Promise.all(
    top.map(async (c) => cache.get(key(query, c)) ?? score(query, c)),
  )
  return top.map((c, i) => ({ ...c, score: scores[i] })).sort(byScore)
}
\`\`\`

### Next steps

- [x] Reproduce the p95 regression on the staging corpus
- [x] Add a per-stage timing span to every run
- [ ] Ship the score cache behind a flag
- [ ] Re-measure after a week of traffic

See the [knowledge note](/knowledge) for the full trace, or the original [HNSW paper](https://arxiv.org/abs/1603.09320).

---

*Prepared by Research agent · 4 sources*`

const CITATIONS: Citation[] = [
  { index: 1, title: 'Latency SLOs for conversational assistants — internal spec v3', href: 'https://docs.example.com/slo' },
  { index: 2, title: 'Incident review: re-ranker timeout (Oct 14)', onClick: () => {} },
  { index: 3, title: 'Cross-encoder cost model — benchmarks', href: 'https://research.example.org/cross-encoder' },
]

const STREAM_TEXT = `Here’s what I found in the repository. The flaky test comes from a **race in \`useRunStream\`**: the effect subscribes after the first event is emitted.

1. The engine emits \`step.started\` synchronously.
2. The hook subscribes in \`useEffect\`, one frame later.
3. The first event is dropped, so the step never renders as running.

\`\`\`ts
useLayoutEffect(() => runEngine.subscribe(runId, onEvent), [runId])
\`\`\`

Switching to a layout effect closes the gap. I’ll open a draft PR with the fix and a regression test.`

const CODE_TS = `import { useEffect, useState } from 'react'
import type { Run } from '@/core/types'

/** Live view of a run: re-renders on every engine event. */
export function useRun(runId: string): Run | undefined {
  const [run, setRun] = useState(() => runEngine.get(runId))
  useEffect(() => {
    return runEngine.subscribe(runId, () => setRun(runEngine.get(runId)))
  }, [runId])
  return run
}

export function formatCost(usd: number, estimate = true): string {
  const value = usd < 0.01 ? \`$\${usd.toFixed(4)}\` : \`$\${usd.toFixed(2)}\`
  return estimate ? \`≈ \${value}\` : value
}

const RETRY_LIMIT = 3
const BACKOFF_MS = [250, 1_000, 4_000] as const

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < RETRY_LIMIT; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]))
    }
  }
  throw lastError
}`

const CODE_PY = `def chunk(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    """Split a document into overlapping windows, preferring paragraph boundaries so that retrieval never cuts a sentence in half."""
    parts, start = [], 0
    while start < len(text):
        end = min(len(text), start + size)
        parts.append(text[start:end])
        start = end - overlap if end < len(text) else end
    return parts  # e.g. chunk(open("handbook.md").read())`

const DIFF_MIDDLE = `
export function taskTitle(task: Task): string {
  return task.title || 'Untitled task'
}

export function isOverdue(task: Task, now = Date.now()): boolean {
  return task.dueAt != null && task.dueAt < now && task.status !== 'done'
}

export function byDueDate(a: Task, b: Task): number {
  return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
}

export function tasksForProject(projectId: string): Task[] {
  return db.all('tasks').filter((t) => t.projectId === projectId)
}
`

const DIFF_OLD = `import { db } from '@/core/db'
import type { Task } from '@/core/types'

export function createTask(title: string, projectId: string | null): Task {
  const task: Task = {
    id: newId('tsk'),
    title,
    projectId,
    status: 'todo',
    createdAt: Date.now(),
  }
  db.insert('tasks', task)
  return task
}

export function completeTask(id: string) {
  db.update('tasks', id, { status: 'done' })
}
${DIFF_MIDDLE}
export function archiveTask(id: string) {
  db.update('tasks', id, { archived: true })
}

export function renameTask(id: string, title: string) {
  db.update('tasks', id, { title })
}
`

const DIFF_NEW = `import { db } from '@/core/db'
import { logActivity } from '@/core/services/activity'
import type { Task } from '@/core/types'

export function createTask(title: string, projectId: string | null, source?: EntityRef): Task {
  const task: Task = {
    id: newId('tsk'),
    title: title.trim(),
    projectId,
    status: 'todo',
    createdAt: Date.now(),
  }
  db.insert('tasks', task)
  logActivity({ verb: 'created', target: { kind: 'task', id: task.id } })
  if (source) link(source, { kind: 'task', id: task.id }, 'derived_from')
  return task
}

export function completeTask(id: string) {
  db.update('tasks', id, { status: 'done', completedAt: Date.now() })
}
${DIFF_MIDDLE}
export function archiveTask(id: string) {
  db.update('tasks', id, { archived: true })
}

export function renameTask(id: string, title: string) {
  db.update('tasks', id, { title: title.trim() })
}
`

const PATCH = `diff --git a/src/core/runs/engine.ts b/src/core/runs/engine.ts
--- a/src/core/runs/engine.ts
+++ b/src/core/runs/engine.ts
@@ -88,5 +88,7 @@ export class RunEngine {
   resume(runId: string) {
     const run = this.get(runId)
-    if (!run) return
+    if (!run || run.status === 'cancelled') return
+    // Interrupted runs restart from their last completed step.
+    const from = run.steps.findIndex((s) => s.status !== 'done')
     this.schedule(run, from)
   }
`

const TEST_STREAM: TerminalLine[] = [
  { kind: 'command', text: 'npm test -- src/core' },
  { text: '' },
  { text: ' RUN  v5.0.5 /workspace/atrium' },
  { text: '' },
  { text: ' ✓ src/core/db/store.test.ts (14 tests) 38ms' },
  { text: ' ✓ src/core/search/index.test.ts (22 tests) 112ms' },
  { text: ' ✓ src/core/permissions/policy.test.ts (9 tests) 12ms' },
  { text: ' warning: snapshot "runs/engine resumes" is obsolete' },
  { text: ' × src/core/runs/engine.test.ts > resumes interrupted runs 41ms' },
  { text: "   → expected 'running' to be 'queued'" },
  { text: '    at src/core/runs/engine.test.ts:88:31' },
  { text: ' ✓ src/core/ai/intent.test.ts (31 tests) 64ms' },
  { text: '' },
  { text: ' Test Files  1 failed | 4 passed (5)' },
  { text: '      Tests  1 failed | 75 passed (76)' },
  { text: '   Duration  1.42s' },
]

const LOG_LINES = [
  '09:41:02 [boot] hydrating 14 tables from localStorage',
  '09:41:02 [boot] seed skipped — existing workspace found',
  '09:41:03 [runs] resuming 2 interrupted runs',
  '09:41:03 [runs] run_k3j9x0 resumed at step 3/7',
  '09:41:04 [search] index ready (2,184 docs) ✓',
  '09:41:09 [github] WARN rate limit at 82% — backing off 30s',
  '09:41:12 [ai] stream started model=claude-sonnet effort=medium',
  '09:41:15 [ai] ERROR stream interrupted: network changed',
  '09:41:15 [ai] retrying (1/3) in 250ms',
  '09:41:16 [ai] stream completed in 3.9s — 1,204 tokens',
  '09:41:20 [runs] run_k3j9x0 completed ✓',
].join('\n')

function makeRepoTree(big: boolean): TreeNode[] {
  const file = (dir: string, name: string, meta?: ReactNode): TreeNode => ({ id: `${dir}/${name}`, label: name, meta })
  const tree: TreeNode[] = [
    {
      id: 'src',
      label: 'src',
      children: [
        {
          id: 'src/ui',
          label: 'ui',
          children: [
            {
              id: 'src/ui/display',
              label: 'display',
              children: [
                file('src/ui/display', 'CodeBlock.tsx'),
                file('src/ui/display', 'DiffView.tsx', 'M'),
                file('src/ui/display', 'diff.test.ts', 'A'),
                file('src/ui/display', 'Markdown.tsx'),
                file('src/ui/display', 'Terminal.tsx'),
                file('src/ui/display', 'Tree.tsx', 'M'),
              ],
            },
            { id: 'src/ui/charts', label: 'charts', children: [file('src/ui/charts', 'BarChart.tsx'), file('src/ui/charts', 'scale.ts'), file('src/ui/charts', 'scale.test.ts')] },
            file('src/ui', 'index.ts'),
          ],
        },
        {
          id: 'src/core',
          label: 'core',
          children: [
            { id: 'src/core/runs', label: 'runs', children: [file('src/core/runs', 'engine.ts', 'M'), file('src/core/runs', 'engine.test.ts')] },
            file('src/core', 'settings.ts'),
            file('src/core', 'secrets.ts'),
          ],
        },
        { id: 'src/styles', label: 'styles', children: [file('src/styles', 'tokens.css'), file('src/styles', 'base.css')] },
        file('src', 'main.tsx'),
      ],
    },
    { id: 'node_modules', label: 'node_modules', hasChildren: true },
    { id: 'public', label: 'public', children: [file('public', 'favicon.svg'), file('public', 'og-image.png')] },
    file('', '.env.local'),
    file('', 'Dockerfile'),
    file('', 'package.json'),
    file('', 'package-lock.json'),
    file('', 'README.md'),
    file('', 'vite.config.ts'),
  ]
  if (big) {
    tree.push({
      id: 'generated',
      label: 'generated',
      children: Array.from({ length: 40 }, (_, d) => ({
        id: `generated/mod-${d}`,
        label: `module-${String(d).padStart(2, '0')}`,
        children: Array.from({ length: 50 }, (_, f) => file(`generated/mod-${d}`, `handler-${d}-${f}.ts`)),
      })),
    })
  }
  return tree
}

type RunRow = {
  id: string
  name: string
  agent: { label: string; hue: string }
  status: 'running' | 'done' | 'failed' | 'queued'
  durationMs: number | null
  cost: number
  startedAt: number
}

const AGENTS = [
  { label: 'Research', hue: 'bg-hue-sky/15 text-hue-sky' },
  { label: 'Coder', hue: 'bg-hue-violet/15 text-hue-violet' },
  { label: 'Ops', hue: 'bg-hue-amber/15 text-hue-amber' },
  { label: 'Writer', hue: 'bg-hue-rose/15 text-hue-rose' },
]
const RUN_NAMES = [
  'Summarize Q3 churn interviews',
  'Fix flaky engine test',
  'Draft launch announcement',
  'Rotate staging API keys',
  'Compare vector DB pricing',
  'Triage GitHub issues',
  'Refactor billing service',
  'Weekly metrics digest',
  'Audit permission policies',
  'Translate onboarding guide',
]

function makeRuns(n: number): RunRow[] {
  const rng = createRng('runs')
  return Array.from({ length: n }, (_, i) => {
    const status = i === 0 ? 'running' : i === 3 ? 'queued' : rng.chance(0.15) ? 'failed' : 'done'
    return {
      id: `RUN-${(0x4f2a + i * 37).toString(16).toUpperCase()}`,
      name: RUN_NAMES[i % RUN_NAMES.length],
      agent: AGENTS[rng.int(0, AGENTS.length - 1)],
      status,
      durationMs: status === 'queued' ? null : rng.int(8_000, 900_000),
      cost: rng.float(0.002, 2.4),
      startedAt: NOW - i * rng.int(20, 140) * MIN,
    }
  })
}

const STATUS = {
  running: { icon: Loader, label: 'Running', cls: 'text-live-ink' },
  done: { icon: CircleCheck, label: 'Done', cls: 'text-done-ink' },
  failed: { icon: CircleX, label: 'Failed', cls: 'text-fail-ink' },
  queued: { icon: CircleDashed, label: 'Queued', cls: 'text-ink-3' },
} as const

const RUN_COLUMNS: DataColumn<RunRow>[] = [
  { key: 'id', header: 'Run', mono: true, sortable: true, width: 104, cell: (r) => <span className="text-ink-3">{r.id}</span> },
  { key: 'name', header: 'Task', sortable: true, cell: (r) => <span className="block max-w-72 truncate text-ink">{r.name}</span> },
  {
    key: 'agent',
    header: 'Agent',
    hideBelow: 'md',
    sortable: true,
    sortValue: (r) => r.agent.label,
    cell: (r) => (
      <span className="inline-flex items-center gap-2">
        <span className={cn('flex size-4 items-center justify-center rounded-xs font-mono text-[9px] font-semibold', r.agent.hue)}>{r.agent.label[0]}</span>
        {r.agent.label}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    cell: (r) => {
      const s = STATUS[r.status]
      const Icon = s.icon
      return (
        <span className={cn('inline-flex items-center gap-1.5', s.cls)}>
          <Icon aria-hidden className={cn('size-3.5', r.status === 'running' && 'atr-spin')} />
          {s.label}
        </span>
      )
    },
  },
  { key: 'durationMs', header: 'Duration', align: 'right', sortable: true, hideBelow: 'sm', cell: (r) => (r.durationMs == null ? <span className="text-ink-4">—</span> : formatDuration(r.durationMs)) },
  { key: 'cost', header: 'Cost (est.)', align: 'right', sortable: true, cell: (r) => formatUsd(r.cost) },
]

function makeActivity(): ActivityItem[] {
  const mark = (letter: string, cls: string) => (
    <span aria-hidden className={cn('flex size-5 items-center justify-center rounded-xs font-mono text-[10px] font-semibold', cls)}>
      {letter}
    </span>
  )
  const chip = (text: string) => <span className="rounded-xs bg-hover px-1 font-mono text-xs text-ink-2">{text}</span>
  return [
    { id: 'a1', at: NOW - 3 * MIN, actor: { label: 'Coder', mark: mark('C', 'bg-hue-violet/15 text-hue-violet') }, summary: 'opened a draft pull request', target: chip('#482 fix run resume race') },
    { id: 'a2', at: NOW - 26 * MIN, actor: { label: 'Morgan Lee' }, summary: 'approved the plan for', target: <span className="text-ink">Refactor billing service</span>, detail: 'Autonomy: balanced · 3 steps need review' },
    { id: 'a3', at: NOW - 2 * HOUR, actor: { label: 'Research', mark: mark('R', 'bg-hue-sky/15 text-hue-sky') }, summary: 'finished investigating', target: <span className="text-ink">Vector DB pricing</span>, detail: '12 sources · report ready' },
    { id: 'a4', at: NOW - DAY - 3 * HOUR, actor: { label: 'Ops', mark: mark('O', 'bg-hue-amber/15 text-hue-amber') }, summary: 'rotated', target: chip('STAGING_API_KEY') },
    { id: 'a5', at: NOW - DAY - 7 * HOUR, actor: { label: 'Morgan Lee' }, summary: 'created project', target: <span className="text-ink">Atrium launch</span> },
    { id: 'a6', at: NOW - 4 * DAY, actor: { label: 'Writer', mark: mark('W', 'bg-hue-rose/15 text-hue-rose') }, summary: 'drafted', target: <span className="text-ink">Launch announcement v2</span> },
  ]
}

/* ------------------------------------------------------------------------------------------ */
/* Demos                                                                                      */
/* ------------------------------------------------------------------------------------------ */

function useTicker(total: number, stepMs: number, run: boolean) {
  const [n, setN] = useState(total)
  useEffect(() => {
    if (!run) return
    setN(0)
    const id = window.setInterval(() => setN((x) => (x >= total ? x : x + 1)), stepMs)
    return () => window.clearInterval(id)
  }, [run, total, stepMs])
  return n
}

function MarkdownDemo() {
  const [replay, setReplay] = useState(0)
  const words = useMemo(() => STREAM_TEXT.split(/(?<=\s)/), [])
  const [count, setCount] = useState(words.length)
  useEffect(() => {
    if (replay === 0) return
    setCount(0)
    const id = window.setInterval(() => setCount((c) => (c >= words.length ? c : c + 2)), 45)
    return () => window.clearInterval(id)
  }, [replay, words.length])
  const streaming = replay > 0 && count < words.length
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
      <Demo title="Markdown · prose=doc" note="serif document voice, ~68ch measure, citations">
        <Markdown prose="doc" citations={CITATIONS}>
          {MEMO}
        </Markdown>
      </Demo>
      <Demo title="Markdown · prose=ui · streaming" note={<GButton onClick={() => setReplay((r) => r + 1)}>{streaming ? 'Streaming…' : 'Replay stream'}</GButton>}>
        <div className="rounded-md border border-line bg-raised p-4">
          <Markdown prose="ui" streaming={streaming || replay === 0}>
            {replay === 0 ? STREAM_TEXT.slice(0, 214) : words.slice(0, count).join('')}
          </Markdown>
        </div>
        <p className="text-xs text-ink-3">
          Inline code like <InlineCode>runEngine.subscribe()</InlineCode> sits on the sunken surface; the caret never shifts layout.
        </p>
      </Demo>
    </div>
  )
}

function CodeDemo() {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Demo title="CodeBlock · filename, lines, highlight 6–8, collapsed">
        <CodeBlock code={CODE_TS} filename="src/core/runs/useRun.ts" highlight="6-8" maxHeight={300} />
      </Demo>
      <div className="flex min-w-0 flex-col gap-10">
        <Demo title="CodeBlock · long lines (toggle wrap)">
          <CodeBlock code={CODE_PY} language="python" />
        </Demo>
        <Demo title="CodeBlock · bare shell">
          <CodeBlock bare code={'npm run typecheck && npx vitest run src/ui\nPORT=5202 npx vite --port 5202 --strictPort'} language="sh" />
        </Demo>
      </div>
    </div>
  )
}

function DiffDemo() {
  const big = useMemo(() => Array.from({ length: 3200 }, (_, i) => `export const k${i} = ${i}`).join('\n'), [])
  const bigNew = useMemo(() => big.replace('export const k1600 = 1600', 'export const k1600 = 1601'), [big])
  return (
    <div className="flex flex-col gap-10">
      <Demo title="DiffView · unified" note="word-level emphasis, collapsed context">
        <DiffView oldText={DIFF_OLD} newText={DIFF_NEW} path="src/core/services/tasks.ts" />
      </Demo>
      <Demo title="DiffView · split">
        <DiffView oldText={DIFF_OLD} newText={DIFF_NEW} path="src/core/services/tasks.ts" mode="split" />
      </Demo>
      <div className="grid gap-10 lg:grid-cols-2">
        <Demo title="DiffView · from a git patch">
          <DiffView patch={PATCH} />
        </Demo>
        <Demo title="DiffView · large-file guard">
          <DiffView oldText={big} newText={bigNew} path="src/generated/constants.ts" />
        </Demo>
      </div>
    </div>
  )
}

function TerminalDemo() {
  const [run, setRun] = useState(0)
  const shown = useTicker(TEST_STREAM.length, 260, run > 0)
  const lines = run > 0 ? TEST_STREAM.slice(0, shown) : TEST_STREAM
  const streaming = run > 0 && shown < TEST_STREAM.length
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Demo title="Terminal · streaming" note={<GButton onClick={() => setRun((r) => r + 1)}>{streaming ? 'Running…' : 'Run tests'}</GButton>}>
        <Terminal lines={lines} title="zsh — atrium" label="Simulated output" streaming={streaming} height="md" cwd="~/atrium" />
      </Demo>
      <Demo title="LogView · timestamps, heuristic tones">
        <LogView lines={LOG_LINES} title="app.log" height="md" />
      </Demo>
    </div>
  )
}

function TreeDemo() {
  const [big, setBig] = useState(false)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string | null>('src/ui/display/DiffView.tsx')
  const [nodes, setNodes] = useState(() => makeRepoTree(false))
  useEffect(() => setNodes(makeRepoTree(big)), [big])
  const loadChildren = (node: TreeNode) =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        setNodes((list) =>
          list.map((n) =>
            n.id === node.id
              ? { ...n, children: ['react', 'react-dom', 'motion', 'zustand', 'diff', 'sugar-high'].map((p) => ({ id: `${n.id}/${p}`, label: p, children: [{ id: `${n.id}/${p}/package.json`, label: 'package.json' }] })) }
              : n,
          ),
        )
        resolve()
      }, 900)
    })
  return (
    <Demo title="Tree · keyboard, lazy, filter" note={<GButton pressed={big} onClick={() => setBig((b) => !b)}>{big ? '2,000+ nodes' : 'Add 2,000 nodes'}</GButton>}>
      <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="h-8 rounded-sm border border-line bg-raised px-2.5 text-sm text-ink placeholder:text-ink-4 focus-visible:border-accent pointer-coarse:h-11"
          />
          <div className="max-h-96 overflow-auto rounded-md border border-line px-1">
            <Tree
              label="Repository files"
              nodes={nodes}
              defaultExpanded={['src', 'src/ui', 'src/ui/display']}
              selectedId={selected}
              onSelect={(n) => setSelected(n.id)}
              loadChildren={loadChildren}
              filter={filter}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 text-sm text-ink-3">
          <p>
            Selected: <span className="font-mono text-xs text-ink">{selected ?? '—'}</span>
          </p>
          <p className="text-xs text-pretty">
            ↑ ↓ move · → expand / enter · ← collapse / parent · Home End · type to jump · * expands siblings · Enter opens. Expand
            <span className="font-mono"> node_modules</span> to see lazy loading.
          </p>
        </div>
      </div>
    </Demo>
  )
}

function TableDemo() {
  const all = useMemo(() => makeRuns(48), [])
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(all[1].id)
  const [dense, setDense] = useState(false)
  const [state, setState] = useState<'data' | 'loading' | 'empty'>('data')
  const rows = state === 'data' ? all : []
  const p = paginate(rows, page, 8)
  return (
    <Demo
      title="DataTable · sortable, selectable, paginated"
      note={
        <span className="flex gap-1.5">
          <GButton pressed={dense} onClick={() => setDense((d) => !d)}>
            Dense
          </GButton>
          <GButton pressed={state === 'loading'} onClick={() => setState((s) => (s === 'loading' ? 'data' : 'loading'))}>
            Loading
          </GButton>
          <GButton pressed={state === 'empty'} onClick={() => setState((s) => (s === 'empty' ? 'data' : 'empty'))}>
            Empty
          </GButton>
        </span>
      }
    >
      <DataTable
        caption="Recent runs"
        columns={RUN_COLUMNS}
        rows={p.rows}
        rowKey={(r) => r.id}
        defaultSort={{ key: 'id', direction: 'asc' }}
        onRowClick={(r) => setSelected(r.id)}
        selectedKey={selected}
        loading={state === 'loading'}
        dense={dense}
        empty={<span>No runs match. <span className="text-ink-4">Try clearing filters.</span></span>}
      />
      <Pagination page={p.page} pageCount={p.pageCount} total={p.total} pageSize={8} onPageChange={setPage} />
    </Demo>
  )
}

function FiguresDemo() {
  const [loading, setLoading] = useState(false)
  return (
    <div className="flex flex-col gap-10">
      <Demo title="Stat" note={<GButton pressed={loading} onClick={() => setLoading((l) => !l)}>Loading</GButton>}>
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Runs this week"
            value="1,284"
            delta={{ value: '12%', direction: 'up', period: 'vs last week' }}
            trend={<Sparkline label="Runs per day, last 14 days" values={daily('stat-runs', 14, 180, 0.4, 3).map((p) => p.v)} />}
            loading={loading}
          />
          <Stat
            label="Spend (estimate)"
            value="$42.18"
            delta={{ value: '$6.02', direction: 'up', goodWhen: 'down', period: 'vs last week' }}
            trend={<Sparkline label="Spend per day, last 14 days" variant="bars" values={[4.1, 3.8, 5.2, 4.9, 6.3, 1.2, 0.8, 5.5, 6.1, 5.8, 7.2, 6.4, 1.9, 1.1]} format={(v) => formatUsd(v)} />}
            loading={loading}
          />
          <Stat label="Median latency" value="1.18" unit="s" delta={{ value: '0.21 s', direction: 'down', goodWhen: 'down', period: 'p50' }} loading={loading} />
          <Stat label="Approvals waiting" value="3" delta={{ value: '0', direction: 'flat', period: 'since yesterday' }} helper="Oldest is 2h old — Ops wants to rotate keys." loading={loading} />
        </div>
        <Stat size="lg" label="Tokens processed · October" value="12.9M" delta={{ value: '31%', direction: 'up', period: 'vs September' }} className="mt-2" loading={loading} />
      </Demo>
      <Demo title="Meter · thresholds → done / attn / fail with glyph + label">
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
          <Meter label="Context window" value={41_200} max={200_000} valueLabel="41.2K / 200K" statusLabels={{ done: 'Plenty of room' }} />
          <Meter label="Monthly budget" value={42.18} max={50} valueLabel="$42.18 of $50" statusLabels={{ attn: 'Approaching limit' }} />
          <Meter label="Error budget burned" value={0.97} statusLabels={{ fail: 'Exhausted — freeze deploys' }} />
          <Meter label="Test coverage" value={0.71} goodWhen="high" thresholds={{ attn: 0.8, fail: 0.6 }} statusLabels={{ attn: 'Below 80% target' }} />
          <Meter label="Indexing" value={0.62} tone="accent" valueLabel="1,354 / 2,184 docs" size="sm" />
        </div>
      </Demo>
    </div>
  )
}

function ActivityDemo() {
  const items = useMemo(() => makeActivity(), [])
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Demo title="ActivityFeed">
        <ActivityFeed items={items} />
      </Demo>
      <div className="flex min-w-0 flex-col gap-10">
        <Demo title="ActivityFeed · compact">
          <ActivityFeed items={items.slice(0, 4)} compact />
        </Demo>
        <Demo title="ActivityFeed · loading / empty">
          <ActivityFeed items={[]} loading compact />
          <ActivityFeed items={[]} />
        </Demo>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------------------------------ */
/* Chart fixtures (seeded, realistic)                                                         */
/* ------------------------------------------------------------------------------------------ */

const TODAY = (() => {
  const d = new Date(NOW)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
})()

function daily(seed: string, days: number, base: number, amp: number, trend = 0): { t: number; v: number }[] {
  const rng = createRng(seed)
  return Array.from({ length: days }, (_, i) => {
    const t = TODAY - (days - 1 - i) * DAY
    const dow = new Date(t).getDay()
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1
    const v = Math.max(0, (base + trend * i) * weekend * (1 + (rng.next() - 0.5) * amp))
    return { t, v: Math.round(v) }
  })
}

const TOKEN_SERIES: TimeSeries[] = [
  { id: 'sonnet', label: 'Claude Sonnet', points: daily('sonnet', 30, 410_000, 0.35, 6_000) },
  { id: 'haiku', label: 'Claude Haiku', points: daily('haiku', 30, 220_000, 0.4, -1_500) },
  { id: 'compat', label: 'OpenAI-compatible', points: daily('compat', 30, 90_000, 0.6, 1_200) },
]

const SPEND_SERIES: TimeSeries[] = [
  {
    id: 'spend',
    label: 'Spend (estimate)',
    points: Array.from({ length: 48 }, (_, i) => {
      const t = TODAY + (new Date(NOW).getHours() + 1) * HOUR - (47 - i) * HOUR
      const h = new Date(t).getHours()
      const day = h >= 8 && h <= 19 ? 1 : 0.25
      const rng = createRng(`spend${i}`)
      return { t, v: Math.round((0.35 + rng.next() * 0.9) * day * 100) / 100 }
    }),
  },
]

const AGENT_WEEKLY: TimeSeries[] = ['Research', 'Coder', 'Ops', 'Writer'].map((label, k) => {
  const rng = createRng(`weekly-${label}`)
  return {
    id: label.toLowerCase(),
    label,
    points: Array.from({ length: 12 }, (_, i) => ({ t: TODAY - (11 - i) * 7 * DAY, v: Math.round((30 + k * 14) * (0.7 + i * 0.05) * (0.8 + rng.next() * 0.4)) })),
  }
})

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function makeWeekdayHour(): WeekdayHourCell[] {
  const rng = createRng('heat')
  const cells: WeekdayHourCell[] = []
  for (let day = 0; day < 7; day++)
    for (let hour = 0; hour < 24; hour++) {
      const work = hour >= 9 && hour <= 18 ? 1 : hour >= 7 && hour <= 21 ? 0.45 : 0.08
      const weekday = day < 5 ? 1 : 0.3
      const lunch = hour === 12 ? 0.6 : 1
      const v = Math.round(work * weekday * lunch * (6 + rng.next() * 30))
      cells.push({ day, hour, value: rng.chance(0.06) ? 0 : v })
    }
  return cells
}

function makeCalendar(): CalendarCell[] {
  const rng = createRng('calendar')
  return Array.from({ length: 26 * 7 }, (_, i) => {
    const t = TODAY - i * DAY
    const dow = new Date(t).getDay()
    const base = dow === 0 || dow === 6 ? 2 : 14
    return { date: t, value: rng.chance(0.12) ? 0 : Math.round(base * (0.3 + rng.next() * 1.4) * (1 - i / 400)) }
  })
}

/* ------------------------------------------------------------------------------------------ */
/* Chart demos                                                                                */
/* ------------------------------------------------------------------------------------------ */

function ChartStates() {
  const [state, setState] = useState<'loading' | 'empty'>('loading')
  return (
    <Demo
      title="States · loading / empty"
      note={
        <span className="flex gap-1.5">
          <GButton pressed={state === 'loading'} onClick={() => setState('loading')}>
            Loading
          </GButton>
          <GButton pressed={state === 'empty'} onClick={() => setState('empty')}>
            Empty
          </GButton>
        </span>
      }
    >
      <div className="grid gap-10 md:grid-cols-2">
        <TimeSeriesChart title="Runs per day" series={[]} loading={state === 'loading'} height={180} empty="No runs in the last 30 days" />
        <BarChart title="Cost by project" categories={[]} series={[]} loading={state === 'loading'} height={180} empty="No spend recorded yet" />
      </div>
    </Demo>
  )
}

function ChartsDemo() {
  const heat = useMemo(() => makeWeekdayHour(), [])
  const calendar = useMemo(() => makeCalendar(), [])
  const thisWeek = [42, 51, 47, 58, 39, 12, 8]
  const lastWeek = [38, 44, 52, 41, 45, 9, 11]
  return (
    <div className="flex flex-col gap-12">
      <Demo title="TimeSeriesChart · lines" note="crosshair + all-series tooltip · ← → keys · legend toggles">
        <TimeSeriesChart
          title="Tokens per day by model"
          description="Last 30 days · input + output"
          series={TOKEN_SERIES}
          format={(v) => `${formatCompact(v)} tok`}
          height={260}
        />
      </Demo>
      <div className="grid gap-12 lg:grid-cols-2">
        <Demo title="TimeSeriesChart · area (single series)">
          <TimeSeriesChart title="Spend per hour" description="Last 48 hours · estimate" series={SPEND_SERIES} variant="area" format={(v) => formatUsd(v)} height={220} />
        </Demo>
        <Demo title="TimeSeriesChart · stacked area">
          <TimeSeriesChart title="Runs per week by agent" description="Last 12 weeks" series={AGENT_WEEKLY} variant="stacked-area" height={220} />
        </Demo>
      </div>
      <div className="grid gap-12 lg:grid-cols-2">
        <Demo title="BarChart · grouped columns">
          <BarChart
            title="Runs by weekday"
            description="This week vs last week"
            categories={WEEKDAYS}
            series={[
              { id: 'this', label: 'This week', values: thisWeek },
              { id: 'last', label: 'Last week', values: lastWeek },
            ]}
            height={220}
          />
        </Demo>
        <Demo title="BarChart · horizontal, value labels">
          <BarChart
            title="Cost by project"
            description="October · estimate"
            orientation="horizontal"
            categories={['Atrium launch', 'Billing refactor', 'Research: vector DBs', 'Support automation', 'Docs site']}
            series={[{ id: 'cost', label: 'Cost', values: [18.4, 11.2, 7.95, 3.1, 1.42] }]}
            format={(v) => formatUsd(v)}
            valueLabels
          />
        </Demo>
      </div>
      <div className="grid gap-12 lg:grid-cols-2">
        <Demo title="BarChart · stacked">
          <BarChart
            title="Tokens by kind per agent"
            categories={['Research', 'Coder', 'Ops', 'Writer', 'Triage']}
            series={[
              { id: 'in', label: 'Input', values: [820_000, 1_240_000, 210_000, 380_000, 160_000] },
              { id: 'out', label: 'Output', values: [190_000, 420_000, 40_000, 260_000, 30_000] },
              { id: 'cache', label: 'Cache reads', values: [560_000, 980_000, 90_000, 120_000, 60_000] },
            ]}
            mode="stacked"
            format={(v) => formatCompact(v)}
            valueLabels
            height={240}
          />
        </Demo>
        <Demo title="DonutChart · folds past 6 into Other">
          <DonutChart
            title="Knowledge by collection"
            description="Documents indexed"
            slices={[
              { label: 'Engineering handbook', value: 412 },
              { label: 'Customer interviews', value: 268 },
              { label: 'Research papers', value: 191 },
              { label: 'Product specs', value: 144 },
              { label: 'Meeting notes', value: 96 },
              { label: 'Support macros', value: 41 },
              { label: 'Legal', value: 18 },
              { label: 'Archive', value: 12 },
            ]}
            centerLabel="Documents"
          />
        </Demo>
      </div>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Demo title="Heatmap · weekday × hour">
          <Heatmap mode="weekday-hour" title="When agents run" description="Runs started, last 4 weeks" data={heat} unit="runs" />
        </Demo>
        <Demo title="Heatmap · calendar">
          <Heatmap mode="calendar" title="Daily runs" description="Last 26 weeks" data={calendar} unit="runs" />
        </Demo>
      </div>
      <Demo title="Sparkline · line, area, bars">
        <div className="grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-3">
          {[
            { label: 'Runs per day, 14 days', node: <Sparkline label="Runs per day, last 14 days" values={daily('sp1', 14, 40, 0.5).map((p) => p.v)} /> },
            { label: 'Latency p50, 14 days', node: <Sparkline label="Median latency, last 14 days" values={[1.42, 1.38, 1.4, 1.31, 1.29, 1.33, 1.25, 1.21, 1.24, 1.19, 1.22, 1.17, 1.2, 1.18]} area format={(v) => `${v.toFixed(2)} s`} /> },
            { label: 'Approvals per day', node: <Sparkline label="Approvals per day, last 14 days" values={[3, 5, 2, 6, 4, 1, 0, 4, 7, 5, 3, 6, 2, 3]} variant="bars" /> },
          ].map((x) => (
            <div key={x.label} className="flex flex-col gap-2">
              <span className="text-xs text-ink-3">{x.label}</span>
              {x.node}
            </div>
          ))}
        </div>
      </Demo>
      <ChartStates />
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */

export default function Section() {
  const topRef = useRef<HTMLDivElement>(null)
  return (
    <section ref={topRef} aria-labelledby="gallery-display" className="flex flex-col gap-16">
      <header className="flex flex-col gap-2 border-t border-line pt-8">
        <span className="font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase">Track A2</span>
        <h2 id="gallery-display" className="font-serif text-4xl text-ink">
          Display, charts &amp; art
        </h2>
        <p className="max-w-[62ch] text-sm text-ink-3 text-pretty">
          Instruments for reading: documents, code, diffs, terminals, trees, tables and figures — then charts and generative art.
        </p>
      </header>
      <Group title="Documents & code">
        <MarkdownDemo />
        <CodeDemo />
      </Group>
      <Group title="Diffs">
        <DiffDemo />
      </Group>
      <Group title="Terminal & logs">
        <TerminalDemo />
      </Group>
      <Group title="Trees & tables">
        <TreeDemo />
        <TableDemo />
      </Group>
      <Group title="Figures & activity">
        <FiguresDemo />
        <ActivityDemo />
      </Group>
      <Group title="Charts">
        <ChartsDemo />
      </Group>
    </section>
  )
}

import { describe, expect, it } from 'vitest'
import {
  buildDiffLines,
  collapseContext,
  computeDiffStats,
  countLines,
  diffStatCells,
  formatHunkHeader,
  pairLines,
  parseUnifiedDiff,
  patchFileName,
  segmentsFromPatch,
  splitLines,
  unifiedWordRanges,
  wordRanges,
} from './diff'

const lines = (n: number, f = (i: number) => `line ${i + 1}`) => Array.from({ length: n }, (_, i) => f(i)).join('\n') + '\n'

describe('splitLines / countLines', () => {
  it('ignores the trailing newline and handles CRLF', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([])
    expect(countLines('x')).toBe(1)
  })
})

describe('computeDiffStats', () => {
  it('counts added and removed lines', () => {
    expect(computeDiffStats('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual({ additions: 2, deletions: 1 })
  })
  it('is zero for identical text', () => {
    expect(computeDiffStats('same\ntext\n', 'same\ntext\n')).toEqual({ additions: 0, deletions: 0 })
  })
  it('treats a new file as all additions and a deleted file as all deletions', () => {
    expect(computeDiffStats('', 'one\ntwo\nthree\n')).toEqual({ additions: 3, deletions: 0 })
    expect(computeDiffStats('one\ntwo\n', '')).toEqual({ additions: 0, deletions: 2 })
  })
  it('ignores a missing newline at end of file', () => {
    expect(computeDiffStats('a\nb', 'a\nb\n')).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('buildDiffLines', () => {
  it('numbers old and new lines independently', () => {
    const out = buildDiffLines('a\nb\nc\n', 'a\nx\ny\nc\n')!
    expect(out.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ['context', 1, 1, 'a'],
      ['del', 2, null, 'b'],
      ['add', null, 2, 'x'],
      ['add', null, 3, 'y'],
      ['context', 3, 4, 'c'],
    ])
  })
})

describe('collapseContext', () => {
  it('keeps 3 lines of context around a change and collapses the rest', () => {
    const before = lines(30)
    const after = before.replace('line 15\n', 'line fifteen\n')
    const segs = collapseContext(buildDiffLines(before, after)!, 3)
    expect(segs.map((s) => s.type)).toEqual(['gap', 'lines', 'gap'])
    const [g1, mid, g2] = segs
    expect(g1.type === 'gap' && g1.count).toBe(11)
    expect(mid.type === 'lines' && mid.lines.length).toBe(8) // 3 + del + add + 3
    expect(g2.type === 'gap' && g2.count).toBe(12)
    if (mid.type === 'lines') expect(formatHunkHeader(mid.hunk)).toBe('@@ -12,7 +12,7 @@')
  })

  it('does not hide runs shorter than minHidden', () => {
    const before = lines(12)
    const after = before.replace('line 2\n', 'line two\n').replace('line 11\n', 'line eleven\n')
    const segs = collapseContext(buildDiffLines(before, after)!, 3, 4)
    // Lines 6–7 are the only far-from-change run (2 lines) → stays visible as one hunk.
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('lines')
  })

  it('collapses an unchanged file into a single gap', () => {
    const t = lines(20)
    const segs = collapseContext(buildDiffLines(t, t)!, 3)
    expect(segs).toHaveLength(1)
    expect(segs[0].type === 'gap' && segs[0].count).toBe(20)
  })
})

describe('pairLines', () => {
  it('pairs deletions with additions and pads the shorter side', () => {
    const out = buildDiffLines('a\nb\nc\nz\n', 'a\nB\nz\n')!
    const rows = pairLines(out)
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['b', 'B'],
      ['c', null],
      ['z', 'z'],
    ])
  })
})

describe('wordRanges', () => {
  it('finds the changed word inside similar lines', () => {
    const r = wordRanges('const total = price * qty', 'const total = price * quantity')!
    expect(r.old).toEqual([[22, 25]])
    expect(r.new).toEqual([[22, 30]])
  })
  it('gives up when the lines share little', () => {
    expect(wordRanges('return a + b', 'throw new Error("nope")')).toBeNull()
  })
  it('maps partners in unified view', () => {
    const out = buildDiffLines('let x = 1\n', 'let x = 2\n')!
    const map = unifiedWordRanges(out)
    expect(map.get(out[0])).toEqual([[8, 9]])
    expect(map.get(out[1])).toEqual([[8, 9]])
  })
})

describe('diffStatCells', () => {
  it('splits five cells proportionally', () => {
    expect(diffStatCells(12, 3)).toEqual(['add', 'add', 'add', 'add', 'del'])
    expect(diffStatCells(0, 9)).toEqual(['del', 'del', 'del', 'del', 'del'])
  })
  it('keeps both kinds visible and pads small diffs with neutral cells', () => {
    expect(diffStatCells(100, 1)).toEqual(['add', 'add', 'add', 'add', 'del'])
    expect(diffStatCells(1, 1)).toEqual(['add', 'del', 'neutral', 'neutral', 'neutral'])
    expect(diffStatCells(0, 0)).toEqual(['neutral', 'neutral', 'neutral', 'neutral', 'neutral'])
  })
})

describe('patches', () => {
  const patch = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,3 +10,4 @@ export function boot() {
   init()
-  start()
+  start({ warm: true })
+  ready()
   done()
`
  it('parses a git patch into segments with numbering', () => {
    const [p] = parseUnifiedDiff(patch)
    expect(patchFileName(p)).toBe('src/app.ts')
    const segs = segmentsFromPatch(p)
    expect(segs[0]).toMatchObject({ type: 'gap', count: 9, expandable: false })
    const hunk = segs[1]
    expect(hunk.type).toBe('lines')
    if (hunk.type === 'lines') {
      expect(hunk.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
        ['context', 10, 10],
        ['del', 11, null],
        ['add', null, 11],
        ['add', null, 12],
        ['context', 12, 13],
      ])
    }
  })
})

describe('lenient patch parsing', () => {
  const wrongCounts = `--- a/src/run.ts
+++ b/src/run.ts
@@ -88,7 +88,9 @@ export class RunEngine {
   resume(runId: string) {
-    if (!run) return
+    if (!run || run.status === 'cancelled') return
+    const from = run.steps.findIndex((s) => s.status !== 'done')
   }
`
  it('recovers hunks whose declared counts are wrong', () => {
    const [p] = parseUnifiedDiff(wrongCounts)
    expect(p).toBeDefined()
    expect(patchFileName(p)).toBe('src/run.ts')
    expect(p.hunks[0]).toMatchObject({ oldStart: 88, oldLines: 3, newStart: 88, newLines: 4 })
    const segs = segmentsFromPatch(p)
    const hunk = segs.find((s) => s.type === 'lines')
    expect(hunk?.type === 'lines' && hunk.lines.map((l) => l.kind)).toEqual(['context', 'del', 'add', 'add', 'context'])
  })
  it('returns nothing for text that is not a diff', () => {
    expect(parseUnifiedDiff('hello world\nthis is not a patch')).toEqual([])
  })
  it('splits multi-file patches', () => {
    const two = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-a
+b
diff --git a/y.ts b/y.ts
--- a/y.ts
+++ b/y.ts
@@ -1 +1,2 @@
 c
+d
`
    expect(parseUnifiedDiff(two).map(patchFileName)).toEqual(['x.ts', 'y.ts'])
  })
})

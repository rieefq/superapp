import { describe, expect, it } from 'vitest'
import {
  classifyLogLine,
  collectExpandableIds,
  compareValues,
  dayLabel,
  deltaTone,
  fileKind,
  flattenTree,
  groupByDay,
  meterTone,
  paginate,
  sortRows,
  splitTimestamp,
} from './logic'
import { highlightLines, languageFromPath, languageLabel, matchRanges, overlayRanges } from './highlight'

describe('classifyLogLine', () => {
  it.each([
    ['✓ src/ui/display/diff.test.ts (16 tests) 43ms', 'done'],
    ['Tests  24 passed (24)', 'done'],
    ['PASS  src/core/runs/engine.test.ts', 'done'],
    ['× handles fractional ranges without float noise', 'fail'],
    ['Tests  1 failed | 23 passed (24)', 'fail'],
    ['FAIL  src/app.test.ts > boots', 'fail'],
    ["TypeError: Cannot read properties of undefined (reading 'id')", 'fail'],
    ['npm ERR! code ELIFECYCLE', 'fail'],
    ['12 passed, 0 failed', 'done'],
    ['Build finished with no errors', 'plain'],
    ['warning: unused variable `x`', 'attn'],
    ['⚠ 2 deprecated packages', 'attn'],
    ['    at Object.<anonymous> (src/app.ts:4:11)', 'dim'],
    ['# comment line', 'dim'],
    ['Compiling 214 modules…', 'plain'],
    ['', 'plain'],
  ])('%s → %s', (line, tone) => {
    expect(classifyLogLine(line)).toBe(tone)
  })

  it('classifies after stripping a timestamp', () => {
    expect(classifyLogLine('10:42:01 ✓ ready in 412ms')).toBe('done')
    expect(classifyLogLine('[2026-11-01T10:42:01Z] ERROR connection refused')).toBe('fail')
  })
})

describe('splitTimestamp', () => {
  it('splits clock and ISO prefixes', () => {
    expect(splitTimestamp('10:42:01 server up')).toEqual({ ts: '10:42:01', rest: 'server up' })
    expect(splitTimestamp('[2026-11-01 10:42:01.120] hi')).toEqual({ ts: '[2026-11-01 10:42:01.120]', rest: 'hi' })
    expect(splitTimestamp('no ts here')).toEqual({ rest: 'no ts here' })
  })
})

describe('fileKind', () => {
  it.each([
    ['src/app.tsx', 'code'],
    ['src/diff.test.ts', 'test'],
    ['README.md', 'doc'],
    ['package-lock.json', 'lock'],
    ['package.json', 'data'],
    ['Dockerfile', 'config'],
    ['.env.local', 'env'],
    ['.gitignore', 'config'],
    ['vite.config.ts', 'config'],
    ['logo.svg', 'markup'],
    ['hero.png', 'image'],
    ['styles/tokens.css', 'style'],
    ['deploy.sh', 'shell'],
    ['schema.sql', 'database'],
    ['unknown.blob', 'file'],
  ])('%s → %s', (name, kind) => {
    expect(fileKind(name)).toBe(kind)
  })
  it('folders', () => expect(fileKind('src', true)).toBe('folder'))
})

describe('flattenTree', () => {
  const tree = [
    {
      id: 'src',
      label: 'src',
      children: [
        { id: 'ui', label: 'ui', children: [{ id: 'button', label: 'Button.tsx' }, { id: 'diff', label: 'DiffView.tsx' }] },
        { id: 'main', label: 'main.tsx' },
      ],
    },
    { id: 'readme', label: 'README.md' },
    { id: 'lazy', label: 'vendor', hasChildren: true },
  ]

  it('shows only expanded branches with aria positions', () => {
    const rows = flattenTree(tree, new Set(['src']))
    expect(rows.map((r) => [r.node.id, r.depth, r.posInSet, r.setSize, r.expanded])).toEqual([
      ['src', 1, 1, 3, true],
      ['ui', 2, 1, 2, false],
      ['main', 2, 2, 2, false],
      ['readme', 1, 2, 3, false],
      ['lazy', 1, 3, 3, false],
    ])
    expect(rows.find((r) => r.node.id === 'lazy')!.expandable).toBe(true)
  })

  it('filters to matches plus ancestors and force-expands them', () => {
    const rows = flattenTree(tree, new Set(), 'diff')
    expect(rows.map((r) => r.node.id)).toEqual(['src', 'ui', 'diff'])
    expect(rows[0].expanded).toBe(true)
    expect(rows[2].setSize).toBe(1)
  })

  it('handles 2,000 nodes quickly', () => {
    const big = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`,
      label: `dir-${i}`,
      children: Array.from({ length: 50 }, (_, j) => ({ id: `d${i}f${j}`, label: `file-${i}-${j}.ts` })),
    }))
    const all = new Set(collectExpandableIds(big))
    const t0 = performance.now()
    const rows = flattenTree(big, all)
    const filtered = flattenTree(big, new Set(), '-7.ts')
    expect(rows).toHaveLength(2040)
    expect(filtered.length).toBeGreaterThan(40)
    expect(performance.now() - t0).toBeLessThan(150)
  })
})

describe('sortRows / compareValues / paginate', () => {
  const rows = [
    { name: 'run-10', cost: 2.5, at: null as number | null },
    { name: 'run-2', cost: 12, at: 3 },
    { name: 'Run-1', cost: 0.4, at: 1 },
  ]
  it('sorts strings naturally and numbers numerically', () => {
    expect(sortRows(rows, (r) => r.name, 'asc').map((r) => r.name)).toEqual(['Run-1', 'run-2', 'run-10'])
    expect(sortRows(rows, (r) => r.cost, 'desc').map((r) => r.cost)).toEqual([12, 2.5, 0.4])
  })
  it('keeps empty values last in both directions', () => {
    expect(sortRows(rows, (r) => r.at, 'asc').map((r) => r.at)).toEqual([1, 3, null])
    expect(sortRows(rows, (r) => r.at, 'desc').map((r) => r.at)).toEqual([3, 1, null])
  })
  it('compares dates and booleans', () => {
    expect(compareValues(new Date(1), new Date(2))).toBeLessThan(0)
    expect(compareValues(true, false)).toBeGreaterThan(0)
  })
  it('paginates with clamping', () => {
    const list = Array.from({ length: 53 }, (_, i) => i)
    expect(paginate(list, 3, 25)).toMatchObject({ page: 3, pageCount: 3, from: 51, to: 53, total: 53 })
    expect(paginate(list, 99, 25).page).toBe(3)
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pageCount: 1, from: 0, to: 0 })
  })
})

describe('groupByDay / dayLabel', () => {
  const now = new Date(2026, 10, 1, 15, 0).getTime() // Sun Nov 1 2026, 15:00 local
  it('labels relative days', () => {
    expect(dayLabel(now - 3_600_000, now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 31, 23).getTime(), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 9, 28).getTime(), now, 'en-US')).toBe('Wednesday')
    expect(dayLabel(new Date(2026, 8, 3).getTime(), now, 'en-US')).toBe('Sep 3')
    expect(dayLabel(new Date(2025, 8, 3).getTime(), now, 'en-US')).toBe('Sep 3, 2025')
  })
  it('groups newest first', () => {
    const items = [
      { id: 'a', at: new Date(2026, 9, 31, 9).getTime() },
      { id: 'b', at: new Date(2026, 10, 1, 9).getTime() },
      { id: 'c', at: new Date(2026, 10, 1, 14).getTime() },
    ]
    const g = groupByDay(items, now)
    expect(g.map((x) => [x.label, x.items.map((i) => i.id)])).toEqual([
      ['Today', ['c', 'b']],
      ['Yesterday', ['a']],
    ])
  })
})

describe('deltaTone / meterTone', () => {
  it('is good when the direction matches goodWhen', () => {
    expect(deltaTone('up', 'up')).toBe('good')
    expect(deltaTone('up', 'down')).toBe('bad')
    expect(deltaTone('flat', 'down')).toBe('neutral')
  })
  it('crosses thresholds upward for usage meters', () => {
    expect(meterTone(0.5)).toBe('done')
    expect(meterTone(0.8)).toBe('attn')
    expect(meterTone(0.95)).toBe('fail')
  })
  it('crosses thresholds downward for health meters', () => {
    const t = { attn: 0.8, fail: 0.6 }
    expect(meterTone(0.92, t, 'high')).toBe('done')
    expect(meterTone(0.7, t, 'high')).toBe('attn')
    expect(meterTone(0.5, t, 'high')).toBe('fail')
  })
})

describe('highlight', () => {
  it('colors keywords, strings, numbers, calls and comments with syntax vars', () => {
    const [line] = highlightLines("const n = sum(2, 'a') // c", 'ts')
    const find = (t: string) => line.find((tok) => tok.text.includes(t))
    expect(find('const')?.color).toBe('var(--syn-keyword)')
    expect(find('sum')?.color).toBe('var(--syn-function)')
    expect(find('2')?.color).toBe('var(--syn-number)')
    expect(find('a')?.color).toBe('var(--syn-string)')
    expect(find('// c')?.color).toBe('var(--syn-comment)')
    expect(line.map((t) => t.text).join('')).toBe("const n = sum(2, 'a') // c")
  })
  it('keeps one token list per line and plain text for unknown languages', () => {
    expect(highlightLines('a\nb', 'nope')).toHaveLength(2)
    expect(highlightLines('x = 1\ny = 2', 'python')).toHaveLength(2)
  })
  it('labels and detects languages', () => {
    expect(languageLabel('ts')).toBe('TypeScript')
    expect(languageLabel('tsx')).toBe('TSX')
    expect(languageFromPath('src/ui/DiffView.tsx')).toBe('tsx')
    expect(languageFromPath('Dockerfile')).toBe('dockerfile')
    expect(languageFromPath('notes.unknownext')).toBeUndefined()
  })
  it('overlays ranges across token boundaries', () => {
    const out = overlayRanges([{ text: 'hello ' }, { text: 'world' }], [[4, 8]])
    expect(out.map((t) => [t.text, !!t.mark])).toEqual([
      ['hell', false],
      ['o ', true],
      ['wo', true],
      ['rld', false],
    ])
    expect(matchRanges('Button.tsx button', 'butt')).toEqual([
      [0, 4],
      [11, 15],
    ])
  })
})

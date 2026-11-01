import { beforeEach, describe, expect, it } from 'vitest'
import { buildExport } from '@/app/shell/exportData'
import { useContextStore } from '@/core/context'
import { db, emptyTables, SCHEMA_VERSION, TABLE_NAMES, useDB } from '@/core/db'
import { useSecretsStore } from '@/core/secrets'
import { fx } from '@/core/services/testFixtures'
import { DEFAULT_SETTINGS, getSettings, useSettingsStore } from '@/core/settings'
import { applyImport, checkImport, eraseEverything, sanitizeSettings, storageReport } from './data'

function seedSmallWorld() {
  const tables = emptyTables()
  tables.projects = { prj_1: fx.project() }
  tables.tasks = { tsk_1: fx.task(), tsk_2: fx.task({ id: 'tsk_2', title: 'Second' }) }
  tables.agents = { agt_1: fx.agent() }
  tables.runs = { run_1: fx.run() }
  db.replaceAll(tables)
}

beforeEach(() => {
  localStorage.clear()
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  useSecretsStore.getState().clearAll()
  useContextStore.getState().setScope(null)
  useContextStore.getState().clear()
})

describe('checkImport', () => {
  it('accepts a real export and summarizes it', () => {
    seedSmallWorld()
    useContextStore.getState().setScope('prj_1')
    useContextStore.getState().pin({ kind: 'task', id: 'tsk_1' })
    const text = JSON.stringify(buildExport(new Date('2026-11-01T12:00:00Z')))
    const result = checkImport(text, 'atrium-export.json')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary).toMatchObject({ fileName: 'atrium-export.json', total: 5, exportedAt: '2026-11-01T12:00:00.000Z', missingTables: [], ignoredTables: [] })
    expect(result.summary.counts.tasks).toBe(2)
    expect(result.payload.context).toEqual({ scopeProjectId: 'prj_1', held: [{ kind: 'task', id: 'tsk_1' }] })
    expect(result.payload.settings?.appearance.theme).toBe('dark')
  })

  it('rejects files that are not JSON, not Atrium, or another data format', () => {
    expect(checkImport('{nope', 'x.json')).toMatchObject({ ok: false, error: expect.stringContaining('valid JSON') })
    expect(checkImport('[]', 'x.json')).toMatchObject({ ok: false, error: expect.stringContaining('isn’t an Atrium export') })
    expect(checkImport(JSON.stringify({ app: 'other', data: {} }), 'x.json')).toMatchObject({ ok: false })
    expect(checkImport(JSON.stringify({ app: 'atrium', schemaVersion: SCHEMA_VERSION + 1, data: {} }), 'x.json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('newer version'),
    })
    expect(checkImport(JSON.stringify({ app: 'atrium', schemaVersion: 0, data: {} }), 'x.json')).toMatchObject({ ok: false, error: expect.stringContaining('older') })
    expect(checkImport(JSON.stringify({ app: 'atrium', schemaVersion: SCHEMA_VERSION }), 'x.json')).toMatchObject({ ok: false, error: expect.stringContaining('no data') })
  })

  it('rejects damaged rows and refuses oversized files', () => {
    const base = { app: 'atrium', schemaVersion: SCHEMA_VERSION }
    const wrongId = checkImport(JSON.stringify({ ...base, data: { tasks: { tsk_1: { ...fx.task(), id: 'tsk_9' } } } }), 'x.json')
    expect(wrongId).toMatchObject({ ok: false, detail: expect.stringContaining('1 row in Tasks') })
    const badRun = checkImport(JSON.stringify({ ...base, data: { runs: { run_1: { ...fx.run(), steps: 'nope' } } } }), 'x.json')
    expect(badRun).toMatchObject({ ok: false, detail: expect.stringContaining('Runs') })
    const notTable = checkImport(JSON.stringify({ ...base, data: { projects: [] } }), 'x.json')
    expect(notTable).toMatchObject({ ok: false })
    expect(checkImport('{}', 'big.json', 30 * 1024 * 1024)).toMatchObject({ ok: false, error: expect.stringContaining('too large') })
  })

  it('reports missing tables (imported empty) and ignores unknown ones', () => {
    const r = checkImport(JSON.stringify({ app: 'atrium', schemaVersion: SCHEMA_VERSION, data: { projects: { prj_1: fx.project() }, widgets: {} } }), 'x.json')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.summary.ignoredTables).toEqual(['widgets'])
    expect(r.summary.missingTables).toHaveLength(TABLE_NAMES.length - 1)
    expect(r.payload.tables.tasks).toEqual({})
  })
})

describe('sanitizeSettings', () => {
  it('keeps valid values and falls back to defaults for anything else', () => {
    const s = sanitizeSettings({
      profile: { name: '  Ada  ', hue: 'rose', email: 'ada@example.com', extra: 1 },
      appearance: { theme: 'blue', density: 'compact' },
      ai: { effort: 'high', showReasoning: 'yes' },
      safety: { alwaysAsk: ['knowledge.read', 'teleport'], monthlyBudgetUsd: -5, defaultAutonomy: 'autonomous' },
      simulation: { speed: 99 },
      onboarded: true,
      junk: { a: 1 },
    })
    expect(s.profile).toEqual({ name: 'Ada', hue: 'rose', email: 'ada@example.com' })
    expect(s.appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, density: 'compact' })
    expect(s.ai).toEqual({ ...DEFAULT_SETTINGS.ai, effort: 'high' })
    expect(s.safety.alwaysAsk).toEqual(['knowledge.read'])
    expect(s.safety.monthlyBudgetUsd).toBe(DEFAULT_SETTINGS.safety.monthlyBudgetUsd)
    expect(s.safety.defaultAutonomy).toBe('autonomous')
    expect(s.simulation.speed).toBe(DEFAULT_SETTINGS.simulation.speed)
    expect(s.onboarded).toBe(true)
    expect('junk' in s).toBe(false)
  })
})

describe('applyImport', () => {
  it('replaces the data, persists it, restores scope and held items that resolve, and keeps settings unless asked', () => {
    seedSmallWorld()
    useContextStore.getState().setScope('prj_1')
    useContextStore.getState().pin({ kind: 'task', id: 'tsk_1' })
    const exported = buildExport()
    exported.settings = { ...exported.settings, appearance: { ...exported.settings.appearance, theme: 'light' } }
    exported.context.held.push({ kind: 'task', id: 'tsk_gone' })
    const checked = checkImport(JSON.stringify(exported), 'a.json')
    if (!checked.ok) throw new Error(checked.error)

    db.replaceAll(emptyTables())
    useContextStore.getState().setScope(null)
    useContextStore.getState().clear()

    const result = applyImport(checked.payload, { withSettings: false })
    expect(result).toEqual({ unsaved: [], held: 1 })
    expect(db.all('tasks')).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem('atrium.db.tasks')!)).toHaveProperty('tsk_2')
    expect(useContextStore.getState().scopeProjectId).toBe('prj_1')
    expect(useContextStore.getState().pinned.map((p) => p.ref.id)).toEqual(['tsk_1'])
    expect(getSettings().appearance.theme).toBe('dark')

    applyImport(checked.payload, { withSettings: true })
    expect(getSettings().appearance.theme).toBe('light')
  })
})

describe('eraseEverything', () => {
  it('empties every table (persisted, so nothing re-seeds), resets settings and removes API keys', () => {
    seedSmallWorld()
    useSettingsStore.getState().update('appearance', { theme: 'light' })
    useSecretsStore.getState().set('anthropic', 'apiKey', 'sk-ant-test')
    useContextStore.getState().setScope('prj_1')
    eraseEverything()
    expect(db.all('projects')).toHaveLength(0)
    expect(localStorage.getItem('atrium.db.projects')).toBe('{}')
    expect(localStorage.getItem('atrium.db.meta')).toContain(`"version":${SCHEMA_VERSION}`)
    expect(getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(useSecretsStore.getState().secrets).toEqual({})
    expect(useContextStore.getState().scopeProjectId).toBeNull()
  })
})

describe('storageReport', () => {
  it('measures tables largest first and counts API keys without reading them', () => {
    seedSmallWorld()
    localStorage.setItem('atrium.db.tasks', JSON.stringify(db.get('tasks', 'tsk_1')))
    localStorage.setItem('atrium.db.projects', '{}')
    useSecretsStore.getState().set('anthropic', 'apiKey', 'sk-ant-test')
    const r = storageReport(useDB.getState())
    expect(r.tables[0].key).toBe('tasks')
    expect(r.tables.find((t) => t.key === 'tasks')!.rows).toBe(2)
    expect(r.totalRows).toBe(5)
    expect(r.other.find((o) => o.key === 'atrium.secrets')!.rows).toBe(1)
    expect(r.totalBytes).toBeGreaterThan(0)
  })
})


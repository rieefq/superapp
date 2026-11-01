import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Circle } from 'lucide-react'
import { getIcon, ICON_ALIASES, ICONS, resolveIconName } from './DynamicIcon'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : []
  })
}

describe('DynamicIcon', () => {
  it('resolves names and legacy aliases, falling back to Circle', () => {
    expect(getIcon('FolderKanban')).toBe(ICONS.FolderKanban)
    expect(getIcon('BarChart3')).toBe(ICONS.ChartColumn)
    expect(getIcon('Code2')).toBe(ICONS.CodeXml)
    expect(getIcon('NotAnIcon')).toBe(Circle)
    expect(getIcon(undefined)).toBe(Circle)
    expect(resolveIconName('toString')).toBeNull()
  })

  it('every alias points at a curated icon', () => {
    for (const target of Object.values(ICON_ALIASES)) expect(ICONS[target]).toBeDefined()
  })

  it('covers every string icon name used in src/core, src/app and workspace manifests', () => {
    const root = join(__dirname, '..', '..')
    const files = [...walk(join(root, 'core')), ...walk(join(root, 'app')), ...walk(join(root, 'workspaces'))]
    const used = new Set<string>()
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/icon\s*:\s*['"]([A-Z][A-Za-z0-9]+)['"]/g)) used.add(m[1])
    }
    const missing = [...used].filter((n) => resolveIconName(n) === null)
    expect(missing).toEqual([])
  })
})

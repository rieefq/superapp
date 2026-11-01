import { describe, expect, it } from 'vitest'
import { MANIFESTS } from './registry'
import { boundCombos, chordShortcuts, FORBIDDEN_COMBOS, isForbiddenCombo, keysFor } from './shortcuts'

describe('keyboard map (§3.11)', () => {
  it('never binds a reserved combo', () => {
    const bad = boundCombos().filter(isForbiddenCombo)
    expect(bad).toEqual([])
  })

  it('recognizes every forbidden combo, regardless of spelling', () => {
    for (const c of FORBIDDEN_COMBOS) expect(isForbiddenCombo(c)).toBe(true)
    expect(isForbiddenCombo('ctrl+t')).toBe(true)
    expect(isForbiddenCombo('meta+shift+p')).toBe(true)
    expect(isForbiddenCombo('mod+k')).toBe(false)
    expect(isForbiddenCombo('g c')).toBe(false)
  })

  it('binds the spec’s global combos', () => {
    expect(keysFor('command')).toEqual(['mod+k'])
    expect(keysFor('stop')).toEqual(['mod+.'])
    expect(keysFor('inspector')).toEqual(['mod+\\'])
    expect(keysFor('sheet')).toEqual(['mod+/'])
    expect(keysFor('region-next')).toEqual(['f6'])
  })

  it('derives a G chord for every workspace from the manifests', () => {
    const chords = chordShortcuts(MANIFESTS)
    expect(chords).toHaveLength(MANIFESTS.length)
    expect(chords.find((c) => c.path === '/chat')?.keys).toEqual(['g c'])
    expect(chords.find((c) => c.path === '/settings')?.keys).toEqual(['g ,'])
  })
})

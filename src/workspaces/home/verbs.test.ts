import { describe, expect, it } from 'vitest'
import { cycleVerb, routeLine, routeVerb, SHEET_KIND } from './verbs'

describe('Home verbs', () => {
  it('Auto routes with the intent rules and reads back why', () => {
    const r = routeVerb('auto', 'Fix the failing tests in the billing repo')
    expect(r.intent).toBe('build')
    expect(r.auto?.reason).toMatch(/coding task/)
    expect(routeLine(r, 'Atlas Portal v2')).toEqual({ reading: 'Looks like code work', target: 'Build in Atlas Portal v2' })
  })

  it('an explicit verb wins and shows no reading', () => {
    const r = routeVerb('research', 'Fix the failing tests')
    expect(r).toEqual({ intent: 'research' })
    expect(routeLine(r, null)).toEqual({ target: 'Research' })
  })

  it('questions go to Ask', () => {
    expect(routeVerb('auto', 'What is our refund policy?').intent).toBe('ask')
  })

  it('Tab cycles the chips in order and wraps', () => {
    expect(cycleVerb('auto', 1)).toBe('ask')
    expect(cycleVerb('automate', 1)).toBe('auto')
    expect(cycleVerb('auto', -1)).toBe('automate')
  })

  it('maps the sheet verbs to Start sheet kinds', () => {
    expect(SHEET_KIND).toEqual({ research: 'research', build: 'session', delegate: 'agent', organize: 'task' })
  })
})

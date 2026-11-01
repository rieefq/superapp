import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import type { Agent } from '@/core/types'
import { detectIntent, extractSchedule, scheduleToCron, suggestTitle, type Intent } from './intent'

function agent(id: string, name: string): Agent {
  return {
    id, name, role: 'Agent', description: '', hue: 'volt', sigil: 1, modelId: 'sim-swift', instructions: '', capabilities: [],
    knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'balanced', status: 'active', createdAt: 0, updatedAt: 0,
  }
}

describe('detectIntent', () => {
  beforeEach(() => {
    db.replaceAll(emptyTables())
    db.insertMany('agents', [agent('agt_scout', 'Scout'), agent('agt_forge', 'Forge')])
  })

  const cases: Array<[string, Intent]> = [
    // ask
    ['What is our refund policy?', 'ask'],
    ['How do I set up SSO for the portal?', 'ask'],
    ['Draft a launch email for Lumen', 'ask'],
    ['hello', 'ask'],
    ['Summarize the meeting notes from Tuesday', 'ask'],
    // research
    ['Research usage-based pricing trends in B2B SaaS', 'research'],
    ['Investigate why churn spiked in Q4', 'research'],
    ['Analyze the competitive landscape for freight portals', 'research'],
    ['Compare Tidewell and Freightly pricing with sources', 'research'],
    // build
    ['Fix the login redirect bug', 'build'],
    ['Refactor the auth middleware and add unit tests', 'build'],
    ['Why is the checkout e2e test flaky?', 'build'],
    ['Open a PR that adds a /health endpoint', 'build'],
    ['Deploy the latest build to staging', 'build'],
    // automate
    ['Every Monday at 9am, research competitor pricing and post a summary to Slack', 'automate'],
    ['Whenever a high-priority ticket arrives, alert the on-call channel', 'automate'],
    ['Automate the weekly digest of project updates', 'automate'],
    ['When a PR is opened then run the review checklist', 'automate'],
    ['Send me a daily summary of failed runs at 8am', 'automate'],
    // create
    ['Design a logo for Atlas Lumen', 'create'],
    ['Make slides for the board meeting', 'create'],
    ['Create a storyboard for the hero video', 'create'],
    ['Write copy for the Lumen landing page', 'create'],
    // delegate
    ['Have Scout look into the EU e-invoicing mandate', 'delegate'],
    ['Keep an eye on support tickets tagged urgent', 'delegate'],
    ['Follow up with Meridian Freight about the renewal', 'delegate'],
    ['Ask an agent to handle the inbox triage on my behalf', 'delegate'],
    // organize
    ['Remind me to send the board update every Friday', 'organize'],
    ['Create a task to fix the login bug', 'organize'],
    ['Add a milestone for the beta launch on Dec 1', 'organize'],
    ['Save this as a note in my Field Notes project', 'organize'],
    ['todo: update the pricing page', 'organize'],
  ]

  it.each(cases)('%s → %s', (text, expected) => {
    const result = detectIntent(text)
    expect(result.intent).toBe(expected)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
    expect(result.reason.length).toBeGreaterThan(10)
  })

  it('is more confident for strong, unambiguous cues', () => {
    expect(detectIntent('Every Monday at 9am, research competitor pricing and post a summary to Slack').confidence).toBeGreaterThan(0.8)
    expect(detectIntent('Fix the bug').confidence).toBeLessThan(detectIntent('Fix the flaky checkout test in the repo and open a PR').confidence)
  })

  it('suggests a title and a schedule with cron', () => {
    const r = detectIntent('Every Monday at 9am, research competitor pricing and post a summary to Slack')
    expect(r.suggestions).toEqual({
      title: 'Research competitor pricing and post a summary to Slack',
      schedule: 'Every Monday at 9am',
      cron: '0 9 * * 1',
    })
    expect(detectIntent('Create a task to fix the login bug').suggestions?.title).toBe('Fix the login bug')
    expect(detectIntent('Remind me to send the board update every Friday').suggestions).toMatchObject({ title: 'Send the board update', schedule: 'every Friday', cron: '0 9 * * 5' })
  })

  it('cites the matched cues in the reason', () => {
    expect(detectIntent('Design a logo for Atlas Lumen').reason).toContain('logo')
    expect(detectIntent('What is our refund policy?').reason).toMatch(/question/)
  })

  it('handles empty input', () => {
    expect(detectIntent('   ')).toMatchObject({ intent: 'ask' })
  })
})

describe('schedules', () => {
  it('extracts schedule phrases as written', () => {
    expect(extractSchedule('Post the digest every Monday at 9am please')).toBe('every Monday at 9am')
    expect(extractSchedule('Run it daily at 17:30')).toBe('daily at 17:30')
    expect(extractSchedule('Check the queue every 15 minutes')).toBe('every 15 minutes')
    expect(extractSchedule('Send a report on weekdays at 8:15 am')).toBe('on weekdays at 8:15 am')
    expect(extractSchedule('Remind me tomorrow at noon')).toBe('tomorrow at noon')
    expect(extractSchedule('Every Monday and Thursday at 10:30 sync the CRM')).toBe('Every Monday and Thursday at 10:30')
    expect(extractSchedule('Fix the login bug')).toBeUndefined()
  })

  it('converts recurring schedules to cron', () => {
    expect(scheduleToCron('every Monday at 9am')).toBe('0 9 * * 1')
    expect(scheduleToCron('every Monday and Thursday at 10:30')).toBe('30 10 * * 1,4')
    expect(scheduleToCron('daily at 17:30')).toBe('30 17 * * *')
    expect(scheduleToCron('every weekday at 8am')).toBe('0 8 * * 1,2,3,4,5')
    expect(scheduleToCron('weekly')).toBe('0 9 * * 1')
    expect(scheduleToCron('monthly')).toBe('0 9 1 * *')
    expect(scheduleToCron('hourly')).toBe('0 * * * *')
    expect(scheduleToCron('every 15 minutes')).toBe('*/15 * * * *')
    expect(scheduleToCron('every 2 hours')).toBe('0 */2 * * *')
    expect(scheduleToCron('every evening')).toBe('0 18 * * *')
    expect(scheduleToCron('every day at 12pm')).toBe('0 12 * * *')
    expect(scheduleToCron('every day at 12am')).toBe('0 0 * * *')
  })

  it('returns no cron for one-off phrases', () => {
    expect(scheduleToCron('tomorrow at noon')).toBeUndefined()
    expect(scheduleToCron('next Monday')).toBeUndefined()
    expect(scheduleToCron('in 2 hours')).toBeUndefined()
    expect(scheduleToCron('on Monday at 3pm')).toBeUndefined()
    expect(scheduleToCron('on Mondays at 3pm')).toBe('0 15 * * 1')
  })

  it('builds short titles', () => {
    expect(suggestTitle('Can you please investigate why churn spiked in Q4?')).toBe('Investigate why churn spiked in Q4')
    expect(suggestTitle('Whenever a deal closes, post it to the sales channel')).toBe('A deal closes, post it to the sales channel')
  })
})

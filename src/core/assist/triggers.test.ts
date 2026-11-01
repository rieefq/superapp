import { describe, expect, it } from 'vitest'
import { describeCron, describeEvent, describeTrigger, TRIGGER_EVENTS } from './triggers'

describe('describeTrigger', () => {
  it('names manual, schedule, event and webhook triggers', () => {
    expect(describeTrigger({ type: 'manual', label: 'Run manually' })).toBe('Manual')
    expect(describeTrigger({ type: 'schedule', label: '', cron: '0 9 * * 1' })).toBe('Mondays at 09:00')
    expect(describeTrigger({ type: 'event', label: 'New email to support@', event: 'gmail.message.received', integrationId: 'gmail' })).toBe(
      'When a Gmail message arrives',
    )
    expect(describeTrigger({ type: 'event', label: 'x', event: 'github.pull_request.opened' })).toBe('When a pull request is opened')
    expect(describeTrigger({ type: 'webhook', label: 'Deploy hook' })).toBe('When a webhook is received')
  })

  it('falls back to the label for schedules it cannot phrase, and to generic text without one', () => {
    expect(describeTrigger({ type: 'schedule', label: 'Every other Friday', cron: '0 9 * 1-6 5' })).toBe('Every other Friday')
    expect(describeTrigger({ type: 'schedule', label: '', cron: '0 9 * 1-6 5' })).toBe('On a schedule (0 9 * 1-6 5)')
    expect(describeTrigger({ type: 'schedule', label: '' })).toBe('On a schedule')
    expect(describeTrigger({ type: 'event', label: 'Custom thing' })).toBe('Custom thing')
    expect(describeTrigger({ type: 'event', label: '' })).toBe('When an event happens')
  })
})

describe('describeCron', () => {
  it.each([
    ['0 9 * * 1', 'Mondays at 09:00'],
    ['0 8 * * 1', 'Mondays at 08:00'],
    ['30 10 * * 1,4', 'Mondays and Thursdays at 10:30'],
    ['0 8 * * 1,2,3,4,5', 'Weekdays at 08:00'],
    ['0 8 * * 1-5', 'Weekdays at 08:00'],
    ['0 10 * * 0,6', 'Weekends at 10:00'],
    ['0 9 * * 0,1', 'Mondays and Sundays at 09:00'],
    ['0 18 * * MON,WED,FRI', 'Mondays, Wednesdays and Fridays at 18:00'],
    ['30 17 * * *', 'Daily at 17:30'],
    ['0 2 * * *', 'Daily at 02:00'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['* * * * *', 'Every minute'],
    ['0 * * * *', 'Hourly'],
    ['15 * * * *', 'Hourly at :15'],
    ['0 */2 * * *', 'Every 2 hours'],
    ['0 9 */3 * *', 'Every 3 days at 09:00'],
    ['0 9 1 * *', 'Monthly on the 1st at 09:00'],
    ['0 9 22 * *', 'Monthly on the 22nd at 09:00'],
    ['0 9 1 1,4,7,10 *', 'Quarterly on the 1st at 09:00'],
    ['0 9 1 */2 *', 'Every 2 months on the 1st at 09:00'],
    ['0 9 1 1 *', 'Yearly on Jan 1 at 09:00'],
  ])('%s → %s', (cron, text) => {
    expect(describeCron(cron)).toBe(text)
  })

  it('rejects malformed or unsupported expressions', () => {
    expect(describeCron('0 9 * *')).toBeUndefined()
    expect(describeCron('0 25 * * *')).toBeUndefined()
    expect(describeCron('0 9 1 * 1')).toBeUndefined()
    expect(describeCron('nope')).toBeUndefined()
  })
})

describe('describeEvent', () => {
  it('names every known event', () => {
    for (const e of TRIGGER_EVENTS) expect(describeEvent(e.event)).toBe(e.label)
  })

  it('phrases unknown events from their segments and the integration catalog', () => {
    expect(describeEvent('notion.page.updated')).toBe('When a Notion page is updated')
    expect(describeEvent('stripe.invoice.received')).toBe('When a Stripe invoice arrives')
    expect(describeEvent('gitlab.merge_request.closed')).toBe('When a GitLab merge request is closed')
    expect(describeEvent('custom.thing.fail')).toBe('When a Custom thing fails')
    expect(describeEvent(undefined, 'slack')).toBe('When Slack sends an event')
    expect(describeEvent(undefined)).toBeUndefined()
  })
})

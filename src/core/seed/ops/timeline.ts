import type { Clock } from './time'

/**
 * Key moments of the last ~30 days, in one place so runs, sessions, approvals,
 * notifications and activity all agree. `wd(k)` = k-th weekday before today.
 */
export function buildTimeline(clock: Clock) {
  const { wd, day, last } = clock
  return {
    clock,
    /** Mondays at 09:00 (digest) and 08:00 (radar), most recent first. */
    digestMondays: last(1, 4, 9, 0),
    radarMondays: last(1, 4, 8, 0),
    /** The second most recent Saturday (weekend reading, a weekend support email). */
    saturday: last(6, 2, 10, 12)[1] ?? day(9, 10, 12),

    // Coding sessions on northwind/atlas-portal
    bundleTurn1: wd(11, 9, 40),
    bundleTurn2: wd(11, 14, 10),
    bundleMerged: wd(10, 10, 30),
    flakyTurn1: wd(6, 14, 5),
    flakyTurn2: wd(5, 9, 30),
    ssoTurn1: wd(2, 10, 15),
    ssoTurn2: wd(1, 11, 40),
    stripeTurn1: wd(1, 15, 20),

    // Research
    tidewell1: wd(15, 10, 20),
    tidewell2: wd(14, 14, 5),
    churn1: wd(3, 9, 50),

    // Agents
    scoutSizing: wd(18, 9, 30),
    scoutFreightly: wd(12, 16, 0),
    scoutBrief: wd(4, 10, 10),
    scoutBriefRevision: wd(2, 14, 45),
    heraldReleaseNotes: wd(10, 16, 30),
    heraldRetro: wd(9, 9, 40),
    sentinelRubric: wd(12, 10, 0),
    sentinelWeekly: wd(6, 17, 0),
    sentinelEscalation: wd(4, 11, 20),
    museHeroCopy: wd(8, 15, 20),
    museBeats: wd(5, 11, 0),
    ledgerSnapshot: wd(13, 9, 15),
    ledgerNrrFailed: wd(8, 14, 0),
    ledgerNrr: wd(7, 10, 30),
    ledgerLumenUsage: wd(2, 9, 5),
    ledgerDoubleCharge: wd(1, 13, 20),
    /** Nightly Notion syncs, oldest first; the last one failed and Archivist was paused. */
    archivistNights: [day(10, 2, 0), day(9, 2, 0), day(8, 2, 0), day(7, 2, 0), day(6, 2, 0)],
    archivistPaused: day(5, 9, 12),

    // Studio
    studioGradients: wd(17, 14, 30),
    studioIsometric: wd(16, 11, 10),
    studioKeyArt: wd(9, 15, 0),
    studioBackgrounds: wd(6, 10, 15),
    studioSocial: wd(3, 13, 40),

    // Workflows
    prReviews: [wd(19, 10, 5), wd(16, 14, 20), wd(12, 15, 40), wd(7, 16, 30), wd(4, 9, 45)],
    assetsTestRun: wd(12, 15, 30),
    assetsDisabled: wd(11, 10, 5),
    triageV4: wd(12, 16, 45),

    // Integrations
    jiraTokenExpired: day(1, 7, 45),
  }
}

export type Timeline = ReturnType<typeof buildTimeline>

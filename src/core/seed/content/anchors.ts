import type { Clock } from './helpers'

/**
 * Moments the content part shares with the operations part. The first block mirrors
 * `../ops/timeline.ts` (same weekday arithmetic), so a conversation, task or document
 * always exists before the agent run, session or alert that refers to it. The second
 * block holds content-only moments placed relative to those.
 */
export function buildAnchors(clock: Clock) {
  const { wd, day, last } = clock
  const radar = last(1, 4, 8, 0)
  const saturday = last(6, 2, 10, 12)[1] ?? day(9, 10, 12)
  return {
    // ---- mirrored from the operations timeline -------------------------------------
    /** Competitor radar runs, most recent Monday first (08:00). */
    radarM1: radar[0] ?? day(7, 8, 0),
    radarM2: radar[1] ?? day(14, 8, 0),
    radarM4: radar[3] ?? day(28, 8, 0),
    /** Second most recent Saturday, 10:12 (weekend reading). */
    saturday,
    bundleTurn1: wd(11, 9, 40),
    bundleMerged: wd(10, 10, 30),
    flakyTurn1: wd(6, 14, 5),
    flakyTurn2: wd(5, 9, 30),
    ssoTurn1: wd(2, 10, 15),
    ssoTurn2: wd(1, 11, 40),
    stripeTurn1: wd(1, 15, 20),
    portbase1: wd(15, 10, 20),
    portbase2: wd(14, 14, 5),
    churn1: wd(3, 9, 50),
    scoutSizing: wd(18, 9, 30),
    scoutFreightly: wd(12, 16, 0),
    scoutBrief: wd(4, 10, 10),
    scoutBriefRevision: wd(2, 14, 45),
    heraldRetro: wd(9, 9, 40),
    sentinelRubric: wd(12, 10, 0),
    museHeroCopy: wd(8, 15, 20),
    museBeats: wd(5, 11, 0),
    ledgerLumenUsage: wd(2, 9, 5),
    archivistPaused: day(5, 9, 12),
    studioGradients: wd(17, 14, 30),
    studioIsometric: wd(16, 11, 10),
    studioKeyArt: wd(9, 15, 0),
    studioBackgrounds: wd(6, 10, 15),
    studioSocial: wd(3, 13, 40),
    /** Support emails the triage workflow handled. */
    meridianSsoEmail: wd(3, 7, 55),
    haldenRateLimitEmail: wd(5, 16, 5),
    /** Chat runs the operations part records for assistant turns in content threads. */
    chat: {
      tokens: wd(14, 15, 30),
      portbase: wd(17, 10, 45),
      triage: wd(13, 14, 20),
      retro: wd(10, 9, 20),
      launchPlan: wd(9, 10, 0),
      heroCopy: wd(8, 16, 40),
      incident: wd(7, 10, 30),
      pricing: wd(6, 13, 15),
      hiring: wd(5, 12, 10),
      stripeRisks: wd(4, 11, 5),
      ssoBug: wd(3, 16, 10),
      okrs: wd(2, 17, 5),
      agentsReading: saturday + 75 * 60_000,
    },

    // ---- content-only moments ------------------------------------------------------
    /** Checkout latency incident (afternoon of a weekday; the postmortem chat is the next day). */
    incident: wd(8, 14, 2),
    /** Weekly product sync. */
    productSync: wd(3, 10, 0),
    /** Customer call with Meridian Freight. */
    meridianCall: wd(10, 16, 0),
    /** Hero copy test result and pick ("From tracking to knowing."). */
    heroCopyPick: wd(6, 9, 50),
  }
}

export type Anchors = ReturnType<typeof buildAnchors>

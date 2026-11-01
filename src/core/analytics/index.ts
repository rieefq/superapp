/**
 * Analytics: aggregation for the Insights workspace and Home summaries. Pure, deterministic
 * functions (pass `now`) plus thin React hooks over the database. Import from '@/core/analytics'.
 */
export {
  computeInsights, runTime, runDurationMs, INSIGHT_RANGES, RUN_KINDS, UNKNOWN_MODEL_ID,
  type Insights, type InsightsInput, type InsightsTotals, type InsightsDay, type InsightsWindow, type RangeDays,
  type ModelUsage, type AgentInsight, type WorkflowInsight, type FailureReason, type BudgetSummary,
} from './insights'
export { computeHomeSummary, isMyOpenTask, EMPTY_HOME_SUMMARY, type HomeSummary, type HomeSummaryInput } from './home'
export { runFailureMessage, normalizeFailureReason, failureFingerprint, UNKNOWN_FAILURE } from './failures'
export {
  percentChange, percentDelta, pointsDelta, absoluteDelta, rangeLabel, comparisonLabel, formatRate, formatMaybeDuration,
  heatmapCells, dailyPoints, homeSummaryPhrases,
  type Delta, type Direction, type HomePhrase,
} from './format'
export { percentile, percentileSorted, median, mean, ratio } from './stats'
export {
  startOfLocalDay, addLocalDays, localDaysBetween, dayIndex, localWeekday, localHour, startOfLocalMonth,
  startOfNextLocalMonth, minuteFloor, minuteCeil,
} from './time'
export { useInsights, useHomeSummary, useMinuteNow, readInsights, readHomeSummary, type UseInsightsOptions } from './hooks'

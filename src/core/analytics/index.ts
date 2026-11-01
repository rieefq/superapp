/**
 * Analytics: aggregation for the Insights workspace and Home summaries. Pure, deterministic
 * functions (pass `now`) plus thin React hooks over the database. Import from '@/core/analytics'.
 */
export {
  computeInsights, runTime, runDurationMs, matchesProvider, failedStepOf, INSIGHT_RANGES, PROVIDER_FILTERS, RUN_KINDS,
  UNKNOWN_MODEL_ID, APPROVAL_WAIT_BUCKETS,
  type Insights, type InsightsInput, type InsightsRun, type InsightsTotals, type InsightsDay, type InsightsWindow, type RangeDays,
  type ModelUsage, type AgentInsight, type WorkflowInsight, type FailureReason, type BudgetSummary, type ProviderFilter,
  type BucketUnit, type InsightsBucket, type KindInsight, type LastFailure, type FailingNode, type ApprovalWaitBucket,
} from './insights'
export { computeHomeSummary, isMyOpenTask, EMPTY_HOME_SUMMARY, type HomeSummary, type HomeSummaryInput } from './home'
export { runFailureMessage, normalizeFailureReason, failureFingerprint, UNKNOWN_FAILURE } from './failures'
export {
  percentChange, percentDelta, pointsDelta, absoluteDelta, rangeLabel, comparisonLabel, rangeToken, parseRangeToken, formatRate,
  formatMaybeDuration, heatmapCells, dailyPoints, homeSummaryPhrases,
  type Delta, type Direction, type HomePhrase,
} from './format'
export { percentile, percentileSorted, median, mean, ratio } from './stats'
export {
  startOfLocalDay, addLocalDays, localDaysBetween, dayIndex, localWeekday, localHour, startOfLocalMonth,
  startOfNextLocalMonth, minuteFloor, minuteCeil, startOfLocalHour, localHoursBetween,
} from './time'
export {
  queryRuns, sortRunRecords, runRecord, recordDurationMs, statusGroup, modelKeyOf, HISTORY_STATUSES,
  type RunRecord, type RunQuery, type RunNames, type HistoryStatus, type HistorySortKey, type SortDirection,
} from './history'
export {
  monthSpend, shouldPostBudgetUpdate, checkBudgetUpdate, watchBudget, BUDGET_ATTN_RATIO, BUDGET_UPDATE_TITLE, type MonthSpend,
} from './budget'
export {
  useInsights, useHomeSummary, useMinuteNow, readInsights, readHomeSummary, useRunRecords, type UseInsightsOptions,
} from './hooks'

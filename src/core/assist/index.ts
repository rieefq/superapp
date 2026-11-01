/**
 * Assist: deterministic, rule-based suggestions from workspace state (not AI). Used by Home,
 * the command center and Workflows; the UI labels these as suggestions from workspace state.
 * Import from '@/core/assist'.
 */
export * from './types'
export { suggestNextActions, NEXT_ACTION_KINDS, ASSIST_ROUTES } from './nextActions'
export { pickAgentForInstruction, recentSuccessRate, AGENT_TOPICS } from './agents'
export { pickRepoForScope } from './repos'
export { kindFromCreateText, cleanCreatePrompt } from './create'
export { draftWorkflowFromText, DRAFT_LAYOUT } from './workflowDraft'
export { describeTrigger, describeCron, describeEvent, TRIGGER_EVENTS } from './triggers'
export { useNextActions, getNextActions, selectNextActions, useMinuteClock, type UseNextActionsOptions } from './hooks'

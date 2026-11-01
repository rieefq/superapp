/**
 * Signature components (docs/DESIGN.md §5): the product's recognizable motifs — the mark, the status
 * glyph alphabet, the Step Tape, run pills/rows/timelines, the honesty kit, provenance (Colophon and
 * Receipt), identity marks, entity chips, the ApprovalCard and small parts. Import from '@/ui'.
 */

// Mark
export { AtriumMark, FAVICON_SVGS, setFavicon, useActivityState, useFavicon } from './AtriumMark'
export type { AtriumMarkProps, AtriumMarkState } from './AtriumMark'

// Status glyph alphabet
export {
  StatusGlyph, RunStatusGlyph, StepStatusGlyph, RunStatusBadge, TaskGlyph, PriorityGlyph, StatusDot, LiveIndicator,
} from './glyphs'
export type {
  SignalTone, StatusGlyphProps, RunStatusGlyphProps, StepStatusGlyphProps, RunStatusBadgeProps, TaskGlyphProps, PriorityGlyphProps,
  StatusDotProps, LiveIndicatorProps,
} from './glyphs'
export {
  RUN_STATUS_META, STEP_STATUS_META, TASK_STATUS_META, PRIORITY_META, stepGlyph, taskGlyph, runSignal, activityState,
} from './glyphMeta'
export type { GlyphShape, GlyphTone, GlyphSpec, TaskGlyphSpec, PrioritySpec, ActivityState } from './glyphMeta'

// Steps and runs
export { StepIcon, StepTape, OutcomeTape, STEP_KIND_ICON } from './StepTape'
export type { StepIconProps, StepTapeProps, StepTapeSize, OutcomeTapeProps } from './StepTape'
export { computeTape, tapeProgress, currentStepIndex, isWideStep } from './tape'
export type { TapeCell, TapeCellState, TapeModel, TapeRun, TapeOptions } from './tape'
export { RunPill, RunPeek, useRunElapsed } from './RunPill'
export type { RunPillProps, RunPeekProps, RunOwner, RunProjectInfo } from './RunPill'
export { RunRow, RUN_KIND_ICON, runCurrentLine } from './RunRow'
export type { RunRowProps } from './RunRow'
export { RunTimeline, SimFrame } from './RunTimeline'
export type { RunTimelineProps } from './RunTimeline'
export {
  groupTimelineSteps, groupLabel, readCounts, isStepSimulated, toolLabel, simulatedFrameHeader, stepDurationMs, isTerminalStep, isWebStep,
} from './timeline'
export type { TimelineEntry, TimelineStepEntry, TimelineGroupEntry } from './timeline'
export { stepTitle, toBase, toPast, toParticiple, startsWithVerb, stripTicks } from './tense'
export { CodeSpans } from './text'

// Honesty kit
export { SimBadge, LiveBadge, OriginBadge, SIM_EXPLANATION, LIVE_EXPLANATION } from './honesty'
export type { SimBadgeProps, LiveBadgeProps } from './honesty'

// Provenance
export { ProvenanceLine, RunMeta, Receipt } from './provenance'
export type { ProvenanceLineProps, ProvenanceTool, RunMetaProps, ReceiptProps } from './provenance'
export { buildReceipt, receiptToMarkdown, receiptJson, modelInfoFor, toolUseLabel } from './receipt'
export type { ReceiptModel, ReceiptTool, ReceiptCapability, ReceiptSaw, ReceiptModelInfo, BuildReceiptOptions, ReceiptMarkdownOptions } from './receipt'

// Identity
export { AgentMark, MonogramMark } from './marks'
export type { AgentMarkProps, MonogramMarkProps } from './marks'
export { sigilElements, sigilPaths, SIGIL_MAX_RADIUS } from './sigil'
export type { SigilElement, SigilPaths } from './sigil'

// Entities
export {
  EntityChip, EntityHoverCard, EntityIcon, EntityMark, KindTile, RunCapsule, EntityCardContext, EntityCardProvider, useEntityActions,
  useEntityExcerpt, excerptIn, entityStatusWord, kindIcon, ENTITY_DRAG_TYPE,
} from './entity'
export type { EntityChipProps, EntityHoverCardProps, EntityIconProps } from './entity'

// Approvals
export { ApprovalCard, ApprovalCardConnected } from './ApprovalCard'
export type { ApprovalCardProps, ApprovalCardConnectedProps, ApprovalRequester } from './ApprovalCard'
export { approvalHeadline, stampText, truncatePatch, isPatch, grantsWithAlwaysAllow, RISK_LABEL } from './approvalLogic'

// Small parts
export { MetaLabel, IdCode, TickMeter, tickMeterLevel } from './small'
export type { IdCodeProps, TickMeterProps, TickMeterLevel } from './small'
export { SelectionToolbar } from './SelectionToolbar'
export type { SelectionToolbarProps, SelectionAction } from './SelectionToolbar'

// Formats and clock
export { formatTok, formatTokenCount, formatCost, formatClock, formatSeconds, formatHm, formatAge } from './format'
export { useNow } from './clock'

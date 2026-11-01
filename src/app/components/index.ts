/**
 * Shared connected components (§5.4.10–§5.4.15, §7): the building blocks every workspace uses to start
 * work, show context and land results. Import from '@/app/components'. See README.md for usage.
 */

// Composer, Context Line, ContextMeter
export { Composer, DropOverlay, type ComposerProps, type ComposerSubmitMeta } from './composer/Composer'
export { fileToAttachment, filesToAttachments, useStageDrop, ATTACHMENT_TEXT_BYTES } from './composer/attachments'
export { detectTrigger, completeTrigger, filterCommands, parseSlash, matchedTerms, type Trigger } from './composer/text'
export { useMentionOptions, type MentionOption, type MentionGroup } from './composer/MentionMenu'
export {
  useComposerContext,
  retrieveLikely,
  type ComposerContext,
  type ComposerContextOptions,
  type ComposerContextRefs,
  type ContextEntry,
  type ContextGroup,
} from './context/useComposerContext'
export { toChatSelection } from './context/chatSelection'
export { ContextLine, ContextChip, type ContextLineProps } from './context/ContextLine'
export { ContextMeter, meterLevel, OVER_WINDOW_REASON, useOpenContextInspector, type ContextMeterProps } from './context/ContextMeter'
export { estimateRefTokens, estimateMemoryTokens, estimateAttachmentTokens, formatTokenCount, formatWindow } from './context/tokens'

// Start sheet & ReadBack
export * from './start'
export { ReadBack, ReadBackLine, useReadBack, ESTIMATE_TOOLTIP, type ReadBackData, type ReadBackProps, type UseReadBackInput } from './readback/ReadBack'
export {
  capabilityRows,
  capabilityUses,
  estimateRunCost,
  budgetState,
  formatCost,
  type ReadBackKind,
  type CapabilityRow,
  type CapabilityUse,
  type CostEstimate,
  type BudgetState,
} from './readback/plan'

// Landing
export { DerivedRow, LandedCard, DerivedList, type DerivedRowProps, type LandedCardProps, type DerivedListProps } from './landing/Landing'
export { useDerived, derivedRefsIn, runForIn, type DerivedItem } from './landing/useDerived'

// Entity actions
export {
  TurnIntoMenu,
  HandoffMenu,
  HoldButton,
  PinButton,
  SaveToKnowledgeButton,
  useScopedKey,
  type TurnIntoMenuProps,
  type HoldButtonProps,
  type SaveToKnowledgeButtonProps,
} from './actions/actions'

export { SelectionActions, type SelectionActionsProps } from './actions/SelectionActions'

// Runs
export { RunPanel, type RunPanelProps } from './run/RunPanel'

// Pickers
export { Picker, PickerTrigger, type PickerOption, type PickerProps, type PickerTriggerProps } from './pickers/Picker'
export {
  ProjectPicker,
  AgentPicker,
  RepoPicker,
  CollectionPicker,
  WorkflowPicker,
  EntityPicker,
  ModelPicker,
  ModelLabel,
  PickerFooterButton,
  useMaybeEntity,
  type ProjectPickerProps,
  type AgentPickerProps,
  type RepoPickerProps,
  type CollectionPickerProps,
  type WorkflowPickerProps,
  type EntityPickerProps,
  type ModelPickerProps,
} from './pickers/pickers'

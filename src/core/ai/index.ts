/**
 * Public API of the AI layer: model catalog, provider registry, chat orchestration and
 * intent detection. Import from `@/core/ai`.
 */
export * from './types'
export { MODEL_CATALOG, DEFAULT_MODEL_ID, getModel, estimateCost, estimateReferenceCost, estimateTokens } from './models'
export {
  getProvider,
  listProviders,
  getModelInfo,
  providerFor,
  checkModel,
  unavailableMessage,
  listModels,
  useModels,
  useModelAvailability,
  OAI_PLACEHOLDER_ID,
  type ModelAvailability,
  type ModelCheck,
} from './registry'
export {
  NEW_THREAD_TITLE,
  titleFromText,
  createThread,
  renameThread,
  deleteThread,
  setThreadPinned,
  setThreadArchived,
  setThreadModel,
  setThreadProject,
  addThreadContext,
  removeThreadContext,
  forkThread,
  sendMessage,
  stopGeneration,
  regenerate,
  editAndResend,
  setFeedback,
  recoverInterruptedMessages,
  useThreadMessages,
  useIsGenerating,
  awaitGeneration,
  isGenerating,
  type CreateThreadInput,
  type SendMessageInput,
  type SendMessageResult,
} from './chat'
export { friendlyError } from './chatRunner'
export { detectIntent, extractSchedule, scheduleToCron, suggestTitle, type Intent, type IntentResult, type IntentSuggestions } from './intent'
export { ANTHROPIC_NEEDS_KEY } from './providers/anthropic'
export { OAI_MODEL_PREFIX, OAI_NEEDS_CONFIG } from './providers/openaiCompatible'

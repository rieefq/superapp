/** Atrium UI hooks — keyboard, disclosure, media, storage, motion, clipboard. */
export {
  createSequenceMatcher,
  eventKey,
  formatCombo,
  formatShortcut,
  hasCommandModifier,
  isMacPlatform,
  matchesAny,
  matchesCombo,
  parseCombo,
  setMacPlatformOverride,
  type KeyEventLike,
  type ParsedCombo,
} from './hotkeys'
export { useHotkey, useChord, type HotkeyOptions, type ChordOptions } from './useHotkey'
export { useDisclosure, type Disclosure } from './useDisclosure'
export { useClickOutside } from './useClickOutside'
export {
  useMediaQuery,
  useBreakpoint,
  useBreakpointUp,
  useCoarsePointer,
  breakpointAtLeast,
  BREAKPOINTS,
  type Breakpoint,
} from './useMediaQuery'
export { useLocalStorageState } from './useLocalStorageState'
export { useReducedMotion, prefersReducedMotion } from './useReducedMotion'
export { useCopy, copyText } from './useCopy'
export { useDebounced, useDebouncedCallback } from './useDebounced'
export { useIsTyping, isTypingTarget } from './useIsTyping'
export { useControllableState } from './useControllableState'
export { useLatest, useStableCallback } from './useLatest'

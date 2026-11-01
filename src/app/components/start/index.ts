/**
 * The Start sheet (§5.4.11, §3.10). The shell mounts StartSheetHost once; everything else opens it with
 * `openStartSheet(kind, { source, prefill, background })` from '@/app/shell/store'.
 */
export { StartSheetHost } from './StartSheetHost'
export { StartSheet, StartPanel, type StartSheetProps, type StartPanelProps } from './StartSheet'
export { START_KINDS, START_KIND_META, STUDIO_KINDS, AUTONOMY_OPTIONS, type StartKindMeta, type StudioKind } from './kinds'
export { startWork, validateStart, capRun, dueFromInput, startEvents, type StartForm, type StartResult } from './submit'

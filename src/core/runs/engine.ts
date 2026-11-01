import type { RunEngine } from './types'

/**
 * STUB — replaced by the run-engine implementation.
 * The contract lives in ./types.ts (RunEngine).
 */
const notImplemented = (name: string) => () => {
  throw new Error(`runEngine.${name} is not implemented yet`)
}

export const runEngine: RunEngine = {
  start: notImplemented('start') as RunEngine['start'],
  cancel: notImplemented('cancel'),
  pause: notImplemented('pause'),
  resume: notImplemented('resume'),
  retry: notImplemented('retry') as RunEngine['retry'],
  resolveApproval: notImplemented('resolveApproval'),
  resumeInterrupted: notImplemented('resumeInterrupted'),
}

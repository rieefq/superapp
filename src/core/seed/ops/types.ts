import type { TableName } from '@/core/db/schema'
import type { StepPlan } from '@/core/runs/types'
import type { EntityRef, ID } from '@/core/types'

/** Factory name the in-flight seed runs resume with (see `ScriptedRunParams`). */
export const SCRIPTED_FACTORY = 'scripted'

/**
 * A shallow patch applied to one row when a scripted run succeeds:
 * `db.update(patch.table, patch.id, patch.patch)`.
 */
export interface SeedPatch {
  table: TableName
  id: ID
  patch: Record<string, unknown>
}

/**
 * Params of the 'scripted' run factory used by the seeded in-flight runs. Plain JSON:
 * the factory replays `steps` from `run.script.cursor`, writes `summary` and appends
 * `outputs` on success, then applies `onSuccessPatches` in order.
 */
export type ScriptedRunParams = {
  steps: StepPlan[]
  summary: string
  outputs?: EntityRef[]
  onSuccessPatches?: SeedPatch[]
}

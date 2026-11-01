import { db, hydrate, startPersistence, writeAll } from '@/core/db'
import { registerAllFactories } from '@/core/runs/factories'
import { runEngine } from '@/core/runs'
import { recoverInterruptedMessages } from '@/core/ai/chat'

let booted = false

/**
 * One-time application startup:
 * 1. register simulation script factories (needed before resuming runs)
 * 2. load persisted data, or seed the demo world on first run
 * 3. start persistence, recover interrupted chat streams, resume in-flight runs
 */
export async function boot(): Promise<void> {
  if (booted) return
  booted = true
  registerAllFactories()
  const loaded = hydrate()
  if (!loaded) await seedDemoWorld()
  startPersistence()
  try {
    recoverInterruptedMessages()
  } catch (err) {
    console.warn('[boot] chat recovery failed', err)
  }
  try {
    runEngine.resumeInterrupted()
  } catch (err) {
    console.warn('[boot] run engine resume failed', err)
  }
}

/**
 * Build and store the first-run demo world. The seed module is large and only needed on first
 * run or reset, so it is loaded on demand (kept out of the main bundle).
 */
async function seedDemoWorld(): Promise<void> {
  const { buildSeed } = await import('@/core/seed')
  const seed = buildSeed(Date.now())
  db.replaceAll(seed)
  writeAll(seed)
}

/** Wipe the database and re-seed the demo world (settings and secrets are kept). */
export async function resetDemoData(): Promise<void> {
  await seedDemoWorld()
  try {
    runEngine.resumeInterrupted()
  } catch {
    /* engine unavailable */
  }
}

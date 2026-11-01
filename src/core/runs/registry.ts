import type { RunFactory } from './types'

const factories = new Map<string, RunFactory>()

/** Register (or replace) a named simulation script factory. */
export function registerRunFactory(name: string, factory: RunFactory): void {
  factories.set(name, factory)
}

export function getRunFactory(name: string): RunFactory | undefined {
  return factories.get(name)
}

export function listRunFactories(): string[] {
  return [...factories.keys()]
}

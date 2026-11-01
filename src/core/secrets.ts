import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Local secrets vault for API keys/tokens (e.g. Anthropic key, GitHub token).
 * Stored only in this browser's localStorage, never in the database export.
 * A production deployment should proxy provider calls through a backend instead.
 */
interface SecretsStore {
  secrets: Record<string, Record<string, string>>
  set: (integrationId: string, key: string, value: string) => void
  clear: (integrationId: string) => void
  clearAll: () => void
}

export const useSecretsStore = create<SecretsStore>()(
  persist(
    (set) => ({
      secrets: {},
      set: (integrationId, key, value) =>
        set((s) => ({ secrets: { ...s.secrets, [integrationId]: { ...s.secrets[integrationId], [key]: value } } })),
      clear: (integrationId) =>
        set((s) => {
          const next = { ...s.secrets }
          delete next[integrationId]
          return { secrets: next }
        }),
      clearAll: () => set({ secrets: {} }),
    }),
    { name: 'atrium.secrets', version: 1 },
  ),
)

export function getSecret(integrationId: string, key: string): string | undefined {
  const v = useSecretsStore.getState().secrets[integrationId]?.[key]
  return v && v.trim() ? v.trim() : undefined
}

export function setSecret(integrationId: string, key: string, value: string): void {
  useSecretsStore.getState().set(integrationId, key, value)
}

export function clearSecrets(integrationId: string): void {
  useSecretsStore.getState().clear(integrationId)
}

/** True when a secret exists (re-renders when it changes). Never exposes the value. */
export function useHasSecret(integrationId: string, key: string): boolean {
  return useSecretsStore((s) => !!s.secrets[integrationId]?.[key]?.trim())
}

/** Mask a secret for display: "sk-ant-…a1b2". */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

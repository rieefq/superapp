import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings } from '@/core/types'
import { DEFAULT_MODEL_ID } from '@/core/ai/models'

export const DEFAULT_SETTINGS: Settings = {
  profile: { name: 'Morgan Lee', hue: 'volt' },
  appearance: { theme: 'dark', density: 'comfortable', reduceMotion: 'system', singleKeyShortcuts: true },
  ai: { defaultModelId: DEFAULT_MODEL_ID, effort: 'medium', showReasoning: true, autoRetrieve: true },
  safety: {
    defaultAutonomy: 'balanced',
    alwaysAsk: ['messages.send', 'repo.pull_request', 'payments.spend'],
    confirmDestructive: true,
    monthlyBudgetUsd: 50,
    countSimulatedSpend: false,
  },
  notifications: { runCompleted: true, runFailed: true, approvals: true, toasts: true, focusMode: false, browser: false },
  simulation: { speed: 1 },
  onboarded: false,
}

interface SettingsStore {
  settings: Settings
  update: <K extends keyof Settings>(section: K, patch: Settings[K] extends object ? Partial<Settings[K]> : Settings[K]) => void
  reset: () => void
}

/** User settings, persisted separately from the database (survive "reset demo data"). */
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (section, patch) =>
        set((s) => {
          const cur = s.settings[section]
          const next =
            cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur, ...(patch as object) } : (patch as Settings[typeof section])
          return { settings: { ...s.settings, [section]: next } }
        }),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: 'atrium.settings',
      version: 1,
      // Merge so new settings keys added later get their defaults.
      merge: (persisted, current) => {
        const p = (persisted as Partial<SettingsStore> | undefined)?.settings
        if (!p) return current
        const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>
        for (const [k, v] of Object.entries(p)) {
          const d = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[k]
          merged[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' ? { ...d, ...v } : v
        }
        return { ...current, settings: merged as unknown as Settings }
      },
    },
  ),
)

/** Read settings with a selector: `useSettings((s) => s.ai.defaultModelId)`. */
export function useSettings<T>(selector: (s: Settings) => T): T {
  return useSettingsStore((st) => selector(st.settings))
}

export function getSettings(): Settings {
  return useSettingsStore.getState().settings
}

/** Patch one settings section: `updateSettings('appearance', { theme: 'light' })`. */
export function updateSettings<K extends keyof Settings>(
  section: K,
  patch: Settings[K] extends object ? Partial<Settings[K]> : Settings[K],
): void {
  useSettingsStore.getState().update(section, patch)
}

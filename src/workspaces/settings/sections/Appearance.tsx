import { Monitor, Moon, Sun } from 'lucide-react'
import { useSettings } from '@/core/settings'
import type { Settings } from '@/core/types'
import { SegmentedControl, useBreakpointUp, useMediaQuery, useTheme } from '@/ui'
import { Group, SectionBody, SettingRow, useSaveSetting } from '../parts'
import { getSection } from '../sections'

type Appearance = Settings['appearance']

const THEMES = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
] as const satisfies readonly { value: Appearance['theme']; label: string; icon: typeof Moon }[]

const DENSITIES = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const satisfies readonly { value: Appearance['density']; label: string }[]

const MOTIONS = [
  { value: 'system', label: 'System' },
  { value: 'reduce', label: 'Reduce' },
  { value: 'full', label: 'Full' },
] as const satisfies readonly { value: Appearance['reduceMotion']; label: string }[]

/** Appearance (§6.12): theme (crossfades), density, motion. */
export default function AppearanceSection() {
  const appearance = useSettings((s) => s.appearance)
  const { resolvedTheme } = useTheme()
  const osReduces = useMediaQuery('(prefers-reduced-motion: reduce)')
  const save = useSaveSetting()
  // Phones: the controls sit under their labels at full width.
  const narrow = !useBreakpointUp('sm')

  const themeHint =
    appearance.theme === 'system'
      ? `Follows your system, which is ${resolvedTheme} right now.`
      : 'Graphite for dark, paper for light. Color only ever signals state.'
  const densityHint =
    appearance.density === 'compact' ? 'Rows 28px, controls 28px, 13px text. More on screen.' : 'Rows 36px, controls 32px, 14px text.'
  const motionHint =
    appearance.reduceMotion === 'system'
      ? `Follows your system, which ${osReduces ? 'asks for reduced motion' : 'allows full motion'} right now.`
      : appearance.reduceMotion === 'reduce'
        ? 'No movement or scaling. Fades stay short; live work shows a still ring instead of breathing.'
        : 'Panels slide, live work breathes, results develop. Ignores the system setting.'

  return (
    <SectionBody lead={getSection('appearance')!.lead}>
      <Group label="Display" footnote="No appearance setting can hide simulated labels.">
        <SettingRow id="theme" label="Theme" hint={themeHint}>
          <SegmentedControl
            options={THEMES}
            value={appearance.theme}
            onValueChange={(theme) => save('theme', 'Theme', 'appearance', { theme })}
            fullWidth={narrow}
          />
        </SettingRow>
        <SettingRow id="density" label="Density" hint={densityHint}>
          <SegmentedControl
            options={DENSITIES}
            value={appearance.density}
            onValueChange={(density) => save('density', 'Density', 'appearance', { density })}
            fullWidth={narrow}
          />
        </SettingRow>
        <SettingRow id="motion" label="Motion" hint={motionHint}>
          <SegmentedControl
            options={MOTIONS}
            value={appearance.reduceMotion}
            onValueChange={(reduceMotion) => save('motion', 'Motion', 'appearance', { reduceMotion })}
            fullWidth={narrow}
          />
        </SettingRow>
      </Group>
    </SectionBody>
  )
}

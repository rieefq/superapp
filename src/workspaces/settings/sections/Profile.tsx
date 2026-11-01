import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useSettings } from '@/core/settings'
import { HUES, type Hue } from '@/core/types'
import { Avatar, Input } from '@/ui'
import { cn } from '@/lib/cn'
import { checkEmail, checkName } from '../logic'
import { BlockRow, Group, SectionBody, SettingRow, useDraft, useMarkSaved, useSaveSetting } from '../parts'
import { getSection } from '../sections'

const HUE_LABEL: Record<Hue, string> = {
  volt: 'Volt',
  sky: 'Sky',
  violet: 'Violet',
  coral: 'Coral',
  amber: 'Amber',
  mint: 'Mint',
  rose: 'Rose',
  cyan: 'Cyan',
}

/** Profile (§6.12): name, email, identity hue, with a live initials preview. */
export default function ProfileSection() {
  const profile = useSettings((s) => s.profile)
  const save = useSaveSetting()
  const mark = useMarkSaved()

  const commitName = useCallback((name: string) => save('name', 'Name', 'profile', { name }), [save])
  const name = useDraft({
    stored: profile.name,
    check: checkName,
    commit: (value) => commitName(value),
    onSettled: () => mark('name', 'Name'),
  })
  const email = useDraft({
    stored: profile.email ?? '',
    check: checkEmail,
    commit: (value) => save('email', 'Email', 'profile', { email: value }),
    onSettled: () => mark('email', 'Email'),
  })

  const shownName = checkName(name.value).ok ? name.value : profile.name

  return (
    <SectionBody lead={getSection('profile')!.lead}>
      <div className="flex items-center gap-4" aria-label="Preview" role="group">
        <Avatar name={shownName} hue={profile.hue} size="2xl" decorative />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="type-title-2 truncate text-ink">{shownName}</span>
          <span className="type-meta truncate text-ink-3">{profile.email || 'No email added'}</span>
          <span className="type-caption text-ink-3">Stored on this device</span>
        </div>
      </div>

      <Group label="Identity">
        <SettingRow id="name" label="Name" hint="Shown on your avatar, in activity and on tasks you own." error={name.error}>
          <Input
            value={name.value}
            onValueChange={name.onValueChange}
            onFocus={name.onFocus}
            onBlur={name.onBlur}
            autoComplete="name"
            maxLength={80}
            wrapperClassName="w-64 max-sm:w-full"
          />
        </SettingRow>
        <SettingRow id="email" label="Email" hint="Optional. It stays on this device; nothing is sent to it." error={email.error}>
          <Input
            type="email"
            value={email.value}
            onValueChange={email.onValueChange}
            onFocus={email.onFocus}
            onBlur={email.onBlur}
            placeholder="you@example.com"
            autoComplete="email"
            inputMode="email"
            wrapperClassName="w-64 max-sm:w-full"
          />
        </SettingRow>
        <BlockRow id="hue" label="Identity hue" hint="Colors your avatar. Hues mark who or what something is, never its state.">
          {({ labelId, hintId }) => (
            <HuePicker
              name={shownName}
              value={profile.hue}
              labelledBy={labelId}
              describedBy={hintId}
              onChange={(hue) => save('hue', 'Identity hue', 'profile', { hue })}
            />
          )}
        </BlockRow>
      </Group>

      <Group label="Where your name goes" footnote="Nothing about you leaves this browser except what a live model receives with your messages.">
        <ul className="flex flex-col">
          <NoteRow>Your avatar, the user menu, the activity journal and tasks assigned to you.</NoteRow>
          <NoteRow>
            The instructions sent with each chat turn say “The user’s name is {shownName}.” so answers can address you. With a live model this
            text goes to its provider; the Simulator keeps it local.
          </NoteRow>
          <NoteRow>Simulated integrations derive fictional accounts from it, always on .example domains.</NoteRow>
        </ul>
      </Group>
    </SectionBody>
  )
}

function NoteRow({ children }: { children: ReactNode }) {
  return (
    <li className="type-body-sm flex gap-2.5 border-b border-line px-4 py-3 text-ink-2 last:border-b-0">
      <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-4" />
      <span className="text-pretty">{children}</span>
    </li>
  )
}

/**
 * Eight identity hues as avatar previews (circles: you are an actor). A radio group: one tab stop,
 * arrows move and select, Home/End jump.
 */
function HuePicker({
  name,
  value,
  onChange,
  labelledBy,
  describedBy,
}: {
  name: string
  value: Hue
  onChange: (hue: Hue) => void
  labelledBy: string
  describedBy?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const select = (i: number) => {
    const hue = HUES[(i + HUES.length) % HUES.length]
    onChange(hue)
    refs.current[(i + HUES.length) % HUES.length]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const map: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: HUES.length - 1 }
    if (e.key in map) {
      e.preventDefault()
      select(map[e.key])
    }
  }
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className="flex flex-wrap items-center gap-2.5">
      {HUES.map((hue, i) => {
        const selected = hue === value
        return (
          <button
            key={hue}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={HUE_LABEL[hue]}
            title={HUE_LABEL[hue]}
            tabIndex={selected ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative grid size-10 place-items-center rounded-full transition-[box-shadow] duration-(--dur-1) ease-standard',
              "pointer-coarse:after:absolute pointer-coarse:after:-inset-1 pointer-coarse:after:content-['']",
              selected ? 'shadow-[0_0_0_2px_var(--surface-canvas),0_0_0_3.5px_var(--ink)]' : 'hover:shadow-[0_0_0_2px_var(--surface-canvas),0_0_0_3px_var(--line-strong)]',
              'focus-visible:outline-offset-4',
            )}
          >
            <Avatar name={name} hue={hue} size="lg" decorative />
          </button>
        )
      })}
    </div>
  )
}

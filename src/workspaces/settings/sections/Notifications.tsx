import { useSettings } from '@/core/settings'
import { Switch } from '@/ui'
import { Group, SectionBody, SettingRow, useSaveSetting } from '../parts'
import { getSection } from '../sections'

/** Notifications (§6.12, §3.8): toasts, Focus mode, and which events post Updates. */
export default function NotificationsSection() {
  const n = useSettings((s) => s.notifications)
  const save = useSaveSetting()

  return (
    <SectionBody lead={getSection('notifications')!.lead}>
      <Group label="Interruptions">
        <SettingRow
          id="toasts"
          label="Toasts"
          hint="Short notes at the bottom right. Off: nothing pops up; everything still lands in Updates and is read out to screen readers."
        >
          <Switch checked={n.toasts} onCheckedChange={(toasts) => save('toasts', 'Toasts', 'notifications', { toasts })} />
        </SettingRow>
        <SettingRow
          id="focus-mode"
          label="Focus mode"
          hint="No approval toasts. The Needs-you count, the Run Line and the tab title still update, and a Focus tag shows in the Run Line."
        >
          <Switch checked={n.focusMode} onCheckedChange={(focusMode) => save('focus-mode', 'Focus mode', 'notifications', { focusMode })} />
        </SettingRow>
      </Group>

      <Group label="What to tell you about" footnote="Approvals and reviews always wait in Needs you, whatever you choose here.">
        <SettingRow
          id="approvals"
          label="Approval requests"
          hint="A persistent toast with Review, and a spoken “Needs you” line, when a run asks for your approval."
        >
          <Switch checked={n.approvals} onCheckedChange={(approvals) => save('approvals', 'Approval requests', 'notifications', { approvals })} />
        </SettingRow>
        <SettingRow id="run-completed" label="Finished runs" hint="Posts an Update when a delegated run completes. Chat replies never do.">
          <Switch checked={n.runCompleted} onCheckedChange={(runCompleted) => save('run-completed', 'Finished runs', 'notifications', { runCompleted })} />
        </SettingRow>
        <SettingRow id="run-failed" label="Failed runs" hint="Posts an Update when a delegated run fails. The failed pill stays in the Run Line either way.">
          <Switch checked={n.runFailed} onCheckedChange={(runFailed) => save('run-failed', 'Failed runs', 'notifications', { runFailed })} />
        </SettingRow>
      </Group>
    </SectionBody>
  )
}

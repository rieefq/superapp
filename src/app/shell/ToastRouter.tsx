import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useDB } from '@/core/db'
import { entityRoute, markRead, notificationEvents } from '@/core/services'
import { getSettings } from '@/core/settings'
import type { Notification } from '@/core/types'
import { dismissToast, toast, type ToastTone } from '@/ui'
import { useShellStore } from './store'
import { announce } from './Announcer'

/** Is a modal layer (Start sheet, command center, dialog, phone sheet) open? */
function modalOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"]')
}

/** Open approval toasts: toast id → approval id. */
const approvalToasts = new Map<string, string>()

const UPDATE_TONE: Record<Notification['tone'], ToastTone> = {
  success: 'success',
  danger: 'error',
  warning: 'warning',
  info: 'neutral',
  neutral: 'neutral',
  accent: 'neutral',
}

/**
 * Routes notification events to toasts (§3.8):
 * - approvals: persistent attention toast with [Review]; never in Focus mode (the badge still updates);
 * - updates: quiet, dismissed after 6s;
 * - nothing toasts when settings.notifications.toasts is off.
 * Whatever does not toast is still announced through the polite live region.
 */
export function ToastRouter() {
  const navigate = useNavigate()

  // Approval toasts persist until handled: once the approval resolves anywhere, its toast goes.
  useEffect(
    () =>
      useDB.subscribe((state, before) => {
        if (state.approvals === before.approvals) return
        for (const [toastId, approvalId] of approvalToasts) {
          const a = state.approvals[approvalId]
          if (!a || a.status !== 'pending') {
            approvalToasts.delete(toastId)
            dismissToast(toastId)
          }
        }
      }),
    [],
  )

  useEffect(
    () =>
      notificationEvents.on('created', (n) => {
        const settings = getSettings().notifications
        const approval = n.kind === 'approval.requested'
        if (approval) {
          const sentence = `Needs you: ${n.title.replace(/^Approval needed:\s*/i, '')}`
          if (!settings.toasts || settings.focusMode) {
            announce(sentence)
            return
          }
          const toastId = `approval-${n.id}`
          if (n.ref?.kind === 'approval') approvalToasts.set(toastId, n.ref.id)
          toast({
            id: toastId,
            onDismiss: () => approvalToasts.delete(toastId),
            title: n.title.replace(/^Approval needed:\s*/i, ''),
            description: n.body,
            tone: 'warning',
            duration: Infinity,
            action: {
              label: 'Review',
              onClick: () => {
                markRead(n.id)
                const st = useShellStore.getState()
                st.setNeedsYouTab('needs')
                st.setNeedsYouOpen(true)
              },
            },
          })
          return
        }
        // Quiet updates never cover a sheet or dialog you are working in; they stay in Updates.
        if (!settings.toasts || modalOpen()) {
          announce(n.title)
          return
        }
        const tone = UPDATE_TONE[n.tone] ?? 'neutral'
        toast({
          id: `update-${n.id}`,
          title: n.title,
          description: n.body,
          // Updates are quiet: no attention styling even when the notification carried a warning tone.
          tone: tone === 'warning' ? 'neutral' : tone,
          duration: 6000,
          action: n.ref
            ? {
                label: 'Open',
                onClick: () => {
                  markRead(n.id)
                  if (n.ref) navigate(entityRoute(n.ref))
                },
              }
            : undefined,
        })
      }),
    [navigate],
  )
  return null
}

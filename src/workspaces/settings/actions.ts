import { confirm, toast } from '@/ui'
import { eraseEverything } from './data'

/*
 * Data flows that both the Data section and ⌘K start (the manifest loads this module on demand).
 * Export and Reset demo world are the shell's own `runExport` / `runResetDemo`.
 */

/** Erase everything after a typed confirmation (`erase`, §3.10), then go Home to the empty world. */
export async function runErase(navigate: (to: string) => void): Promise<boolean> {
  const ok = await confirm({
    title: 'Erase everything?',
    description:
      'This deletes every project, conversation, run, task and note in this browser, along with your settings and API keys. Atrium starts empty; the demo world stays gone until you reset it. This can’t be undone.',
    tone: 'danger',
    confirmLabel: 'Erase everything',
    requireText: 'erase',
  })
  if (!ok) return false
  try {
    eraseEverything()
    navigate('/')
    toast.success('Everything was erased', {
      description: 'Atrium is empty. Reset the demo world in Settings › Data to bring Northwind Labs back.',
      duration: 8000,
      action: { label: 'Open Data', onClick: () => navigate('/settings/data') },
    })
    return true
  } catch (err) {
    toast.error('Couldn’t erase everything', { description: err instanceof Error ? err.message : String(err) })
    return false
  }
}

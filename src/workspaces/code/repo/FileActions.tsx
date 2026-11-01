import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Check, Copy, ExternalLink, Layers, MessageSquarePlus, SquareTerminal } from 'lucide-react'
import { useContextStore } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { holdRepoFile, type RepoFileContent } from '@/core/services'
import type { ID, Repo } from '@/core/types'
import { Button, IconButton, Tooltip, copyText, toast } from '@/ui'
import { githubBlobUrl } from '../logic'
import { useGo } from '../hooks'

/** Is this repository file held (through its Knowledge copy)? */
function useHeldFile(repoId: ID, path: string): ID | undefined {
  const knowledgeId = useDB((s: Tables) => {
    for (const k of Object.values(s.knowledge)) {
      if (k.source.type === 'code' && k.source.ref?.kind === 'repo' && k.source.ref.id === repoId && k.file?.name === path) return k.id
    }
    return undefined
  })
  const held = useContextStore((s) => !!knowledgeId && s.pinned.some((p) => p.ref.kind === 'knowledge' && p.ref.id === knowledgeId))
  return held ? knowledgeId : undefined
}

/** Hold file (§6.3): a Knowledge copy of the file rides along in every new AI action. */
export function HoldFileButton({ repo, path, file }: { repo: Repo; path: string; file?: RepoFileContent }) {
  const heldId = useHeldFile(repo.id, path)
  const [busy, setBusy] = useState(false)
  const disabled = !file || !!file.skipped
  const toggle = async () => {
    if (heldId) {
      useContextStore.getState().unpin({ kind: 'knowledge', id: heldId })
      toast({ title: `Released ${path}`, description: 'It no longer rides along in new AI actions.', action: { label: 'Undo', onClick: () => useContextStore.getState().pin({ kind: 'knowledge', id: heldId }) } })
      return
    }
    setBusy(true)
    try {
      await holdRepoFile(repo.id, path)
      toast({ tone: 'success', title: `Holding ${path}`, description: 'A copy is kept in Knowledge and rides along in every new AI action.' })
    } catch (err) {
      toast({ tone: 'error', title: `Couldn’t hold ${path}`, description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Tooltip content={heldId ? 'Release: stop sending it with new AI actions' : 'Keeps a copy in Knowledge and holds it: it rides along in new AI actions'}>
      <Button size="xs" variant="ghost" leadingIcon={heldId ? Check : Layers} aria-pressed={!!heldId} loading={busy} disabled={disabled && !heldId} onClick={() => void toggle()}>
        {heldId ? 'Held' : 'Hold file'}
      </Button>
    </Tooltip>
  )
}

export function CopyPathButton({ path }: { path: string }) {
  return (
    <IconButton
      icon={Copy}
      label="Copy path"
      size="xs"
      onClick={() => void copyText(path).then((ok) => toast(ok ? { title: 'Path copied', description: path } : { tone: 'error', title: 'Couldn’t copy the path' }))}
    />
  )
}

export function OpenOnGithubButton({ repo, path }: { repo: Repo; path: string }) {
  const url = githubBlobUrl(repo, path)
  if (!url || repo.mode !== 'live') return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label="Open on GitHub (new tab)"
      title="Open on GitHub"
      className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
    >
      <ExternalLink aria-hidden className="size-3.5" strokeWidth={1.75} />
    </a>
  )
}

/** "Start a session about this file" (repo explorer): the new-session form with the path in the instruction. */
export function StartAboutFileButton({ repo, path }: { repo: Repo; path: string }) {
  const navigate = useGo()
  return (
    <Button size="xs" variant="secondary" leadingIcon={SquareTerminal} onClick={() => navigate(`/code/new?repo=${encodeURIComponent(repo.id)}&path=${encodeURIComponent(path)}`)}>
      Start a session about this file
    </Button>
  )
}

/** "Ask about this file" (session Files): adds the path to the session's instruction. */
export function AskAboutFileButton({ onAsk }: { onAsk: () => void }) {
  return (
    <Button size="xs" variant="secondary" leadingIcon={MessageSquarePlus} onClick={onAsk}>
      Ask about this file
    </Button>
  )
}

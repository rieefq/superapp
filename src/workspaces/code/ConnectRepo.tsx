import { useId, useRef, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { ArrowRight, FolderGit2 } from 'lucide-react'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { formatResetTime, GithubRequestError, parseRepoInput } from '@/core/github'
import { connectDemoRepo, connectGithubRepo } from '@/core/services'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import type { Repo } from '@/core/types'
import { Button, Dialog, Field, Input, SimBadge, toast } from '@/ui'
import { useFetchRateLimit, useRateLimit } from './hooks'
import { fileCount, rateLimitText } from './logic'
import { REPO_SIM_EXPLANATION } from './parts'
import { useGo } from './hooks'

/**
 * "Connect a repository" (§6.3): a GitHub repository read live (owner/name or a github.com URL), or
 * the bundled demo repository (simulated). Opened from the list pane, Code home, ⌘K and `/code?connect=1`.
 */

interface ConnectDialogState {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useConnectDialog = create<ConnectDialogState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

export function openConnectDialog(): void {
  useConnectDialog.getState().setOpen(true)
}

/** The friendly sentence for a failed connect, with the fix (§8.3: what happened, why, next step). */
export function connectErrorMessage(err: unknown): string {
  if (err instanceof GithubRequestError) {
    switch (err.kind) {
      case 'not_found':
        return 'Repository not found. Check the owner and name — private repositories need a GitHub token in Integrations.'
      case 'rate_limited':
        return `GitHub rate limit reached${err.resetAt ? ` — resets at ${formatResetTime(err.resetAt)}` : ''}. Add a token in Integrations for higher limits, or use the demo repository.`
      case 'unauthorized':
        return 'GitHub rejected the token. Update or remove it in Integrations › GitHub.'
      case 'forbidden':
        return 'GitHub denied access to this repository. Check the token’s permissions in Integrations › GitHub.'
      case 'network':
        return 'Couldn’t reach GitHub. Check your connection and try again.'
      default:
        return err.message
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export function ConnectRepoDialog() {
  const open = useConnectDialog((s) => s.open)
  const setOpen = useConnectDialog((s) => s.setOpen)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="md"
      title="Connect a repository"
      description="Coding agents read a GitHub repository live, or work in the bundled demo repository."
    >
      {open && <ConnectForm onDone={() => setOpen(false)} />}
    </Dialog>
  )
}

function ConnectForm({ onDone }: { onDone: () => void }) {
  const navigate = useGo()
  const scope = useScope()
  const project = useDB((s: Tables) => (scope ? s.projects[scope] : undefined))
  const demo = useDB((s: Tables) => Object.values(s.repos).find((r) => r.provider === 'demo'))
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const formId = useId()
  const rate = useRateLimit()
  useFetchRateLimit(true)

  const finish = (repo: Repo, fresh: boolean) => {
    onDone()
    const files = fileCount(repo.tree)
    toast({
      tone: 'success',
      title: fresh ? `Connected ${repo.fullName}` : `${repo.fullName} is already connected`,
      description: repo.mode === 'live' ? `${files.toLocaleString('en-US')} files read live from GitHub.${repo.treeTruncated ? ' The tree is partial.' : ''}` : 'The demo repository is bundled with Atrium. Its sessions are simulated.',
    })
    navigate(`/code/repos/${encodeURIComponent(repo.id)}`)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const input = value.trim()
    if (!input) {
      setError('Enter a repository as owner/name or a github.com URL.')
      inputRef.current?.focus()
      return
    }
    if (!parseRepoInput(input)) {
      setError('That doesn’t look like a GitHub repository. Use owner/name or a github.com URL.')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const before = new Set(Object.keys(useDB.getState().repos))
    try {
      const repo = await connectGithubRepo(input, { projectId: scope })
      finish(repo, !before.has(repo.id))
    } catch (err) {
      setError(connectErrorMessage(err))
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  const startWithDemo = () => {
    const existed = !!demo
    const repo = connectDemoRepo({ projectId: scope })
    finish(repo, !existed)
  }

  return (
    <div className="flex flex-col gap-5">
      <form id={formId} onSubmit={submit} className="flex flex-col gap-3" aria-busy={busy}>
        <Field
          label="GitHub repository"
          error={error ?? undefined}
          hint={error ? undefined : 'Public repositories work without a token. Files are read live; commands, tests and pull requests stay simulated.'}
        >
          <Input
            ref={inputRef}
            value={value}
            onValueChange={(v) => {
              setValue(v)
              if (error) setError(null)
            }}
            placeholder="owner/repo or GitHub URL"
            icon={FolderGit2}
            autoComplete="off"
            spellCheck={false}
            data-autofocus=""
            className="font-mono text-[13px]"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="type-meta min-w-0 flex-1 text-ink-3" aria-live="polite">
            {busy ? 'Reading the repository from GitHub…' : rate ? rateLimitText(rate) : project ? `Files into ${project.name}` : ''}
          </span>
          <Button type="submit" variant="primary" loading={busy} trailingIcon={ArrowRight} kbd="enter">
            Connect
          </Button>
        </div>
      </form>

      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="type-label text-ink-4">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <section aria-label="Demo repository" className="flex flex-col gap-3 rounded-md border border-dashed border-line-input p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="type-mono-sm truncate text-ink">
              {DEMO_REPO.owner}/{DEMO_REPO.name}
            </span>
            <SimBadge explanation={REPO_SIM_EXPLANATION} />
          </div>
          <p className="type-caption text-ink-2">
            {DEMO_REPO.language} · {DEMO_REPO.files.length} files · bundled with Atrium. Sessions on it are simulated end to end.
          </p>
        </div>
        <Button variant="secondary" onClick={startWithDemo} disabled={busy} className="shrink-0">
          {demo ? 'Open the demo repository' : 'Use the demo repository'}
        </Button>
      </section>
    </div>
  )
}

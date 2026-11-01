import { useMemo } from 'react'
import { FolderX } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import type { CodeSession, FileChange } from '@/core/types'
import { EmptyState } from '@/ui'
import { insertIntoComposer } from '../drafts'
import { askAboutFile } from '../logic'
import { AskAboutFileButton, CopyPathButton, HoldFileButton, OpenOnGithubButton } from '../repo/FileActions'
import { RepoBrowser } from '../repo/RepoBrowser'

/**
 * Files (§6.3): the repository's tree (live GitHub, or the demo repository) and a read-only viewer on
 * the base branch. Files this session changed are marked; "Ask about this file" adds its path to the
 * instruction, "Hold file" makes it ride along in every new AI action.
 */
export function FilesPane({
  session, path, onPath, onAsk, onReviewFile,
}: { session: CodeSession; path: string | null; onPath: (p: string | null) => void; onAsk: () => void; onReviewFile: (path: string) => void }) {
  const repo = useDB((s: Tables) => s.repos[session.repoId])
  const changed = useMemo(() => new Map<string, FileChange['changeType']>(session.changes.map((c) => [c.path, c.changeType])), [session.changes])
  if (!repo) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState compact icon={FolderX} title="Repository disconnected" description="Its files can’t be read until it is connected again. Proposed changes stay in Changes." />
      </div>
    )
  }
  return (
    <RepoBrowser
      repo={repo}
      path={path}
      onPath={onPath}
      changed={changed}
      notice={(p) =>
        changed.has(p) ? (
          <p className="type-caption flex shrink-0 items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-ink-2">
            Showing {repo.defaultBranch}. This session changes this file.
            <button type="button" onClick={() => onReviewFile(p)} className="rounded-xs font-medium text-ink underline decoration-line-input underline-offset-2 hover:decoration-ink">
              Review the change
            </button>
          </p>
        ) : null
      }
      actions={(p, file) => (
        <>
          <AskAboutFileButton
            onAsk={() => {
              insertIntoComposer(session.id, askAboutFile(p))
              onAsk()
            }}
          />
          <HoldFileButton repo={repo} path={p} file={file} />
          <CopyPathButton path={p} />
          <OpenOnGithubButton repo={repo} path={p} />
        </>
      )}
    />
  )
}

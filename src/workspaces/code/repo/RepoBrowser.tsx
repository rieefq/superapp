import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, FileQuestion, FileWarning, FolderTree, TriangleAlert } from 'lucide-react'
import { formatResetTime } from '@/core/github'
import type { RepoFileContent } from '@/core/services'
import type { FileChange, Repo } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { Button, CodeBlock, EmptyState, ErrorState, FileIcon, SearchField, Skeleton, Tree, languageLabel, type TreeNode } from '@/ui'
import { useElementWidth, useRepoFile } from '../hooks'
import { buildFileTree, CHANGE_LETTER, defaultExpanded, fileCount, splitPath, type FileTreeNode } from '../logic'
import { RepoModeBadge } from '../parts'

export interface RepoBrowserProps {
  repo: Repo
  /** The open file (null: none). */
  path: string | null
  onPath: (path: string | null) => void
  /** Files a session changed (marked in the tree with their M/A/D letter). */
  changed?: ReadonlyMap<string, FileChange['changeType']>
  /** Actions in the viewer header for the open file. */
  actions?: (path: string, file: RepoFileContent | undefined) => ReactNode
  /** Under the viewer header (e.g. "This file has changes in this session · Review"). */
  notice?: (path: string) => ReactNode
}

function toTreeNodes(nodes: readonly FileTreeNode[], changed?: ReadonlyMap<string, FileChange['changeType']>): TreeNode[] {
  return nodes.map((n) => {
    const letter = changed?.get(n.id)
    return {
      id: n.id,
      label: n.label,
      ...(n.children ? { children: toTreeNodes(n.children, changed) } : {}),
      ...(letter ? { meta: <span title={`Changed in this session (${letter})`}>{CHANGE_LETTER[letter]}</span> } : {}),
    }
  })
}

/**
 * Repository files (§6.3 Files, the repo explorer): a filterable tree and a read-only viewer with line
 * numbers and syntax highlighting. GitHub repositories are read live (loading, not-found and rate-limit
 * states; cached files still open); the demo repository is bundled. Narrow panes show one at a time.
 */
export function RepoBrowser({ repo, path, onPath, changed, actions, notice }: RepoBrowserProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(rootRef)
  const wide = width === 0 || width >= 680
  const showTree = wide || !path
  const showViewer = wide || !!path
  return (
    <div ref={rootRef} className="flex min-h-0 flex-1">
      {showTree && <FileTreePane repo={repo} path={path} onPath={onPath} changed={changed} className={wide ? 'w-[256px] shrink-0 border-r border-line' : 'flex-1'} />}
      {showViewer && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {path ? (
            <FileViewer repo={repo} path={path} actions={actions} notice={notice} onBack={wide ? undefined : () => onPath(null)} />
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState compact icon={FolderTree} title="Pick a file" description={`Choose a file in the tree to read it${repo.mode === 'live' ? ' live from GitHub' : ''}.`} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const FileTreePane = memo(function FileTreePane({
  repo, path, onPath, changed, className,
}: { repo: Repo; path: string | null; onPath: (p: string | null) => void; changed?: ReadonlyMap<string, FileChange['changeType']>; className?: string }) {
  const [filter, setFilter] = useState('')
  const files = repo.tree ?? []
  const nodes = useMemo(() => toTreeNodes(buildFileTree(files), changed), [files, changed])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded(files, path)))
  // Opening a file from elsewhere (a link, ?path=) reveals it in the tree.
  const [lastPath, setLastPath] = useState(path)
  if (path !== lastPath) {
    setLastPath(path)
    if (path) {
      const parts = path.split('/')
      const missing = parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/')).filter((d) => !expanded.has(d))
      if (missing.length) setExpanded(new Set([...expanded, ...missing]))
    }
  }
  const count = fileCount(files)
  const open = (node: TreeNode) => {
    if (!node.children) onPath(node.id)
  }
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line px-3 py-2.5">
        <SearchField size="sm" value={filter} onValueChange={setFilter} placeholder="Filter files by name" aria-label="Filter files by name" />
        <p className="type-meta flex items-center gap-1.5 text-ink-3">
          {count.toLocaleString('en-US')} files · {repo.defaultBranch}
          <RepoModeBadge repo={repo} />
        </p>
      </div>
      {repo.treeTruncated && (
        <p className="type-caption flex shrink-0 items-start gap-1.5 border-b border-line bg-attn-tint/40 px-3 py-2 text-ink-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-attn" strokeWidth={1.75} />
          Partial tree: GitHub listed only part of this large repository. Some files are missing.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1.5">
        {count === 0 ? (
          <EmptyState compact icon={FileQuestion} title="No files" description={repo.mode === 'live' ? 'This repository is empty, or its tree has not been read yet. Refresh it from GitHub.' : 'The demo tree is missing. Refresh the repository.'} />
        ) : (
          <Tree
            nodes={nodes}
            label={`Files in ${repo.fullName}`}
            selectedId={path}
            onSelect={open}
            onActivate={open}
            expanded={expanded}
            onExpandedChange={setExpanded}
            filter={filter}
            dense
            emptyText={`No files match “${filter}”.`}
          />
        )}
      </div>
    </div>
  )
})

function FileViewer({
  repo, path, actions, notice, onBack,
}: { repo: Repo; path: string; actions?: RepoBrowserProps['actions']; notice?: RepoBrowserProps['notice']; onBack?: () => void }) {
  const { load, retry } = useRepoFile(repo.id, path)
  const { dir, base } = splitPath(path)
  const file = load.state === 'ready' ? load.file : undefined
  const lines = file && !file.skipped ? file.content.split('\n').length - (file.content.endsWith('\n') ? 1 : 0) : undefined
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-1.5 pr-2 pl-3">
        {onBack && <Button size="xs" variant="ghost" leadingIcon={ArrowLeft} onClick={onBack} className="-ml-1">Files</Button>}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <FileIcon name={base} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate font-mono text-xs" title={path}>
            <span className="text-ink-3">{dir}</span>
            <span className="text-ink">{base}</span>
          </span>
        </span>
        <span className="type-meta hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          {file?.language && <span>{languageLabel(file.language)}</span>}
          {lines !== undefined && <span>· {lines.toLocaleString('en-US')} lines</span>}
          {file && <span>· {formatBytes(file.size)}</span>}
        </span>
        {actions && <span className="flex shrink-0 flex-wrap items-center gap-1">{actions(path, file)}</span>}
      </header>
      {notice?.(path)}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" aria-busy={load.state === 'loading'}>
        {load.state === 'loading' || load.state === 'idle' ? (
          <div className="flex flex-col gap-2.5 px-4 py-4" aria-label={repo.mode === 'live' ? 'Reading the file from GitHub' : 'Loading the file'}>
            {[62, 48, 71, 36, 55, 44, 67, 30].map((w, i) => (
              <span key={i} className="flex items-center gap-3">
                <Skeleton width={18} height={9} />
                <Skeleton width={`${w}%`} height={9} />
              </span>
            ))}
          </div>
        ) : load.state === 'error' ? (
          <div className="p-4">
            <ErrorState
              compact
              title={load.kind === 'rate_limited' ? 'GitHub rate limit reached' : load.kind === 'not_found' ? 'Couldn’t find this file' : 'Couldn’t read this file'}
              message={
                load.kind === 'rate_limited'
                  ? `GitHub stopped answering for now${load.resetAt ? ` — it resets at ${formatResetTime(load.resetAt)}` : ''}. Cached files still open. Add a token in Integrations › GitHub for higher limits.`
                  : load.kind === 'not_found'
                    ? `${path} isn’t on ${repo.defaultBranch} anymore. Refresh the repository to update the tree.`
                    : load.message
              }
              details={load.message}
              onRetry={retry}
            />
          </div>
        ) : file?.skipped ? (
          <div className="p-6">
            <EmptyState compact icon={FileWarning} title={file.skipped === 'binary' ? 'Binary file not shown' : 'Too large to preview'} description={file.content} />
          </div>
        ) : file ? (
          <CodeBlock code={file.content} filename={path} language={file.language} lineNumbers bare className="min-h-full rounded-none border-0" />
        ) : null}
      </div>
    </div>
  )
}

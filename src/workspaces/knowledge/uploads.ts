import { create } from 'zustand'
import { importFiles } from '@/core/services/knowledge'
import type { ID, KnowledgeItem } from '@/core/types'

/**
 * In-flight imports (per-file progress rows, §6.7 "Progress shows per file"). Files are read locally in
 * the browser — never uploaded. Done rows clear themselves after a few seconds; a file that could not be
 * read keeps its row with the reason, Retry and Dismiss ("File read error: inline on the file's row").
 * Module state (not persisted): imports started from ⌘K show up when the library opens.
 */

export type UploadStatus = 'queued' | 'reading' | 'done' | 'error'

export interface UploadRow {
  id: string
  name: string
  size: number
  status: UploadStatus
  itemId?: ID
  title?: string
  error?: string
  /** Kept for Retry. */
  file: File
  target: UploadTarget
}

export interface UploadTarget {
  collectionId?: ID | null
  projectId?: ID | null
}

interface UploadState {
  rows: UploadRow[]
}

export const useUploads = create<UploadState>(() => ({ rows: [] }))

const DONE_LINGER_MS = 4000
let seq = 0

function patch(id: string, next: Partial<UploadRow>): void {
  useUploads.setState((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, ...next } : r)) }))
}

function scheduleClear(id: string): void {
  setTimeout(() => {
    useUploads.setState((s) => ({ rows: s.rows.filter((r) => !(r.id === id && r.status === 'done')) }))
  }, DONE_LINGER_MS)
}

async function run(rows: UploadRow[]): Promise<KnowledgeItem[]> {
  const byTarget = new Map<string, UploadRow[]>()
  for (const r of rows) {
    const key = `${r.target.collectionId ?? ''}|${r.target.projectId ?? ''}`
    byTarget.set(key, [...(byTarget.get(key) ?? []), r])
  }
  const all: KnowledgeItem[] = []
  for (const group of byTarget.values()) {
    const target = group[0].target
    const items = await importFiles(
      group.map((r) => r.file),
      {
        collectionId: target.collectionId ?? null,
        projectId: target.projectId ?? null,
        notifyErrors: false,
        onProgress: (e) => {
          const row = group[e.index]
          if (!row) return
          if (e.status === 'reading') patch(row.id, { status: 'reading' })
          else if (e.status === 'done') {
            patch(row.id, { status: 'done', itemId: e.item?.id, title: e.item?.title })
            scheduleClear(row.id)
          } else patch(row.id, { status: 'error', error: e.error })
        },
      },
    )
    all.push(...items)
  }
  return all
}

/** Read files into Knowledge with per-file progress. Resolves with the items that were created. */
export function uploadFiles(files: readonly File[], target: UploadTarget = {}): Promise<KnowledgeItem[]> {
  if (!files.length) return Promise.resolve([])
  const rows: UploadRow[] = files.map((file) => ({
    id: `upl_${++seq}`,
    name: file.name,
    size: file.size,
    status: 'queued',
    file,
    target,
  }))
  useUploads.setState((s) => ({ rows: [...s.rows, ...rows] }))
  return run(rows)
}

/** Read a failed file again. */
export function retryUpload(id: string): Promise<KnowledgeItem[]> {
  const row = useUploads.getState().rows.find((r) => r.id === id)
  if (!row) return Promise.resolve([])
  patch(id, { status: 'queued', error: undefined })
  return run([{ ...row, status: 'queued', error: undefined }])
}

export function dismissUpload(id: string): void {
  useUploads.setState((s) => ({ rows: s.rows.filter((r) => r.id !== id) }))
}

/** Test helper. */
export function __resetUploads(): void {
  useUploads.setState({ rows: [] })
}

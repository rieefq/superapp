import { useEffect, useRef, useState, type RefObject } from 'react'
import { classifyFile, createImagePreview, readTextFile } from '@/core/services/fileImport'
import type { Attachment } from '@/core/types'
import { newId } from '@/lib/id'

/**
 * File attachments for composers: files are read locally in the browser (never uploaded).
 * Text-like files keep their extracted text; images keep a small JPEG preview (vision models
 * receive it); PDFs and binaries keep only their name and size, and say so.
 */

/** Text attached to a single message is capped so one file cannot flood the context. */
export const ATTACHMENT_TEXT_BYTES = 200 * 1024

export async function fileToAttachment(file: File): Promise<Attachment> {
  const base = { id: newId('att'), name: file.name, mime: file.type || 'application/octet-stream', size: file.size }
  const cls = classifyFile(file)
  if (cls === 'text') {
    const { text, truncated } = await readTextFile(file, ATTACHMENT_TEXT_BYTES)
    return { ...base, kind: 'text', text: truncated ? `${text}\n\n[Truncated: only the first 200 KB of ${file.name} were read.]` : text }
  }
  if (cls === 'image') {
    const preview = await createImagePreview(file)
    return preview ? { ...base, kind: 'image', previewUrl: preview.dataUrl } : { ...base, kind: 'image' }
  }
  return { ...base, kind: cls === 'pdf' ? 'pdf' : 'other' }
}

/** Read several files; files that fail to read are reported, the rest still attach. */
export async function filesToAttachments(files: readonly File[]): Promise<{ attachments: Attachment[]; failed: string[] }> {
  const settled = await Promise.allSettled(files.map(fileToAttachment))
  const attachments: Attachment[] = []
  const failed: string[] = []
  settled.forEach((r, i) => (r.status === 'fulfilled' ? attachments.push(r.value) : failed.push(files[i].name)))
  return { attachments, failed }
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/**
 * Drop files anywhere on a stage container (§5.4.10 "Dropping files anywhere on the stage attaches them").
 * Returns `dragging` so the host can draw the drop overlay (a solid 1px ink outline on --accent-tint).
 */
export function useStageDrop(target: RefObject<HTMLElement | null>, onFiles: (files: File[]) => void, enabled = true): { dragging: boolean } {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const handler = useRef(onFiles)
  handler.current = onFiles

  useEffect(() => {
    const el = target.current
    if (!el || !enabled) return
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) handler.current(files)
    }
    el.addEventListener('dragenter', onEnter)
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragenter', onEnter)
      el.removeEventListener('dragover', onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop', onDrop)
      depth.current = 0
    }
  }, [target, enabled])

  return { dragging }
}

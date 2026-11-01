/**
 * Real downloads for procedural artwork: the same node tree the screen renders, serialized
 * to standalone SVG, or rasterized to PNG through a canvas.
 */
import { buildArt, toSvgString, type ProceduralSpec } from './generate'

/** Standalone SVG markup at the given pixel size (composition matches width / height). */
export function exportArtSvg(spec: ProceduralSpec, width: number, height: number): string {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const tree = buildArt(spec, w / h, `art${Math.abs(Math.floor(spec.seed))}`)
  tree.attrs.width = w
  tree.attrs.height = h
  return `<?xml version="1.0" encoding="UTF-8"?>\n${toSvgString(tree)}`
}

/** Rasterize to a PNG blob (browser only). */
export async function exportArtPng(spec: ProceduralSpec, width: number, height: number): Promise<Blob> {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const svg = exportArtSvg(spec, w, h)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not render the artwork'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const g = canvas.getContext('2d')
    if (!g) throw new Error('Canvas is unavailable')
    g.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Export and trigger a browser download (`format` defaults to png). */
export async function downloadArt(
  spec: ProceduralSpec,
  opts: { width: number; height: number; format?: 'png' | 'svg'; filename?: string },
): Promise<void> {
  const format = opts.format ?? 'png'
  const blob =
    format === 'svg'
      ? new Blob([exportArtSvg(spec, opts.width, opts.height)], { type: 'image/svg+xml' })
      : await exportArtPng(spec, opts.width, opts.height)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = opts.filename ?? `artwork-${spec.seed}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

import type { ComponentType, SVGProps } from 'react'
import {
  CodeXml,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileDatabase,
  FileImage,
  FileKey,
  FileLock,
  FileMusic,
  FilePlay,
  FileTerminal,
  FileText,
  FileType,
  FlaskConical,
  Folder,
  FolderOpen,
  Palette,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { FILE_KIND_HUE, fileKind, type FileKind } from './logic'

type Icon = ComponentType<SVGProps<SVGSVGElement>>

const KIND_ICON: Record<FileKind, Icon> = {
  folder: Folder,
  code: FileCode,
  test: FlaskConical,
  markup: CodeXml,
  style: Palette,
  data: FileBraces,
  config: FileCog,
  doc: FileText,
  image: FileImage,
  video: FilePlay,
  audio: FileMusic,
  archive: FileArchive,
  lock: FileLock,
  env: FileKey,
  shell: FileTerminal,
  database: FileDatabase,
  font: FileType,
  file: File,
}

const HUE_TEXT: Record<string, string> = {
  volt: 'text-hue-volt',
  sky: 'text-hue-sky',
  violet: 'text-hue-violet',
  coral: 'text-hue-coral',
  amber: 'text-hue-amber',
  mint: 'text-hue-mint',
  rose: 'text-hue-rose',
  cyan: 'text-hue-cyan',
}

export interface FileIconProps extends SVGProps<SVGSVGElement> {
  /** File or directory name / path. */
  name: string
  directory?: boolean
  /** For directories: open state. */
  open?: boolean
  /** Force a kind instead of inferring it from the name. */
  kind?: FileKind
  /** Drop the identity tint (monochrome ink-3). */
  muted?: boolean
}

/** Icon for a file by extension/kind; identity hues are used sparingly for scannable kinds. */
export function FileIcon({ name, directory, open, kind, muted, className, ...props }: FileIconProps) {
  const k = kind ?? fileKind(name, directory)
  const Ico = k === 'folder' && open ? FolderOpen : KIND_ICON[k]
  const hue = FILE_KIND_HUE[k]
  return (
    <Ico
      aria-hidden
      strokeWidth={1.75}
      className={cn('size-4 shrink-0', !muted && hue ? HUE_TEXT[hue] : 'text-ink-3', className)}
      {...props}
    />
  )
}

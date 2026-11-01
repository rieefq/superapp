import {
  Clapperboard,
  FileText,
  Image,
  ListChecks,
  NotebookPen,
  Orbit,
  Palette,
  Presentation,
  SquareTerminal,
  Telescope,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { StartKind } from '@/app/shell/store'
import type { Autonomy } from '@/core/types'

/** The seven kinds of the Start sheet (§5.4.11), in the segmented control's order. */
export const START_KINDS: readonly StartKind[] = ['task', 'research', 'session', 'agent', 'workflow', 'note', 'studio']

export interface StartKindMeta {
  label: string
  /** Header noun: "New research", "Research from …". */
  noun: string
  icon: LucideIcon
  /** Starting it produces a Run (split Start ⏎ / Start in background ⌘⏎); otherwise "Create ⏎". */
  runs: boolean
  /** Label of the brief field. */
  briefLabel: string
  briefPlaceholder: string
  /** Show the title field. */
  title: boolean
  /** Placeholder of the title field. */
  titlePlaceholder?: string
}

export const START_KIND_META: Record<StartKind, StartKindMeta> = {
  task: {
    label: 'Task',
    noun: 'Task',
    icon: ListChecks,
    runs: false,
    briefLabel: 'Description',
    briefPlaceholder: 'What needs to happen, and what “done” looks like',
    title: true,
  },
  research: {
    label: 'Research',
    noun: 'Research',
    icon: Telescope,
    runs: true,
    briefLabel: 'Question',
    briefPlaceholder: 'What do you want to find out?',
    title: true,
    titlePlaceholder: 'Optional — derived from the question',
  },
  session: {
    label: 'Coding session',
    noun: 'Coding session',
    icon: SquareTerminal,
    runs: true,
    briefLabel: 'Instruction',
    briefPlaceholder: 'Describe the change you want',
    title: true,
    titlePlaceholder: 'Optional — derived from the instruction',
  },
  agent: {
    label: 'Agent',
    noun: 'Agent run',
    icon: Orbit,
    runs: true,
    briefLabel: 'Instruction',
    briefPlaceholder: 'What should the agent do?',
    title: false,
  },
  workflow: {
    label: 'Workflow run',
    noun: 'Workflow run',
    icon: Workflow,
    runs: true,
    briefLabel: 'Note',
    briefPlaceholder: '',
    title: false,
  },
  note: {
    label: 'Note',
    noun: 'Note',
    icon: NotebookPen,
    runs: false,
    briefLabel: 'Content',
    briefPlaceholder: 'Write the note — Markdown works',
    title: true,
    titlePlaceholder: 'Optional — the first line is used',
  },
  studio: {
    label: 'Studio',
    noun: 'Studio draft',
    icon: Palette,
    runs: true,
    briefLabel: 'Prompt',
    briefPlaceholder: 'Describe what to make',
    title: true,
    titlePlaceholder: 'Optional — derived from the prompt',
  },
}

export type StudioKind = 'document' | 'presentation' | 'image' | 'video'

export const STUDIO_KINDS: { value: StudioKind; label: string; icon: LucideIcon }[] = [
  { value: 'document', label: 'Doc', icon: FileText },
  { value: 'presentation', label: 'Deck', icon: Presentation },
  { value: 'image', label: 'Image', icon: Image },
  { value: 'video', label: 'Video', icon: Clapperboard },
]

export const AUTONOMY_OPTIONS: { value: Autonomy; label: string; effect: string }[] = [
  { value: 'supervised', label: 'Supervised', effect: 'Asks before every change it makes: edits, commands and pull requests.' },
  { value: 'balanced', label: 'Balanced', effect: 'Asks before medium- and high-risk actions, such as running commands.' },
  { value: 'autonomous', label: 'Autonomous', effect: 'Asks only before high-risk actions, such as opening a pull request.' },
]

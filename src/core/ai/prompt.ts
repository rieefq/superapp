/**
 * Prompt formats shared by chat orchestration (which writes them) and the local
 * simulator (which reads them back to ground its answers). Keeping both directions in
 * one module guarantees the simulator understands exactly what chat sends to real models.
 */

export const ATRIUM_IDENTITY =
  "You are Atrium, an AI collaborator inside the user's workspace. Be direct, structured and honest; say when you are unsure."

export const CITE_INSTRUCTION = 'When you use a document, cite it inline as [n].'

/** A retrieved knowledge passage, numbered for inline [n] citations. */
export interface KnowledgeDoc {
  /** 1-based; matches the [n] marker and the message's citation order. */
  index: number
  title: string
  passage: string
}

export interface PromptProject {
  name: string
  goal?: string
  instructions?: string
}

export interface SystemPromptInput {
  now: number
  userName?: string
  project?: PromptProject | null
  /** One-line summaries of pinned non-knowledge context ("Task: “Fix login” (in progress)"). */
  context?: string[]
  docs?: KnowledgeDoc[]
}

// ---------------------------------------------------------------- escaping

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(text: string): string {
  return escapeXml(text).replace(/"/g, '&quot;')
}

function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// ---------------------------------------------------------------- system prompt

export function formatPromptDate(now: number): string {
  return new Date(now).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

/** `<knowledge><doc index="1" title="…">passage</doc>…</knowledge>` */
export function formatKnowledgeBlock(docs: readonly KnowledgeDoc[]): string {
  const lines = docs.map((d) => `<doc index="${d.index}" title="${escapeAttr(d.title)}">${escapeXml(d.passage.trim())}</doc>`)
  return ['<knowledge>', ...lines, '</knowledge>'].join('\n')
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const parts: string[] = [ATRIUM_IDENTITY]
  const facts = [`Today's date is ${formatPromptDate(input.now)}.`]
  if (input.userName?.trim()) facts.push(`The user's name is ${input.userName.trim()}.`)
  parts.push(facts.join('\n'))

  const project = input.project
  if (project) {
    const lines = [`This conversation is part of the project “${project.name}”.`]
    if (project.goal?.trim()) lines.push(`Project goal: ${project.goal.trim()}`)
    if (project.instructions?.trim()) lines.push(`Project instructions: ${project.instructions.trim()}`)
    parts.push(lines.join('\n'))
  }

  if (input.context?.length) {
    parts.push(['The user pinned this context:', ...input.context.map((c) => `- ${c}`)].join('\n'))
  }

  if (input.docs?.length) {
    parts.push(
      [
        'Relevant passages from the user’s knowledge base:',
        formatKnowledgeBlock(input.docs),
        CITE_INSTRUCTION,
      ].join('\n'),
    )
  }
  return parts.join('\n\n')
}

// ---------------------------------------------------------------- parsing (simulator side)

/** Read the numbered knowledge passages back out of a system prompt. */
export function parseKnowledgeBlock(system: string | undefined): KnowledgeDoc[] {
  if (!system) return []
  const block = /<knowledge>([\s\S]*?)<\/knowledge>/.exec(system)
  if (!block) return []
  const docs: KnowledgeDoc[] = []
  const re = /<doc\s+index="(\d+)"\s+title="([^"]*)"\s*>([\s\S]*?)<\/doc>/g
  for (let m = re.exec(block[1]); m; m = re.exec(block[1])) {
    const passage = unescapeXml(m[3]).trim()
    if (passage) docs.push({ index: Number(m[1]), title: unescapeXml(m[2]), passage })
  }
  return docs
}

export interface PromptFacts {
  userName?: string
  projectName?: string
  projectGoal?: string
  /** "Sunday, November 1, 2026" */
  date?: string
}

/** Extract the small facts the simulator personalizes with (name, project, goal). */
export function parsePromptFacts(system: string | undefined): PromptFacts {
  if (!system) return {}
  const body = system.replace(/<knowledge>[\s\S]*?<\/knowledge>/, '')
  return {
    userName: /^The user's name is (.+?)\.$/m.exec(body)?.[1],
    projectName: /^This conversation is part of the project “(.+?)”\.$/m.exec(body)?.[1],
    projectGoal: /^Project goal: (.+)$/m.exec(body)?.[1],
    date: /^Today's date is (.+?)\.$/m.exec(body)?.[1],
  }
}

// ---------------------------------------------------------------- attachments in user turns

const FILE_LABEL = 'Attached file:'
const NOTE_LABEL = 'Attached'

/** A fence longer than any backtick run inside `text` (CommonMark rule), at least three. */
function fenceFor(text: string): string {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

/** Text attachment as a fenced block labeled with the filename. */
export function formatAttachmentBlock(name: string, text: string): string {
  const fence = fenceFor(text)
  return `${FILE_LABEL} ${name}\n${fence}\n${text.replace(/\s+$/, '')}\n${fence}`
}

/** One-line note for attachments the model cannot read (images for non-vision models, binaries). */
export function formatAttachmentNote(name: string, kind: 'image' | 'file'): string {
  return kind === 'image'
    ? `${NOTE_LABEL} image: ${name} (not visible to this model)`
    : `${NOTE_LABEL} file: ${name} (contents not included)`
}

export interface ParsedFile {
  name: string
  text: string
}

export interface ParsedNote {
  name: string
  kind: 'image' | 'file'
}

export interface ParsedUserContent {
  /** What the user actually typed. */
  text: string
  files: ParsedFile[]
  notes: ParsedNote[]
}

/** Split a user turn into the typed request, fenced text attachments and attachment notes. */
export function parseUserContent(content: string): ParsedUserContent {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const kept: string[] = []
  const files: ParsedFile[] = []
  const notes: ParsedNote[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fileLabel = line.startsWith(`${FILE_LABEL} `) ? line.slice(FILE_LABEL.length + 1).trim() : null
    const fence = fileLabel !== null ? /^(`{3,})\s*$/.exec(lines[i + 1] ?? '') : null
    if (fileLabel !== null && fence) {
      const body: string[] = []
      let j = i + 2
      while (j < lines.length && lines[j].trim() !== fence[1]) body.push(lines[j++])
      files.push({ name: fileLabel, text: body.join('\n') })
      i = j
      continue
    }
    const note = /^Attached (image|file): (.+?) \((?:not visible to this model|contents not included)\)$/.exec(line)
    if (note) {
      notes.push({ kind: note[1] as 'image' | 'file', name: note[2] })
      continue
    }
    kept.push(line)
  }
  return { text: kept.join('\n').trim(), files, notes }
}

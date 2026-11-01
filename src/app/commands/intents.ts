/**
 * Starting work from the command center's intent row (§3.7, §8.1). `⏎` runs attached (you go to
 * the work); `⌘⏎` runs in the background (you stay; a pill enters the Run Line).
 */
import { db } from '@/core/db'
import { sendMessage, type Intent } from '@/core/ai'
import { createWorkflow, generateAsset, updateWorkflow } from '@/core/services'
import { draftWorkflowFromText, kindFromCreateText } from '@/core/assist'
import type { ID } from '@/core/types'
import { toast } from '@/ui'
import { openStartSheet, type StartKind } from '../shell/store'

export interface IntentRunInput {
  verb: Intent
  text: string
  title?: string
  projectId: ID | null
  background: boolean
  navigate: (to: string) => void
}

const START_KIND: Partial<Record<Intent, StartKind>> = {
  research: 'research',
  build: 'session',
  delegate: 'agent',
  organize: 'task',
}

/** Run an intent. Resolves when the work was started (or the Start sheet opened). */
export async function runIntent({ verb, text, title, projectId, background, navigate }: IntentRunInput): Promise<void> {
  const kind = START_KIND[verb]
  if (kind) {
    openStartSheet(kind, { prefill: { title: title ?? text, brief: text, ...(projectId ? { projectId } : {}) }, background })
    return
  }
  if (verb === 'ask') {
    // Held items ride along automatically (chat reads them at generation time).
    const result = await sendMessage({ text, projectId })
    if (background) {
      toast('Asked in a new conversation', { action: { label: 'Open', onClick: () => navigate(`/chat/${encodeURIComponent(result.threadId)}`) } })
    } else navigate(`/chat/${encodeURIComponent(result.threadId)}`)
    return
  }
  if (verb === 'create') {
    const { kind: assetKind, prompt } = kindFromCreateText(text)
    const asset = generateAsset({ kind: assetKind, prompt, projectId })
    if (background) {
      toast(`Generating “${asset.title}” (simulated)`, { action: { label: 'Open', onClick: () => navigate(`/studio/${encodeURIComponent(asset.id)}`) } })
    } else navigate(`/studio/${encodeURIComponent(asset.id)}`)
    return
  }
  // automate: a rule-based draft from the text (not AI), opened in the editor for review.
  let workflowId: ID
  try {
    const draft = draftWorkflowFromText(text, {
      agents: db.all('agents'),
      connections: db.all('connections'),
      runs: db.all('runs'),
    })
    const wf = createWorkflow({ name: draft.name, description: draft.description, projectId, trigger: draft.trigger })
    updateWorkflow(wf.id, { nodes: draft.nodes, edges: draft.edges })
    workflowId = wf.id
  } catch {
    const wf = createWorkflow({ name: title ?? text, description: text, projectId })
    workflowId = wf.id
  }
  if (background) {
    toast('Drafted a workflow from your request', {
      description: 'A rule-based draft. Review it before you turn it on.',
      action: { label: 'Open', onClick: () => navigate(`/workflows/${encodeURIComponent(workflowId)}`) },
    })
  } else navigate(`/workflows/${encodeURIComponent(workflowId)}`)
}

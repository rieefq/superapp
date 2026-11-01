import type { ID } from '@/core/types'

/**
 * Text commands of the Chat composer: `@Agent …` at the start of a message (§6.2: "sending it opens
 * the Start sheet as an Agent assignment"), and the arguments of `/agent <name> <instruction>`.
 */

export interface NamedAgent {
  id: ID
  name: string
  status?: string
}

export interface AgentMention {
  agentId: ID
  name: string
  instruction: string
}

const byLongestName = (agents: readonly NamedAgent[]) =>
  agents.filter((a) => a.status !== 'archived' && a.name.trim()).sort((a, b) => b.name.length - a.name.length)

/** Split "<name> <rest>" when `text` starts with an agent's name (case-insensitive, whole word). */
function leadingAgent(text: string, agents: readonly NamedAgent[]): { agent: NamedAgent; rest: string } | null {
  const lower = text.toLowerCase()
  for (const agent of byLongestName(agents)) {
    const name = agent.name.toLowerCase()
    if (!lower.startsWith(name)) continue
    const next = text.charAt(name.length)
    if (next && !/[\s,:;.!?]/.test(next)) continue
    return { agent, rest: text.slice(name.length).replace(/^[\s,:;.!?]+/, '').trim() }
  }
  return null
}

/** `@Scout compare EU suppliers` → Scout + "compare EU suppliers". Null when the message doesn't start with an agent. */
export function parseAgentMention(text: string, agents: readonly NamedAgent[]): AgentMention | null {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('@')) return null
  const hit = leadingAgent(trimmed.slice(1), agents)
  if (!hit) return null
  return { agentId: hit.agent.id, name: hit.agent.name, instruction: hit.rest }
}

/** `/agent Scout compare EU suppliers` arguments → the agent (if named) and the instruction. */
export function parseAgentArgs(args: string, agents: readonly NamedAgent[]): { agentId?: ID; instruction: string } {
  const trimmed = args.trim().replace(/^@/, '')
  const hit = leadingAgent(trimmed, agents)
  return hit ? { agentId: hit.agent.id, instruction: hit.rest } : { instruction: args.trim() }
}

/**
 * Place items made from the conversation itself (thread-level Turn into, slash commands, forks) after
 * the last message that existed when they were made. Returns message id → items, in time order;
 * items older than every message go under '' (before the first turn).
 */
export function placeAfterMessages<T extends { at: number }>(messages: readonly { id: ID; createdAt: number }[], items: readonly T[]): Map<ID, T[]> {
  const out = new Map<ID, T[]>()
  const sorted = [...items].sort((a, b) => a.at - b.at)
  for (const item of sorted) {
    let anchor = ''
    for (const m of messages) if (m.createdAt <= item.at) anchor = m.id
    const list = out.get(anchor)
    if (list) list.push(item)
    else out.set(anchor, [item])
  }
  return out
}

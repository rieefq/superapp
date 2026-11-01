import { Cpu, KeyRound, Plug, PlugZap, Server } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'
import { db } from '@/core/db'
import { INTEGRATION_CATEGORIES, INTEGRATIONS } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'

/** Focus the catalog's search field as soon as the catalog is on screen (navigation renders in a transition). */
function focusSearch() {
  const started = Date.now()
  const tick = () => {
    const input = window.location.pathname === '/integrations' ? document.querySelector<HTMLElement>('#main input[data-search-input]') : null
    if (input) input.focus()
    else if (Date.now() - started < 2000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const categoryLabel = (id: string) => INTEGRATION_CATEGORIES.find((c) => c.id === id)?.label ?? id

/** "Connected · simulated" / "Available · live" / "Error: token expired" — read when ⌘K opens. */
function statusSubtitle(id: string, support: 'live' | 'simulated'): string {
  const conn = db.get('connections', id)
  const mode = support === 'live' ? 'live' : 'simulated'
  if (!conn || conn.status === 'disconnected') return `Integration · ${conn ? 'Disconnected' : 'Available'} · ${mode}`
  if (conn.status === 'error') return `Integration · Error${conn.error ? `: ${conn.error}` : ''}`
  if (conn.status === 'connecting') return 'Integration · Connecting…'
  return `Integration · Connected · ${mode}`
}

export const manifest: WorkspaceManifest = {
  id: 'integrations',
  label: 'Integrations',
  description: 'Connect services and control what agents may do with them.',
  icon: Plug,
  group: 'system',
  path: '/integrations',
  chord: ['g', 'n'],
  newAction: {
    label: 'Connect a service',
    run: (ctx) => {
      ctx.navigate('/integrations')
      focusSearch()
    },
  },
  commands: (): Command[] => [
    {
      id: 'integrations.connect-anthropic',
      title: 'Connect a model',
      subtitle: 'Add your Anthropic API key — Claude models appear in every model picker',
      icon: KeyRound,
      group: 'Integrations',
      keywords: ['anthropic', 'claude', 'api key', 'model', 'live', 'provider'],
      priority: 40,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/integrations/anthropic')
      },
    },
    {
      id: 'integrations.connect-endpoint',
      title: 'Add an OpenAI-compatible endpoint',
      subtitle: 'Ollama, LM Studio, OpenRouter, vLLM',
      icon: Server,
      group: 'Integrations',
      keywords: ['openai', 'ollama', 'lm studio', 'openrouter', 'vllm', 'local model', 'endpoint'],
      priority: 39,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/integrations/openai-compatible')
      },
    },
    {
      id: 'integrations.connected',
      title: 'Show connected integrations',
      icon: PlugZap,
      group: 'Integrations',
      keywords: ['connections', 'connected', 'services', 'errors'],
      priority: 38,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/integrations?filter=connected')
      },
    },
    {
      id: 'integrations.simulator',
      title: 'Simulator',
      subtitle: 'AI models · Always on · simulated',
      icon: Cpu,
      group: 'Integrations',
      keywords: ['simulator', 'sim', 'swift', 'deep', 'local', 'model'],
      priority: 5,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/integrations/simulator')
      },
    },
    // Every catalog entry, so "slack" or "send messages" in ⌘K finds it (integrations aren't in the item index).
    ...INTEGRATIONS.map(
      (def, i): Command => ({
        id: `integrations.open.${def.id}`,
        title: def.name,
        subtitle: statusSubtitle(def.id, def.support),
        icon: Plug,
        group: 'Integrations',
        keywords: ['integration', 'connect', categoryLabel(def.category).toLowerCase(), ...def.capabilities.map((c) => CAPABILITIES[c].label.toLowerCase())],
        priority: 4 - i / 100,
        run: (ctx) => {
          ctx.close()
          ctx.navigate(`/integrations/${def.id}`)
        },
      }),
    ),
  ],
  shortcuts: [
    { keys: '/', label: 'Search the catalog' },
    { keys: 'arrowright', label: 'Move between cards (arrows; ↑↓ by row)' },
    { keys: 'enter', label: 'Open the focused integration' },
    { keys: 'space', label: 'Inspect the focused integration' },
  ],
  defaultInspectorTab: 'item',
}

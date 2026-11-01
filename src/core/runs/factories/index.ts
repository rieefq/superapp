import { registerAgentFactories } from './agent'
import { registerCodeFactories } from './code'
import { registerResearchFactories } from './research'
import { registerStudioFactories } from './studio'
import { registerWorkflowFactories } from './workflow'

let registered = false

/** Register every simulation script factory. Called once at app startup (before resuming runs). */
export function registerAllFactories(): void {
  if (registered) return
  registered = true
  registerAgentFactories()
  registerCodeFactories()
  registerResearchFactories()
  registerWorkflowFactories()
  registerStudioFactories()
}

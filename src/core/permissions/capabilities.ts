import type { Capability, CapabilityInfo } from '@/core/types'

/** Catalog of capabilities with their default risk. Icons are lucide-react names. */
export const CAPABILITIES: Record<Capability, CapabilityInfo> = {
  'knowledge.read': { id: 'knowledge.read', label: 'Read knowledge', description: 'Search and read documents, notes and files in Knowledge.', risk: 'low', icon: 'BookOpen' },
  'knowledge.write': { id: 'knowledge.write', label: 'Write knowledge', description: 'Create and update knowledge items.', risk: 'low', icon: 'BookPlus' },
  'web.search': { id: 'web.search', label: 'Search the web', description: 'Run web searches and collect sources.', risk: 'low', icon: 'Globe' },
  'web.browse': { id: 'web.browse', label: 'Browse pages', description: 'Open and read web pages.', risk: 'low', icon: 'Compass' },
  'repo.read': { id: 'repo.read', label: 'Read repositories', description: 'Read code, history and issues from connected repositories.', risk: 'low', icon: 'FolderGit2' },
  'repo.write': { id: 'repo.write', label: 'Modify code', description: 'Edit files and commit to a working branch.', risk: 'medium', icon: 'FileCode2' },
  'repo.pull_request': { id: 'repo.pull_request', label: 'Open pull requests', description: 'Push branches and open pull requests for review.', risk: 'high', icon: 'GitPullRequest' },
  'shell.execute': { id: 'shell.execute', label: 'Run commands', description: 'Execute terminal commands in the session sandbox (install, build, test).', risk: 'medium', icon: 'SquareTerminal' },
  'tasks.manage': { id: 'tasks.manage', label: 'Manage tasks', description: 'Create, update and complete project tasks.', risk: 'low', icon: 'ListChecks' },
  'messages.send': { id: 'messages.send', label: 'Send messages', description: 'Post to chat channels or send email on your behalf.', risk: 'high', icon: 'Send' },
  'calendar.manage': { id: 'calendar.manage', label: 'Manage calendar', description: 'Read availability and create or move events.', risk: 'medium', icon: 'CalendarClock' },
  'files.read': { id: 'files.read', label: 'Read files', description: 'Read files from connected storage.', risk: 'low', icon: 'FileText' },
  'files.write': { id: 'files.write', label: 'Write files', description: 'Create or modify files in connected storage.', risk: 'medium', icon: 'FilePen' },
  'media.generate': { id: 'media.generate', label: 'Generate media', description: 'Create images, video, audio and slides.', risk: 'low', icon: 'Sparkles' },
  'workflows.run': { id: 'workflows.run', label: 'Run workflows', description: 'Trigger automations.', risk: 'medium', icon: 'Workflow' },
  'data.query': { id: 'data.query', label: 'Query data', description: 'Run read-only queries against connected databases.', risk: 'medium', icon: 'Database' },
  'payments.spend': { id: 'payments.spend', label: 'Spend money', description: 'Make purchases or issue refunds.', risk: 'high', icon: 'CreditCard' },
}

export const CAPABILITY_LIST: CapabilityInfo[] = Object.values(CAPABILITIES)

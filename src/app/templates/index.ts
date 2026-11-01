/**
 * Workspace templates (docs/DESIGN.md §3.4, §6.0). Import from '@/app/templates'.
 * See README.md in this folder for the docking rule and examples.
 */
export { WorkspaceScreen, useWorkspaceScreen } from './WorkspaceScreen'
export type { WorkspaceScreenProps, WorkspaceScreenContextValue } from './WorkspaceScreen'
export { ListPane, ListGroup, ListRow, ListRows, ScopeFilterRow } from './ListPane'
export type { ListPaneProps, ListRowProps } from './ListPane'
export { Stage, useStagePrimary, measureClass } from './Stage'
export type { StageProps, StageMeasure } from './Stage'
export { StageHeader } from './StageHeader'
export type { StageHeaderProps, StageHeaderTabs } from './StageHeader'
export { PageTemplate, SessionTemplate, BoardTemplate, CanvasTemplate, LibraryTemplate } from './templates'
export type { PageTemplateProps, SessionTemplateProps, BoardTemplateProps, CanvasTemplateProps, CanvasDrawer, LibraryTemplateProps } from './templates'
// Shell hooks templates and workspaces commonly need.
export { useShellLayout } from '../shell/context'
export { useInspectEntity } from '../inspector/inspect'

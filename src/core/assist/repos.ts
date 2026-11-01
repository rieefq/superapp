import type { ID, Project, Repo } from '@/core/types'

/**
 * Default repository for a coding request in a scope:
 * 1. the project's own repositories — `project.repoIds` in order (when a project object is given),
 *    then repos whose `projectId` is the project, most recently synced first;
 * 2. otherwise the most recently synced connected (non-demo) repository, preferring ones that do
 *    not belong to a different project;
 * 3. otherwise the bundled demo repository;
 * 4. otherwise null.
 */
export function pickRepoForScope(
  scope: ID | Pick<Project, 'id' | 'repoIds'> | null | undefined,
  repos: readonly Repo[],
): ID | null {
  if (!repos.length) return null
  const projectId = typeof scope === 'string' ? scope : scope?.id ?? null
  const byId = new Map(repos.map((r) => [r.id, r]))
  const synced = (r: Repo) => r.lastSyncedAt ?? r.connectedAt
  const recentFirst = (a: Repo, b: Repo) => synced(b) - synced(a) || a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id)

  if (projectId) {
    if (scope && typeof scope === 'object') {
      const listed = scope.repoIds.find((id) => byId.has(id))
      if (listed) return listed
    }
    const own = repos.filter((r) => r.projectId === projectId).sort(recentFirst)
    if (own[0]) return own[0].id
  }

  const connected = repos
    .filter((r) => r.provider !== 'demo')
    .sort((a, b) => Number(isForeign(a, projectId)) - Number(isForeign(b, projectId)) || recentFirst(a, b))
  if (connected[0]) return connected[0].id

  const demo = repos.filter((r) => r.provider === 'demo').sort(recentFirst)
  return demo[0]?.id ?? null
}

/** Belongs to a project other than the one in scope. */
function isForeign(repo: Repo, projectId: ID | null): boolean {
  return !!repo.projectId && repo.projectId !== projectId
}

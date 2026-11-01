import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { loadLens } from '@/app/lens/registry'
import MyTasks from './MyTasks'
import ProjectPage from './ProjectPage'
import ProjectsIndex from './ProjectsIndex'

/**
 * Projects (§6.9) — goals, tasks and milestones for you and your agents. Routes (relative to
 * `projects/*`): the index, `my-tasks`, and `:projectId/(overview|tasks|work|activity|memory)`.
 * `?task=` selects a task (its drawer is Inspector › Item); `?new=1` opens New project.
 */
export default function ProjectsWorkspace() {
  // Warm the task/project lens so the first task opened in the Inspector draws at once.
  useEffect(() => {
    void loadLens('task').catch(() => undefined)
  }, [])
  return (
    <Routes>
      <Route index element={<ProjectsIndex />} />
      <Route path="my-tasks" element={<MyTasks />} />
      <Route path=":projectId/*" element={<ProjectPage />} />
    </Routes>
  )
}

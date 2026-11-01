/**
 * Bundled demo repository used for simulated coding sessions (no network needed).
 * STUB — files are filled in by the seed-operations implementation.
 */
export interface DemoRepoFile {
  path: string
  content: string
}

export interface DemoRepo {
  owner: string
  name: string
  defaultBranch: string
  description: string
  language: string
  files: DemoRepoFile[]
}

export const DEMO_REPO: DemoRepo = {
  owner: 'northwind',
  name: 'atlas-portal',
  defaultBranch: 'main',
  description: 'Atlas customer portal for freight & logistics teams (demo repository).',
  language: 'TypeScript',
  files: [],
}

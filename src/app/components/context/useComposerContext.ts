import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useContextStore } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { highlightText, retrieveKnowledge } from '@/core/search'
import { useSettings } from '@/core/settings'
import { refKey, sameRef, type Attachment, type EntityRef, type ID, type Project } from '@/core/types'
import { matchedTerms } from '../composer/text'
import { estimateAttachmentTokens, estimateMemoryTokens, estimateRefTokens, rowFor } from './tokens'

/**
 * The context an AI action will receive, as shown by the Context Line (§2.5, §5.4.10):
 * Project memory → Held → Attached → Likely. Every chip can be switched off for this action;
 * × removes it. `refs` is exactly what will be sent — hosts pass it to services.
 * ("No context reaches a model unless it appears in the Context Line.")
 */

export type ContextGroup = 'project' | 'held' | 'attached' | 'likely' | 'file'

export interface ContextEntry {
  /** Stable key: 'memory', a refKey, or 'file:<id>'. */
  key: string
  group: ContextGroup
  ref?: EntityRef
  file?: Attachment
  tokens: number
  /** Switched on for this action. */
  on: boolean
  /** Likely chips: the words of the draft that matched ("webhook", "retry"). */
  terms?: string[]
  exists: boolean
}

export interface ComposerContextRefs {
  /** Project the action runs in (null = no project). */
  projectId: ID | null
  /** Project memory (goal, instructions, pinned items) rides along. */
  projectMemory: boolean
  /** Project memory items that will be included. */
  memoryRefs: EntityRef[]
  held: EntityRef[]
  attached: EntityRef[]
  /** Auto-retrieved knowledge (sent when auto-retrieve is on, unless excluded). */
  likely: EntityRef[]
  /** File attachments that are switched on. */
  attachments: Attachment[]
  /** Every entity that will be sent, deduped, in Context Line order (memory items excluded: they travel with the project). */
  all: EntityRef[]
  /** Entities the user switched off or excluded for this action. */
  excluded: EntityRef[]
  /** Estimated tokens of everything above (not counting the draft text). */
  tokens: number
}

export interface ComposerContextOptions {
  /** Project override; undefined = the active scope. */
  projectId?: ID | null
  /** Controlled attached refs (e.g. a thread's contextRefs). */
  attached?: readonly EntityRef[]
  onAttachedChange?: (refs: EntityRef[]) => void
  /** Initial attached refs when uncontrolled (e.g. the Start sheet's source). */
  initialAttached?: readonly EntityRef[]
  /** Show and send likely (auto-retrieved) knowledge. Default: settings.ai.autoRetrieve. */
  autoRetrieve?: boolean
  /** Include held items. Default true. */
  includeHeld?: boolean
  /** Debounce for likely retrieval (ms). Default 350. */
  debounceMs?: number
}

export interface ComposerContext {
  projectId: ID | null
  project: Project | undefined
  /** Ordered entries: project memory, held, attached (files last), likely. */
  entries: ContextEntry[]
  refs: ComposerContextRefs
  /** Total estimated tokens of the context that is switched on (excludes the draft). */
  tokens: number
  draft: string
  files: Attachment[]
  /** Feed the current draft (likely retrieval is debounced). */
  setDraft: (text: string) => void
  isOn: (key: string) => boolean
  toggle: (key: string) => void
  /** Attach an entity (a likely item is promoted). */
  attach: (ref: EntityRef) => void
  /** Detach an attached entity. */
  detach: (ref: EntityRef) => void
  /** Exclude a likely item for this draft. */
  dismissLikely: (ref: EntityRef) => void
  addFiles: (files: Attachment[]) => void
  removeFile: (id: ID) => void
  /** Release a held item (global Holding). */
  release: (ref: EntityRef) => void
  /** Hold an item (global Holding) — e.g. Undo after a release. */
  hold: (ref: EntityRef) => void
  /** After a submit: clear per-action switches, likely, files and (uncontrolled) attachments. */
  reset: () => void
}

interface LikelyHit {
  ref: EntityRef
  terms: string[]
}

const EMPTY_REFS: EntityRef[] = []

function uniqRefs(refs: readonly EntityRef[]): EntityRef[] {
  const out: EntityRef[] = []
  for (const r of refs) if (!out.some((x) => sameRef(x, r))) out.push({ kind: r.kind, id: r.id })
  return out
}

/** Likely knowledge for a draft: real local retrieval, minus what is already in context or excluded. */
export function retrieveLikely(draft: string, projectId: ID | null, skip: ReadonlySet<string>, limit = 3): LikelyHit[] {
  const text = draft.trim()
  if (text.length < 8 || text.split(/\s+/).length < 2) return []
  let hits: ReturnType<typeof retrieveKnowledge> = []
  try {
    hits = retrieveKnowledge(text, { projectId: projectId ?? undefined, limit: limit + skip.size })
  } catch {
    return []
  }
  const out: LikelyHit[] = []
  for (const h of hits) {
    const ref: EntityRef = { kind: 'knowledge', id: h.item.id }
    if (skip.has(refKey(ref))) continue
    const haystack = `${h.item.title}\n${h.passage}`
    out.push({ ref, terms: matchedTerms(haystack, highlightText(haystack, text)) })
    if (out.length >= limit) break
  }
  return out
}

export function useComposerContext(options: ComposerContextOptions = {}): ComposerContext {
  const { onAttachedChange, includeHeld = true, debounceMs = 350 } = options
  const scope = useContextStore((s) => s.scopeProjectId)
  const projectId = options.projectId !== undefined ? options.projectId : scope
  const pinned = useContextStore((s) => s.pinned)
  const autoRetrieveSetting = useSettings((s) => s.ai.autoRetrieve)
  const autoRetrieve = options.autoRetrieve ?? autoRetrieveSetting

  const [internalAttached, setInternalAttached] = useState<EntityRef[]>(() => uniqRefs(options.initialAttached ?? []))
  const controlled = options.attached !== undefined
  const attached = useMemo(() => uniqRefs(controlled ? (options.attached ?? EMPTY_REFS) : internalAttached), [controlled, options.attached, internalAttached])

  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())
  const [files, setFiles] = useState<Attachment[]>([])
  const [draft, setDraftState] = useState('')
  const [likelyHits, setLikelyHits] = useState<LikelyHit[]>([])

  const project = useDB((s) => (projectId ? s.projects[projectId] : undefined))
  const memoryRefs = project?.pinnedRefs ?? EMPTY_REFS
  const held = useMemo(() => (includeHeld ? uniqRefs(pinned.filter((p) => p.source === 'user').map((p) => p.ref)) : EMPTY_REFS), [includeHeld, pinned])

  // Likely retrieval: debounced on the draft; skips what is already in context or dismissed.
  const skip = useMemo(() => {
    const keys = new Set<string>(dismissed)
    for (const r of [...memoryRefs, ...held, ...attached]) keys.add(refKey(r))
    return keys
  }, [dismissed, memoryRefs, held, attached])
  useEffect(() => {
    if (!autoRetrieve) {
      setLikelyHits((cur) => (cur.length ? [] : cur))
      return
    }
    const timer = setTimeout(() => setLikelyHits(retrieveLikely(draft, projectId, skip)), draft.trim() ? debounceMs : 0)
    return () => clearTimeout(timer)
  }, [draft, projectId, skip, autoRetrieve, debounceMs])
  const likely = useMemo(() => likelyHits.filter((h) => !skip.has(refKey(h.ref))), [likelyHits, skip])

  // Rows behind every ref, so token estimates follow edits (shallow-compared).
  const allRefs = useMemo(() => [...memoryRefs, ...held, ...attached, ...likely.map((l) => l.ref)], [memoryRefs, held, attached, likely])
  const rows = useDB(useShallow((s: Tables) => allRefs.map((r) => rowFor(s, r))))

  const entries = useMemo<ContextEntry[]>(() => {
    const s = useDB.getState()
    const tokensOf = (r: EntityRef) => estimateRefTokens(r, s)
    const exists = (i: number) => rows[i] !== undefined
    const out: ContextEntry[] = []
    if (project) {
      const memoryTokens = estimateMemoryTokens(project) + memoryRefs.reduce((n, r) => n + tokensOf(r), 0)
      out.push({ key: 'memory', group: 'project', tokens: memoryTokens, on: !off.has('memory'), exists: true })
    }
    let i = memoryRefs.length
    for (const r of held) {
      const key = refKey(r)
      out.push({ key, group: 'held', ref: r, tokens: tokensOf(r), on: !off.has(key), exists: exists(i++) })
    }
    for (const r of attached) {
      const key = refKey(r)
      out.push({ key, group: 'attached', ref: r, tokens: tokensOf(r), on: !off.has(key), exists: exists(i++) })
    }
    for (const f of files) {
      const key = `file:${f.id}`
      out.push({ key, group: 'file', file: f, tokens: estimateAttachmentTokens(f), on: !off.has(key), exists: true })
    }
    for (const l of likely) {
      const key = refKey(l.ref)
      out.push({ key, group: 'likely', ref: l.ref, terms: l.terms, tokens: tokensOf(l.ref), on: !off.has(key), exists: exists(i++) })
    }
    return out
    // `rows` changes when any referenced row changes.
  }, [project, memoryRefs, held, attached, files, likely, off, rows])

  const refs = useMemo<ComposerContextRefs>(() => {
    const on = (g: ContextGroup) => entries.filter((e) => e.group === g && e.on && e.exists && e.ref).map((e) => e.ref as EntityRef)
    const memoryOn = !!project && !off.has('memory')
    const heldOn = on('held')
    const attachedOn = on('attached')
    const likelyOn = on('likely')
    const excluded = entries.filter((e) => !e.on && e.ref).map((e) => e.ref as EntityRef)
    for (const key of dismissed) {
      const [kind, ...rest] = key.split(':')
      excluded.push({ kind: kind as EntityRef['kind'], id: rest.join(':') })
    }
    const tokens = entries.filter((e) => e.on && e.exists).reduce((n, e) => n + e.tokens, 0)
    return {
      projectId,
      projectMemory: memoryOn,
      memoryRefs: memoryOn ? [...memoryRefs] : [],
      held: heldOn,
      attached: attachedOn,
      likely: likelyOn,
      attachments: files.filter((f) => !off.has(`file:${f.id}`)),
      all: uniqRefs([...heldOn, ...attachedOn, ...likelyOn]),
      excluded: uniqRefs(excluded),
      tokens,
    }
  }, [entries, project, off, projectId, memoryRefs, files, dismissed])

  const attachedRef = useRef(attached)
  attachedRef.current = attached
  const setAttached = useCallback(
    (next: EntityRef[]) => {
      if (!controlled) setInternalAttached(next)
      onAttachedChange?.(next)
    },
    [controlled, onAttachedChange],
  )

  const toggle = useCallback((key: string) => {
    setOff((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const attach = useCallback(
    (ref: EntityRef) => {
      const cur = attachedRef.current
      if (cur.some((r) => sameRef(r, ref))) return
      setAttached([...cur, { kind: ref.kind, id: ref.id }])
      setDismissed((d) => {
        if (!d.has(refKey(ref))) return d
        const next = new Set(d)
        next.delete(refKey(ref))
        return next
      })
    },
    [setAttached],
  )

  const detach = useCallback(
    (ref: EntityRef) => {
      setAttached(attachedRef.current.filter((r) => !sameRef(r, ref)))
      setOff((cur) => {
        if (!cur.has(refKey(ref))) return cur
        const next = new Set(cur)
        next.delete(refKey(ref))
        return next
      })
    },
    [setAttached],
  )

  const dismissLikely = useCallback((ref: EntityRef) => {
    setDismissed((d) => new Set(d).add(refKey(ref)))
  }, [])

  const addFiles = useCallback((next: Attachment[]) => {
    if (next.length) setFiles((cur) => [...cur, ...next.filter((f) => !cur.some((c) => c.id === f.id))])
  }, [])
  const removeFile = useCallback((id: ID) => setFiles((cur) => cur.filter((f) => f.id !== id)), [])

  const release = useCallback((ref: EntityRef) => useContextStore.getState().unpin(ref), [])
  const hold = useCallback((ref: EntityRef) => useContextStore.getState().pin(ref), [])

  const reset = useCallback(() => {
    setOff(new Set())
    setDismissed(new Set())
    setFiles([])
    setLikelyHits([])
    setDraftState('')
    if (!controlled) setInternalAttached([])
  }, [controlled])

  const isOn = useCallback((key: string) => !off.has(key), [off])

  return {
    projectId,
    project,
    entries,
    refs,
    tokens: refs.tokens,
    draft,
    files,
    setDraft: setDraftState,
    isOn,
    toggle,
    attach,
    detach,
    dismissLikely,
    addFiles,
    removeFile,
    release,
    hold,
    reset,
  }
}

## A3 — SIGNATURE COMPONENTS (src/ui/signature/**, gallery section src/ui/gallery/sections/signature.tsx)
These are the product's recognizable motifs; they appear in every workspace. Use the names/visuals from docs/DESIGN.md where it defines them (e.g. its name for the live indicator, provenance footer, identity mark); keep the exported component names below as the code API (add aliases if the spec uses different names).
Contract stubs already exist in src/ui/signature/* with the exact props — keep every prop (you may add optional ones) and replace the implementations.
- AgentMark { seed: number; hue: Hue; size?: number; live?: boolean; label?: string; shape?: 'square' | 'circle' }: procedural identity mark (geometric, distinctive, derived from seed; NOT a robot/face). Crisp at 16-64px. `live` adds the live ring/pulse motif.
- MonogramMark { text: string (1-3 chars); hue: Hue; size? } for projects/collections/integrations (tinted square, hue letter).
- LiveIndicator { tone?: 'live'|'attn'|'done'|'fail'|'neutral'; size?: 'xs'|'sm'|'md'; pulsing?: boolean; label?: string } — the single motion motif meaning "AI is working"; static when reduced motion.
- StatusDot { tone }, RunStatusBadge { status: RunStatus; size? } (glyph + label + tone; waiting = needs you), StepIcon { kind: StepKind; status: StepStatus }.
- MetaLabel (mono uppercase kicker/metadata), IdCode { id; label? } (e.g. RUN-4F2A, copy on click), SimBadge { size?; label?; explanation? } (hatched "Simulated" badge with tooltip explaining what was simulated), LiveBadge { size? } ("Live" — real network/model).
- ProvenanceLine { modelLabel?; simulated?; usage?: Usage; durationMs?; costIsEstimate?; extra? } — the footer on every AI output (model · Simulated/Live · tokens · cost · duration).
- RunMeta { run: Run; showModel? } (RUN code · model · tokens · cost(estimate when simulated) · duration live-updating while active).
- RunTimeline { run: Run; approvals?: Record<ID, Approval>; onApprove?(approvalId, note?); onReject?(approvalId, note?); renderRef?(ref): ReactNode; compact?: boolean; defaultExpanded?: 'all' | 'active' | 'none' } — vertical thread of steps: StepIcon on a hairline spine; title/detail; status; timing (duration, or live elapsed); expandable body: input (command → Terminal style, query → mono), output (Terminal for command/test; list for search/browse; Markdown for message/write), refs (renderRef or EntityChip), file changes (DiffStat per file), waiting step → inline ApprovalCard; while running, a subtle "working…" row at the end. Keyboard: steps are disclosure buttons.
- ApprovalCard { approval: Approval; requester?: { name: string; mark?: ReactNode }; variant?: 'compact' | 'full'; onApprove?(note?); onReject?(note?) } — the interrupt: title, requester, risk badge, capability (icon + label), reason (approval.reason), preview (command/diff/message/text with destination label), optional note, Approve (primary) / Reject (danger-text) with async loading; resolved/expired state with who/when/note. Compact variant fits a 360px panel row.
- EntityChip (connected; uses useEntity/entityRoute from @/core/services/entities) { entity: EntityRef; size?; variant?: 'default'|'subtle'|'outline'; onRemove?; noHoverCard?; noLink?; showKind? } + EntityHoverCard (title, kind, subtitle, status, updated, project) + EntityIcon { kind } (KIND_META icons).
- KindLabel/kicker helpers as needed.
Gallery: realistic fixtures (construct Run/Approval objects inline) for every state: running with streaming output, waiting approval (command, message, diff previews), failed step, completed run, all RunStatus values, AgentMark grid of 24 seeds × hues at several sizes, chips for each kind.

## D1 — GLOBAL SHELL (src/app/shell/**, src/app/commands/**, src/app/shortcuts.ts, src/app/App.tsx, src/app/routes.tsx)
(see shell.md functional requirements)

## D2 — SHARED ACTION COMPONENTS + HOME (src/app/components/**, src/workspaces/home/**)
(see shell.md functional requirements)

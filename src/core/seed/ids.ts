/**
 * Seed story bible: fixed ids + one-line intent for the first-run demo world.
 *
 * The user, Morgan Lee, is the product lead at Northwind Labs, a startup building
 * "Atlas" — a customer portal SaaS for freight & logistics companies. Atlas Lumen is
 * a new analytics add-on launching soon. Competitors (all fictional): Tidewell,
 * Freightly, ShipLoom. Customers (fictional): Meridian Freight, Coastal Cargo, Halden Logistics.
 * Simulated web sources use fictional publications on `.example` domains only.
 */

export const PROJECT = {
  atlas: 'prj_atlas', // "Atlas Portal v2" — rebuild: SSO/auth revamp, Stripe billing migration, performance. hue sky, icon Boxes
  landscape: 'prj_landscape', // "Q4 Competitive Landscape" — competitor + pricing research. hue violet, icon Telescope
  lumen: 'prj_lumen', // "Lumen Launch" — launch campaign for the Atlas Lumen add-on. hue amber, icon Megaphone
  ops: 'prj_ops', // "Support Ops Automation" — triage, digests, incident summaries. hue mint, icon Workflow
  fieldNotes: 'prj_field_notes', // "Field Notes" — personal reading notes & learning. hue rose, icon Feather
} as const

export const AGENT = {
  scout: 'agt_scout', // Research analyst — web search/browse, knowledge r/w. balanced. violet
  forge: 'agt_forge', // Coding agent — repo r/w/PR, shell (ask). balanced. sky
  herald: 'agt_herald', // Communications — weekly digests to Slack (ask), tasks. amber. schedule Mon 09:00
  sentinel: 'agt_sentinel', // Support triage — Gmail, tasks, Slack alerts (ask). autonomous. mint
  muse: 'agt_muse', // Creative director — media generation, brand knowledge. rose
  ledger: 'agt_ledger', // Metrics & finance analyst — data.query (Postgres/Stripe read), payments deny. cyan
  archivist: 'agt_archivist', // Knowledge curator — Notion sync, tagging, dedupe. coral. PAUSED. nightly schedule
} as const

export const COLLECTION = {
  product: 'col_product',
  engineering: 'col_engineering',
  research: 'col_research',
  brand: 'col_brand',
  meetings: 'col_meetings',
  notes: 'col_notes',
} as const

export const REPO = {
  atlas: 'rep_atlas', // northwind/atlas-portal — bundled demo repo (simulated). TypeScript + React + vitest
} as const

export const THREAD = {
  ssoBug: 'thr_sso_bug', // atlas — "Session expiry after SSO login"
  stripeRisks: 'thr_stripe_risks', // atlas — "Stripe migration risks"
  tokens: 'thr_tokens', // atlas — "Naming our design tokens"
  retro: 'thr_retro', // atlas — "Sprint 14 retro synthesis"
  tidewell: 'thr_tidewell', // landscape — "How does Tidewell position against us?"
  pricing: 'thr_pricing', // lumen — "Pricing tiers for Atlas Lumen"
  launchPlan: 'thr_launch_plan', // lumen — "Launch plan outline"
  heroCopy: 'thr_hero_copy', // lumen — "Hero copy variations"
  triage: 'thr_triage', // ops — "Designing a support triage rubric"
  incident: 'thr_incident', // ops — "Postmortem: checkout latency spike"
  agentsReading: 'thr_agents_reading', // field notes — "Notes on agent reliability patterns"
  rust: 'thr_rust', // field notes — "Learning plan: Rust for TypeScript devs"
  okrs: 'thr_okrs', // no project — "Drafting Q1 OKRs"
  hiring: 'thr_hiring', // no project — "Interview loop for a senior frontend engineer"
} as const

export const KNOWLEDGE = {
  lumenPrd: 'kno_lumen_prd', // product — "Atlas Lumen PRD"
  pricingMemo: 'kno_pricing_memo', // product — "Pricing strategy memo (draft)"
  personaOlivia: 'kno_persona_olivia', // product — "Persona: Olivia, operations manager"
  glossary: 'kno_glossary', // product — "Atlas glossary"
  okrsDraft: 'kno_okrs_draft', // product — "Q1 OKRs (draft)"
  adrSessions: 'kno_adr_sessions', // engineering — "ADR-012: Session tokens & refresh"
  stripePlan: 'kno_stripe_plan', // engineering — "Stripe Billing migration plan"
  codeReview: 'kno_code_review', // engineering — "Engineering handbook: code review"
  onboarding: 'kno_onboarding', // engineering — "New engineer onboarding guide"
  rateLimits: 'kno_rate_limits', // engineering — "Public API rate limits"
  incidentLatency: 'kno_incident_latency', // engineering — "Incident report: checkout latency (Oct 21)"
  tidewellTeardown: 'kno_tidewell_teardown', // research — "Competitor teardown: Tidewell" (from investigation inv_tidewell)
  freightlyNotes: 'kno_freightly_notes', // research — "Freightly product notes"
  marketSizing: 'kno_market_sizing', // research — "Market sizing: mid-market freight portals"
  churnInterviews: 'kno_churn_interviews', // research — "Churn interview synthesis (6 customers)"
  brandVoice: 'kno_brand_voice', // brand — "Brand voice guide"
  launchChecklist: 'kno_launch_checklist', // brand — "Lumen launch checklist"
  messagingHouse: 'kno_messaging_house', // brand — "Lumen messaging house"
  syncOct28: 'kno_sync_oct28', // meetings — "Weekly product sync — notes"
  meridianCall: 'kno_meridian_call', // meetings — "Customer call: Meridian Freight" (transcript)
  slaPolicy: 'kno_sla_policy', // meetings? -> product — "Support SLA policy"
  triageRubric: 'kno_triage_rubric', // product — "Support triage rubric v2"
  agentPatterns: 'kno_agent_patterns', // notes — "Notes: reliable agent patterns"
  designSystems: 'kno_design_systems', // notes — "Notes: design systems that scale"
  rustPlan: 'kno_rust_plan', // notes — "Rust learning plan"
  leadership: 'kno_leadership', // notes — "Notes: managing through ambiguity"
  csvAccounts: 'kno_accounts_csv', // dataset — "Top accounts by ARR.csv" (file upload)
} as const

export const INVESTIGATION = {
  tidewell: 'inv_tidewell', // complete — "Tidewell positioning & pricing" (report saved to kno_tidewell_teardown)
  pricingTrends: 'inv_pricing_trends', // running — "Usage-based pricing trends in B2B SaaS" (active run)
  churn: 'inv_churn', // review — "Why do logistics customers churn?"
  einvoicing: 'inv_einvoicing', // draft — "EU e-invoicing mandate: impact on Atlas"
} as const

export const WORKFLOW = {
  triage: 'wfl_triage', // "Support triage" — Gmail event → Sentinel classify → urgent? → Slack alert / Linear task
  digest: 'wfl_digest', // "Weekly project digest" — Mon 09:00 → Herald summarize → approval → Slack post
  prReview: 'wfl_pr_review', // "PR review assistant" — GitHub PR opened → Forge review → comment (approval)
  radar: 'wfl_radar', // "Competitor radar" — weekly → Scout web search → knowledge write → notify
  assets: 'wfl_assets', // "Launch asset pipeline" — manual → Muse generate → approval → Drive upload. DISABLED
} as const

export const SESSION = {
  sso: 'ses_sso', // needs_review — "Fix session expiry after SSO login" (changes + passing checks)
  stripe: 'ses_stripe', // working/waiting — "Migrate invoices to Stripe Billing" (approval: npm install)
  bundle: 'ses_bundle', // merged — "Reduce dashboard bundle size"
  flaky: 'ses_flaky', // failed — "Fix flaky checkout e2e test"
} as const

export const BOARD = {
  launch: 'brd_launch', // "Lumen launch visuals"
  social: 'brd_social', // "Social cutdowns"
  brand: 'brd_brand', // "Brand explorations"
} as const

/** Tasks referenced across seed parts (created by the content part). */
export const TASK = {
  ssoFix: 'tsk_sso_fix', // atlas — "Fix session expiry after SSO login" — assigned to Forge, in review (session ses_sso)
  stripeMigration: 'tsk_stripe_migration', // atlas — "Migrate invoices to Stripe Billing" — Forge, in progress (ses_stripe)
  bundleSize: 'tsk_bundle_size', // atlas — "Reduce dashboard bundle size" — done (ses_bundle)
  flakyTest: 'tsk_flaky_test', // atlas — "Fix flaky checkout e2e test" — todo, last attempt failed (ses_flaky)
  weeklyDigest: 'tsk_weekly_digest', // ops — "Send weekly project digest" — Herald, in progress (waiting approval)
  competitorBrief: 'tsk_competitor_brief', // landscape — "Competitor brief for board deck" — Scout
  heroVideo: 'tsk_hero_video', // lumen — "Storyboard the launch hero video" — Muse, in progress
  triageRubric: 'tsk_triage_rubric', // ops — "Finalize triage rubric v2" — you, review
} as const

/**
 * Source id convention: `src_<investigation-key>_<n>` (1-based), e.g. src_pricing_1 … src_pricing_8
 * for INVESTIGATION.pricingTrends, src_tidewell_1 … for INVESTIGATION.tidewell, src_churn_n, src_einvoicing_n.
 * Seeded in-flight run ids: run_seed_inv_pricing, run_seed_ses_stripe, run_seed_herald_digest,
 * run_seed_sentinel_triage, run_seed_muse_storyboard. Pending approvals: apv_seed_npm, apv_seed_slack.
 */

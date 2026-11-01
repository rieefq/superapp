/**
 * Readable, fixed ids for rows that only the content part creates but that several
 * content modules reference (origins, cross-links, pinned refs). Shared story ids
 * (projects, knowledge, threads, tasks…) live in `../ids.ts`.
 */

/** Extra knowledge items beyond the story bible. */
export const KNO = {
  winloss: 'kno_winloss_q3', // research — "Win/loss notes: Q3 competitive deals"
  lumenFaq: 'kno_lumen_faq', // brand — "Lumen launch FAQ (internal)"
  betaFeedback: 'kno_beta_feedback', // product — "Lumen beta feedback log"
  retroCsv: 'kno_retro_s14', // engineering — "sprint-14-retro.csv" (uploaded from chat)
} as const

/** Messages that other entities were derived from (task/investigation/knowledge/asset origins). */
export const MSG = {
  ssoTask: 'msg_sso_06', // → TASK.ssoFix
  stripeTasks: 'msg_stripe_06', // → runbook + invoice numbering tasks
  tokensTask: 'msg_tokens_06', // → token rename task
  retroTasks: 'msg_retro_04', // → review SLA trial + flaky quarantine tasks
  retroUpload: 'msg_retro_01', // → retro CSV saved to knowledge
  portbaseStart: 'msg_portbase_04', // → INVESTIGATION.portbase
  battlecardTask: 'msg_portbase_08', // → battlecard task
  pricingScenarios: 'msg_pricing_04', // → Ledger revenue scenarios task
  pricingResearch: 'msg_pricing_08', // → INVESTIGATION.pricingTrends (in-flight run)
  launchTasks: 'msg_launch_06', // → sales brief + webinar tasks
  heroSaved: 'msg_hero_06', // → hero copy asset
  triageDoc: 'msg_triage_06', // → KNOWLEDGE.triageRubric
  triageTask: 'msg_triage_08', // → TASK.triageRubric
  incidentSaved: 'msg_incident_06', // → incident report + two reliability tasks
  agentsTalk: 'msg_agents_06', // → all-hands talk task
  rustSaved: 'msg_rust_06', // → KNOWLEDGE.rustPlan + week-1 task
  okrsSaved: 'msg_okrs_06', // → KNOWLEDGE.okrsDraft + review task
  hiringTask: 'msg_hiring_06', // → job post task
} as const

export const MILESTONE = {
  atlasAuth: 'ms_atlas_auth',
  atlasBilling: 'ms_atlas_billing',
  atlasPerf: 'ms_atlas_perf',
  atlasGa: 'ms_atlas_ga',
  landTeardowns: 'ms_land_teardowns',
  landBrief: 'ms_land_brief',
  landReview: 'ms_land_review',
  lumenBeta: 'ms_lumen_beta',
  lumenPricing: 'ms_lumen_pricing',
  lumenAssets: 'ms_lumen_assets',
  lumenLaunch: 'ms_lumen_launch',
  opsDigest: 'ms_ops_digest',
  opsTriage: 'ms_ops_triage',
  opsIncidents: 'ms_ops_incidents',
  notesRust: 'ms_notes_rust',
  notesTalk: 'ms_notes_talk',
} as const

/** Content-only tasks that other modules reference (links, notifications, activity). */
export const TSK = {
  runbook: 'tsk_atlas_runbook',
  numbering: 'tsk_atlas_numbering',
  tokens: 'tsk_atlas_tokens',
  queryPlan: 'tsk_atlas_query_plan',
  p95Alert: 'tsk_atlas_p95_alert',
  carrierMap: 'tsk_atlas_carrier_map',
  rateLimits: 'tsk_atlas_rate_limits',
  scim: 'tsk_atlas_scim',
  canvasCharts: 'tsk_atlas_canvas_charts',
  reviewSla: 'tsk_atlas_review_sla',
  flakyQuarantine: 'tsk_atlas_flaky_quarantine',
  battlecard: 'tsk_land_battlecard',
  freightlyPricing: 'tsk_land_freightly_pricing',
  shiploomInterviews: 'tsk_land_shiploom_interviews',
  radar: 'tsk_land_radar',
  churnReview: 'tsk_land_churn_review',
  analystReport: 'tsk_land_analyst_report',
  pricingLock: 'tsk_lumen_pricing_lock',
  launchEmail: 'tsk_lumen_launch_email',
  salesBrief: 'tsk_lumen_sales_brief',
  heroCopy: 'tsk_lumen_hero_copy',
  meridianQuote: 'tsk_lumen_meridian_quote',
  webinar: 'tsk_lumen_webinar',
  betaFixes: 'tsk_lumen_beta_fixes',
  keynoteReview: 'tsk_lumen_keynote_review',
  helpCenter: 'tsk_lumen_help_center',
  socialCutdowns: 'tsk_lumen_social_cutdowns',
  launchDate: 'tsk_lumen_launch_date',
  revenueModel: 'tsk_lumen_revenue_model',
  betaUsage: 'tsk_lumen_beta_usage',
  tagTickets: 'tsk_ops_tag_tickets',
  slaUpdate: 'tsk_ops_sla_update',
  incidentSummaries: 'tsk_ops_incident_summaries',
  supportInbox: 'tsk_ops_support_inbox',
  haldenFollowUp: 'tsk_ops_halden_follow_up',
  postmortem: 'tsk_ops_postmortem',
  rustWeek1: 'tsk_notes_rust_week1',
  rustWeek3: 'tsk_notes_rust_week3',
  agentsTalk: 'tsk_notes_agents_talk',
  okrReview: 'tsk_misc_okr_review',
  jobPost: 'tsk_misc_job_post',
  expenses: 'tsk_misc_expenses',
  oneOnOne: 'tsk_misc_one_on_one',
  conference: 'tsk_misc_conference',
} as const

export const ASSET = {
  heroImage: 'ast_hero_night_port',
  scorecardVisual: 'ast_feature_scorecards',
  warehouseIso: 'ast_warehouse_iso',
  socialSquare: 'ast_social_square',
  socialVertical: 'ast_social_vertical',
  socialQuote: 'ast_social_quote',
  brandIcon: 'ast_brand_icon',
  brandPattern: 'ast_brand_pattern',
  keynote: 'ast_keynote',
  storyboard: 'ast_hero_storyboard',
  narration: 'ast_narration',
  heroCopy: 'ast_hero_copy',
  launchEmail: 'ast_launch_email',
  socialPosts: 'ast_social_posts',
  salesOnePager: 'ast_sales_onepager',
} as const

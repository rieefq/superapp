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
  ssoTask: 'msg_sso_06', // → TASK.ssoFix (handed to Forge)
  stripeTasks: 'msg_stripe_06', // → runbook + invoice numbering tasks
  tokensTask: 'msg_tokens_06', // → token rename task
  retroUpload: 'msg_retro_01', // → retro CSV saved to knowledge
  retroTasks: 'msg_retro_04', // → PR size limit, same-day flaky tickets, focus mornings
  portbaseStart: 'msg_portbase_04', // → INVESTIGATION.portbase
  battlecardTask: 'msg_portbase_08', // → battlecard task
  pricingScenarios: 'msg_pricing_04', // → Ledger revenue scenarios task
  pricingResearch: 'msg_pricing_08', // → INVESTIGATION.pricingTrends (in-flight run)
  launchTasks: 'msg_launch_06', // → sales brief + webinar tasks
  heroSaved: 'msg_hero_06', // → hero copy asset
  triageHandoff: 'msg_triage_06', // → TASK.triageRubric (Sentinel drafts, Morgan reviews)
  incidentTasks: 'msg_incident_06', // → two reliability tasks
  agentsTalk: 'msg_agents_06', // → all-hands talk task
  rustSaved: 'msg_rust_06', // → KNOWLEDGE.rustPlan + week-1 task
  okrsTask: 'msg_okrs_06', // → OKR review task
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

/**
 * Content-only tasks. Ids avoid a shared second segment so `shortCode()` (TSK-RUNB, TSK-INVO…)
 * stays distinct for every task; the same goes for ASSET below.
 */
export const TSK = {
  runbook: 'tsk_runbook',
  numbering: 'tsk_invoice_numbering',
  tokens: 'tsk_token_rename',
  queryPlan: 'tsk_query_plan_ci',
  p95Alert: 'tsk_p95_alert',
  carrierMap: 'tsk_carrier_map',
  rateLimits: 'tsk_rate_limit_audit',
  scim: 'tsk_scim_spike',
  canvasCharts: 'tsk_canvas_charts',
  prLimit: 'tsk_pr_size_limit',
  sameDayTickets: 'tsk_same_day_tickets',
  focusMornings: 'tsk_focus_mornings',
  battlecard: 'tsk_battlecard',
  freightlyPricing: 'tsk_freightly_pricing',
  shiploomInterviews: 'tsk_shiploom_interviews',
  radar: 'tsk_radar_setup',
  churnReview: 'tsk_churn_review',
  analystReport: 'tsk_paid_report',
  pricingLock: 'tsk_pricing_lock',
  launchEmail: 'tsk_launch_email',
  salesBrief: 'tsk_sales_brief',
  heroCopy: 'tsk_headline_copy',
  meridianQuote: 'tsk_meridian_quote',
  webinar: 'tsk_webinar',
  betaFixes: 'tsk_alert_threshold_fixes',
  keynoteReview: 'tsk_keynote_review',
  helpCenter: 'tsk_help_center',
  videoCutdowns: 'tsk_video_cutdowns',
  launchDate: 'tsk_date_confirmation',
  revenueModel: 'tsk_revenue_model',
  betaUsage: 'tsk_beta_usage',
  tagTickets: 'tsk_tag_tickets',
  slaUpdate: 'tsk_sla_update',
  incidentSummaries: 'tsk_incident_summaries',
  supportInbox: 'tsk_support_inbox',
  customerFollowUp: 'tsk_customer_follow_up',
  postmortem: 'tsk_postmortem',
  rustWeek1: 'tsk_ownership_exercises',
  rustWeek3: 'tsk_log_parser',
  agentsTalk: 'tsk_agents_talk',
  okrReview: 'tsk_okr_review',
  jobPost: 'tsk_job_post',
  expenses: 'tsk_expenses',
  oneOnOne: 'tsk_one_on_one',
  conference: 'tsk_conference',
} as const

export const ASSET = {
  keyArt: 'ast_key_art',
  scorecardVisual: 'ast_scorecard_visual',
  gradients: 'ast_gradient_studies',
  isometric: 'ast_isometric_yard',
  appIcon: 'ast_app_icon',
  backgrounds: 'ast_screenshot_backgrounds',
  cutdownTracking: 'ast_tracking_cutdowns',
  cutdownDock: 'ast_dock_cutdowns',
  cutdownQuote: 'ast_quote_cutdowns',
  keynote: 'ast_keynote',
  storyboard: 'ast_storyboard',
  narration: 'ast_narration',
  heroCopy: 'ast_hero_copy',
  launchEmail: 'ast_launch_email',
  socialPosts: 'ast_social_posts',
  onePager: 'ast_one_pager',
} as const

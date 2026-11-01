/**
 * Topic vocabulary for the research simulator: which broad category a question belongs
 * to, and the neutral "facets" sources in that category tend to discuss. Facets are
 * framing words only — never facts, figures or claims.
 */

export type TopicCategory =
  | 'pricing'
  | 'churn'
  | 'competition'
  | 'regulation'
  | 'engineering'
  | 'market'
  | 'product'
  | 'marketing'
  | 'ai'
  | 'logistics'
  | 'general'

const TRIGGERS: Record<Exclude<TopicCategory, 'general'>, RegExp> = {
  pricing: /\b(pric\w*|tiers?|plans?|billing|monetiz\w*|usage[- ]based|seat[- ]based|discount\w*|packag\w*|subscription\w*|revenue)\b/i,
  churn: /\b(churn\w*|retention|retain\w*|cancel\w*|renewal\w*|attrition|downgrad\w*)\b/i,
  competition: /\b(competit\w*|positioning|position|landscape|alternatives?|rivals?|vs\.?|versus|teardown|compare|comparison)\b/i,
  regulation: /\b(regulat\w*|mandate\w*|complian\w*|laws?|legal|gdpr|e-?invoic\w*|tax\w*|polic(y|ies)|directive|audit\w*)\b/i,
  engineering: /\b(api|apis|migrat\w*|architect\w*|performance|latency|security|sso|auth\w*|infrastructure|database|scal\w*|reliab\w*|bundle|refactor\w*|code)\b/i,
  market: /\b(market\w*|sizing|tam|segments?|growth|demand|adoption|trends?|industry|buyers?)\b/i,
  product: /\b(onboarding|ux|usability|features?|roadmap|workflow\w*|dashboard\w*|analytics|personas?|customers?)\b/i,
  marketing: /\b(launch\w*|campaign\w*|messaging|brand\w*|copy|positioning|audience|content|seo|social)\b/i,
  ai: /\b(ai|llms?|agents?|models?|machine learning|ml|automation|copilot\w*|genai)\b/i,
  logistics: /\b(freight|logistics|shipping|shipments?|carriers?|warehous\w*|supply chain|fleet|cargo|delivery)\b/i,
}

export const FACETS: Record<TopicCategory, readonly string[]> = {
  pricing: ['value metric', 'packaging', 'willingness to pay', 'expansion paths', 'discount policy', 'billing complexity'],
  churn: ['onboarding quality', 'time to value', 'support responsiveness', 'product fit', 'switching costs', 'champion turnover'],
  competition: ['positioning', 'target segment', 'integration depth', 'pricing transparency', 'switching costs', 'roadmap focus'],
  regulation: ['scope and applicability', 'implementation timelines', 'data format requirements', 'vendor readiness', 'enforcement approach', 'cross-border differences'],
  engineering: ['migration effort', 'operational risk', 'observability', 'performance budgets', 'security review', 'maintenance cost'],
  market: ['segment definitions', 'buying process', 'budget ownership', 'competitive alternatives', 'adoption barriers', 'timing'],
  product: ['onboarding', 'workflow fit', 'adoption', 'usability', 'feedback loops', 'feature discoverability'],
  marketing: ['message clarity', 'audience fit', 'channel mix', 'proof points', 'launch sequencing', 'brand consistency'],
  ai: ['evaluation', 'reliability', 'human oversight', 'cost control', 'data governance', 'failure modes'],
  logistics: ['shipment visibility', 'carrier integrations', 'exception handling', 'customer communication', 'data quality', 'operational workload'],
  general: ['costs', 'risks', 'adoption', 'fit with current workflows', 'quality of evidence', 'time to value'],
}

/** Cautious, generic next actions a source might recommend. */
export const ACTIONS: readonly string[] = [
  'piloting with a small customer segment first',
  'interviewing a handful of affected customers',
  'mapping the current process end to end',
  'agreeing on a success metric up front',
  'checking first-party documentation directly',
  'reviewing contracts and data flows with the owners',
  'running a time-boxed experiment',
  'comparing notes with the teams closest to the problem',
]

/** Categories that match a text, most specific first; always ends with 'general'. */
export function detectCategories(text: string): TopicCategory[] {
  const found = (Object.keys(TRIGGERS) as Array<Exclude<TopicCategory, 'general'>>).filter((c) => TRIGGERS[c].test(text))
  return [...found, 'general']
}

/** Facets for a text: facets of its primary category, topped up from the next ones. */
export function facetsFor(text: string, count = 4): string[] {
  const out: string[] = []
  for (const c of detectCategories(text)) {
    for (const f of FACETS[c]) {
      if (!out.includes(f)) out.push(f)
      if (out.length >= count) return out
    }
  }
  return out
}

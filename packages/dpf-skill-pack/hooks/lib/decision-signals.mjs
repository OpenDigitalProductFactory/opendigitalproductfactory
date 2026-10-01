// packages/dpf-skill-pack/hooks/lib/decision-signals.mjs
//
// The single home of the decision-routing vocabulary (BI-383668B9, BI-0F0BE69A,
// BI-E4DE3825). Two guards enforce `consult-scopes-before-asking`:
//
//   - decision-routing-guard.mjs   PreToolUse on AskUserQuestion (the tool channel)
//   - decision-menu-stop-guard.mjs Stop, on the final reply      (the prose channel)
//
// They must agree on what a platform/build decision looks like, what counts as
// evidence of a kernel consultation, and how an operator-owned question opts
// out, or one channel drifts into blocking what the other allows. Pure data.

// Engineering approach/architecture-selection vocabulary. Deliberately excludes
// generic "which" so operator-owned questions ("which brand color", "what should
// we name it") do not match — "which" must be followed by an engineering noun.
export const DECISION_LANGUAGE = [
  /\barchitectur/i,
  /\bwhich\s+(?:approach|option|design|library|framework|pattern|implementation|schema|migration|strategy)\b/i,
  /\bspec\b/i,
  /\bimplement(?:ation|ing)?\b/i,
  /\brefactor/i,
  /\bschema\b/i,
  /\bmigration\b/i,
  // Pronoun deliberately NOT required (BI-0F0BE69A): "How should THIS SCOPE enter
  // the roadmap" is the same decision as "how should WE scope this", and the
  // pronoun form was the exact phrasing that escaped this guard.
  /\bhow\s+(?:should|far|do|much|many|deep|ambitious|aggressive|broad|big)\b/i,
  /\boption\s+(?:1|2|3|one|two|three|a|b|c)\b/i,
];

// Delivery/product-planning vocabulary (BI-0F0BE69A). Scoping, epic sequencing
// and roadmap-shaping ARE platform/build decisions, but agents naturally phrase
// them in product register rather than engineering register — so the engineering
// list above never saw them. This closes that register gap.
export const DELIVERY_LANGUAGE = [
  /\broadmap\b/i,
  /\bepics?\b/i,
  /\bbacklog\b/i,
  /\bsequenc(?:e|ing|ed)\b/i,
  /\bphase\s*(?:\d|[a-c]\b|one|two|three)/i,
  /\bscope\b/i,
  /\b(?:wizard|setup|onboarding)\s+step\b/i,
  /\bprioriti[sz]/i,
  /\bfold(?:ed|ing)?\s+into\b/i,
  /\b(?:build|ship)\s+(?:it\s+)?(?:first|now|later|order)\b/i,
  /\bfirst\s+pass\b/i,
  // BI-E4DE3825: delivery-gate decisions ("push with --no-verify", "rerun the
  // gate", "open the PR") are build decisions in their own right.
  /\b(?:pre-?gate|gate|override|no-verify|merge queue|pull request|PR)\b/i,
];

// High-precision structural signal (BI-0F0BE69A): a question carrying a code
// identifier is by construction about the codebase, not about naming, branding,
// or market strategy.
export const TECHNICAL_ARTIFACT = [
  /\b(?:BI|EP|DI|PR|DOC|AGT)-[A-Z0-9][A-Z0-9-]{3,}\b/, // semantic ids (case-sensitive on purpose)
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // SCREAMING_SNAKE constants (SETUP_STEPS, PORTFOLIO_SLUGS)
  /\b[\w.-]+\.(?:ts|tsx|mjs|cjs|js|jsx|prisma|sql|json|ya?ml|md)\b/i, // file names
  /\b(?:packages|apps|scripts|services|docs)\/[\w./-]+/i, // repo paths
];

export const ALL_SIGNALS = [...DECISION_LANGUAGE, ...DELIVERY_LANGUAGE, ...TECHNICAL_ARTIFACT];

// If the text already cites a kernel consultation, the agent did the right
// thing (consulted, now surfacing a low-confidence/defer result) — allow it.
export const LEDGER_MARKERS = [
  /principle_decide/i,
  /dpf-decision-via-kernel/i,
  /\bWWMD\b/,
  /kernel (?:ledger|consultation|recommend)/i,
  /\bcomposite\b/i,
  /\bmargin\b/i,
  /contribution ledger/i,
  /consulted the kernel/i,
];

// Explicit opt-out for a genuinely operator-owned decision that happens to trip
// the heuristic.
export const BYPASS_TOKEN = /\[(?:direct-ask|operator-owned)\]/i;

export function hasDecisionSignal(text) {
  return ALL_SIGNALS.some((re) => re.test(text));
}

export function hasLedgerMarker(text) {
  return LEDGER_MARKERS.some((re) => re.test(text));
}

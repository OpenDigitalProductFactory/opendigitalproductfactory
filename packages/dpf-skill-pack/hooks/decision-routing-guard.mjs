#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/decision-routing-guard.mjs
//
// PreToolUse guard (BI-383668B9, EP-5560770F — Gate A of the harness-enforced
// decision-routing + lease-punt spec, docs/superpowers/specs/2026-07-03-...).
//
// `consult-scopes-before-asking` is a COMMANDMENT: before asking a human to
// choose on a platform/build decision, an agent must consult the governed scope
// (WWMD / principle_decide via dpf-decision-via-kernel) and act on a
// high-confidence recommendation; it escalates to the human only if the kernel
// returns low confidence or flags a commandment conflict. Until now this lived
// only in prose + skill guidance, so a session could — and did — skip straight
// to a numbered menu ("Option 3 it is").
//
// This guard blocks an AskUserQuestion that presents a platform/build DECISION
// (2+ options in engineering approach/architecture vocabulary) with no evidence
// of a kernel consultation. The block mode (vs a soft nudge) is the founder
// kernel's own high-confidence recommendation for this choice (principle_decide,
// 2026-07-03: hard_block composite 4.54 vs warn 3.78, margin 0.75).
//
// False-positive control is the NARROW scope, not the block strength: the guard
// trips on codebase-decision signals, so operator-owned questions (naming,
// branding, business strategy) do not match and are never blocked. Two
// escapes remain: (a) once the agent HAS consulted and is legitimately surfacing
// a low-confidence/defer result, its question references the ledger
// (principle_decide / composite / margin) and is allowed; (b) explicit bypass via
// the DPF_ALLOW_DIRECT_ASK=1 env var or a `[direct-ask]` / `[operator-owned]`
// token in the question. Fails OPEN on any error.
//
// Decision protocol mirrors lease-guard.mjs (deny + reason, exit 0).

import { readHookPayload, isDecisionTool, emitDeny, inDpfWorkspace } from "./lib/hook-io.mjs";

// Engineering approach/architecture-selection vocabulary. Deliberately excludes
// generic "which" so operator-owned questions ("which brand color", "what should
// we name it") do not match — "which" must be followed by an engineering noun.
const DECISION_LANGUAGE = [
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
const DELIVERY_LANGUAGE = [
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
];

// High-precision structural signal (BI-0F0BE69A): a question carrying a code
// identifier is by construction about the codebase, not about naming, branding,
// or market strategy. These patterns are near-zero-false-positive against
// operator-owned questions — "Nova"/"Atlas"/"SMB"/"Blue" match none of them —
// and they caught two of the three questions that escaped the original guard.
const TECHNICAL_ARTIFACT = [
  /\b(?:BI|EP|DI|PR|DOC|AGT)-[A-Z0-9][A-Z0-9-]{3,}\b/, // semantic ids (case-sensitive on purpose)
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // SCREAMING_SNAKE constants (SETUP_STEPS, PORTFOLIO_SLUGS)
  /\b[\w.-]+\.(?:ts|tsx|mjs|cjs|js|jsx|prisma|sql|json|ya?ml|md)\b/i, // file names
  /\b(?:packages|apps|scripts|services|docs)\/[\w./-]+/i, // repo paths
];

const ALL_SIGNALS = [...DECISION_LANGUAGE, ...DELIVERY_LANGUAGE, ...TECHNICAL_ARTIFACT];

// If the question already cites a kernel consultation, the agent did the right
// thing (consulted, now surfacing a low-confidence/defer result) — allow it.
const LEDGER_MARKERS = [
  /principle_decide/i,
  /dpf-decision-via-kernel/i,
  /\bWWMD\b/,
  /kernel (?:ledger|consultation|recommend)/i,
  /\bcomposite\b/i,
  /\bmargin\b/i,
  /contribution ledger/i,
  /consulted the kernel/i,
];

// Explicit per-call bypass token for a genuinely operator-owned decision that
// happens to trip the heuristic.
const BYPASS_TOKEN = /\[(?:direct-ask|operator-owned)\]/i;

const GUIDANCE =
  "Decision-routing gate (BI-383668B9): this looks like a platform/build decision with multiple options, asked of the operator without a kernel consultation. " +
  "`consult-scopes-before-asking` is a commandment — route it through the kernel FIRST: dpf-decision-via-kernel -> principle_decide. Act on a high-confidence recommendation; do not ask. " +
  "Only surface to the operator if the kernel returns low confidence (margin < tieMargin) or a commandment conflict — and when you do, include the ledger (composite/margin) in the question so this gate recognizes the legitimate escalation. " +
  "For a genuinely operator-owned call (naming, branding, business strategy), bypass with DPF_ALLOW_DIRECT_ASK=1 or a `[operator-owned]` tag in the question.";

/**
 * Pure decision: should this AskUserQuestion be blocked? Exported for tests.
 * @param {string} toolName
 * @param {{ questions?: Array<{question?:string, header?:string, options?:Array<{label?:string,description?:string}>}> }} toolInput
 * @param {Record<string,string|undefined>} env
 * @returns {{ block: boolean, reason?: string, header?: string }}
 */
export function decide(toolName, toolInput = {}, env = {}) {
  if (!isDecisionTool(toolName)) return { block: false };
  if (env.DPF_ALLOW_DIRECT_ASK === "1") return { block: false };
  const questions = Array.isArray(toolInput?.questions) ? toolInput.questions : [];
  for (const q of questions) {
    const options = Array.isArray(q?.options) ? q.options : [];
    if (options.length < 2) continue; // single-path / factual clarification
    const text = [
      q?.question,
      q?.header,
      ...options.map((o) => `${o?.label ?? ""} ${o?.description ?? ""}`),
    ]
      .filter(Boolean)
      .join(" ");
    if (BYPASS_TOKEN.test(text)) continue;
    if (LEDGER_MARKERS.some((re) => re.test(text))) continue; // consulted → surfacing
    if (ALL_SIGNALS.some((re) => re.test(text))) {
      return { block: true, reason: GUIDANCE, header: q?.header };
    }
  }
  return { block: false };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0); // DPF-scoped global hook: enforce only inside a DPF checkout

  // Operator-decision tool across surfaces (AskUserQuestion / AskQuestion).
  if (!isDecisionTool(payload.toolName)) process.exit(0);
  const verdict = decide(payload.toolName, payload.toolInput ?? {}, process.env);
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason); // dual-envelope deny — blocks on every surface
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("decision-routing-guard.mjs")) {
  main();
}

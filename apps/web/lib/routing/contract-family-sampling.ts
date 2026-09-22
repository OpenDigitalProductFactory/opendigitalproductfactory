// apps/web/lib/routing/contract-family-sampling.ts
//
// BI-40DA6D05: temperature follows the CONTRACT FAMILY, not the budget class.
//
// The superseded rule (recipe-seeder's OPENAI_CHAT_TEMPERATURE) mapped
// minimize_cost → 0.3, balanced → 0.7, quality_first → 1.0. Budget class says
// how much we are willing to SPEND; temperature says how much we are willing to
// VARY. They are unrelated axes, and that mapping was actively inverted for the
// case that matters most: a deterministic field extraction on a quality_first
// budget got temperature 1.0 — maximum variance on the task that needs none.
//
// Budget class keeps its real job — choosing the model and capping spend — and
// no longer touches sampling. (It does legitimately govern how many deliberation
// passes we run; see the quality-by-process design.)
//
// Spec: docs/superpowers/specs/2026-09-18-situational-llm-call-parameterization-design.md §2

/** What a task wants from sampling, independent of which model serves it. */
export type SamplingIntent =
  | "deterministic"
  | "precise"
  | "considered"
  | "conversational"
  | "divergent";

const INTENT_TEMPERATURE: Record<SamplingIntent, number> = {
  deterministic: 0.0,
  precise: 0.2,
  // `considered` deliberately carries no opinion of its own — analysis and review
  // want whatever the model's own thinking-mode profile says, which is stricter
  // evidence than our table. resolveSamplingIntent callers read TEMPERATURE only
  // when no vendor thinking profile applies.
  considered: 0.4,
  conversational: 0.7,
  divergent: 0.9,
};

/**
 * Contract families, as `inferContract` mints them ("sync.tool_action",
 * "sync.code_gen", …). Matched on the segment after the interaction mode so a
 * background or batch variant of the same work gets the same intent.
 */
const FAMILY_INTENT: Record<string, SamplingIntent> = {
  // One right answer — any variance is a defect, not creativity.
  extraction: "deterministic",
  classification: "deterministic",
  schema_output: "deterministic",
  structured_output: "deterministic",
  triage: "deterministic",
  // Correctness over variety.
  tool_action: "precise",
  code_gen: "precise",
  code: "precise",
  // Judgement work: the model's own reasoning profile should lead.
  analysis: "considered",
  review: "considered",
  reasoning: "considered",
  deliberation: "considered",
  // Prose for a person.
  conversation: "conversational",
  chat: "conversational",
  drafting: "conversational",
  summarization: "conversational",
  // Deliberately many candidates.
  ideation: "divergent",
  brainstorm: "divergent",
  naming: "divergent",
};

/** Strip the interaction-mode prefix: "sync.code_gen" → "code_gen". */
export function contractFamilyKey(contractFamily: string): string {
  const trimmed = contractFamily.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  return dot >= 0 ? trimmed.slice(dot + 1) : trimmed;
}

/**
 * The sampling intent a contract family implies, or null when the family is
 * unknown. Null means "assert nothing" — an unrecognised family must not be
 * silently treated as conversational.
 */
export function resolveSamplingIntent(contractFamily: string): SamplingIntent | null {
  return FAMILY_INTENT[contractFamilyKey(contractFamily)] ?? null;
}

/** The temperature that intent asks for. */
export function intentTemperature(intent: SamplingIntent): number {
  return INTENT_TEMPERATURE[intent];
}

/**
 * The temperature a contract family asks for, or null when unknown.
 * `strictSchema` forces determinism regardless of family: a response that must
 * satisfy a schema has one correct shape, whatever the task around it is.
 */
export function contractFamilyTemperature(
  contractFamily: string,
  opts?: { strictSchema?: boolean },
): number | null {
  if (opts?.strictSchema) return INTENT_TEMPERATURE.deterministic;
  const intent = resolveSamplingIntent(contractFamily);
  return intent ? INTENT_TEMPERATURE[intent] : null;
}

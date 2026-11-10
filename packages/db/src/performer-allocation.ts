// Performer kinds and work-allocation patterns — the human / AI / robot boundary.
//
// WHY THIS EXISTS. FPAW §10 ("Performer and work-allocation model") normatively
// specifies two closed axes: five performer kinds an implementation MUST
// distinguish, and twelve allocation patterns that say who executes and who
// controls. Until this module, a grep for every one of those terms across
// packages/db/prisma, apps/web/lib and packages/ returned ZERO hits outside the
// standard document itself (BI-40B36B94).
//
// That is the defect shape this codebase keeps finding: doctrine that reads as
// shipped and is inert. A standard with no consumer cannot refuse anything, so
// the §10.2 prohibition — "an ineligible performer MUST NOT become eligible
// merely because it is faster, cheaper, available, or preferred by a model" —
// had nothing to enforce it.
//
// WHAT THIS SLICE DOES AND DOES NOT DO. It makes the vocabulary canonical and
// drift-proof: performer-allocation.test.ts parses FPAW §10 and fails if the
// standard and this module disagree in either direction. It deliberately adds
// NO Prisma enum and NO column. An allocation record has to be designed against
// the activity substrate, not guessed at from a staffing shift; inventing a
// column nothing writes would reproduce the very defect being closed. Later
// slices import from here instead of retyping string literals, so the closed set
// has exactly one home (AGENTS.md §8).
//
// Standard: docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md §10

/**
 * Who — or what — can be assigned work. FPAW §10.1.
 *
 * Passive machinery is a Resource, not a Performer. An authorized robot has
 * both a performer identity and a separately managed physical asset, controller
 * and safety configuration. A mixed team is a Collaboration over these kinds,
 * not a sixth kind of its own.
 */
export const PERFORMER_KINDS = [
  "human",
  "ai-coworker",
  "deterministic-automation",
  "authorized-robot",
  "partner-organization",
] as const;
export type PerformerKind = (typeof PERFORMER_KINDS)[number];

/**
 * How execution and control are split between performers. FPAW §10.3.
 *
 * Ordered as the standard orders them: from work a human must do, through the
 * graduated hand-offs, to work a qualified AI may do unattended inside a
 * TAK-enforced ceiling — then the non-agentic and multi-party patterns. The
 * order is the human-to-AI gradient and is asserted by the conformance test.
 */
export const ALLOCATION_PATTERNS = [
  "human-only",
  "human-led-ai-assisted",
  "ai-prepare-human-decide",
  "paired-execution",
  "ai-led-human-approved",
  "ai-primary-human-exception",
  "bounded-autonomous-ai",
  "deterministic-automation",
  "robot-primary-safety-supervised",
  "partner-primary-internal-accountable",
  "mixed-sequential",
  "mixed-parallel",
] as const;
export type AllocationPattern = (typeof ALLOCATION_PATTERNS)[number];

/**
 * The eligibility gates of FPAW §10.2 step 1.
 *
 * These are a GATE, not a score. Every one must pass before suitability is
 * considered at all — that ordering is the whole point of §10.2, and it is why
 * "faster / cheaper / available / preferred by a model" cannot promote an
 * ineligible performer.
 *
 * `license-credential` is the join to EP-LIC-C64FC2: the platform already
 * tracks credentials and renewal posture, and this is the axis that consumes
 * one as a constraint on who may execute.
 */
export const ELIGIBILITY_GATES = [
  "authority",
  "license-credential",
  "safety",
  "physical-reach",
  "data-clearance",
  "tool-resource-availability",
  "qualification",
  "contractual-legal",
] as const;
export type EligibilityGate = (typeof ELIGIBILITY_GATES)[number];

/** Whether a pattern permits an AI performer to EXECUTE (rather than assist). */
const AI_EXECUTING_PATTERNS: ReadonlySet<AllocationPattern> = new Set([
  "ai-led-human-approved",
  "ai-primary-human-exception",
  "bounded-autonomous-ai",
]);

/**
 * True when the pattern lets an AI coworker execute the work itself.
 *
 * `ai-prepare-human-decide` is deliberately FALSE: the AI prepares, and an
 * authorized human makes the consequential decision. Reading "AI is involved"
 * as "AI executes" is the collapse this predicate exists to prevent.
 */
export function allowsAiExecution(pattern: AllocationPattern): boolean {
  return AI_EXECUTING_PATTERNS.has(pattern);
}

/**
 * True when the pattern requires a named human in the control path — as
 * decider, approver, exception handler, or safety supervisor.
 *
 * `bounded-autonomous-ai` is the only AI-executing pattern that returns false:
 * it runs without per-occurrence review. Accountability and escalation are
 * still separate assignments (§10.4) — unreviewed is not unaccountable.
 */
export function requiresHumanInControlPath(pattern: AllocationPattern): boolean {
  return pattern !== "bounded-autonomous-ai" && pattern !== "deterministic-automation";
}

/** Narrowing guards for values arriving from JSON, config or a model. */
export function isPerformerKind(value: unknown): value is PerformerKind {
  return typeof value === "string" && (PERFORMER_KINDS as readonly string[]).includes(value);
}

export function isAllocationPattern(value: unknown): value is AllocationPattern {
  return typeof value === "string" && (ALLOCATION_PATTERNS as readonly string[]).includes(value);
}

export function isEligibilityGate(value: unknown): value is EligibilityGate {
  return typeof value === "string" && (ELIGIBILITY_GATES as readonly string[]).includes(value);
}

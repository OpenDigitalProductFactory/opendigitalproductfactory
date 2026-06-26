// Signal (1) of the self-driving cognitive-load migration loop (BI-A028AA14,
// EP-COST-001): the AI-to-code "stabilized -> codify" trigger.
//
// Distills ToolExecution telemetry into a per-(agent x tool x input-shape)
// stability summary so the migration curator can NOMINATE "codify X" candidates
// with evidence -- instead of re-reading code every cycle. A reasoning pattern
// that recurs often, returns the same outcome, and succeeds is a candidate to
// replace with deterministic code (the descent the whole effort is about).
//
// SCOPE -- this is the pure, deterministic STATS CORE only:
//   - It takes samples whose `inputShape` / `outputDigest` are ALREADY
//     normalised by the caller. HOW to canonicalise ToolExecution.parameters /
//     result is a deliberate, tunable decision documented in the design pass and
//     kept OUT of this codifiable core (so the core never churns when the
//     normalisation is retuned).
//   - It NEVER files anything. Turning a "stabilized" verdict into a triaging
//     "codify X" BI is the auto-nomination wiring -- a separate, FOUNDER-GATED
//     step, because it mutates the backlog from telemetry. See:
//     docs/superpowers/plans/2026-06-26-self-driving-migration-nomination-signals-design.md

export interface ToolReasoningSample {
  agentId: string;
  toolName: string;
  /** Caller-normalised signature of the input parameters (the "kind" of call). */
  inputShape: string;
  /** Caller-normalised signature of the result (equal digests mean equal outcome). */
  outputDigest: string;
  success: boolean;
}

export type StabilityVerdict =
  | "stabilized" // recurs often, low output variance, high success -> codify candidate
  | "variable" // recurs, but outputs vary or it fails too often -> keep as AI judgment
  | "insufficient-data"; // too few occurrences to judge

export interface ToolReasoningStability {
  agentId: string;
  toolName: string;
  inputShape: string;
  recurrence: number;
  distinctOutputs: number;
  /** distinctOutputs / recurrence, in (0,1]; lower means more deterministic. */
  varianceRatio: number;
  /** successes / recurrence, in [0,1]. */
  successRate: number;
  verdict: StabilityVerdict;
}

/** Minimum occurrences of a signature before a verdict is trustworthy. */
export const MIN_RECURRENCE_TO_JUDGE = 10;
/** At/below this distinct-output ratio the pattern is deterministic enough. */
export const MAX_VARIANCE_RATIO_TO_CODIFY = 0.2;
/** Only codify a pattern that succeeds at least this often. */
export const MIN_SUCCESS_RATE_TO_CODIFY = 0.9;

/**
 * Group tool-execution samples by (agent x tool x input-shape) and classify each
 * group's codifiability. Pure + deterministic (no DB, no clock) so it is fully
 * unit-testable and capacity-cheap to run over a telemetry window. Results are
 * ordered most-codifiable-first.
 */
export function summarizeToolReasoningStability(
  samples: ToolReasoningSample[],
): ToolReasoningStability[] {
  const groups = new Map<
    string,
    { agentId: string; toolName: string; inputShape: string; outputs: Set<string>; total: number; successes: number }
  >();

  for (const s of samples) {
    const key = `${s.agentId} ${s.toolName} ${s.inputShape}`;
    let g = groups.get(key);
    if (!g) {
      g = { agentId: s.agentId, toolName: s.toolName, inputShape: s.inputShape, outputs: new Set(), total: 0, successes: 0 };
      groups.set(key, g);
    }
    g.total += 1;
    if (s.success) g.successes += 1;
    g.outputs.add(s.outputDigest);
  }

  const out: ToolReasoningStability[] = [];
  for (const g of groups.values()) {
    const recurrence = g.total;
    const distinctOutputs = g.outputs.size;
    const varianceRatio = distinctOutputs / recurrence;
    const successRate = g.successes / recurrence;
    out.push({
      agentId: g.agentId,
      toolName: g.toolName,
      inputShape: g.inputShape,
      recurrence,
      distinctOutputs,
      varianceRatio,
      successRate,
      verdict: classifyStability(recurrence, varianceRatio, successRate),
    });
  }

  // Deterministic ordering: codify candidates first, then by recurrence desc,
  // then by a stable key so equal rows never reorder run-to-run.
  out.sort(
    (a, b) =>
      codifyRank(b) - codifyRank(a) ||
      b.recurrence - a.recurrence ||
      stableKey(a).localeCompare(stableKey(b)),
  );
  return out;
}

function classifyStability(recurrence: number, varianceRatio: number, successRate: number): StabilityVerdict {
  if (recurrence < MIN_RECURRENCE_TO_JUDGE) return "insufficient-data";
  if (varianceRatio <= MAX_VARIANCE_RATIO_TO_CODIFY && successRate >= MIN_SUCCESS_RATE_TO_CODIFY) {
    return "stabilized";
  }
  return "variable";
}

function codifyRank(s: ToolReasoningStability): number {
  return s.verdict === "stabilized" ? 1 : 0;
}

function stableKey(s: ToolReasoningStability): string {
  return `${s.agentId} ${s.toolName} ${s.inputShape}`;
}

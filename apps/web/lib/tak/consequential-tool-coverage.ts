// apps/web/lib/tak/consequential-tool-coverage.ts
//
// Derives the consult-gated tool set from the DECLARED consequence class on
// each ToolDefinition (TAK §8.4.1 — "derived, not enumerated").
//
// The defect this closes: the consult-before-consequential-act gate was built,
// enforced by default, and correct — and governed 2 of 174 side-effecting
// tools, because its reach was a hand-maintained allowlist inside the hook. An
// allowlist is an opt-in, so every tool added after it was written was ordinary
// by omission and nobody had to decide that. Reading `ToolDefinition.consequence`
// instead makes the classification live where the tool is declared, so a new
// consequential tool is gated the moment it declares what it is.
//
// CONSEQUENTIAL_DECISION_TOOLS survives as a TRANSITIONAL SEED and is UNIONED,
// never replaced: it carries the two backlog decision-actions (triage / retire)
// whose consequence is the DECISION taken, not a declared reach, so they would
// not otherwise derive. Removing the seed would silently shrink coverage.
//
// Not in scope here (deliberately, own review): flipping the default for an
// UNCLASSIFIED side-effecting tool to consequential. That would move ~120 tools
// behind the gate at once. `summary.consequentialGate` in the capability
// measure reports the remaining gap so it stays visible rather than assumed.

import { PLATFORM_TOOLS, type ToolDefinition } from "@/lib/mcp-tools";
import { CONSEQUENTIAL_DECISION_TOOLS } from "@/lib/tak/decision-routing-governance-hook";

export type ConsequenceClassifiableTool = Pick<
  ToolDefinition,
  "name" | "sideEffect" | "consequence"
>;

/**
 * Pure derivation — exported for tests and for the measure's parity check.
 * A tool is consequential when it declares a `consequence` AND has a side
 * effect (a declared reach on a read-only tool is a declaration error, not a
 * gate), or when it is named in the transitional seed.
 */
export function deriveConsequentialToolNames(input: {
  tools: readonly ConsequenceClassifiableTool[];
  seed?: ReadonlySet<string>;
}): ReadonlySet<string> {
  const seed = input.seed ?? CONSEQUENTIAL_DECISION_TOOLS;
  const derived = new Set<string>(seed);
  for (const tool of input.tools) {
    if (tool.sideEffect && tool.consequence) derived.add(tool.name);
  }
  return derived;
}

let _cache: ReadonlySet<string> | null = null;

/** The live gated set over the real platform catalog. Memoized; the catalog is static. */
export function getConsequentialToolNames(): ReadonlySet<string> {
  _cache ??= deriveConsequentialToolNames({ tools: PLATFORM_TOOLS });
  return _cache;
}

/** Test seam — the catalog is module-static, so the memo must be clearable. */
export function _resetConsequentialToolCacheForTests(): void {
  _cache = null;
}

/**
 * Coverage of the gate over the side-effecting surface. The number the
 * capability measure reports and the CI ratchet holds shrink-only.
 */
export function measureConsequentialGateCoverage(
  tools: readonly ConsequenceClassifiableTool[] = PLATFORM_TOOLS,
): {
  sideEffectingTools: number;
  gateClassified: number;
  ungated: number;
  coveragePct: number;
} {
  const gated = deriveConsequentialToolNames({ tools });
  const sideEffecting = tools.filter((t) => t.sideEffect);
  const classified = sideEffecting.filter((t) => gated.has(t.name));
  return {
    sideEffectingTools: sideEffecting.length,
    gateClassified: classified.length,
    ungated: sideEffecting.length - classified.length,
    coveragePct:
      sideEffecting.length === 0
        ? 0
        : Math.round((classified.length / sideEffecting.length) * 100),
  };
}

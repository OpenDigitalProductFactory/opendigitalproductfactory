// apps/web/lib/build/decision-ledger.ts
//
// Band 3 of the Build Studio "Solution & Oversight" layer (overseer-grade UX).
// Spec: docs/superpowers/specs/2026-06-22-build-studio-overseer-ux-design.md (§3.3, §4.2).
// BI-EC934FC6.
//
// A pure read-model that surfaces, at a non-technical overseer's altitude, the
// decisions the platform already recorded for a build — unifying TWO existing
// sources into one plain "the call / the options / the why" shape:
//   1. FeatureBuild.deliberationSummary — per-phase peer-review / debate outcome.
//   2. DecisionInteraction rows (scoped by buildId) — governed kernel / WWMD
//      principle_decide calls.
// Both already exist and are written by the build pipeline; this NEVER mutates
// them. Today neither is shown at top altitude (deliberation only inside the
// collapsed DetailsDrawer; kernel decisions only on /platform/ai/founder-review).

import { prisma } from "@dpf/db";
import type {
  BuildDeliberationSummary,
  BuildDeliberationPhase,
} from "@/lib/feature-build-types";

export type BuildDecisionLedgerSource = "deliberation" | "kernel";

/** One plain-language decision for the overseer. */
export type BuildDecisionLedgerEntry = {
  /** Stable key for React lists + dedupe. */
  id: string;
  /** Which lifecycle phase the decision belongs to. */
  phase: BuildDeliberationPhase | "build";
  /** "deliberation" = peer-review/debate consensus; "kernel" = governed WWMD/principle_decide. */
  source: BuildDecisionLedgerSource;
  /** Plain "what we decided". */
  theCall: string;
  /** The options that were weighed (may be empty when the source records none). */
  theOptions: string[];
  /** Plain "why" — the rationale. */
  theWhy: string;
  /** True for governed kernel decisions (surfaced with a governance tag). */
  governance: boolean;
  /** Honestly-surfaced open risks carried from the source (never silently dropped). */
  unresolvedRisks: string[];
};

/** DB-agnostic shape of a DecisionInteraction row the projector consumes.
 *  Keeping this minimal lets the pure projector be unit-tested without a DB. */
export type DecisionInteractionInput = {
  interactionId: string;
  phaseFrom: string | null;
  phaseTo: string | null;
  question: string;
  options: unknown; // Json column — array of strings or option objects
  rationale: string | null;
  principleConflict: boolean;
  createdAt: Date;
};

const PHASE_RANK: Record<BuildDecisionLedgerEntry["phase"], number> = {
  ideate: 0,
  plan: 1,
  build: 2,
  review: 3,
};

const DELIBERATION_PHASES: BuildDeliberationPhase[] = ["ideate", "plan", "review"];

function phaseLabel(phase: BuildDeliberationPhase): string {
  if (phase === "ideate") return "design";
  if (phase === "plan") return "plan";
  return "review";
}

/** Coerce a known phase string; anything else collapses to "plan" so an entry
 *  always has a sortable, renderable phase. */
function normalizePhase(value: string | null | undefined): BuildDecisionLedgerEntry["phase"] {
  if (value === "ideate" || value === "plan" || value === "build" || value === "review") {
    return value;
  }
  return "plan";
}

/** Parse the loosely-typed DecisionInteraction.options Json into plain strings.
 *  Accepts an array of strings or of objects ({ label | name | title | option | id }).
 *  Anything else yields []. */
function coerceOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const label = o.label ?? o.name ?? o.title ?? o.option ?? o.id;
      if (typeof label === "string" && label.trim()) out.push(label.trim());
    }
  }
  return out;
}

function deliberationCall(
  phase: BuildDeliberationPhase,
  patternSlug: "review" | "debate",
  consensusState: string,
): string {
  const patternPhrase = patternSlug === "debate" ? "a debate" : "peer review";
  const patternNoun = patternSlug === "debate" ? "debate" : "peer review";
  const what = phaseLabel(phase);
  switch (consensusState) {
    case "consensus":
      return `Accepted the ${what} after ${patternPhrase}`;
    case "partial-consensus":
      return `Accepted the ${what} with some open concerns after ${patternPhrase}`;
    case "pending":
      return `The ${what} ${patternNoun} is still in progress`;
    default:
      // no-consensus / insufficient-evidence / anything unexpected
      return `Flagged unresolved concerns in the ${what} ${patternNoun}`;
  }
}

/**
 * PURE projector — given the two existing sources, returns the plain ledger.
 * No DB, no mutation, deterministic. This is the unit-tested core; the loader
 * below is the only DB-bound part.
 */
export function projectDecisionLedger(
  deliberationSummary: BuildDeliberationSummary | null,
  decisions: readonly DecisionInteractionInput[],
): BuildDecisionLedgerEntry[] {
  const entries: BuildDecisionLedgerEntry[] = [];

  // 1. Per-phase deliberation (peer-review / debate) consensus.
  if (deliberationSummary) {
    for (const phase of DELIBERATION_PHASES) {
      const entry = deliberationSummary[phase];
      if (!entry) continue;
      entries.push({
        id: `deliberation:${phase}:${entry.deliberationRunId}`,
        phase,
        source: "deliberation",
        theCall: deliberationCall(phase, entry.patternSlug, entry.consensusState),
        theOptions: [],
        theWhy: entry.rationaleSummary,
        governance: false,
        unresolvedRisks: Array.isArray(entry.unresolvedRisks) ? entry.unresolvedRisks : [],
      });
    }
  }

  // 2. Governed kernel / WWMD decisions (the calls the canary surfacing today misses).
  for (const decision of decisions) {
    entries.push({
      id: `kernel:${decision.interactionId}`,
      phase: normalizePhase(decision.phaseTo ?? decision.phaseFrom),
      source: "kernel",
      theCall: decision.question.trim(),
      theOptions: coerceOptions(decision.options),
      theWhy: (decision.rationale ?? "").trim(),
      governance: true,
      unresolvedRisks: [],
    });
  }

  // Stable order: by phase, then deliberation before kernel within a phase, then
  // original insertion order (decisions already arrive createdAt-ascending).
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byPhase = PHASE_RANK[a.entry.phase] - PHASE_RANK[b.entry.phase];
      if (byPhase !== 0) return byPhase;
      if (a.entry.source !== b.entry.source) {
        return a.entry.source === "deliberation" ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * DB-bound loader: reads the two existing sources for a build and projects them.
 * Read-only — performs no writes and adds no new data exposure (it reads only
 * records already visible for this build via the drawer + founder-review).
 */
export async function loadBuildDecisionLedger(
  buildId: string,
): Promise<BuildDecisionLedgerEntry[]> {
  const [build, decisions] = await Promise.all([
    prisma.featureBuild.findUnique({
      where: { buildId },
      select: { deliberationSummary: true },
    }),
    prisma.decisionInteraction.findMany({
      where: { buildId },
      orderBy: { createdAt: "asc" },
      select: {
        interactionId: true,
        phaseFrom: true,
        phaseTo: true,
        question: true,
        options: true,
        rationale: true,
        principleConflict: true,
        createdAt: true,
      },
    }),
  ]);

  const deliberationSummary =
    (build?.deliberationSummary as unknown as BuildDeliberationSummary | null) ?? null;

  return projectDecisionLedger(deliberationSummary, decisions);
}

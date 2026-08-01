// Stance → decision-axis mapping (BI-E1427A3E, Phase 0).
//
// Spec: docs/superpowers/specs/2026-07-31-stance-derived-dimension-vectors-design.md
//
// WHY THIS EXISTS. The platform has two things called "vectors" and until now
// they were not connected. The 20-axis registry (`PRINCIPLE_DIMENSIONS`) is what
// options are scored against. The five business stance vectors are the only
// layer a business owner ever edits — and `seed-org-wwwd-corpus.ts` seeds them
// as `pageKind: "stance"` with no principle block, so their
// `principleDimensionVector` is null in every install. An owner could say "we
// honour a quote we got wrong" and it moved no axis on any option a coworker
// weighed; the stance only ever reached a decision through retrieval and the
// semantic-alignment fallback.
//
// This module is the MAP ONLY. Phase 0 deliberately ships no derivation and
// writes nothing: authoring the edges is the reviewable act, and wiring them to
// live scoring is Phase 2 behind the simulation gate in the spec (§6).
//
// PLATFORM-OWNED, IDENTICAL IN EVERY INSTALL. An install re-weights the shared
// registry; it never declares axes. Per-org axes would make each install's
// judgement incomparable with every other's and destroy the hive's ability to
// generalise (tier-rebalance design §2.3). Only the RESOLVED weights differ per
// org — never the map.

import {
  PRINCIPLE_COST_DIMENSIONS,
  type PrincipleDimension,
} from "@dpf/db/wiki-taxonomy";

import {
  STANCE_VECTOR_KEYS,
  type StanceVectorKey,
} from "@/lib/onboarding/archetype-business-context";

/**
 * The ceiling on any stance-derived weight magnitude.
 *
 * KERNEL RULING DI-687A1094E253 (2026-08-01, `cap-below-doctrine`, margin
 * 6.52, no commandment conflict): an organization's stance is authoritative
 * WITHIN its scope but never doctrine-tier — not even at the `ruled` tier where
 * a human has ruled on a real decision. Subsidiarity gives the org the decision
 * it owns; it does not let commercial policy outweigh a universal obligation
 * (safety, privacy, never-wipe-db) that the commandments carry at magnitude 1.0.
 *
 * Set to the core-tier default (0.4) so a stance can genuinely move a ranking
 * while one commandment at full alignment still outweighs it decisively.
 */
export const STANCE_MAX_MAGNITUDE = 0.4;

/**
 * Axes a stance may NEVER derive a weight on, whatever its wording.
 *
 * KERNEL RULING DI-A01830820221 (2026-08-01, `never-derive-safety`, margin
 * 2.65, no commandment conflict): `public_safety` is on the spine as a
 * UNIVERSAL OBLIGATION rather than by usage frequency. Some archetype
 * `quality-bar` defaults do name safety ("patient safety and clinical quality
 * are never traded for speed or margin"), which is exactly why deriving from
 * them is tempting — and exactly why it is refused. Safety weight comes from
 * profession corpora and kernel principles, never from an owner-authored
 * COMMERCIAL stance, so no org can dilute or manufacture a safety weight by
 * editing its quality bar.
 */
export const STANCE_FORBIDDEN_DIMENSIONS = [
  "public_safety",
] as const satisfies readonly PrincipleDimension[];

export type StanceForbiddenDimension =
  (typeof STANCE_FORBIDDEN_DIMENSIONS)[number];

/** One stance → axis edge. */
export type StanceAxisEdge = {
  /** The axis this stance speaks to. Constrained to the closed registry. */
  dimension: PrincipleDimension;
  /**
   * Signed base weight, magnitude <= STANCE_MAX_MAGNITUDE. A COST axis must be
   * negative: option features are non-negative, so the only way to express
   * "this stance pulls against the cost" is a negative weight. A positive
   * weight on a cost axis makes the scorer reward the very harm the stance
   * opposes — the `never-wipe-db` inversion (2026-06-14 sign audit).
   *
   * `ceilingUsd` scaling on top of this base is Phase 1 (spec §4.2); it is
   * deliberately not applied here.
   */
  weight: number;
  /**
   * Why this edge exists, traceable to the stance defaults' own wording rather
   * than to what the axis NAME suggests (spec §5.1).
   */
  rationale: string;
  /**
   * True when the axis is profession-local. Such an edge may only be scored
   * inside its owning profession; outside it, the axis projects onto its spine
   * target. Derivation (Phase 2) must honour this — it is declared here so the
   * constraint is reviewable rather than implicit.
   */
  professionLocal?: true;
};

/**
 * The map. `satisfies Record<StanceVectorKey, ...>` is the enforcement: adding
 * a stance key without mapping it is a COMPILE error, not a silently unmapped
 * stance — the same discipline as `PRINCIPLE_DIMENSION_SCOPE`.
 */
export const STANCE_DIMENSION_MAP = {
  "customer-goodwill": [
    {
      dimension: "cost_efficiency",
      weight: -0.3,
      rationale:
        "Every default frames goodwill as absorbing cost to keep a relationship: 'a redo, replacement, refund, or credit'. Negative because this stance deliberately trades money away — it is not the cheap option, and scoring it as one would invert the owner's intent.",
    },
    {
      dimension: "long_term_maintainability",
      weight: 0.35,
      rationale:
        "What the money buys is relationship durability — 'a comped meal that wins the next three visits is cheap'. Durability is the axis every profession can weigh that against.",
    },
    {
      dimension: "speed_to_value",
      weight: 0.3,
      rationale:
        "'Resolve it on the spot' / 'fix the visit while the guest is still at the table' / 'same-day response' — immediacy is explicit in the generic default and every override.",
    },
    {
      dimension: "operator_effort",
      weight: -0.25,
      rationale:
        "COST axis. 'Without making the customer fight for it' and 'not the argument' are demands to keep the operations-to-resolution low, so the stance pulls against effort.",
    },
  ],
  "pricing-integrity": [
    {
      dimension: "governance_compliance",
      weight: 0.4,
      rationale:
        "'We honor the prices we quote, including our own mistakes' is commitment-keeping — the obligation-satisfaction axis. Public sector sharpens it: fees change 'by public decision, not a service gesture'.",
    },
    {
      dimension: "evidence_density",
      weight: 0.3,
      rationale:
        "The quoted record is what binds; the stance is that the record wins over convenience, which is the verifiable-backing axis rather than assertion.",
    },
    {
      dimension: "cost_efficiency",
      weight: -0.25,
      rationale:
        "Negative: honouring our own error, and refusing to 'price below what the work costs us', both decline the locally cheaper move.",
    },
  ],
  "growth-vs-stability": [
    {
      dimension: "long_term_maintainability",
      weight: 0.4,
      rationale:
        "'Existing commitments get first call on our capacity' — the stance protects the durable book of work over the new opportunity.",
    },
    {
      dimension: "speed_to_value",
      weight: -0.3,
      rationale:
        "Negative on a benefit axis, and legitimately so: 'at the pace quality allows, not faster' is an explicit trade of speed. This is the clearest case in the map of a stance buying something by giving up speed.",
    },
    {
      dimension: "capacity_utilization",
      weight: 0.25,
      professionLocal: true,
      rationale:
        "The stance is literally about how capacity is allocated between new and existing work. Profession-local to operations; projects onto cost_efficiency when the decision leaves operations.",
    },
  ],
  "quality-bar": [
    {
      dimension: "long_term_maintainability",
      weight: 0.4,
      rationale:
        "'A redo is cheaper than a lost reputation' is durability reasoning: pay now to stay correct later.",
    },
    {
      dimension: "evidence_density",
      weight: 0.3,
      rationale:
        "'Work that leaves our hands meets our standard' presumes a checkable standard rather than an asserted one.",
    },
    {
      dimension: "speed_to_value",
      weight: -0.3,
      rationale:
        "Negative: 'if it isn't right, it doesn't leave the pass' declines speed at the margin, however urgent the job.",
    },
    // NO public_safety edge. Several archetype quality-bar defaults DO name
    // safety, which is precisely the tempting case the kernel refused — see
    // STANCE_FORBIDDEN_DIMENSIONS and ruling DI-A01830820221.
  ],
  "spend-authority": [
    {
      dimension: "cost_efficiency",
      weight: 0.4,
      rationale:
        "The stance is directly about money discipline — what may be spent, and up to what ceiling, without the owner.",
    },
    {
      dimension: "blast_radius",
      weight: -0.3,
      rationale:
        "COST axis. 'Anything novel, recurring, or above the ceiling goes to the owner' is a REACH limit, not merely a price limit: recurring and novel commitments reach further than their sticker price.",
    },
    {
      dimension: "reversibility",
      weight: 0.3,
      rationale:
        "Routine budgeted purchases are the reversible ones; the ceiling is where irreversibility begins, which is why crossing it needs the owner.",
    },
    {
      dimension: "legibility_of_consequence",
      weight: 0.35,
      rationale:
        "A ceiling exists so the owner can foresee what proceeds without them — the precondition-of-informed-authorization axis.",
    },
  ],
} as const satisfies Record<StanceVectorKey, readonly StanceAxisEdge[]>;

const COST_DIMENSIONS = new Set<string>(PRINCIPLE_COST_DIMENSIONS);
const FORBIDDEN = new Set<string>(STANCE_FORBIDDEN_DIMENSIONS);

/** Whether an axis is one a stance may never derive a weight on. */
export function isStanceForbiddenDimension(
  dimension: string,
): dimension is StanceForbiddenDimension {
  return FORBIDDEN.has(dimension);
}

/**
 * Assert a map's invariants. Defaults to the live map, so the guard test calls
 * it bare and a violating edge cannot reach main; Phase 2 calls it before any
 * write so a violating vector is never persisted.
 *
 * Takes the map as a parameter specifically so the guard can be tested against
 * deliberately-broken maps. A checker only ever run against a known-good input
 * proves nothing about whether it can actually fail.
 *
 * Returns the list of violations rather than throwing, so a caller can report
 * every problem at once instead of one per run.
 */
export function findStanceDimensionMapViolations(
  map: Partial<Record<StanceVectorKey, readonly StanceAxisEdge[]>> = STANCE_DIMENSION_MAP,
): string[] {
  const violations: string[] = [];

  for (const stanceKey of STANCE_VECTOR_KEYS) {
    const edges: readonly StanceAxisEdge[] = map[stanceKey] ?? [];

    if (edges.length === 0) {
      violations.push(`${stanceKey}: has no edges (an unmapped stance is a silent no-op)`);
      continue;
    }

    const seen = new Set<string>();
    for (const edge of edges) {
      const where = `${stanceKey} -> ${edge.dimension}`;

      if (seen.has(edge.dimension)) {
        violations.push(`${where}: duplicate edge (weights would be ambiguous)`);
      }
      seen.add(edge.dimension);

      if (isStanceForbiddenDimension(edge.dimension)) {
        violations.push(
          `${where}: forbidden axis — a commercial stance may never derive this ` +
            `(kernel ruling DI-A01830820221)`,
        );
      }

      if (edge.weight === 0 || !Number.isFinite(edge.weight)) {
        violations.push(`${where}: weight must be a non-zero finite number (got ${edge.weight})`);
      }

      if (Math.abs(edge.weight) > STANCE_MAX_MAGNITUDE) {
        violations.push(
          `${where}: |weight| ${Math.abs(edge.weight)} exceeds STANCE_MAX_MAGNITUDE ` +
            `${STANCE_MAX_MAGNITUDE} — org stance is never doctrine-tier ` +
            `(kernel ruling DI-687A1094E253)`,
        );
      }

      if (COST_DIMENSIONS.has(edge.dimension) && edge.weight > 0) {
        violations.push(
          `${where}: cost axis carries a POSITIVE weight (${edge.weight}) — this ` +
            `rewards the very cost the stance opposes (the never-wipe-db inversion)`,
        );
      }

      if (edge.rationale.trim().length < 20) {
        violations.push(`${where}: rationale is missing or too short to review`);
      }
    }
  }

  return violations;
}

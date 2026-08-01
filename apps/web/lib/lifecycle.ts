// Pure utility library — no server imports. Safe in tests and client components.
//
// CANONICAL LIFECYCLE BACKBONE — single source of truth for the lifecycle axes that
// every governed thing resolves to, physical and non-physical.
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §4, §8.1.
//
// The platform previously expressed lifecycle/state in ~5 non-reconciled vocabularies
// (EaElement.lifecycleStage/Status, InventoryEntity.status/supportStatus, ServiceOffering
// .status, Document.currentState, BusinessCapability maturity). This module defines the
// ONE common model and resolveLifecycle() maps each of those onto it, so callers stop
// reading model-specific status strings.
//
// Per AGENTS.md §3, fixed-value string columns are canonical enums defined here; values
// use hyphens, not underscores. Adding a value requires updating any DB column comment
// and MCP enum mirror in the same commit.

import type { GovernedThingKind } from "./governed-thing-ref";

// ─── Axis A — Realization stage (structural maturity; CSDM6 elaboration axis) ───────
// Mirrors EaElement.refinementLevel. conceptual → logical → actual (one-way elaboration).
export const REALIZATION_STAGES = ["conceptual", "logical", "actual"] as const;
export type RealizationStage = (typeof REALIZATION_STAGES)[number];

// ─── Axis B — Lifecycle stage (progression; IT4IT-value-stream aligned) ─────────────
// The canonical progression already shared by EaElement / DigitalProduct / Agent.
export const LIFECYCLE_STAGES = ["plan", "design", "build", "production", "retirement"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

// ─── Axis C — Operational condition ─────────────────────────────────────────────────
export const LIFECYCLE_STATUSES = ["draft", "active", "inactive"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

// Observed recency — only meaningful for manifested (actual) things. (iTop freshness pattern,
// 2026-04-30-discovery-portfolio-gap-closure-design.md.)
export const FRESHNESS_VALUES = ["fresh", "stale", "retired"] as const;
export type Freshness = (typeof FRESHNESS_VALUES)[number];

// Technology currency / obsolescence — only meaningful for manifested things.
export const CURRENCY_VALUES = ["current", "approaching-eol", "unsupported", "end-of-life"] as const;
export type Currency = (typeof CURRENCY_VALUES)[number];

// ─── Physical vs non-physical (derived) ─────────────────────────────────────────────
// logical (non-physical): no retirement/inactive, no freshness/currency — superseded, not
// decommissioned. manifested (physical/operational): full lifecycle incl. retirement.
export const MANIFESTATION_CLASSES = ["logical", "manifested"] as const;
export type ManifestationClass = (typeof MANIFESTATION_CLASSES)[number];

// ─── Temporal perspective (derived, never stored) ───────────────────────────────────
// "current / future / past" is not a column; it is derived from the axes above and, for
// manifested things, corroborated by operational evidence (freshness). See §4.4.
export const TEMPORAL_PERSPECTIVES = ["future", "current", "past"] as const;
export type TemporalPerspective = (typeof TEMPORAL_PERSPECTIVES)[number];

// ─── Legal transitions ──────────────────────────────────────────────────────────────
// Stage progression is forward-only by default (plan → design → build → production →
// retirement). production may also jump straight to retirement (decommission without a
// build phase). retirement is terminal.
export const LIFECYCLE_STAGE_TRANSITIONS: Record<LifecycleStage, readonly LifecycleStage[]> = {
  plan: ["design"],
  design: ["build", "production"],
  build: ["production"],
  production: ["retirement"],
  retirement: [],
};

// Status is freely toggleable except that, once inactive at retirement, it is terminal.
export const LIFECYCLE_STATUS_TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  draft: ["active", "inactive"],
  active: ["inactive"],
  inactive: ["active"],
};

export function isLegalStageTransition(from: LifecycleStage, to: LifecycleStage): boolean {
  if (from === to) return true;
  return LIFECYCLE_STAGE_TRANSITIONS[from].includes(to);
}

export function isLegalStatusTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  return LIFECYCLE_STATUS_TRANSITIONS[from].includes(to);
}

// ─── Canonical descriptor ───────────────────────────────────────────────────────────
export type CanonicalLifecycle = {
  realizationStage: RealizationStage | null;
  lifecycleStage: LifecycleStage;
  lifecycleStatus: LifecycleStatus;
  manifestationClass: ManifestationClass;
  /** null for logical things (no observable operational presence). */
  freshness: Freshness | null;
  /** null for logical things (no support/EOL clock). */
  currency: Currency | null;
  /** Derived; never persisted. */
  temporalPerspective: TemporalPerspective;
};

export type SupportLifecycleMilestone = {
  milestone: string;
  date: Date | string | null;
  confidence?: number | null;
};

// ─── Derivation helpers ─────────────────────────────────────────────────────────────

/** A thing is manifested (physical/operational) once it reaches the actual realization
 *  stage; otherwise it is logical (design intent). Callers may override via an explicit
 *  hint (e.g. an EA element type already classified as manifested). */
export function deriveManifestationClass(
  realizationStage: RealizationStage | null,
  hint?: ManifestationClass,
): ManifestationClass {
  if (hint) return hint;
  return realizationStage === "actual" ? "manifested" : "logical";
}

/**
 * Derive the temporal perspective from the canonical axes (§4.4). Priority:
 *   1. past   — retirement stage, or observed-retired freshness
 *   2. future — design intent: not yet operational (plan/design stage)
 *   3. current — operational reality (build/production), the default
 *
 * The driver is the lifecycle STAGE (progression), not the realization stage: a
 * non-physical thing (logical manifestation) such as a published document or an active
 * service offering is "current", not "future". Realization stage describes structural
 * maturity, which is orthogonal to whether the thing is operational today.
 */
export function deriveTemporalPerspective(input: {
  realizationStage: RealizationStage | null;
  lifecycleStage: LifecycleStage;
  lifecycleStatus: LifecycleStatus;
  freshness: Freshness | null;
}): TemporalPerspective {
  if (
    input.lifecycleStage === "retirement" ||
    input.lifecycleStatus === "inactive" ||
    input.freshness === "retired"
  ) return "past";
  if (input.lifecycleStage === "plan" || input.lifecycleStage === "design") return "future";
  return "current";
}

/**
 * Resolve the support boundary from the canonical CatalogLifecycleMilestone spine.
 * A more specific support boundary wins over the generic EOL date. When sources
 * disagree for the same milestone, prefer the highest-confidence observation and
 * then the earlier date as the conservative risk boundary.
 */
export function deriveSupportEndDate(
  milestones: readonly SupportLifecycleMilestone[] | null | undefined,
): Date | null {
  const priority = [
    "security_updates_end",
    "extended_support_end",
    "eosl",
    "eol",
    "mainstream_end",
  ];
  for (const milestone of priority) {
    const candidates = (milestones ?? [])
      .filter((row) => row.milestone === milestone && row.date != null)
      .map((row) => ({
        date: row.date instanceof Date ? row.date : new Date(row.date as string),
        confidence: row.confidence ?? 0,
      }))
      .filter((row) => !Number.isNaN(row.date.getTime()))
      .sort((left, right) => right.confidence - left.confidence || left.date.getTime() - right.date.getTime());
    if (candidates[0]) return candidates[0].date;
  }
  return null;
}

/** Map a CMDB-style supportStatus + optional EOL date onto the canonical currency axis. */
export function deriveCurrency(input: {
  supportStatus?: string | null;
  supportEndsAt?: Date | string | null;
  /** Window before supportEndsAt within which a thing is "approaching-eol". Default 180d. */
  approachingWindowDays?: number;
  now?: Date;
}): Currency | null {
  const { supportStatus, supportEndsAt } = input;
  // An explicit EOL date is the strongest signal.
  if (supportEndsAt != null) {
    const end = supportEndsAt instanceof Date ? supportEndsAt : new Date(supportEndsAt);
    if (!Number.isNaN(end.getTime())) {
      const now = input.now ?? new Date();
      if (end.getTime() <= now.getTime()) return "end-of-life";
      const windowMs = (input.approachingWindowDays ?? 180) * 24 * 60 * 60 * 1000;
      if (end.getTime() - now.getTime() <= windowMs) return "approaching-eol";
      return "current";
    }
  }
  switch (supportStatus) {
    case "supported":
      return "current";
    case "deprecated":
      return "approaching-eol";
    case "end-of-life":
      return "end-of-life";
    case "unsupported":
      return "unsupported";
    case "unknown":
    case null:
    case undefined:
      return null;
    default:
      return null;
  }
}

// ─── resolveLifecycle — the unifier ─────────────────────────────────────────────────
// Accepts an already-fetched row shape discriminated by kind and returns the canonical
// descriptor. Pure: callers fetch rows; this never touches the DB. Each kind's mapper is
// the single place that knows how that model's bespoke fields map onto the common axes.

export type ResolveLifecycleInput =
  | {
      kind: "EaElement";
      lifecycleStage: string;
      lifecycleStatus: string;
      refinementLevel?: string | null;
      manifestationClass?: ManifestationClass | null;
    }
  | {
      kind: "DigitalProduct";
      lifecycleStage: string;
      lifecycleStatus: string;
    }
  | {
      kind: "Agent";
      lifecycleStage: string;
      status?: string | null;
    }
  | {
      kind: "InventoryEntity";
      status?: string | null;
      supportStatus?: string | null;
      /** Milestones joined through InventoryEntity.catalogIdentity. */
      supportMilestones?: readonly SupportLifecycleMilestone[] | null;
      freshness?: string | null;
      now?: Date;
    }
  | {
      kind: "ServiceOffering";
      status?: string | null;
    }
  | {
      kind: "Document";
      currentState?: string | null;
    }
  | {
      kind: "BusinessCapability";
      status?: string | null;
    };

function coerceStage(value: string | null | undefined, fallback: LifecycleStage): LifecycleStage {
  return (LIFECYCLE_STAGES as readonly string[]).includes(value ?? "")
    ? (value as LifecycleStage)
    : fallback;
}

function coerceStatus(value: string | null | undefined, fallback: LifecycleStatus): LifecycleStatus {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as LifecycleStatus)
    : fallback;
}

function coerceRealization(value: string | null | undefined): RealizationStage | null {
  return (REALIZATION_STAGES as readonly string[]).includes(value ?? "")
    ? (value as RealizationStage)
    : null;
}

function finalize(parts: {
  realizationStage: RealizationStage | null;
  lifecycleStage: LifecycleStage;
  lifecycleStatus: LifecycleStatus;
  manifestationClass: ManifestationClass;
  freshness: Freshness | null;
  currency: Currency | null;
}): CanonicalLifecycle {
  // Logical things never carry freshness or currency (§8.1 invariants).
  const freshness = parts.manifestationClass === "manifested" ? parts.freshness : null;
  const currency = parts.manifestationClass === "manifested" ? parts.currency : null;
  return {
    ...parts,
    freshness,
    currency,
    temporalPerspective: deriveTemporalPerspective({
      realizationStage: parts.realizationStage,
      lifecycleStage: parts.lifecycleStage,
      lifecycleStatus: parts.lifecycleStatus,
      freshness,
    }),
  };
}

export function resolveLifecycle(input: ResolveLifecycleInput): CanonicalLifecycle {
  switch (input.kind) {
    case "EaElement": {
      const realizationStage = coerceRealization(input.refinementLevel);
      const manifestationClass = deriveManifestationClass(
        realizationStage,
        input.manifestationClass ?? undefined,
      );
      return finalize({
        realizationStage,
        lifecycleStage: coerceStage(input.lifecycleStage, "plan"),
        lifecycleStatus: coerceStatus(input.lifecycleStatus, "draft"),
        manifestationClass,
        freshness: null,
        currency: null,
      });
    }

    case "DigitalProduct": {
      const lifecycleStage = coerceStage(input.lifecycleStage, "plan");
      // A digital product is an operational/manifested thing; its realization is actual
      // once it has reached build or beyond.
      const realizationStage: RealizationStage =
        lifecycleStage === "plan"
          ? "conceptual"
          : lifecycleStage === "design"
            ? "logical"
            : "actual";
      return finalize({
        realizationStage,
        lifecycleStage,
        lifecycleStatus: coerceStatus(input.lifecycleStatus, "draft"),
        manifestationClass: "manifested",
        freshness: null,
        currency: null,
      });
    }

    case "Agent": {
      const lifecycleStage = coerceStage(input.lifecycleStage, "production");
      return finalize({
        realizationStage: lifecycleStage === "plan" || lifecycleStage === "design" ? "logical" : "actual",
        lifecycleStage,
        lifecycleStatus: input.status === "inactive" ? "inactive" : "active",
        manifestationClass: "manifested",
        freshness: null,
        currency: null,
      });
    }

    case "InventoryEntity": {
      // Discovery is the current-state layer: always actual / manifested.
      const active = input.status !== "inactive";
      return finalize({
        realizationStage: "actual",
        lifecycleStage: active ? "production" : "retirement",
        lifecycleStatus: active ? "active" : "inactive",
        manifestationClass: "manifested",
        freshness: (FRESHNESS_VALUES as readonly string[]).includes(input.freshness ?? "")
          ? (input.freshness as Freshness)
          : active
            ? "fresh"
            : "retired",
        currency: deriveCurrency({
          supportStatus: input.supportStatus,
          supportEndsAt: deriveSupportEndDate(input.supportMilestones),
          now: input.now,
        }),
      });
    }

    case "ServiceOffering": {
      // A service commitment is non-physical (logical). draft → approved → active → discontinued.
      const status = input.status ?? "draft";
      const map: Record<string, { stage: LifecycleStage; status: LifecycleStatus }> = {
        draft: { stage: "plan", status: "draft" },
        approved: { stage: "design", status: "active" },
        active: { stage: "production", status: "active" },
        discontinued: { stage: "retirement", status: "inactive" },
      };
      const m = map[status] ?? map["draft"];
      return finalize({
        realizationStage: m.stage === "production" ? "actual" : "logical",
        lifecycleStage: m.stage,
        lifecycleStatus: m.status,
        manifestationClass: "logical",
        freshness: null,
        currency: null,
      });
    }

    case "Document": {
      const state = input.currentState ?? "draft";
      const map: Record<string, { stage: LifecycleStage; status: LifecycleStatus }> = {
        draft: { stage: "plan", status: "draft" },
        published: { stage: "production", status: "active" },
        deprecated: { stage: "production", status: "inactive" },
        archived: { stage: "retirement", status: "inactive" },
      };
      const m = map[state] ?? map["draft"];
      return finalize({
        realizationStage: "logical",
        lifecycleStage: m.stage,
        lifecycleStatus: m.status,
        manifestationClass: "logical",
        freshness: null,
        currency: null,
      });
    }

    case "BusinessCapability": {
      // Capabilities are logical — superseded, not decommissioned.
      const active = input.status !== "inactive";
      return finalize({
        realizationStage: "logical",
        lifecycleStage: active ? "production" : "retirement",
        lifecycleStatus: active ? "active" : "inactive",
        manifestationClass: "logical",
        freshness: null,
        currency: null,
      });
    }
  }
}

// Compile-time exhaustiveness guard: resolveLifecycle must handle every GovernedThingKind.
type _ResolvedKinds = ResolveLifecycleInput["kind"];
const _exhaustive: Record<GovernedThingKind, true> = {
  EaElement: true,
  DigitalProduct: true,
  InventoryEntity: true,
  ServiceOffering: true,
  Document: true,
  Agent: true,
  BusinessCapability: true,
};
// If a kind is added to GOVERNED_THING_KINDS without a resolver branch (or vice-versa),
// one of these assignments fails to type-check.
const _kindCoverage: Record<_ResolvedKinds, true> = _exhaustive;
void _kindCoverage;

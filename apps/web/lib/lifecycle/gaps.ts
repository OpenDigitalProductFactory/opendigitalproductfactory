// Pure utility library — no server imports. Safe in tests and client components.
//
// LifecycleGap register — enums, stable gapKey, and the reconcile planner (EP-LIFECYCLE
// / slice 4). Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md
// §6, §8.6.
//
// A LifecycleGap is a typed delta between baseline and target, or a cross-cutting concern
// (EOL, vulnerability, data-quality, break-fix) raised against the current-state baseline.
// Generators produce LifecycleGapInput[]; reconcileGaps() turns them into idempotent
// create/update/resolve ops against the existing open gaps for that dimension. Per AGENTS.md
// §3, enum values use hyphens.

import type { GovernedThingKind, GovernedThingRef } from "../governed-thing-ref";
import { governedThingRefKey } from "../governed-thing-ref";

export const GAP_DIMENSIONS = [
  "capability",
  "technology-currency",
  "vulnerability",
  "data-quality",
  "operational",
  "cost",
  "regulatory",
] as const;
export type GapDimension = (typeof GAP_DIMENSIONS)[number];

export const GAP_KINDS = ["add", "change", "remove"] as const;
export type GapKind = (typeof GAP_KINDS)[number];

export const GAP_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type GapSeverity = (typeof GAP_SEVERITIES)[number];

export const GAP_SCOPE_LEVELS = ["portfolio", "product"] as const;
export type GapScopeLevel = (typeof GAP_SCOPE_LEVELS)[number];

export const GAP_STATUSES = ["open", "scoped", "resolved", "dismissed"] as const;
export type GapStatus = (typeof GAP_STATUSES)[number];

/**
 * Build a stable, deduplicating gap key. Repeated signals (EOL re-scan, recurring CVE,
 * DQ re-check) for the same (dimension, thing, signal) map to the same gap, so they update
 * rather than multiply (spec §6 dedup rule). `signalId` distinguishes multiple gaps of the
 * same dimension on one thing (e.g. several CVEs); omit it for one-per-thing dimensions.
 */
export function buildGapKey(parts: {
  dimension: GapDimension;
  ref: GovernedThingRef;
  baselinePlateauId?: string;
  targetPlateauId?: string;
  signalId?: string;
}): string {
  const base = `${parts.dimension}:${governedThingRefKey(parts.ref)}`;
  const plateauScope = [
    parts.baselinePlateauId ? `baseline:${parts.baselinePlateauId}` : null,
    parts.targetPlateauId ? `target:${parts.targetPlateauId}` : null,
  ].filter(Boolean).join(":");
  return [base, plateauScope || null, parts.signalId ?? null].filter(Boolean).join(":");
}

export type LifecycleGapInput = {
  gapKey: string;
  kind: GapKind;
  dimension: GapDimension;
  severity: GapSeverity;
  scopeLevel: GapScopeLevel;
  governedThingKind: GovernedThingKind;
  governedThingId: string;
  title: string;
  detail?: string;
  evidenceRef?: string;
  digitalProductId?: string;
  baselinePlateauId?: string;
  targetPlateauId?: string;
};

/** Existing open/scoped gap row (the planner only ever sees non-terminal gaps). */
export type ExistingGap = {
  id: string;
  gapKey: string;
  status: string;
  severity: string;
  title: string;
  detail: string | null;
};

export type GapOp =
  | { op: "create"; input: LifecycleGapInput }
  | { op: "update"; id: string; input: LifecycleGapInput }
  | { op: "resolve"; id: string; gapKey: string };

export type GapPlanSummary = {
  created: number;
  updated: number;
  resolved: number;
  unchanged: number;
  preserved: number;
};

export type GapPlan = { ops: GapOp[]; material: boolean; summary: GapPlanSummary };

/**
 * Reconcile a generator's output against the existing open gaps FOR THAT DIMENSION.
 *
 * The caller must pass `existingOpen` already scoped to the generator's dimension (and
 * scope), so a re-run of one generator never resolves another dimension's gaps.
 *
 * Rules (idempotent):
 *  - gapKey generated, no existing      → create
 *  - gapKey generated, existing differs (severity/title/detail) → update
 *  - gapKey generated, existing equal   → unchanged
 *  - gapKey existing, not generated     → resolve (the underlying signal cleared)
 */
export type GapReconcileContext = {
  /** The one dimension queried into existingOpen and emitted by this generator. */
  dimension: GapDimension;
  /** False when the evidence source failed, timed out, or returned a partial window. */
  evidenceComplete: boolean;
};

export function reconcileGaps(
  generated: LifecycleGapInput[],
  existingOpen: ExistingGap[],
  context: GapReconcileContext,
): GapPlan {
  const existingByKey = new Map<string, ExistingGap>();
  for (const g of existingOpen) existingByKey.set(g.gapKey, g);

  const ops: GapOp[] = [];
  const summary: GapPlanSummary = { created: 0, updated: 0, resolved: 0, unchanged: 0, preserved: 0 };
  const generatedKeys = new Set<string>();

  for (const input of generated) {
    if (input.dimension !== context.dimension) {
      throw new Error(
        `Gap generator for '${context.dimension}' emitted '${input.dimension}' (${input.gapKey}).`,
      );
    }
    if (generatedKeys.has(input.gapKey)) {
      throw new Error(`Gap generator emitted duplicate gapKey: ${input.gapKey}`);
    }
    generatedKeys.add(input.gapKey);
    const existing = existingByKey.get(input.gapKey);
    if (!existing) {
      ops.push({ op: "create", input });
      summary.created += 1;
      continue;
    }
    const changed =
      existing.severity !== input.severity ||
      existing.title !== input.title ||
      (existing.detail ?? "") !== (input.detail ?? "");
    if (changed) {
      ops.push({ op: "update", id: existing.id, input });
      summary.updated += 1;
    } else {
      summary.unchanged += 1;
    }
  }

  for (const g of existingOpen) {
    if (generatedKeys.has(g.gapKey)) continue;
    if (!context.evidenceComplete) {
      summary.preserved += 1;
      continue;
    }
    ops.push({ op: "resolve", id: g.id, gapKey: g.gapKey });
    summary.resolved += 1;
  }

  return { ops, material: ops.length > 0, summary };
}

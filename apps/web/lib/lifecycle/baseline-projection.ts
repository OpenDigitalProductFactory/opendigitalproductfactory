// Pure utility library — no server imports. Safe in tests and client components.
//
// Baseline Plateau projection PLANNER (EP-LIFECYCLE / slice 3).
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §5.
//
// The baseline (current-state) Plateau is a projection of the live estate: the governed
// things that are in the "current" temporal perspective (actual / active / fresh) belong
// to it. This module computes the deterministic, idempotent membership plan; the IO applier
// (baseline-projector.ts) writes it. A no-delta run produces an empty, immaterial plan.
//
// There is exactly one PlateauMembership row per (plateau, kind, id) — enforced by the DB
// unique constraint — so matching is by key regardless of open/closed state.

import type { CanonicalLifecycle } from "../lifecycle";
import type { GovernedThingKind, GovernedThingRef } from "../governed-thing-ref";
import { governedThingRefKey } from "../governed-thing-ref";

/** A governed thing currently observed in the current-state estate. The caller resolves
 *  the canonical snapshot via resolveLifecycle() over a fetched row and supplies the
 *  corroborating evidence pointer (e.g. "discovery-run:RUN123"). */
export type BaselineMemberInput = {
  kind: GovernedThingKind;
  id: string;
  stateSnapshot: CanonicalLifecycle;
  evidenceRef: string;
};

/** Shape of an existing projected PlateauMembership row (open = validTo === null). */
export type ExistingMembership = {
  id: string;
  governedThingKind: string;
  governedThingId: string;
  membershipSource: string;
  validTo: Date | null;
  stateSnapshot: unknown;
};

export type MembershipOp =
  | { op: "open"; member: BaselineMemberInput }
  | { op: "refresh"; id: string; member: BaselineMemberInput; reopened: boolean }
  | { op: "close"; id: string; ref: GovernedThingRef; reason: string };

export type BaselinePlanSummary = {
  opened: number;
  refreshed: number;
  reopened: number;
  closed: number;
  unchanged: number;
};

export type BaselinePlan = {
  ops: MembershipOp[];
  material: boolean;
  summary: BaselinePlanSummary;
};

/** Stable, comparable serialization of the canonical snapshot for change detection. */
function snapshotKey(s: CanonicalLifecycle): string {
  return [
    s.realizationStage ?? "",
    s.lifecycleStage,
    s.lifecycleStatus,
    s.manifestationClass,
    s.freshness ?? "",
    s.currency ?? "",
    s.temporalPerspective,
  ].join("|");
}

function existingSnapshotKey(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const s = raw as Partial<CanonicalLifecycle>;
  if (!s.lifecycleStage || !s.lifecycleStatus || !s.manifestationClass || !s.temporalPerspective) {
    return ""; // incomplete/empty snapshot ({}) — always treat as changed so it refreshes
  }
  return snapshotKey(s as CanonicalLifecycle);
}

/**
 * Compute the membership plan for the baseline Plateau.
 *
 * @param evidence  governed things currently in the current-state estate
 * @param existing  existing PROJECTED membership rows for the baseline plateau
 *
 * Rules (idempotent):
 *  - key in evidence, no existing row            → open
 *  - key in evidence, existing row closed         → refresh (reopened: clear validTo)
 *  - key in evidence, existing open, snapshot ≠   → refresh
 *  - key in evidence, existing open, snapshot =   → unchanged (no op)
 *  - key NOT in evidence, existing open           → close (left current state)
 *  - key NOT in evidence, existing already closed → ignored (already historical)
 */
export function planBaselineProjection(
  evidence: BaselineMemberInput[],
  existing: ExistingMembership[],
): BaselinePlan {
  const existingByKey = new Map<string, ExistingMembership>();
  for (const row of existing) {
    existingByKey.set(`${row.governedThingKind}:${row.governedThingId}`, row);
  }

  const ops: MembershipOp[] = [];
  const summary: BaselinePlanSummary = { opened: 0, refreshed: 0, reopened: 0, closed: 0, unchanged: 0 };
  const evidenceKeys = new Set<string>();

  for (const member of evidence) {
    const key = governedThingRefKey({ kind: member.kind, id: member.id });
    evidenceKeys.add(key);
    const row = existingByKey.get(key);

    if (!row) {
      ops.push({ op: "open", member });
      summary.opened += 1;
      continue;
    }

    const wasClosed = row.validTo !== null;
    const snapshotChanged = existingSnapshotKey(row.stateSnapshot) !== snapshotKey(member.stateSnapshot);

    if (wasClosed) {
      ops.push({ op: "refresh", id: row.id, member, reopened: true });
      summary.reopened += 1;
    } else if (snapshotChanged) {
      ops.push({ op: "refresh", id: row.id, member, reopened: false });
      summary.refreshed += 1;
    } else {
      summary.unchanged += 1;
    }
  }

  for (const row of existing) {
    if (row.validTo !== null) continue; // already closed
    const key = `${row.governedThingKind}:${row.governedThingId}`;
    if (evidenceKeys.has(key)) continue; // still present
    const ref: GovernedThingRef = {
      kind: row.governedThingKind as GovernedThingKind,
      id: row.governedThingId,
    };
    ops.push({ op: "close", id: row.id, ref, reason: "left current-state estate (no longer observed)" });
    summary.closed += 1;
  }

  return { ops, material: ops.length > 0, summary };
}

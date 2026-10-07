import { createHash } from "node:crypto";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import type { OwedAcceptance } from "./owed-acceptance";

// The acceptance_owed snapshot writer (BI-04140C98, AC-AA-01).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.1.
//
// A derived read model kept for its history: who owed what, and since when.
// That history cannot be recomputed once evidence changes. No code reads a
// snapshot as the current verdict; readiness is recomputed for that.
//
// Written only when the answer changed. "Changed" is the owed codes, the
// owner's agent id and the unroutable codes with their reasons. Reworded
// guidance or a renamed coworker is not a change of who owes what.

export const ACCEPTANCE_OWED_ACTIVITY_KIND = "acceptance_owed" as const;

export type OwedSnapshotDb = {
  backlogItemActivity: {
    findFirst(args: {
      where: { backlogItemId: string; kind: typeof ACCEPTANCE_OWED_ACTIVITY_KIND };
      orderBy: Array<{ recordedAt: "desc" } | { id: "desc" }>;
      select: { payload: true };
    }): Promise<{ payload: unknown } | null>;
    create(args: {
      data: {
        backlogItemId: string;
        kind: typeof ACCEPTANCE_OWED_ACTIVITY_KIND;
        summary: string;
        payload: Record<string, unknown>;
        recordedByAgentId?: string;
      };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function comparable(projection: OwedAcceptance) {
  return {
    owedCodes: sortedUnique(projection.owed.map((entry) => entry.code)),
    owner: projection.owner?.agentId ?? null,
    unroutable: sortedUnique(projection.unroutable.map((entry) => `${entry.code}:${entry.reason}`)),
  };
}

export function owedAcceptanceFingerprint(projection: OwedAcceptance): string {
  return createHash("sha256").update(canonicalJson(comparable(projection))).digest("hex");
}

function lastFingerprint(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as { fingerprint?: unknown }).fingerprint;
  return typeof value === "string" ? value : null;
}

function summarize(projection: OwedAcceptance): string {
  const codes = sortedUnique(projection.owed.map((entry) => entry.code));
  const owner = projection.owner
    ? `owner ${projection.owner.agentId}`
    : projection.unroutable.length > 0 ? "no routable owner" : "no owner needed";
  const owes = codes.length > 0 ? `owes ${codes.join(", ")}` : "owes nothing";
  return `Acceptance ${owes}; ${owner}${projection.unroutable.length > 0 ? `; ${projection.unroutable.length} unroutable` : ""}`.slice(0, 500);
}

export async function recordOwedAcceptanceSnapshot(input: {
  db: OwedSnapshotDb;
  backlogItemId: string;
  projection: OwedAcceptance;
  recordedByAgentId?: string;
}): Promise<{ written: boolean; activityId: string | null }> {
  const fingerprint = owedAcceptanceFingerprint(input.projection);
  const last = await input.db.backlogItemActivity.findFirst({
    where: { backlogItemId: input.backlogItemId, kind: ACCEPTANCE_OWED_ACTIVITY_KIND },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  if (last && lastFingerprint(last.payload) === fingerprint) return { written: false, activityId: null };

  const created = await input.db.backlogItemActivity.create({
    data: {
      backlogItemId: input.backlogItemId,
      kind: ACCEPTANCE_OWED_ACTIVITY_KIND,
      summary: summarize(input.projection),
      payload: {
        fingerprint,
        owedCodes: comparable(input.projection).owedCodes,
        owed: input.projection.owed,
        owner: input.projection.owner,
        unroutable: input.projection.unroutable,
        closable: input.projection.closable,
      },
      ...(input.recordedByAgentId ? { recordedByAgentId: input.recordedByAgentId } : {}),
    },
    select: { id: true },
  });
  return { written: true, activityId: created.id };
}

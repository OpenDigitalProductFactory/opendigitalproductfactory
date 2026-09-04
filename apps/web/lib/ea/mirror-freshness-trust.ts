// Staleness signal for the Prisma→EA data-model mirror (BI-4501D3C8).
//
// query_ontology_graph returned elements with NO staleness signal at all, so a
// caller could not distinguish "this model does not exist" from "this model
// was merged after the last mirror run". That window is real: the mirror is a
// NIGHTLY reconcile (data-model-mirror-nightly, 03:00 UTC). PR #4481 merged at
// 01:17 and the six models it added were invisible to the mirror until 03:05 —
// nearly two hours in which a correct question got an empty, unqualified
// answer. A BI was filed in that window asserting the models were absent and
// that nothing refreshed the mirror; both claims were wrong, and an empty
// result with no staleness marker is what made them look right.
//
// Reuses the existing trust-vector shape rather than inventing a second
// staleness convention — a second one would be the single-source-of-truth
// failure the rulebook exists to prevent.

import { DATA_MODEL_MIRROR_TASK_ID } from "@dpf/db";
import { scoreTrustVector } from "@/lib/trust-vector/score";
import type { TrustAssessment, TrustDimensionInput } from "@/lib/trust-vector/types";

/** Beyond this the nightly has plainly not run and the mirror is unreliable. */
const STALE_AFTER_HOURS = 26;

export type MirrorFreshnessInput = {
  lastRunAt: Date | string | null;
  lastStatus: string | null;
  isActive: boolean;
  elementCount: number;
  asOf?: Date;
};

function hoursSince(when: Date, now: Date): number {
  return (now.getTime() - when.getTime()) / 3_600_000;
}

export function buildMirrorFreshnessTrust(input: MirrorFreshnessInput): TrustAssessment {
  const now = input.asOf ? new Date(input.asOf) : new Date();
  const lastRun = input.lastRunAt ? new Date(input.lastRunAt) : null;
  const age = lastRun ? hoursSince(lastRun, now) : null;

  const dimensions: TrustDimensionInput[] = [
    {
      key: "freshness",
      label: "Mirror freshness",
      score: age === null ? 0 : age > STALE_AFTER_HOURS ? 0.2 : age > 24 ? 0.6 : 1,
      weight: 2,
      rationale:
        age === null
          ? "The data-model mirror has no recorded run — the ontology may predate the current schema entirely."
          : `Mirror last reconciled ${age.toFixed(1)}h ago. It runs nightly, so a model merged since ` +
            "that run is NOT yet mirrored and its absence here is not evidence it does not exist.",
      ...(lastRun ? { measuredAt: lastRun.toISOString() } : {}),
      evidenceRefs: [
        {
          kind: "prisma-row",
          label: DATA_MODEL_MIRROR_TASK_ID,
          ref: DATA_MODEL_MIRROR_TASK_ID,
          sourceTable: "ScheduledAgentTask",
        },
      ],
    },
    {
      key: "runtimeAvailability",
      label: "Mirror cadence",
      score: input.isActive ? (input.lastStatus === "ok" ? 1 : 0.4) : 0,
      weight: 1,
      rationale: input.isActive
        ? `The nightly mirror task is active; last run status "${input.lastStatus ?? "unknown"}".`
        : "The nightly mirror task is INACTIVE — nothing is refreshing this ontology.",
      evidenceRefs: [],
    },
    {
      key: "sourceAuthority",
      label: "Source authority",
      score: 0.9,
      weight: 1,
      rationale:
        "EaElement rows are the deterministic projection of the Prisma schema, authoritative " +
        "as of the last reconcile — not as of now.",
      evidenceRefs: [
        { kind: "prisma-row", label: "EaElement", ref: "EaElement", sourceTable: "EaElement" },
      ],
    },
  ];

  return scoreTrustVector({
    subject: { type: "ea-ontology", id: "data-model-mirror", label: "EA ontology (data-model mirror)" },
    asOf: now.toISOString(),
    dimensions,
    sourceSummary:
      "Ontology trust is derived from when the nightly Prisma→EA mirror last reconciled and whether its task is active.",
  });
}

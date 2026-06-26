// EP-GOLDEN-TRIANGLE Slice 3b (BI-CF28CCF0) — pure receipt logic.
//
// "See the difference in outcome when adjusted": compare a requested posture
// (the decoded policy) against what actually ran (route facts already captured
// in RouteOutcome / telemetry). Pure — no I/O — so it is fully snapshot-testable
// and reusable by both the capture path and the comparison view. Persistence is
// migration-free (the receipt rides `DecisionInteraction.outcomePayload`).
import type { DecodedPolicy, GoldenTrianglePreference, GoldenTrianglePreset } from "@/lib/golden-triangle";
import { assignTierFromModelId, type QualityTier } from "@/lib/routing/quality-tiers";

const TIER_RANK: Record<QualityTier, number> = { basic: 0, adequate: 1, strong: 2, frontier: 3 };

/** What actually happened on a run — sourced from RouteOutcome / AdapterRunTelemetry. */
export interface ActualRun {
  modelId: string;
  /** Derived from `modelId` when absent. */
  tier?: QualityTier;
  costUsd?: number | null;
  latencyMs?: number | null;
  /** Preferred provider failed over to a backup (an infra downgrade, not a posture choice). */
  fallbackOccurred?: boolean;
  verificationPassed?: boolean | null;
  accepted?: boolean | null;
}

export type DeviationKind = "match" | "downgrade" | "info";

export interface Deviation {
  field: string;
  requested: string;
  actual: string;
  kind: DeviationKind;
}

/** Which authority scope supplied the governing posture, or "none" (Balanced cold-start). */
export type GoldenTriangleGovernedBy = "agent" | "organization" | "platform" | "none";

export interface GoldenTriangleReceipt {
  preset: GoldenTrianglePreset;
  /** The scope whose default governed this run (cascade: agent → org → platform → none). */
  governedBy: GoldenTriangleGovernedBy;
  requested: {
    minimumTier?: QualityTier;
    effort?: string;
    budgetClass?: string;
    verificationDepth?: string;
  };
  actual: {
    modelId: string;
    tier: QualityTier;
    costUsd: number | null;
    latencyMs: number | null;
    fallbackOccurred: boolean;
    verificationPassed: boolean | null;
    accepted: boolean | null;
  };
  deviations: Deviation[];
  /** True when nothing the user asked for was downgraded. */
  matchedRequest: boolean;
  /** Plain-language one-liner for the receipt row / decode panel. */
  summary: string;
}

function fmtCost(c: number | null): string {
  return c === null ? "cost n/a" : `$${c < 0.01 ? c.toFixed(4) : c.toFixed(3)}`;
}

function fmtLatency(ms: number | null): string {
  return ms === null ? "" : `${(ms / 1000).toFixed(1)}s`;
}

export function buildGoldenTriangleReceipt(
  preference: GoldenTrianglePreference,
  decoded: DecodedPolicy,
  actual: ActualRun,
  /** The scope that governed this run (from DispatchPosture.source). Defaults to
   *  "none": Balanced / no posture set at any scope (the cold-start case). */
  governedBy: GoldenTriangleGovernedBy = "none",
): GoldenTriangleReceipt {
  const po = decoded.postureOverride;
  const ob = decoded.orchestrationBudget;
  const actualTier = actual.tier ?? assignTierFromModelId(actual.modelId);
  const costUsd = actual.costUsd ?? null;
  const latencyMs = actual.latencyMs ?? null;
  const fallbackOccurred = actual.fallbackOccurred ?? false;
  const verificationPassed = actual.verificationPassed ?? null;
  const accepted = actual.accepted ?? null;

  const deviations: Deviation[] = [];

  if (po.minimumTier) {
    const met = TIER_RANK[actualTier] >= TIER_RANK[po.minimumTier];
    deviations.push({
      field: "tier",
      requested: po.minimumTier,
      actual: actualTier,
      kind: met ? "match" : "downgrade",
    });
  }
  if (fallbackOccurred) {
    deviations.push({ field: "routing", requested: "preferred route", actual: "backup (failover)", kind: "downgrade" });
  }
  if (verificationPassed === false) {
    deviations.push({ field: "verification", requested: ob.verificationDepth ?? "—", actual: "failed", kind: "info" });
  }

  const matchedRequest = !deviations.some((d) => d.kind === "downgrade");

  const reqParts: string[] = [];
  if (po.minimumTier) reqParts.push(`${po.minimumTier} tier`);
  if (po.effort) reqParts.push(`${po.effort} effort`);
  const presetLabel = preference.preset.charAt(0).toUpperCase() + preference.preset.slice(1);
  const reqStr = reqParts.length ? `${presetLabel} (${reqParts.join(", ")})` : presetLabel;
  const costLat = [fmtCost(costUsd), fmtLatency(latencyMs)].filter(Boolean).join(", ");
  const verdict = matchedRequest
    ? `ran on ${actual.modelId} (${actualTier} tier) — matched`
    : fallbackOccurred
      ? `ran on ${actual.modelId} (${actualTier} tier) — downgraded by failover`
      : `ran on ${actual.modelId} (${actualTier} tier) — below the requested tier`;
  const summary = `${reqStr}: ${verdict}. ${costLat}.`;

  return {
    preset: preference.preset,
    governedBy,
    requested: {
      ...(po.minimumTier ? { minimumTier: po.minimumTier } : {}),
      ...(po.effort ? { effort: po.effort } : {}),
      ...(po.budgetClass ? { budgetClass: po.budgetClass } : {}),
      ...(ob.verificationDepth ? { verificationDepth: ob.verificationDepth } : {}),
    },
    actual: { modelId: actual.modelId, tier: actualTier, costUsd, latencyMs, fallbackOccurred, verificationPassed, accepted },
    deviations,
    matchedRequest,
    summary,
  };
}

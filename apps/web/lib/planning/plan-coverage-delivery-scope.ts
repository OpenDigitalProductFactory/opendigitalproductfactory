import { createHash } from "node:crypto";
import { readBoundEditPaths, readBoundWorkShapeRef, type BoundWorkShapeDb } from "@/lib/backlog/initiative-readiness/bound-work-shape";
import { readinessShapeFromWorkShape } from "@/lib/backlog/initiative-readiness/entry-adapter";
import { assessDeliverySensitivity } from "@/lib/backlog/initiative-readiness/delivery-sensitivity";
import { deriveAuthoritativeReadinessProfile } from "@/lib/backlog/initiative-readiness/profiles";
import { effectiveShape } from "@/lib/backlog/initiative-readiness/shape-requirements";
import { parseItemBodyAcceptance } from "@/lib/backlog/initiative-readiness/item-body-baseline";

export type PlanDeliveryScope = {
  shape: "break-fix" | "small" | "medium";
  digest: string;
  acceptanceCriteria: string[];
};

type ScopeItem = {
  id: string; itemId: string; effortSize: string | null;
  title?: string | null; body?: string | null; workType?: string | null;
  type?: string | null; source?: string | null; scopeKind?: string | null;
};

/** Reads the same bound shape, edit facts and sensitivity policy as readiness.
 * A null result preserves the legacy scope-baseline contract, never an exemption.
 */
export async function readPlanDeliveryScope(
  db: { workroom?: BoundWorkShapeDb["workroom"] }, item: ScopeItem,
): Promise<PlanDeliveryScope | null> {
  if (!db.workroom) return null;
  const boundDb: BoundWorkShapeDb = {
    workroom: db.workroom,
    backlogItem: { findFirst: async () => ({ id: item.id }) },
  };
  const ref = await readBoundWorkShapeRef(boundDb, item.itemId);
  const declared = readinessShapeFromWorkShape(ref);
  if (!declared || item.effortSize === "xlarge") return null;
  const paths = (await readBoundEditPaths(boundDb, item.itemId)).sort();
  const sensitivity = assessDeliverySensitivity({ ...item, declaredPaths: paths });
  const profile = deriveAuthoritativeReadinessProfile(item);
  const shape = effectiveShape(declared, sensitivity.level, profile, item.workType);
  if (shape !== "break-fix" && shape !== "small" && shape !== "medium") return null;
  const acceptanceCriteria = shape === "medium" ? parseItemBodyAcceptance(item.body).criteria : [];
  const digest = "sha256:" + createHash("sha256").update(JSON.stringify({
    itemId: item.itemId, effortSize: item.effortSize, title: item.title ?? null,
    body: item.body ?? null, workType: item.workType ?? null, type: item.type ?? null,
    source: item.source ?? null, scopeKind: item.scopeKind ?? null,
    ref, shape, sensitivity, paths, acceptanceCriteria,
  })).digest("hex");
  return { shape, digest, acceptanceCriteria };
}

export function projectCurrentScopeBaselineTraceability(rows: { payload: unknown }[]): {
  baselineId: string;
  artifactDigest: string;
  objectiveIds: string[];
  acceptanceIds: string[];
} | null {
  const parsed = rows.flatMap(({ payload }) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string" || typeof row.artifactDigest !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")
      || !Array.isArray(row.objectiveStatements) || !Array.isArray(row.acceptanceStatements)) return [];
    const objectiveIds = row.objectiveStatements.flatMap((entry) => entry && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).objectiveId === "string"
      ? [(entry as Record<string, string>).objectiveId]
      : []);
    const acceptanceIds = row.acceptanceStatements.flatMap((entry) => entry && typeof entry === "object"
      && typeof (entry as Record<string, unknown>).acceptanceId === "string"
      ? [(entry as Record<string, string>).acceptanceId]
      : []);
    if (objectiveIds.length !== row.objectiveStatements.length || acceptanceIds.length !== row.acceptanceStatements.length) return [];
    return [{
      baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      artifactDigest: row.artifactDigest,
      objectiveIds,
      acceptanceIds,
    }];
  });
  if (parsed.length !== rows.length) return null;
  const superseded = new Set(parsed.map((entry) => entry.supersedesBaselineId).filter(Boolean));
  const heads = parsed.filter((entry) => !superseded.has(entry.baselineId));
  return heads.length === 1 ? heads[0]! : null;
}


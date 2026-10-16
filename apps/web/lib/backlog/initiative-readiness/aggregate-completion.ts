import { validatePlanBacklogCoverage, type PlanBacklogDeliverable } from "@/lib/planning/plan-backlog-coverage";
import type { projectBacklogItemReadiness, InitiativeReadinessActivity } from "./entry-adapter";
import type { ReadinessEvidenceState } from "./types";

type PlanSource = Pick<ReturnType<typeof projectBacklogItemReadiness>, "baselineId" | "planArtifact" | "planArtifactDigest">;
export type AggregateCompletionDb = {
  backlogItem: { findMany(args: unknown): Promise<Array<{ itemId: string; status: string }>> };
};
export type AggregateCompletion = {
  decomposition: ReadinessEvidenceState;
  delivery: "pass" | "missing";
  evidenceRefs: string[];
  coverageReasons: string[];
  deliveryReasons: string[];
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Current receipt provenance is read by the existing baseline/plan projector.
 * Recheck its graph and actual child states; a parent merge is not child delivery.
 * The terminal caller supplies its existing serializable transaction.
 */
export async function resolveAggregateCompletion(args: {
  itemId: string;
  activities: readonly InitiativeReadinessActivity[];
  source: PlanSource;
  db: AggregateCompletionDb;
}): Promise<AggregateCompletion> {
  const closed = (decomposition: ReadinessEvidenceState, reason: string, evidenceRefs: string[] = []): AggregateCompletion => ({
    decomposition, delivery: "missing", evidenceRefs, coverageReasons: [reason], deliveryReasons: [],
  });
  const latest = [...args.activities].filter(row => row.kind === "plan_backlog_coverage")
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || b.id.localeCompare(a.id))[0];
  if (!latest) return closed("missing", "Record a current decomposed plan covering at least two distinct child items before closing the initiative.");
  const refs = [latest.id];
  const payload = latest.payload;
  if (!record(payload) || payload.schemaVersion !== 2 || payload.decision !== "decomposed"
    || !Array.isArray(payload.deliverables) || !record(payload.planArtifactRef)) {
    return closed("malformed", "Aggregate completion requires governed decomposed coverage, rather than an atomic or malformed receipt.", refs);
  }
  const artifact = payload.planArtifactRef;
  const source = args.source;
  if (!source.baselineId || payload.scopeBaselineId !== source.baselineId
    || !source.planArtifact || !source.planArtifactDigest
    || !/^sha256:[a-f0-9]{64}$/i.test(source.planArtifactDigest)
    || payload.planArtifactDigest !== source.planArtifactDigest
    || artifact.kind !== source.planArtifact.kind
    || artifact.repositoryFullName !== source.planArtifact.repositoryFullName
    || artifact.commitSha !== source.planArtifact.commitSha
    || artifact.path !== source.planArtifact.path
    || artifact.providerBlobId !== source.planArtifact.providerBlobId) {
    return closed("stale", "Record decomposition coverage for this initiative's current baseline and immutable plan; historical coverage cannot close it.", refs);
  }
  const deliverables = payload.deliverables;
  if (deliverables.some(row => !record(row) || !nonempty(row.key) || !nonempty(row.title)
    || typeof row.independentlyShippable !== "boolean"
    || (row.backlogItemId !== undefined && !nonempty(row.backlogItemId))
    || (row.dependsOn !== undefined && (!Array.isArray(row.dependsOn) || row.dependsOn.some(key => !nonempty(key)))))) {
    return closed("malformed", "Repair malformed deliverables in the current decomposition before closing the initiative.", refs);
  }
  const graph = deliverables as PlanBacklogDeliverable[];
  const childIds = [...new Set(graph.map(row => row.backlogItemId).filter(nonempty))];
  if (childIds.length < 2 || childIds.includes(args.itemId)) {
    return closed("malformed", "Decompose into at least two distinct real child items; the parent cannot be its own delivery.", refs);
  }
  try {
    const children = await args.db.backlogItem.findMany({
      where: { itemId: { in: childIds } },
      select: { itemId: true, status: true },
    });
    const validation = validatePlanBacklogCoverage({ effortSize: "xlarge", decision: "decomposed", deliverables: graph, mappedBacklogItems: children });
    if (!validation.ok) return closed("malformed", validation.error, refs);
    const byId = new Map(children.map(child => [child.itemId, child]));
    const missing = childIds.filter(id => !byId.has(id));
    if (missing.length > 0) return closed("missing", `Resolve missing decomposition children: ${missing.join(", ")}.`, refs);
    const unfinished = childIds.filter(id => byId.get(id)!.status !== "done");
    return { decomposition: "pass", delivery: unfinished.length ? "missing" : "pass", evidenceRefs: refs,
      coverageReasons: [], deliveryReasons: unfinished.length
        ? [`Complete the existing decomposition children before closing the initiative: ${unfinished.map(id => `${id} (${byId.get(id)!.status})`).join(", ")}.`]
        : [] };
  } catch {
    return closed("missing", "The decomposition children could not be read. Restore that evidence reader before closing the initiative.", refs);
  }
}

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { loadCapsuleLivenessInventory, type InventoryDb } from "./liveness-inventory";
import { WorkroomObservations, WORKROOM_OBSERVATION_LIMIT } from "./observation-pages";

type Db = {
  $transaction<T>(work: (db: InventoryDb & { $executeRawUnsafe(query: string): Promise<unknown> }) => Promise<T>, options: { isolationLevel: "RepeatableRead"; timeout: number; maxWait: number }): Promise<T>;
};
const observations = new WorkroomObservations();
let captures = 0;
const OWNER_KEYS = ["leaseHolderPrincipalId", "createdByPrincipalId", "requestedByPrincipalId"] as const;

async function markHandoverRows<T extends Record<string, unknown>>(rows: T[], assistantPrincipalId: string, agentId: string | undefined) {
  const { workroomHandoverCall } = await import("./oauth-workroom-ownership");
  const { providerToExecutorKind } = await import("./external-session-capture");
  const toExecutorKind = providerToExecutorKind(agentId ?? "");
  return rows.map(row => OWNER_KEYS.some(key => row[key] === assistantPrincipalId) ? row
    : { ...row, admission: "handover-required", handover: workroomHandoverCall(String(row.capsuleId), toExecutorKind) });
}

export async function listWorkroomObservation(db: Db, params: Record<string, unknown>, userId: string, context?: ToolExecutionContext, store = observations) {
  if (!userId || !context?.userContext) return { success: false, error: "authority_context_required", message: "Use the governed Workroom tool dispatcher." };
  const where: Record<string, unknown> = Object.fromEntries(["status", "decisionScope", "portfolioRole"].flatMap(key => params[key] ? [[key, params[key]]] : []));
  // A PR number or branch is the handle a person gives when asking an assistant
  // to take over work (BI-679D2BF6).
  const lookup = {
    ...(typeof params.headBranch === "string" && params.headBranch.trim() ? { headBranch: params.headBranch.trim() } : {}),
    ...(Number.isInteger(params.pullRequestNumber) && (params.pullRequestNumber as number) > 0 ? { pullRequestNumber: params.pullRequestNumber } : {}),
  };
  Object.assign(where, lookup);
  const isLookup = Object.keys(lookup).length > 0;
  let assistantPrincipalId: string | null = null;
  const identity = {
    principal: userId,
    authority: canonicalJson({ user: context.userContext, agent: context.agentId ?? null, token: context.apiTokenId ?? null,
      scope: context.tokenScope ?? null, grants: [...(context.tokenGrantScopes ?? [])].sort(), surface: context.authorizedSurfaceContext ?? null }),
    filters: { ...where, staleOnly: params.staleOnly === true },
  };
  try {
    if (context.authSource === "oauth") {
      const { workCapsuleActor } = await import("./handler-actor");
      const actor = await workCapsuleActor(userId, context);
      assistantPrincipalId = actor.agentPrincipalId ?? null;
      // A lookup also matches the person's rooms another assistant created; those
      // rows are reduced to the handover below.
      where.AND = (isLookup ? [actor.principalId] : [actor.principalId, actor.agentPrincipalId]).map(principalId => ({
        OR: OWNER_KEYS.map(key => ({ [key]: principalId })),
      }));
    }
    if (typeof params.cursor === "string") return store.resume(params.cursor, identity);
    if (captures >= 2) throw new Error("snapshot_capacity_exceeded");
    captures++;
    try {
      const now = new Date();
      const { capsulesAll, livenessSummary } = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return loadCapsuleLivenessInventory(tx, { where, take: WORKROOM_OBSERVATION_LIMIT + 1, compact: true }, now);
      }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
      if (capsulesAll.length > WORKROOM_OBSERVATION_LIMIT) throw new Error("snapshot_capacity_exceeded");
      const rows = isLookup && assistantPrincipalId ? await markHandoverRows(capsulesAll, assistantPrincipalId, context.agentId) : capsulesAll;
      return store.capture(params.staleOnly === true ? rows.filter(c => !c.isLive) : rows, identity,
        { limit: typeof params.limit === "number" ? params.limit : undefined, observedAt: now.getTime(), summary: livenessSummary,
          ownershipScope: context.authSource === "oauth" ? "caller-visible" : "installation" });
    } finally { captures--; }
  } catch (error) {
    const code = error instanceof Error ? error.message : "snapshot_unavailable";
    const known = ["invalid_cursor", "cursor_authority_mismatch", "snapshot_expired", "snapshot_unavailable", "snapshot_capacity_exceeded", "page_budget_too_small"].includes(code);
    return { success: false, error: known ? code : "snapshot_unavailable", message: "Start a new observation without cursor, using the same filters; do not combine it with the old traversal. Narrow filters if capacity is exceeded.",
      data: { page: { version: 1, disposition: "restart-required" }, recovery: { toolName: "list_workrooms", arguments: { ...where, staleOnly: params.staleOnly === true } } } };
  }
}

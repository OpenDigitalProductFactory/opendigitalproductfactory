import { canonicalJson } from "@/lib/shared/canonical-json";
import type { ToolExecutionContext } from "@/lib/mcp-tools";
import { loadCapsuleLivenessInventory, type InventoryDb } from "./liveness-inventory";
import { WorkroomObservations, WORKROOM_OBSERVATION_LIMIT } from "./observation-pages";

type Db = {
  $transaction<T>(work: (db: InventoryDb & { $executeRawUnsafe(query: string): Promise<unknown> }) => Promise<T>, options: { isolationLevel: "RepeatableRead"; timeout: number; maxWait: number }): Promise<T>;
};
const observations = new WorkroomObservations();
let captures = 0;

export async function listWorkroomObservation(db: Db, params: Record<string, unknown>, userId: string, context?: ToolExecutionContext, store = observations) {
  if (!userId || !context?.userContext) return { success: false, error: "authority_context_required", message: "Use the governed Workroom tool dispatcher." };
  const where = Object.fromEntries(["status", "decisionScope", "portfolioRole"].flatMap(key => params[key] ? [[key, params[key]]] : []));
  const identity = {
    principal: userId,
    authority: canonicalJson({ user: context.userContext, agent: context.agentId ?? null, token: context.apiTokenId ?? null,
      scope: context.tokenScope ?? null, grants: [...(context.tokenGrantScopes ?? [])].sort(), surface: context.authorizedSurfaceContext ?? null }),
    filters: { ...where, staleOnly: params.staleOnly === true },
  };
  try {
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
      return store.capture(params.staleOnly === true ? capsulesAll.filter(c => !c.isLive) : capsulesAll, identity,
        { limit: typeof params.limit === "number" ? params.limit : undefined, observedAt: now.getTime(), summary: livenessSummary });
    } finally { captures--; }
  } catch (error) {
    const code = error instanceof Error ? error.message : "snapshot_unavailable";
    const known = ["invalid_cursor", "cursor_authority_mismatch", "snapshot_expired", "snapshot_unavailable", "snapshot_capacity_exceeded", "page_budget_too_small"].includes(code);
    return { success: false, error: known ? code : "snapshot_unavailable", message: "Start a new observation without cursor, using the same filters; do not combine it with the old traversal. Narrow filters if capacity is exceeded.",
      data: { page: { version: 1, disposition: "restart-required" }, recovery: { toolName: "list_workrooms", arguments: { ...where, staleOnly: params.staleOnly === true } } } };
  }
}

// BI-39247CB8 — the `retire_peer_demand_intake_copies` tool: load the copies
// the inbound issue triage filed from same-organization peer demand, report a
// read-only dry run, and on an approved call retire each copy through the
// retire_backlog_item core path (retireBacklogItemTool). Governance (WWMD
// DI-F7294B768E8D): one approval for the whole set, bound to the dry run's
// selection digest; a retire whose selection drifted is refused with no writes.
// Pure classification lives in ./peer-demand-intake-copies.

import type { ToolResult } from "@/lib/mcp-tool-types";

import {
  PEER_DEMAND_MARKER_PREFIX,
  WORK_SYNC_MARKER_PREFIX,
  buildRetirementPlan,
  classifyPeerDemandCopy,
  peerDemandMirrorId,
  retirementParams,
  summarizeRetirementPlan,
  type CopyFacts,
  type RetirementPlan,
} from "./peer-demand-intake-copies";

export const RETIRE_PEER_DEMAND_INTAKE_COPIES_TOOL = "retire_peer_demand_intake_copies";

type CopyRow = {
  id: string;
  itemId: string;
  title: string;
  status: string;
  body: string | null;
  resolution: string | null;
  claimedById: string | null;
  claimedByAgentId: string | null;
  claimStatus: string | null;
  activeBuildId: string | null;
  createdAt: Date;
};

/** Everything the plan reads, as bounded set queries. */
export type PeerDemandCopySource = {
  copies(): Promise<CopyRow[]>;
  mirrors(mirrorIds: string[]): Promise<Array<{ mirrorId: string; federationLinkId: string; syncStatus: string; disposition: string | null }>>;
  links(linkIds: string[]): Promise<Array<{ linkId: string; role: string; linkState: string; revokedAt: Date | null }>>;
  activities(rowIds: string[]): Promise<Array<{ backlogItemId: string; kind: string; recordedById: string | null; originKind: string | null }>>;
  /** Workroom.backlogItemId values (row id or BI id) that point at any of these refs. */
  workroomRefs(refs: string[]): Promise<string[]>;
  evidenceRowIds(rowIds: string[]): Promise<string[]>;
  originatedBuildRowIds(rowIds: string[]): Promise<string[]>;
  /** Tool calls naming one of these items whose audit class is not read chatter
   *  (ToolExecution.auditClass is derived from the tool's declared side effect
   *  at write time; metrics_only rows are reads). */
  mutatingToolCalls(itemIds: string[], since: Date): Promise<Array<{ itemId: string; toolName: string; createdAt: Date }>>;
  workSyncTwins(titles: string[]): Promise<Array<{ itemId: string; title: string; body: string | null; createdAt: Date }>>;
};

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export async function loadRetirementPlan(source: PeerDemandCopySource): Promise<RetirementPlan> {
  const rows = await source.copies();
  if (rows.length === 0) return buildRetirementPlan([]);
  const rowIds = rows.map((r) => r.id);
  const itemIds = rows.map((r) => r.itemId);
  const mirrorIds = [...new Set(rows.map((r) => peerDemandMirrorId(r.body)).filter((id): id is string => Boolean(id)))];
  const since = rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), rows[0]!.createdAt);

  const [mirrors, activities, workroomRefs, evidence, builds, toolCalls, twins] = await Promise.all([
    source.mirrors(mirrorIds),
    source.activities(rowIds),
    source.workroomRefs([...rowIds, ...itemIds]),
    source.evidenceRowIds(rowIds),
    source.originatedBuildRowIds(rowIds),
    source.mutatingToolCalls(itemIds, since),
    source.workSyncTwins([...new Set(rows.map((r) => r.title))]),
  ]);
  const links = await source.links([...new Set(mirrors.map((m) => m.federationLinkId))]);

  const mirrorById = new Map(mirrors.map((m) => [m.mirrorId, m]));
  const linkById = new Map(links.map((l) => [l.linkId, l]));
  const activityByRow = group(activities, (a) => a.backlogItemId);
  const workroomCount = group(workroomRefs, (ref) => ref);
  const evidenceCount = group(evidence, (id) => id);
  const buildCount = group(builds, (id) => id);
  const callsByItem = group(toolCalls, (c) => c.itemId);
  const twinByTitle = new Map<string, { itemId: string; createdAt: Date }>();
  for (const twin of twins) {
    if (!twin.body?.includes(WORK_SYNC_MARKER_PREFIX) || twin.body.includes(PEER_DEMAND_MARKER_PREFIX)) continue;
    const current = twinByTitle.get(twin.title);
    if (!current || twin.createdAt < current.createdAt) twinByTitle.set(twin.title, twin);
  }

  return buildRetirementPlan(rows.map((r) => {
    const mirrorId = peerDemandMirrorId(r.body);
    const mirror = mirrorId ? mirrorById.get(mirrorId) : undefined;
    const link = mirror ? linkById.get(mirror.federationLinkId) : undefined;
    const facts: CopyFacts = {
      id: r.id,
      itemId: r.itemId,
      title: r.title,
      status: r.status,
      body: r.body,
      resolution: r.resolution,
      claimedById: r.claimedById,
      claimedByAgentId: r.claimedByAgentId,
      claimStatus: r.claimStatus,
      activeBuildId: r.activeBuildId,
      mirror: mirror
        ? {
            syncStatus: mirror.syncStatus,
            disposition: mirror.disposition,
            link: link ? { role: link.role, linkState: link.linkState, revoked: link.revokedAt !== null } : null,
          }
        : null,
      workroomCount: (workroomCount.get(r.id)?.length ?? 0) + (workroomCount.get(r.itemId)?.length ?? 0),
      evidenceLinkCount: evidenceCount.get(r.id)?.length ?? 0,
      originatedBuildCount: buildCount.get(r.id)?.length ?? 0,
      activities: (activityByRow.get(r.id) ?? []).map((a) => ({ kind: a.kind, recordedById: a.recordedById, originKind: a.originKind })),
      mutatingToolNames: (callsByItem.get(r.itemId) ?? [])
        .filter((c) => c.createdAt > r.createdAt)
        .map((c) => c.toolName),
      workSyncTwinItemId: twinByTitle.get(r.title)?.itemId ?? null,
    };
    return { itemId: r.itemId, title: r.title, status: r.status, classification: classifyPeerDemandCopy(facts) };
  }));
}

export type RetireCopy = (
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
) => Promise<ToolResult>;

export type RetirementDeps = {
  source: PeerDemandCopySource;
  retire: RetireCopy;
  /** Settle budget reservations for retired items; best effort. */
  settle?: (itemIds: string[]) => Promise<void>;
};

function intParam(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(0, Math.min(n, max));
}

export async function handleRetirePeerDemandIntakeCopies(
  params: Record<string, unknown>,
  userId: string,
  context: { agentId?: string } | undefined,
  deps: RetirementDeps,
): Promise<ToolResult> {
  const mode = params["mode"] === "retire" ? "retire" : "dry-run";
  const plan = await loadRetirementPlan(deps.source);
  const summary = summarizeRetirementPlan(plan, {
    sampleSize: intParam(params["sampleSize"], 5, 50),
    keptListLimit: intParam(params["keptListLimit"], 200, 1000),
  });

  if (mode === "dry-run") {
    return {
      success: true,
      message:
        `Dry run: ${summary.toRetire.total} copies to retire, ${summary.keptForReview.total} kept for individual review, `
        + `${summary.alreadyRetired} already retired. To retire, call again with mode "retire" and selectionDigest `
        + `${summary.selectionDigest}; that call asks the operator for one approval.`,
      data: { mode, ...summary },
    };
  }

  const digest = typeof params["selectionDigest"] === "string" ? params["selectionDigest"].trim() : "";
  if (!digest) {
    return { success: false, error: "selection_digest_required", message: "Run the dry run first and pass its selectionDigest." };
  }
  if (digest !== plan.digest) {
    return {
      success: false,
      error: "selection_changed",
      message: "The selection changed since the dry run that was approved. Nothing was retired; run a new dry run and approve that.",
      data: { mode, approvedDigest: digest, ...summary },
    };
  }

  const retired: string[] = [];
  const failed: Array<{ itemId: string; error: string; message: string }> = [];
  for (const row of plan.toRetire) {
    const result = await deps.retire(retirementParams(row.itemId, row.plan), userId, context?.agentId ? { agentId: context.agentId } : undefined);
    if (result.success) retired.push(row.itemId);
    else failed.push({ itemId: row.itemId, error: result.error ?? "retire_failed", message: result.message });
  }
  if (retired.length > 0 && deps.settle) {
    try {
      await deps.settle(retired);
    } catch {
      // the scheduled sweep settles reservations it misses
    }
  }
  return {
    success: failed.length === 0,
    ...(failed.length > 0 ? { error: "some_retirements_failed" } : {}),
    message:
      `Retired ${retired.length} copies; ${plan.alreadyRetired.length} were already retired; `
      + `${failed.length} refused; ${plan.kept.length} kept for individual review.`,
    data: {
      mode,
      selectionDigest: plan.digest,
      retired: retired.length,
      alreadyRetired: plan.alreadyRetired.length,
      failed,
      keptForReview: summary.keptForReview,
    },
  };
}

/** The production source over Prisma. Read-only. */
export async function prismaPeerDemandCopySource(): Promise<PeerDemandCopySource> {
  const { prisma } = await import("@dpf/db");
  return {
    copies: () =>
      prisma.backlogItem.findMany({
        where: { body: { contains: PEER_DEMAND_MARKER_PREFIX } },
        select: {
          id: true, itemId: true, title: true, status: true, body: true, resolution: true,
          claimedById: true, claimedByAgentId: true, claimStatus: true, activeBuildId: true, createdAt: true,
        },
      }),
    mirrors: async (mirrorIds) => {
      const rows = await prisma.federatedRecordMirror.findMany({
        where: { mirrorId: { in: mirrorIds } },
        select: { mirrorId: true, federationLinkId: true, syncStatus: true, payload: true },
      });
      return rows.map((m) => {
        const payload = m.payload as { disposition?: unknown } | null;
        return {
          mirrorId: m.mirrorId,
          federationLinkId: m.federationLinkId,
          syncStatus: m.syncStatus,
          disposition: typeof payload?.disposition === "string" ? payload.disposition : null,
        };
      });
    },
    links: (linkIds) =>
      prisma.federationLink.findMany({
        where: { linkId: { in: linkIds } },
        select: { linkId: true, role: true, linkState: true, revokedAt: true },
      }),
    activities: async (rowIds) => {
      const rows = await prisma.backlogItemActivity.findMany({
        where: { backlogItemId: { in: rowIds } },
        select: { backlogItemId: true, kind: true, recordedById: true, payload: true },
      });
      return rows.map((a) => {
        const origin = (a.payload as { origin?: { kind?: unknown } } | null)?.origin;
        return {
          backlogItemId: a.backlogItemId,
          kind: a.kind,
          recordedById: a.recordedById,
          originKind: a.kind === "intake_origin" && typeof origin?.kind === "string" ? origin.kind : null,
        };
      });
    },
    workroomRefs: async (refs) => {
      const rows = await prisma.workroom.findMany({ where: { backlogItemId: { in: refs } }, select: { backlogItemId: true } });
      return rows.map((w) => w.backlogItemId).filter((id): id is string => Boolean(id));
    },
    evidenceRowIds: async (rowIds) => {
      const rows = await prisma.demandEvidenceLink.findMany({ where: { backlogItemId: { in: rowIds } }, select: { backlogItemId: true } });
      return rows.map((e) => e.backlogItemId);
    },
    originatedBuildRowIds: async (rowIds) => {
      const rows = await prisma.featureBuild.findMany({ where: { originatingBacklogItemId: { in: rowIds } }, select: { originatingBacklogItemId: true } });
      return rows.map((b) => b.originatingBacklogItemId).filter((id): id is string => Boolean(id));
    },
    mutatingToolCalls: (itemIds, since) =>
      prisma.$queryRaw<Array<{ itemId: string; toolName: string; createdAt: Date }>>`
        SELECT "parameters"->>'itemId' AS "itemId", "toolName", "createdAt"
        FROM "ToolExecution"
        WHERE "createdAt" >= ${since}
          AND "auditClass" IS DISTINCT FROM 'metrics_only'
          AND "parameters"->>'itemId' = ANY(${itemIds}::text[])`,
    workSyncTwins: (titles) =>
      prisma.backlogItem.findMany({
        where: { title: { in: titles }, body: { contains: WORK_SYNC_MARKER_PREFIX } },
        select: { itemId: true, title: true, body: true, createdAt: true },
      }),
  };
}

/** Production wiring for the backlog pack handler. */
export async function retirePeerDemandIntakeCopiesTool(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string },
): Promise<ToolResult> {
  const [{ retireBacklogItemTool }, source] = await Promise.all([
    import("@/lib/mcp/backlog-retirement-handlers"),
    prismaPeerDemandCopySource(),
  ]);
  return handleRetirePeerDemandIntakeCopies(params, userId, context, {
    source,
    retire: retireBacklogItemTool,
    settle: async (itemIds) => {
      const [{ settleBudgetReservations }, { prisma }] = await Promise.all([
        import("@/lib/portfolio/budget-reservation"),
        import("@dpf/db"),
      ]);
      await settleBudgetReservations(prisma as never, { itemIds });
    },
  });
}

import type { ToolResult } from "@/lib/mcp-tools";
import { resolveEpicRowId, resolveListLimit } from "./backlog-read-helpers";
import { addScopeFilters, backlogScopeSelect, scopeData } from "./backlog-scope-metadata";

export async function queryBacklog(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  const epicWhere: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  addScopeFilters(where, params);
  addScopeFilters(epicWhere, params);
  const epicRowId = await resolveEpicRowId(prisma, params["epicId"]);
  if (epicRowId === null) {
    return { success: false, error: "epic_not_found", message: `No epic matched ${String(params["epicId"])}` };
  }
  if (epicRowId !== undefined) where["epicId"] = epicRowId;
  const limit = resolveListLimit(params["limit"]);

  const [items, matching, epics, epicTotal, open, inProgress, done] = await Promise.all([
    prisma.backlogItem.findMany({
      where,
      orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
      take: limit,
      select: {
        itemId: true,
        title: true,
        status: true,
        type: true,
        priority: true,
        updatedAt: true,
        ...backlogScopeSelect,
        epic: { select: { epicId: true } },
      },
    }),
    prisma.backlogItem.count({ where }),
    prisma.epic.findMany({
      where: epicWhere,
      select: {
        id: true,
        epicId: true,
        title: true,
        status: true,
        ...backlogScopeSelect,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.epic.count({ where: epicWhere }),
    prisma.backlogItem.count({ where: { status: "open" } }),
    prisma.backlogItem.count({ where: { status: "in-progress" } }),
    prisma.backlogItem.count({ where: { status: "done" } }),
  ]);

  return {
    success: true,
    message: `Backlog: ${open} open, ${inProgress} in-progress, ${done} done. Showing ${items.length} of ${matching} matching item(s), ${epics.length} of ${epicTotal} epic(s).`,
    data: {
      summary: { open, inProgress, done },
      total: matching,
      truncated: items.length < matching,
      epicTotal,
      epicsTruncated: epics.length < epicTotal,
      epics: epics.map((e) => ({
        epicId: e.epicId,
        title: e.title,
        status: e.status,
        ...scopeData(e),
      })),
      items: items.map((i) => ({
        itemId: i.itemId,
        title: i.title,
        status: i.status,
        type: i.type,
        priority: i.priority,
        ...scopeData(i),
        epicId: i.epic?.epicId ?? null,
      })),
    },
  };
}

export async function listEpics(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  addScopeFilters(where, params);
  const limit = resolveListLimit(params["limit"]);
  const epicTotal = await prisma.epic.count({ where });
  const epics = await prisma.epic.findMany({
    where,
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      epicId: true,
      title: true,
      status: true,
      priority: true,
      updatedAt: true,
      ...backlogScopeSelect,
      items: { select: { status: true } },
    },
  });
  const wantOpenItems = params["hasOpenItems"] === true;
  const { buildSpecPlanReferenceIndex } = await import("@/lib/backlog/spec-plan-search");
  const refIndex = await buildSpecPlanReferenceIndex();
  const data = epics
    .map((e) => {
      const total = e.items.length;
      const open = e.items.filter((it) => it.status === "open").length;
      const inProgress = e.items.filter((it) => it.status === "in-progress").length;
      const done = e.items.filter((it) => it.status === "done").length;
      return {
        epicId: e.epicId,
        title: e.title,
        status: e.status,
        priority: e.priority,
        ...scopeData(e),
        itemCount: { total, open, inProgress, done },
        hasSpec: refIndex.specs.has(e.epicId) || refIndex.plans.has(e.epicId),
        updatedAt: e.updatedAt.toISOString(),
        _hasOpen: open + inProgress > 0,
      };
    })
    .filter((row) => (wantOpenItems ? row._hasOpen : true))
    .map((row) => {
      const { _hasOpen, ...rest } = row;
      void _hasOpen;
      return rest;
    });
  return {
    success: true,
    message: `Listed ${data.length} epic(s) (${epics.length} of ${epicTotal} fetched).`,
    data: { epics: data, total: epicTotal, fetched: epics.length, truncated: epics.length < epicTotal },
  };
}

export async function listBacklogItems(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  if (typeof params["type"] === "string") where["type"] = params["type"];
  if (typeof params["workType"] === "string") where["workType"] = params["workType"];
  if (typeof params["source"] === "string") where["source"] = params["source"];
  addScopeFilters(where, params);
  const epicRowId = await resolveEpicRowId(prisma, params["epicId"]);
  if (epicRowId === null) {
    return { success: false, error: "epic_not_found", message: `No epic matched ${String(params["epicId"])}` };
  }
  if (epicRowId !== undefined) where["epicId"] = epicRowId;
  if (params["unclaimed"] === true) {
    where["claimedById"] = null;
    where["claimedByAgentId"] = null;
  }
  if (params["hasActiveBuild"] === true) where["activeBuildId"] = { not: null };
  else if (params["hasActiveBuild"] === false) where["activeBuildId"] = null;

  const limit = resolveListLimit(params["limit"]);
  const matching = await prisma.backlogItem.count({ where });
  const items = await prisma.backlogItem.findMany({
    where,
    take: limit,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      itemId: true,
      title: true,
      status: true,
      type: true,
      workType: true,
      source: true,
      priority: true,
      effortSize: true,
      demandStage: true,
      demandScore: true,
      demandScoreFramework: true,
      ...backlogScopeSelect,
      activeBuildId: true,
      updatedAt: true,
      triageOutcome: true,
      epic: { select: { epicId: true } },
      activeBuild: { select: { phase: true, draftApprovedAt: true } },
    },
  });
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const data = items.map((i) => ({
    itemId: i.itemId,
    title: i.title,
    status: i.status,
    type: i.type,
    workType: i.workType,
    source: i.source,
    priority: i.priority,
    effortSize: i.effortSize,
    demandStage: i.demandStage,
    demandScore: i.demandScore,
    demandScoreFramework: i.demandScoreFramework,
    ...scopeData(i),
    triageOutcome: i.triageOutcome,
    epicId: i.epic?.epicId ?? null,
    hasActiveBuild: i.activeBuildId != null,
    lifecycleLabel: deriveLifecycleLabel({
      backlogItem: { status: i.status, triageOutcome: i.triageOutcome, activeBuildId: i.activeBuildId },
      featureBuild: i.activeBuild
        ? { phase: i.activeBuild.phase, draftApprovedAt: i.activeBuild.draftApprovedAt }
        : null,
      governedBacklogEnabled: true,
    }),
    updatedAt: i.updatedAt.toISOString(),
  }));
  return {
    success: true,
    message: `Listed ${data.length} of ${matching} backlog item(s).`,
    data: { items: data, total: matching, truncated: data.length < matching },
  };
}

export async function getBacklogItem(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const itemIdRaw = String(params["itemId"] ?? "").trim();
  if (!itemIdRaw)
    return { success: false, error: "missing_itemId", message: "itemId is required" };
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: itemIdRaw },
    include: {
      epic: { select: { epicId: true, title: true, status: true } },
      digitalProduct: { select: { productId: true, name: true } },
      organization: { select: { orgId: true, slug: true, name: true } },
      productLine: { select: { lineId: true, key: true, name: true } },
      businessProduct: { select: { productId: true, key: true, name: true } },
      demandEvidenceLinks: {
        where: { status: "active" },
        orderBy: { createdAt: "desc" },
      },
      activeBuild: {
        select: {
          buildId: true,
          phase: true,
          draftApprovedAt: true,
          sandboxId: true,
          createdAt: true,
        },
      },
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 10,
      },
    },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const { searchSpecsAndPlans } = await import("@/lib/backlog/spec-plan-search");
  const specPlanRefs = await searchSpecsAndPlans({
    query: itemIdRaw,
    itemId: itemIdRaw,
    matches: 10,
  });
  const { mapDemandRows } = await import("@/lib/demand/demand-data");
  const demandView = mapDemandRows([item])[0]!;
  return {
    success: true,
    message: `Loaded ${item.itemId}`,
    data: {
      itemId: item.itemId,
      title: item.title,
      status: item.status,
      type: item.type,
      workType: item.workType,
      source: item.source,
      priority: item.priority,
      effortSize: item.effortSize,
      triageOutcome: item.triageOutcome,
      ...scopeData(item),
      body: item.body ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      completedAt: item.completedAt ? item.completedAt.toISOString() : null,
      lifecycleLabel: deriveLifecycleLabel({
        backlogItem: {
          status: item.status,
          triageOutcome: item.triageOutcome,
          activeBuildId: item.activeBuildId,
        },
        featureBuild: item.activeBuild
          ? { phase: item.activeBuild.phase, draftApprovedAt: item.activeBuild.draftApprovedAt }
          : null,
        governedBacklogEnabled: true,
      }),
      epic: item.epic
        ? { epicId: item.epic.epicId, title: item.epic.title, status: item.epic.status }
        : null,
      digitalProduct: item.digitalProduct
        ? { productId: item.digitalProduct.productId, name: item.digitalProduct.name }
        : null,
      productManagementScope: {
        organization: item.organization,
        productLine: item.productLine,
        businessProduct: item.businessProduct,
        digitalProduct: item.digitalProduct,
      },
      demandActivation: demandView.activation,
      demandEvidence: demandView.evidenceLinks,
      activeBuild: item.activeBuild
        ? {
            buildId: item.activeBuild.buildId,
            phase: item.activeBuild.phase,
            draftApprovedAt: item.activeBuild.draftApprovedAt
              ? item.activeBuild.draftApprovedAt.toISOString()
              : null,
            sandboxId: item.activeBuild.sandboxId,
          }
        : null,
      specPlanFiles: specPlanRefs.map((r) => ({
        path: r.path,
        kind: r.kind,
        title: r.title,
        date: r.date,
      })),
      recentActivity: item.activities.map((a) => ({
        id: a.id,
        kind: a.kind,
        summary: a.summary,
        recordedAt: a.recordedAt.toISOString(),
        payload: a.payload,
      })),
    },
  };
}

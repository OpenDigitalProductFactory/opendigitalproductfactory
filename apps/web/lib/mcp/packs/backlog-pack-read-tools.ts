import type { ToolResult } from "@/lib/mcp-tools";
import { resolveEpicRowId, resolveListLimit } from "./backlog-read-helpers";
import { addScopeFilters, backlogScopeSelect, scopeData } from "./backlog-scope-metadata";

const INITIATIVE_READINESS_ACTIVITY_KINDS = [
  "initiative_gate_receipt",
  "initiative_scope_baseline",
  "plan_backlog_coverage",
  "initiative_readiness_decision",
];

function addDeferralFilters(where: Record<string, unknown>, params: Record<string, unknown>): ToolResult | null {
  const conformance = params["deferralConformance"];
  if (conformance === "compliant") {
    where["status"] = "deferred";
    where["deferReason"] = { not: null };
    where["deferTrigger"] = { not: null };
    where["deferReviewAt"] = { not: null };
    where["deferOwnerPrincipalId"] = { not: null };
    where["deferredAt"] = { not: null };
  } else if (conformance === "nonconformant") {
    where["status"] = "deferred";
    where["OR"] = [
      { deferReason: null },
      { deferTrigger: null },
      { deferReviewAt: null },
      { deferOwnerPrincipalId: null },
      { deferredAt: null },
    ];
  }
  if (typeof params["deferralReviewDueBefore"] === "string") {
    const dueBefore = new Date(params["deferralReviewDueBefore"] as string);
    if (Number.isNaN(dueBefore.getTime())) {
      return { success: false, error: "invalid_deferral_review_due_before", message: "deferralReviewDueBefore must be an ISO-8601 timestamp" };
    }
    where["status"] = "deferred";
    where["deferReviewAt"] = { lte: dueBefore };
  }
  return null;
}

const deferralSelect = {
  deferReason: true,
  deferTrigger: true,
  deferReviewAt: true,
  deferOwnerPrincipalId: true,
  deferredAt: true,
  deferOwnerPrincipal: { select: { principalId: true, displayName: true } },
} as const;

function deferralData(item: {
  status: string;
  deferReason: string | null;
  deferTrigger: string | null;
  deferReviewAt: Date | null;
  deferOwnerPrincipalId: string | null;
  deferredAt: Date | null;
  deferOwnerPrincipal: { principalId: string; displayName: string } | null;
}) {
  if (item.status !== "deferred") return null;
  const conformant = Boolean(
    item.deferReason && item.deferTrigger && item.deferReviewAt
      && item.deferOwnerPrincipalId && item.deferredAt,
  );
  return {
    reason: item.deferReason,
    trigger: item.deferTrigger,
    reviewAt: item.deferReviewAt?.toISOString() ?? null,
    deferredAt: item.deferredAt?.toISOString() ?? null,
    owner: item.deferOwnerPrincipal,
    conformant,
    reviewDue: item.deferReviewAt ? item.deferReviewAt.getTime() <= Date.now() : null,
  };
}

export async function queryBacklog(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  const epicWhere: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  const deferralFilterError = addDeferralFilters(where, params);
  if (deferralFilterError) return deferralFilterError;
  addScopeFilters(where, params);
  addScopeFilters(epicWhere, params);
  const epicRowId = await resolveEpicRowId(prisma, params["epicId"]);
  if (epicRowId === null) {
    return { success: false, error: "epic_not_found", message: `No epic matched ${String(params["epicId"])}` };
  }
  if (epicRowId !== undefined) where["epicId"] = epicRowId;
  const limit = resolveListLimit(params["limit"]);

  const [items, matching, epics, epicTotal, open, inProgress, done, deferred, retired] = await Promise.all([
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
        ...deferralSelect,
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
    prisma.backlogItem.count({ where: { status: "deferred" } }),
    prisma.backlogItem.count({ where: { status: "retired" } }),
  ]);

  return {
    success: true,
    message: `Backlog: ${open} open, ${inProgress} in-progress, ${deferred} deferred, ${done} done, ${retired} retired. Showing ${items.length} of ${matching} matching item(s), ${epics.length} of ${epicTotal} epic(s).`,
    data: {
      summary: { open, inProgress, deferred, done, retired },
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
        deferral: deferralData(i),
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
  const deferralFilterError = addDeferralFilters(where, params);
  if (deferralFilterError) return deferralFilterError;
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
  const { buildSpecPlanReferenceIndex, specPlanCorpusCaveat } = await import("@/lib/backlog/spec-plan-search");
  const refIndex = await buildSpecPlanReferenceIndex();
  const specPlanCaveat = specPlanCorpusCaveat(refIndex.corpus);
  const data = epics
    .map((e) => {
      const total = e.items.length;
      const open = e.items.filter((it) => it.status === "open").length;
      const inProgress = e.items.filter((it) => it.status === "in-progress").length;
      const done = e.items.filter((it) => it.status === "done").length;
      const triaging = e.items.filter((it) => it.status === "triaging").length;
      const deferred = e.items.filter((it) => it.status === "deferred").length;
      const retired = e.items.filter((it) => it.status === "retired").length;
      return {
        epicId: e.epicId,
        title: e.title,
        status: e.status,
        priority: e.priority,
        ...scopeData(e),
        itemCount: { total, triaging, open, inProgress, deferred, done, retired },
        hasSpec: refIndex.specs.has(e.epicId),
        hasPlan: refIndex.plans.has(e.epicId),
        updatedAt: e.updatedAt.toISOString(),
        _hasOpen: triaging + open + inProgress + deferred > 0,
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
    message: specPlanCaveat
      ? `Listed ${data.length} epic(s) (${epics.length} of ${epicTotal} fetched). ${specPlanCaveat}`
      : `Listed ${data.length} epic(s) (${epics.length} of ${epicTotal} fetched).`,
    data: {
      epics: data,
      total: epicTotal,
      fetched: epics.length,
      truncated: epics.length < epicTotal,
      specPlanCorpus: refIndex.corpus,
    },
  };
}

export async function listBacklogItems(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const where: Record<string, unknown> = {};
  if (typeof params["status"] === "string") where["status"] = params["status"];
  if (typeof params["type"] === "string") where["type"] = params["type"];
  if (typeof params["workType"] === "string") where["workType"] = params["workType"];
  if (typeof params["source"] === "string") where["source"] = params["source"];
  const deferralFilterError = addDeferralFilters(where, params);
  if (deferralFilterError) return deferralFilterError;
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

  // BI-28E8CB88 acceptance criterion 3: the items holding evidence the gates
  // cannot read must be enumerable, so the backlog can be reconciled rather than
  // silently stalled. When first measured on the live install, 38 items held
  // `evidence` activities, 4 held `initiative_gate_receipt`, and the other 35
  // had no way to be found.
  if (params["evidenceNotCounted"] === true) {
    const holdingEvidence = await prisma.backlogItemActivity.findMany({
      where: { kind: "evidence" },
      distinct: ["backlogItemId"],
      select: { backlogItemId: true },
    });
    const holdingReceipts = await prisma.backlogItemActivity.findMany({
      where: { kind: "initiative_gate_receipt" },
      distinct: ["backlogItemId"],
      select: { backlogItemId: true },
    });
    const withReceipts = new Set(holdingReceipts.map((row) => row.backlogItemId));
    const stalled = holdingEvidence
      .map((row) => row.backlogItemId)
      .filter((id) => !withReceipts.has(id));
    where["id"] = { in: stalled };
  }

  const limit = resolveListLimit(params["limit"]);
  const matching = await prisma.backlogItem.count({ where });
  const items = await prisma.backlogItem.findMany({
    where,
    take: limit,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
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
      ...deferralSelect,
      epic: { select: { epicId: true } },
      activeBuild: { select: { phase: true, draftApprovedAt: true, kind: true } },
      activities: {
        where: { kind: { in: INITIATIVE_READINESS_ACTIVITY_KINDS } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 100,
        select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
      },
    },
  });
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const { buildSpecPlanReferenceIndex, specPlanCorpusCaveat } = await import("@/lib/backlog/spec-plan-search");
  const { projectBacklogItemReadinessSummary } = await import("@/lib/backlog/initiative-readiness/entry-adapter");
  const refIndex = await buildSpecPlanReferenceIndex();
  const specPlanCaveat = specPlanCorpusCaveat(refIndex.corpus);
  const evaluatedAt = new Date().toISOString();
  const data = items.map((i) => {
    const semanticEpic = i.epic?.epicId ?? null;
    const hasSpec = refIndex.specs.has(i.itemId) || Boolean(semanticEpic && refIndex.specs.has(semanticEpic));
    const hasPlan = refIndex.plans.has(i.itemId) || Boolean(semanticEpic && refIndex.plans.has(semanticEpic));
    const readiness = projectBacklogItemReadinessSummary({
      item: {
        id: i.id,
        itemId: i.itemId,
        status: i.status,
        type: i.type,
        source: i.source,
        workType: i.workType,
        scopeKind: i.scopeKind,
        archetypeCategories: i.archetypeCategories,
        archetypeIds: i.archetypeIds,
        activeBuildKind: i.activeBuild?.kind ?? null,
      },
      activities: (i.activities ?? []).map((activity) => ({ ...activity, gateKey: activity.gateKey ?? null })),
      hasSpec,
      hasPlan,
      evaluatedAt,
    });
    return ({
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
    deferral: deferralData(i),
    epicId: i.epic?.epicId ?? null,
    hasActiveBuild: i.activeBuildId != null,
    hasSpec,
    hasPlan,
    readiness,
    lifecycleLabel: deriveLifecycleLabel({
      backlogItem: { status: i.status, triageOutcome: i.triageOutcome, activeBuildId: i.activeBuildId },
      featureBuild: i.activeBuild
        ? { phase: i.activeBuild.phase, draftApprovedAt: i.activeBuild.draftApprovedAt }
        : null,
      governedBacklogEnabled: true,
    }),
    updatedAt: i.updatedAt.toISOString(),
  });
  });
  return {
    success: true,
    message: specPlanCaveat
      ? `Listed ${data.length} of ${matching} backlog item(s). ${specPlanCaveat}`
      : `Listed ${data.length} of ${matching} backlog item(s).`,
    data: {
      items: data,
      total: matching,
      truncated: data.length < matching,
      specPlanCorpus: refIndex.corpus,
    },
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
      deferOwnerPrincipal: { select: { principalId: true, displayName: true } },
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
          kind: true,
          phase: true,
          draftApprovedAt: true,
          sandboxId: true,
          createdAt: true,
        },
      },
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 100,
      },
    },
  });
  if (!item)
    return { success: false, error: "not_found", message: `Item ${itemIdRaw} not found` };
  const { loadBacklogWorkroomOwnership } = await import("@/lib/work-capsules/backlog-workroom-ownership");
  const workroomOwnership = await loadBacklogWorkroomOwnership(prisma, [item.itemId, item.id]);
  const { deriveLifecycleLabel } = await import("@/lib/governed-backlog-workflow");
  const { searchSpecsAndPlans, specPlanCorpusCaveat } = await import("@/lib/backlog/spec-plan-search");
  const { corpus: specPlanCorpus, results: specPlanRefs } = await searchSpecsAndPlans({
    query: itemIdRaw,
    itemId: itemIdRaw,
    matches: 10,
  });
  const specPlanCaveat = specPlanCorpusCaveat(specPlanCorpus);
  const { mapDemandRows } = await import("@/lib/demand/demand-data");
  const demandView = mapDemandRows([item])[0]!;
  const { projectBacklogItemReadinessSummary } = await import("@/lib/backlog/initiative-readiness/entry-adapter");
  const { loadInheritedInitiativeScope } = await import("@/lib/backlog/initiative-readiness/parent-scope-inheritance");
  const hasSpec = specPlanRefs.some((entry) => entry.kind === "spec");
  const hasPlan = specPlanRefs.some((entry) => entry.kind === "plan");
  const inheritedScope = await loadInheritedInitiativeScope(prisma, { childItemId: item.itemId, childRowId: item.id });
  const readiness = projectBacklogItemReadinessSummary({
    inheritedScope,
    item: {
      id: item.id,
      itemId: item.itemId,
      status: item.status,
      type: item.type,
      source: item.source,
      workType: item.workType,
      scopeKind: item.scopeKind,
      archetypeCategories: item.archetypeCategories,
      archetypeIds: item.archetypeIds,
      activeBuildKind: item.activeBuild?.kind ?? null,
    },
    activities: item.activities
      .filter((activity) => INITIATIVE_READINESS_ACTIVITY_KINDS.includes(activity.kind))
      .map((activity) => ({ ...activity, gateKey: activity.gateKey ?? null })),
    hasSpec,
    hasPlan,
    evaluatedAt: new Date().toISOString(),
  });
  return {
    success: true,
    message: specPlanCaveat ? `Loaded ${item.itemId}. ${specPlanCaveat}` : `Loaded ${item.itemId}`,
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
      deferral: deferralData(item),
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
      workrooms: workroomOwnership.workrooms,
      activeWorkrooms: workroomOwnership.liveWorkrooms,
      readiness,
      specPlanCorpus,
      specPlanFiles: specPlanRefs.map((r) => ({
        path: r.path,
        kind: r.kind,
        title: r.title,
        date: r.date,
      })),
      recentActivity: item.activities.slice(0, 10).map((a) => ({
        id: a.id,
        kind: a.kind,
        summary: a.summary,
        recordedAt: a.recordedAt.toISOString(),
        payload: a.payload,
      })),
    },
  };
}

export async function getNextRecommendedWork(params: Record<string, unknown>): Promise<ToolResult> {
  const { prisma } = await import("@dpf/db");
  const { rankCandidates } = await import("@/lib/backlog/recommend");
  const { buildSpecPlanReferenceIndex, specPlanCorpusCaveat } = await import("@/lib/backlog/spec-plan-search");
  const { projectBacklogItemReadinessSummary } = await import("@/lib/backlog/initiative-readiness/entry-adapter");

  const count = typeof params["count"] === "number" ? params["count"] : undefined;
  const epicIdRaw = typeof params["epicId"] === "string" ? params["epicId"].trim() : "";
  const forAgentId = typeof params["forAgentId"] === "string" ? params["forAgentId"] : null;
  const excludeItemIds = Array.isArray(params["excludeItemIds"])
    ? (params["excludeItemIds"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const mode = params["mode"] === "implementation-ready"
    ? "implementation-ready"
    : "design-candidate";

  const where: Record<string, unknown> = {
    status: { in: ["open", "triaging"] },
  };
  if (epicIdRaw) {
    const epicRow = await prisma.epic.findFirst({
      where: { OR: [{ epicId: epicIdRaw }, { id: epicIdRaw }] },
      select: { id: true },
    });
    if (epicRow) where["epicId"] = epicRow.id;
    else
      return {
        success: false,
        error: "epic_not_found",
        message: `No epic matched ${epicIdRaw}`,
      };
  }

  const items = await prisma.backlogItem.findMany({
    where,
    take: 200,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: {
      itemId: true,
      title: true,
      status: true,
      priority: true,
      demandScore: true,
      effortSize: true,
      triageOutcome: true,
      type: true,
      source: true,
      workType: true,
      scopeKind: true,
      archetypeCategories: true,
      archetypeIds: true,
      activeBuildId: true,
      claimedById: true,
      claimedByAgentId: true,
      updatedAt: true,
      epic: { select: { epicId: true, status: true } },
      activeBuild: { select: { kind: true } },
      activities: {
        where: { kind: { in: INITIATIVE_READINESS_ACTIVITY_KINDS } },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 100,
        select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true },
      },
    },
  });

  const refIndex = await buildSpecPlanReferenceIndex();
  const candidates = items.map((i) => {
    const semanticEpic = i.epic?.epicId ?? null;
    const hasSpec =
      refIndex.specs.has(i.itemId) || (semanticEpic ? refIndex.specs.has(semanticEpic) : false);
    const hasPlan =
      refIndex.plans.has(i.itemId) || (semanticEpic ? refIndex.plans.has(semanticEpic) : false);
    const readiness = projectBacklogItemReadinessSummary({
      item: {
        id: i.itemId,
        itemId: i.itemId,
        status: i.status,
        type: i.type,
        source: i.source,
        workType: i.workType,
        scopeKind: i.scopeKind,
        archetypeCategories: i.archetypeCategories,
        archetypeIds: i.archetypeIds,
        activeBuildKind: i.activeBuild?.kind ?? null,
      },
      activities: (i.activities ?? []).map((activity) => ({ ...activity, gateKey: activity.gateKey ?? null })),
      hasSpec,
      hasPlan,
      evaluatedAt: new Date().toISOString(),
    });
    return {
      itemId: i.itemId,
      title: i.title,
      status: i.status,
      priority: i.priority,
      demandScore: i.demandScore,
      effortSize: i.effortSize,
      triageOutcome: i.triageOutcome,
      hasActiveBuild: i.activeBuildId != null,
      claimedById: i.claimedById,
      claimedByAgentId: i.claimedByAgentId,
      epicId: semanticEpic,
      epicStatus: i.epic?.status ?? null,
      hasSpec,
      hasPlan,
      implementationReadinessVerdict: readiness.decisions.implementation.verdict,
      updatedAt: i.updatedAt,
    };
  });

  const ranked = rankCandidates(candidates, {
    excludeItemIds,
    forAgentId,
    count,
    mode,
  });

  // BI-10C34BE1: design-candidate ranking rewards items with no spec. On an
  // install with no docs/superpowers tree every item scores as undesigned, so
  // the tool confidently recommends designing work that is already designed.
  // The recommendations still stand as a priority ordering; what cannot be
  // trusted is the "needs a design" part of the reason.
  const specPlanCaveat = specPlanCorpusCaveat(refIndex.corpus);
  const baseMessage = mode === "implementation-ready"
    ? `Recommending ${ranked.length} implementation-ready item(s).`
    : `Recommending ${ranked.length} design candidate(s).`;
  return {
    success: true,
    message: specPlanCaveat ? `${baseMessage} ${specPlanCaveat}` : baseMessage,
    data: { mode, recommendations: ranked, specPlanCorpus: refIndex.corpus },
  };
}

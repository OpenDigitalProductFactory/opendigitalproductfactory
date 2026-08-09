"use server";

import * as crypto from "crypto";
import { prisma, attributeBacklogPortfolio } from "@dpf/db";
import { auth } from "@/lib/auth";
import { requireCapability } from "@/lib/actions/shared/guards";
import {
  validateBacklogInput,
  validateEpicInput,
  BACKLOG_STATUS_VALUES,
  BACKLOG_WORK_TYPE_VALUES,
  BACKLOG_SOURCE_VALUES,
  BACKLOG_SCOPE_KIND_VALUES,
  initialDemandStageForInput,
  type BacklogItemInput,
  type BacklogStatus,
  type BacklogWorkType,
  type BacklogSource,
  type BacklogScopeKind,
  type EpicInput,
} from "@/lib/backlog";

async function requireManageBacklog(): Promise<void> {
  await requireCapability("manage_backlog");
}

async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function cleanStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

// ─── BacklogItem actions ──────────────────────────────────────────────────────

export async function createBacklogItem(input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const createData = {
    itemId:           `BI-${crypto.randomUUID()}`,
    title:            input.title.trim(),
    type:             input.type,
    workType:         input.workType,
    // Hand-filed BIs from the ops UI are human requests by definition.
    source:           input.source ?? "user-request",
    status:           input.status,
    priority:         input.priority ?? null,
    taxonomyNodeId:   input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    organizationId:   input.organizationId ?? null,
    productLineId:     input.productLineId ?? null,
    businessProductId: input.businessProductId ?? null,
    demandStage:       initialDemandStageForInput(input),
    epicId:           input.epicId ?? null,
    submittedById:    await getSessionUserId(),
    scopeKind:         input.scopeKind ?? null,
    archetypeCategories: cleanStringArray(input.archetypeCategories),
    archetypeIds:        cleanStringArray(input.archetypeIds),
    scopeRationale:      input.scopeRationale?.trim() || null,
    lifecycleTags:       cleanStringArray(input.lifecycleTags),
    ...(input.body !== undefined && { body: input.body.trim() || null }),
  };
  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.backlogItem.create({
      data: createData,
      select: { id: true, demandStage: true },
    });
    if (item.demandStage === "raw") {
      await tx.backlogItemActivity.create({
        data: {
          backlogItemId: item.id,
          kind: "demand_classified",
          summary: "New scoped product demand entered intake",
          payload: { from: "unclassified", to: "raw", deterministic: true },
          recordedById: createData.submittedById,
        },
      });
    }
    return item;
  });
  // BI-PORTPRIO-1: attribute the new item to its portfolio (product → taxonomy
  // node → epic precedence) so it groups/budgets/ranks per portfolio immediately.
  await attributeBacklogPortfolio(created.id);
}

export async function updateBacklogItem(id: string, input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.backlogItem.findUnique({
    where: { id },
    select: {
      status: true,
      scopeKind: true,
      archetypeCategories: true,
      archetypeIds: true,
      scopeRationale: true,
      lifecycleTags: true,
      organizationId: true,
      productLineId: true,
      businessProductId: true,
    },
  });
  const isNowDone = input.status === "done" || input.status === "deferred";
  const wasDone = existing?.status === "done" || existing?.status === "deferred";

  const updateData = {
    title:            input.title.trim(),
    type:             input.type,
    workType:         input.workType,
    ...(input.source !== undefined ? { source: input.source } : {}),
    status:           input.status,
    priority:         input.priority ?? null,
    taxonomyNodeId:   input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    organizationId:   input.organizationId ?? existing?.organizationId ?? null,
    productLineId:     input.productLineId ?? existing?.productLineId ?? null,
    businessProductId: input.businessProductId ?? existing?.businessProductId ?? null,
    epicId:           input.epicId ?? null,
    scopeKind:         input.scopeKind ?? existing?.scopeKind ?? null,
    archetypeCategories: input.archetypeCategories !== undefined
      ? cleanStringArray(input.archetypeCategories)
      : existing?.archetypeCategories ?? [],
    archetypeIds:        input.archetypeIds !== undefined
      ? cleanStringArray(input.archetypeIds)
      : existing?.archetypeIds ?? [],
    scopeRationale:      input.scopeRationale !== undefined
      ? input.scopeRationale.trim() || null
      : existing?.scopeRationale ?? null,
    lifecycleTags:       input.lifecycleTags !== undefined
      ? cleanStringArray(input.lifecycleTags)
      : existing?.lifecycleTags ?? [],
    ...(input.body !== undefined && { body: input.body.trim() || null }),
    ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
    ...(!isNowDone && wasDone ? { completedAt: null } : {}),
  };
  await prisma.backlogItem.update({ where: { id }, data: updateData });

  // Auto-complete epic when all its items are done/deferred
  if (isNowDone && !wasDone) {
    const epicId = input.epicId ?? (await prisma.backlogItem.findUnique({ where: { id }, select: { epicId: true } }))?.epicId;
    if (epicId) {
      const remaining = await prisma.backlogItem.count({
        where: { epicId, status: { notIn: ["done", "deferred"] } },
      });
      if (remaining === 0) {
        await prisma.epic.update({
          where: { id: epicId },
          data: { status: "done", completedAt: new Date() },
        });
      }
    }
  }
}

/**
 * Partial field update for a backlog item — only the supplied fields are written
 * and only those fields are validated. Unlike updateBacklogItem (which requires a
 * complete, fully-valid BacklogItemInput), this does NOT re-require untouched
 * fields, so a single-field edit (e.g. priority/status from the grid) succeeds
 * even on items whose other fields are incomplete (null workType, legacy items).
 * Mirrors the conditional-spread pattern of updateRiskAssessment. Preserves the
 * status side-effects (completedAt) and epic auto-completion of the full update.
 */
export type BacklogFieldPatch = {
  title?: string;
  status?: BacklogStatus;
  priority?: number | null;
  type?: "product" | "portfolio";
  workType?: BacklogWorkType;
  source?: BacklogSource;
  body?: string | null;
  scopeKind?: BacklogScopeKind | null;
  archetypeCategories?: string[];
  archetypeIds?: string[];
  scopeRationale?: string | null;
  lifecycleTags?: string[];
};

export async function updateBacklogItemFields(id: string, patch: BacklogFieldPatch): Promise<void> {
  await requireManageBacklog();

  const existing = await prisma.backlogItem.findUnique({
    where: { id },
    select: { status: true, type: true, digitalProductId: true, epicId: true },
  });
  if (!existing) throw new Error("Backlog item not found");

  // Validate ONLY the fields actually being changed.
  if (patch.title !== undefined && !patch.title.trim()) throw new Error("Title is required");
  if (patch.status !== undefined && !BACKLOG_STATUS_VALUES.includes(patch.status)) {
    throw new Error(`Invalid status: ${patch.status}`);
  }
  if (patch.workType !== undefined && !BACKLOG_WORK_TYPE_VALUES.includes(patch.workType)) {
    throw new Error(`Invalid work type: ${patch.workType}`);
  }
  if (patch.source !== undefined && !BACKLOG_SOURCE_VALUES.includes(patch.source)) {
    throw new Error(`Invalid source: ${patch.source}`);
  }
  if (patch.scopeKind !== undefined && patch.scopeKind !== null && !BACKLOG_SCOPE_KIND_VALUES.includes(patch.scopeKind)) {
    throw new Error(`Invalid scope kind: ${patch.scopeKind}`);
  }
  if (patch.type !== undefined && patch.type !== "product" && patch.type !== "portfolio") {
    throw new Error(`Invalid type: ${patch.type}`);
  }
  // Only enforce the product->digitalProduct rule when the caller is switching to
  // product without one — never block edits to items that are already product.
  if (patch.type === "product" && !existing.digitalProductId) {
    throw new Error("A digital product is required for product-type items");
  }

  const nextStatus = patch.status ?? existing.status;
  const isNowDone = nextStatus === "done" || nextStatus === "deferred";
  const wasDone = existing.status === "done" || existing.status === "deferred";

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = patch.title.trim();
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.workType !== undefined) data.workType = patch.workType;
  if (patch.source !== undefined) data.source = patch.source;
  if (patch.body !== undefined) data.body = patch.body && patch.body.trim() ? patch.body.trim() : null;
  if (patch.scopeKind !== undefined) data.scopeKind = patch.scopeKind;
  if (patch.archetypeCategories !== undefined) data.archetypeCategories = cleanStringArray(patch.archetypeCategories);
  if (patch.archetypeIds !== undefined) data.archetypeIds = cleanStringArray(patch.archetypeIds);
  if (patch.scopeRationale !== undefined) data.scopeRationale = patch.scopeRationale && patch.scopeRationale.trim() ? patch.scopeRationale.trim() : null;
  if (patch.lifecycleTags !== undefined) data.lifecycleTags = cleanStringArray(patch.lifecycleTags);
  if (patch.status !== undefined) {
    if (isNowDone && !wasDone) data.completedAt = new Date();
    if (!isNowDone && wasDone) data.completedAt = null;
  }

  if (Object.keys(data).length === 0) return;
  await prisma.backlogItem.update({ where: { id }, data });

  // Auto-complete the epic when this status change makes all its items done/deferred.
  if (patch.status !== undefined && isNowDone && !wasDone && existing.epicId) {
    const remaining = await prisma.backlogItem.count({
      where: { epicId: existing.epicId, status: { notIn: ["done", "deferred"] } },
    });
    if (remaining === 0) {
      await prisma.epic.update({
        where: { id: existing.epicId },
        data: { status: "done", completedAt: new Date() },
      });
    }
  }
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await requireManageBacklog();
  const { assertBacklogItemGovernanceDeletable } = await import("@/lib/backlog/initiative-governance-deletion");
  await assertBacklogItemGovernanceDeletable(id);
  await prisma.backlogItem.delete({ where: { id } });
}

// ─── Upstream escalation ──────────────────────────────────────────────────────

export type EscalateResult =
  | { status: "created"; issueNumber: number; url: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export async function escalateBacklogItemUpstream(id: string): Promise<EscalateResult> {
  await requireManageBacklog();
  const { escalateToUpstreamIssue } = await import("@/lib/integrate/issue-bridge");
  return escalateToUpstreamIssue({ kind: "backlog", id });
}

export async function escalateEpicUpstream(id: string): Promise<EscalateResult> {
  await requireManageBacklog();
  const { escalateToUpstreamIssue } = await import("@/lib/integrate/issue-bridge");
  return escalateToUpstreamIssue({ kind: "epic", id });
}

// ─── Epic actions ─────────────────────────────────────────────────────────────

export type EpicOverlap = { epicId: string; title: string; status: string; score: number };
export type CreateEpicResult = { created: true; similarEpics: EpicOverlap[] };

export async function createEpic(input: EpicInput): Promise<CreateEpicResult> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);

  // Check for similar existing epics before creating
  let similarEpics: EpicOverlap[] = [];
  try {
    const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
    const searchText = `${input.title} ${input.description ?? ""}`.trim();
    const hits = await searchPlatformKnowledge({ query: searchText, entityType: "epic", limit: 5 });
    if (hits.length > 0) {
      const epicRows = await prisma.epic.findMany({
        where: { epicId: { in: hits.map((h) => h.entityId) } },
        select: { epicId: true, title: true, status: true },
      });
      const rowMap = new Map(epicRows.map((r) => [r.epicId, r]));
      similarEpics = hits
        .filter((h) => rowMap.has(h.entityId))
        .map((h) => {
          const row = rowMap.get(h.entityId)!;
          return { epicId: row.epicId, title: row.title, status: row.status, score: h.score };
        });
    }
  } catch {
    // Semantic search unavailable — proceed without overlap check
  }

  await prisma.$transaction(async (tx) => {
    const epic = await tx.epic.create({
      data: {
        epicId:        `EP-${crypto.randomUUID()}`,
        title:         input.title.trim(),
        status:        input.status,
        submittedById: await getSessionUserId(),
        ...(input.description !== undefined && {
          description: input.description.trim() || null,
        }),
      },
    });
    if (input.portfolioIds.length > 0) {
      await tx.epicPortfolio.createMany({
        data: input.portfolioIds.map((portfolioId) => ({
          epicId:      epic.id,
          portfolioId,
        })),
      });
    }

    // Index in platform knowledge for semantic search
    import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
      storePlatformKnowledge({
        entityId: epic.epicId,
        entityType: "epic",
        title: input.title,
        content: input.description ?? "",
      })
    ).catch(() => {});
  });

  return { created: true, similarEpics };
}

export async function updateEpic(id: string, input: EpicInput): Promise<void> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.epic.findUnique({ where: { id }, select: { status: true } });
  const isNowDone = input.status === "done";
  const wasDone = existing?.status === "done";

  await prisma.$transaction(async (tx) => {
    await tx.epic.update({
      where: { id },
      data: {
        title:  input.title.trim(),
        status: input.status,
        ...(input.description !== undefined && {
          description: input.description.trim() || null,
        }),
        ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
        ...(!isNowDone && wasDone ? { completedAt: null } : {}),
      },
    });
    await tx.epicPortfolio.deleteMany({ where: { epicId: id } });
    if (input.portfolioIds.length > 0) {
      await tx.epicPortfolio.createMany({
        data: input.portfolioIds.map((portfolioId) => ({ epicId: id, portfolioId })),
      });
    }
  });
}

export async function deleteEpic(id: string): Promise<void> {
  await requireManageBacklog();
  const { assertEpicGovernanceDeletable } = await import("@/lib/backlog/initiative-governance-deletion");
  await assertEpicGovernanceDeletable(id);
  await prisma.epic.delete({ where: { id } });
  // onDelete: SetNull in schema handles nullifying BacklogItem.epicId automatically
}

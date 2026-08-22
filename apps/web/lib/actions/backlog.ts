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
import {
  CLEAR_DEFERRAL_PROJECTION,
  normalizeDeferralInput,
} from "@/lib/backlog/deferral-contract";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";

async function requireManageBacklog(): Promise<void> {
  await requireCapability("manage_backlog");
}

async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

async function currentDeferralOwnerRecordId(): Promise<string> {
  const session = await auth();
  if (!session?.user || session.user.type !== "admin") {
    throw new Error("An authenticated employee is required to own a deferral");
  }
  const principalId = await resolvePrincipalRecordIdForSessionIdentity({
    type: "admin",
    id: session.user.id,
  });
  if (!principalId) throw new Error("Your canonical Principal identity is not ready");
  return principalId;
}

async function deferralProjectionForInput(input: BacklogItemInput) {
  if (input.status !== "deferred") return CLEAR_DEFERRAL_PROJECTION;
  const ownerPrincipalId = await currentDeferralOwnerRecordId();
  const normalized = normalizeDeferralInput({
    reason: input.deferReason,
    trigger: input.deferTrigger,
    reviewAt: input.deferReviewAt,
    ownerPrincipalId,
  });
  if (!normalized.ok) throw new Error(normalized.message);
  return { ...normalized.value, deferredAt: new Date() };
}

function cleanStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

async function attemptEpicAutoClose(epicId: string, userId: string): Promise<void> {
  const remaining = await prisma.backlogItem.count({
    where: { epicId, status: { notIn: ["done", "retired"] } },
  });
  if (remaining !== 0) return;
  const epic = await prisma.epic.findUnique({ where: { id: epicId }, select: { epicId: true, status: true } });
  if (!epic || epic.status === "done") return;
  const { completeEpicTransition } = await import(
    "@/lib/backlog/initiative-readiness/epic-terminal-transition"
  );
  await completeEpicTransition({
    epicId: epic.epicId,
    expectedStatus: epic.status,
    actor: { actorType: "human", actorRef: userId, humanContextRef: userId, agentContextRef: null },
    authority: {
      organizationId: null,
      actionKey: "auto_close_epic",
      objectRef: epic.epicId,
      rationale: { capability: "manage_backlog", source: "backlog-child-terminal" },
      authoritySnapshot: {
        decision: "allow",
        effectiveHumanCapability: "manage_backlog",
        effectiveAgentGrant: "human-session",
        tokenScope: "organization",
        organizationId: "platform",
        actionKey: "auto_close_epic",
        policyVersion: "coworker-authority.v1",
      },
    },
  });
}

// ─── BacklogItem actions ──────────────────────────────────────────────────────

export async function createBacklogItem(input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);
  if (input.status === "retired") {
    throw new Error("A new backlog item cannot start retired; use the governed retirement action for an existing item");
  }
  if (input.status === "done") {
    throw new Error("Create the item as open, then request governed completion with objective and delivery evidence");
  }

  const deferralProjection = await deferralProjectionForInput(input);
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
    ...deferralProjection,
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
      deferredAt: true,
    },
  });
  if (input.status === "retired" && existing?.status !== "retired") {
    throw new Error("Use the governed retirement action so the retirement rationale is audited");
  }
  const isNowDone = input.status === "done" || input.status === "retired";
  const wasDone = existing?.status === "done" || existing?.status === "retired";
  const deferralProjection = input.status === "deferred"
    ? {
        ...(await deferralProjectionForInput(input)),
        deferredAt: existing?.status === "deferred" && existing.deferredAt
          ? existing.deferredAt
          : new Date(),
      }
    : CLEAR_DEFERRAL_PROJECTION;

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
    ...deferralProjection,
  };
  const actorUserId = await getSessionUserId();
  if (!actorUserId) throw new Error("An authenticated user is required to update backlog work");
  if (input.status === "done" && !wasDone) {
    const { completeBacklogItemTransition } = await import(
      "@/lib/backlog/initiative-readiness/backlog-terminal-transition"
    );
    const organizationId = input.organizationId ?? existing?.organizationId ?? "platform";
    const terminal = await completeBacklogItemTransition({
      itemId: id,
      expectedStatus: existing?.status ?? "open",
      resolution: "Completed through the backlog editor by an authorized operator.",
      completionEvidence: undefined,
      additionalData: updateData,
      actor: {
        actorType: "human",
        actorRef: actorUserId,
        humanContextRef: actorUserId,
        agentContextRef: null,
      },
      authority: {
        organizationId: existing?.organizationId ?? null,
        actionKey: "update_backlog_item",
        objectRef: id,
        rationale: { capability: "manage_backlog", source: "server-action" },
        authoritySnapshot: {
          decision: "allow",
          effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "human-session",
          tokenScope: "organization",
          organizationId,
          actionKey: "update_backlog_item",
          policyVersion: "coworker-authority.v1",
        },
      },
    });
    if (!terminal.ok) {
      const codes = [...terminal.decision.blockers, ...terminal.decision.unmet].map((entry) => entry.code);
      throw new Error(`This item is not ready to complete: ${codes.join(", ")}.`);
    }
    if (input.epicId) await attemptEpicAutoClose(input.epicId, actorUserId);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.backlogItem.update({ where: { id }, data: updateData });
    if (existing?.status !== input.status || input.status === "deferred") {
      await tx.backlogItemActivity.create({
        data: {
          backlogItemId: id,
          kind: existing?.status === "deferred" && input.status === "deferred"
            ? "deferral_review"
            : "status_change",
          summary: `${existing?.status ?? "unknown"} → ${input.status}`,
          payload: input.status === "deferred"
            ? {
                from: existing?.status ?? null,
                to: input.status,
                deferral: {
                  reason: input.deferReason,
                  trigger: input.deferTrigger,
                  reviewAt: input.deferReviewAt,
                  ownerPrincipalId: deferralProjection.deferOwnerPrincipalId,
                },
              }
            : { from: existing?.status ?? null, to: input.status },
          recordedById: actorUserId,
        },
      });
    }
  });

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
    select: { status: true, type: true, digitalProductId: true, epicId: true, organizationId: true },
  });
  if (!existing) throw new Error("Backlog item not found");

  // Validate ONLY the fields actually being changed.
  if (patch.title !== undefined && !patch.title.trim()) throw new Error("Title is required");
  if (patch.status !== undefined && !BACKLOG_STATUS_VALUES.includes(patch.status)) {
    throw new Error(`Invalid status: ${patch.status}`);
  }
  if (patch.status === "deferred") {
    throw new Error("Use the backlog editor to provide reason, trigger, owner, and review date for a deferral");
  }
  if (patch.status === "retired" && existing.status !== "retired") {
    throw new Error("Use the governed retirement action so the retirement rationale is audited");
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
  const isNowDone = nextStatus === "done" || nextStatus === "retired";
  const wasDone = existing.status === "done" || existing.status === "retired";

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
    Object.assign(data, CLEAR_DEFERRAL_PROJECTION);
  }

  if (Object.keys(data).length === 0) return;
  if (patch.status === "done" && !wasDone) {
    const actorUserId = await getSessionUserId();
    if (!actorUserId) throw new Error("An authenticated user is required to update backlog work");
    const { completeBacklogItemTransition } = await import(
      "@/lib/backlog/initiative-readiness/backlog-terminal-transition"
    );
    const organizationId = existing.organizationId ?? "platform";
    const terminal = await completeBacklogItemTransition({
      itemId: id,
      expectedStatus: existing.status,
      resolution: "Completed through the backlog grid by an authorized operator.",
      completionEvidence: undefined,
      additionalData: data,
      actor: { actorType: "human", actorRef: actorUserId, humanContextRef: actorUserId, agentContextRef: null },
      authority: {
        organizationId: existing.organizationId,
        actionKey: "update_backlog_item_fields",
        objectRef: id,
        rationale: { capability: "manage_backlog", source: "server-action" },
        authoritySnapshot: {
          decision: "allow",
          effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "human-session",
          tokenScope: "organization",
          organizationId,
          actionKey: "update_backlog_item_fields",
          policyVersion: "coworker-authority.v1",
        },
      },
    });
    if (!terminal.ok) {
      const codes = [...terminal.decision.blockers, ...terminal.decision.unmet].map((entry) => entry.code);
      throw new Error(`This item is not ready to complete: ${codes.join(", ")}.`);
    }
    if (existing.epicId) await attemptEpicAutoClose(existing.epicId, actorUserId);
    return;
  }
  await prisma.backlogItem.update({ where: { id }, data });

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
  const { escalateToUpstreamIssue } = await import("@/lib/build/issue-bridge");
  return escalateToUpstreamIssue({ kind: "backlog", id });
}

export async function escalateEpicUpstream(id: string): Promise<EscalateResult> {
  await requireManageBacklog();
  const { escalateToUpstreamIssue } = await import("@/lib/build/issue-bridge");
  return escalateToUpstreamIssue({ kind: "epic", id });
}

// ─── Epic actions ─────────────────────────────────────────────────────────────

export type EpicOverlap = { epicId: string; title: string; status: string; score: number };
export type CreateEpicResult = { created: true; similarEpics: EpicOverlap[] };

export async function createEpic(input: EpicInput): Promise<CreateEpicResult> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);
  if (input.status === "done") {
    throw new Error("Create the Epic as open, converge its canonical backlog receipt anchor, then request governed completion");
  }

  // Check for similar existing epics before creating
  let similarEpics: EpicOverlap[] = [];
  try {
    const { searchPlatformKnowledge } = await import("@/lib/semantic-memory");
    const searchText = `${input.title} ${input.description ?? ""}`.trim();
    const search = await searchPlatformKnowledge({ query: searchText, entityType: "epic", limit: 5 });
    // BI-339C441F: an unavailable search is not "no similar epics". Leave the
    // overlap list empty either way, but do not let a retrieval outage read as
    // a clean duplicate check.
    if (search.status === "unavailable") {
      console.warn(
        `[backlog] epic overlap check skipped — semantic search unavailable (${search.reason}).`,
      );
    }
    const hits = search.results;
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

  const existing = await prisma.epic.findUnique({ where: { id }, select: { epicId: true, status: true } });
  if (!existing) throw new Error("Epic not found");
  const isNowDone = input.status === "done";
  const wasDone = existing.status === "done";

  const epicData = {
    title: input.title.trim(),
    ...(input.description !== undefined && { description: input.description.trim() || null }),
  };
  if (isNowDone && !wasDone) {
    const actorUserId = await getSessionUserId();
    if (!actorUserId) throw new Error("An authenticated user is required to complete an Epic");
    const { completeEpicTransition } = await import(
      "@/lib/backlog/initiative-readiness/epic-terminal-transition"
    );
    const terminal = await completeEpicTransition({
      epicId: existing.epicId,
      expectedStatus: existing.status,
      additionalData: epicData,
      actor: { actorType: "human", actorRef: actorUserId, humanContextRef: actorUserId, agentContextRef: null },
      authority: {
        organizationId: null,
        actionKey: "update_epic",
        objectRef: existing.epicId,
        rationale: { capability: "manage_backlog", source: "server-action" },
        authoritySnapshot: {
          decision: "allow",
          effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "human-session",
          tokenScope: "organization",
          organizationId: "platform",
          actionKey: "update_epic",
          policyVersion: "coworker-authority.v1",
        },
      },
    });
    if (!terminal.ok) {
      throw new Error(`This Epic is not ready to complete: ${terminal.code}.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (!(isNowDone && !wasDone)) {
      await tx.epic.update({
        where: { id },
        data: {
          ...epicData,
          status: input.status,
          ...(!isNowDone && wasDone ? { completedAt: null } : {}),
        },
      });
    }
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

"use server";

import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { CanvasState } from "@/lib/ea-types";
import {
  validateEaLifecycle,
  validateEaRelationship,
  checkEaDqRules,
  type DqViolation,
} from "@dpf/db/ea-validation";
import {
  syncEaElement,
  syncEaRelationship,
  deleteEaElement as neo4jDeleteEaElement,
  deleteEaRelationship as neo4jDeleteEaRelationship,
} from "@dpf/db/neo4j-sync";

const REFERENCE_COVERAGE_STATUSES = [
  "implemented",
  "partial",
  "planned",
  "not_started",
  "out_of_mvp",
] as const;

const REFERENCE_PROPOSAL_STATUSES = [
  "proposed",
  "reviewed",
  "approved",
  "rejected",
  "promoted",
] as const;

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function requireManageEaModel(): Promise<{ userId: string | null }> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_ea_model")
  ) {
    throw new Error("Unauthorized");
  }
  return { userId: user.id ?? null };
}

type ReferenceCoverageStatus = (typeof REFERENCE_COVERAGE_STATUSES)[number];
type ReferenceProposalStatus = (typeof REFERENCE_PROPOSAL_STATUSES)[number];

function assertCoverageStatus(value: string): asserts value is ReferenceCoverageStatus {
  if (!REFERENCE_COVERAGE_STATUSES.includes(value as ReferenceCoverageStatus)) {
    throw new Error("Invalid coverage status");
  }
}

function assertProposalStatus(value: string): asserts value is ReferenceProposalStatus {
  if (!REFERENCE_PROPOSAL_STATUSES.includes(value as ReferenceProposalStatus)) {
    throw new Error("Invalid proposal status");
  }
}

// ─── Element actions ──────────────────────────────────────────────────────────

type CreateEaElementInput = {
  elementTypeId: string;
  name: string;
  description?: string;
  lifecycleStage: string;
  lifecycleStatus: string;
  properties?: Record<string, unknown>;
  digitalProductId?: string;
  infraCiKey?: string;
  portfolioId?: string;
  taxonomyNodeId?: string;
};

export async function createEaElement(input: CreateEaElementInput): Promise<void> {
  const { userId } = await requireManageEaModel();

  const validation = await validateEaLifecycle(input.elementTypeId, input.lifecycleStage, input.lifecycleStatus);
  if (!validation.valid) throw new Error(validation.reason);

  const element = await prisma.eaElement.create({
    data: {
      elementTypeId:   input.elementTypeId,
      name:            input.name,
      description:     input.description ?? null,
      lifecycleStage:  input.lifecycleStage,
      lifecycleStatus: input.lifecycleStatus,
      properties:      (input.properties ?? {}) as Prisma.InputJsonValue,
      createdById:     userId,
      digitalProductId: input.digitalProductId ?? null,
      infraCiKey:       input.infraCiKey ?? null,
      portfolioId:      input.portfolioId ?? null,
      taxonomyNodeId:   input.taxonomyNodeId ?? null,
    },
  });

  // Fire-and-forget Neo4j sync
  const et = await prisma.eaElementType.findUnique({
    where: { id: input.elementTypeId },
    select: { neoLabel: true, slug: true, notation: { select: { slug: true } } },
  });
  const portfolio = input.portfolioId
    ? await prisma.portfolio.findUnique({ where: { id: input.portfolioId }, select: { slug: true } })
    : null;

  if (et) {
    void Promise.resolve(syncEaElement({
      id:               element.id,
      neoLabel:         et.neoLabel,
      notationSlug:     et.notation.slug,
      elementTypeSlug:  et.slug,
      name:             element.name,
      lifecycleStage:   element.lifecycleStage,
      lifecycleStatus:  element.lifecycleStatus,
      digitalProductId: element.digitalProductId,
      infraCiKey:       element.infraCiKey,
      portfolioSlug:    portfolio?.slug ?? null,
      taxonomyNodeId:   element.taxonomyNodeId,
    })).catch(console.error);
  }
}

type UpdateEaElementInput = Partial<Omit<CreateEaElementInput, "elementTypeId">>;

export async function updateEaElement(id: string, input: UpdateEaElementInput): Promise<void> {
  await requireManageEaModel();

  const existing = await prisma.eaElement.findUnique({
    where: { id },
    select: { elementTypeId: true, lifecycleStage: true, lifecycleStatus: true },
  });
  if (!existing) throw new Error("Element not found");

  const newStage  = input.lifecycleStage  ?? existing.lifecycleStage;
  const newStatus = input.lifecycleStatus ?? existing.lifecycleStatus;

  if (input.lifecycleStage !== undefined || input.lifecycleStatus !== undefined) {
    const validation = await validateEaLifecycle(existing.elementTypeId, newStage, newStatus);
    if (!validation.valid) throw new Error(validation.reason);
  }

  const element = await prisma.eaElement.update({
    where: { id },
    data: {
      ...(input.name            !== undefined && { name: input.name }),
      ...(input.description     !== undefined && { description: input.description }),
      ...(input.lifecycleStage  !== undefined && { lifecycleStage: input.lifecycleStage }),
      ...(input.lifecycleStatus !== undefined && { lifecycleStatus: input.lifecycleStatus }),
      ...(input.properties      !== undefined && { properties: input.properties as Prisma.InputJsonValue }),
      ...(input.digitalProductId !== undefined && { digitalProductId: input.digitalProductId }),
      ...(input.infraCiKey       !== undefined && { infraCiKey: input.infraCiKey }),
      ...(input.portfolioId      !== undefined && { portfolioId: input.portfolioId }),
      ...(input.taxonomyNodeId   !== undefined && { taxonomyNodeId: input.taxonomyNodeId }),
    },
    select: {
      id:               true,
      name:             true,
      lifecycleStage:   true,
      lifecycleStatus:  true,
      digitalProductId: true,
      infraCiKey:       true,
      portfolioId:      true,
      taxonomyNodeId:   true,
      elementType: { select: { neoLabel: true, slug: true, notation: { select: { slug: true } } } },
      portfolio:   { select: { slug: true } },
    },
  });

  void Promise.resolve(syncEaElement({
    id:               element.id,
    neoLabel:         element.elementType.neoLabel,
    notationSlug:     element.elementType.notation.slug,
    elementTypeSlug:  element.elementType.slug,
    name:             element.name,
    lifecycleStage:   element.lifecycleStage,
    lifecycleStatus:  element.lifecycleStatus,
    digitalProductId: element.digitalProductId,
    infraCiKey:       element.infraCiKey,
    portfolioSlug:    element.portfolio?.slug ?? null,
    taxonomyNodeId:   element.taxonomyNodeId,
  })).catch(console.error);
}

export async function deleteEaElement(id: string): Promise<void> {
  await requireManageEaModel();
  await prisma.eaElement.delete({ where: { id } });
  void Promise.resolve(neo4jDeleteEaElement(id)).catch(console.error);
}

// ─── Relationship actions ─────────────────────────────────────────────────────

type CreateEaRelationshipInput = {
  fromElementId: string;
  toElementId: string;
  relationshipTypeId: string;
  properties?: Record<string, unknown>;
  viewId?: string;
};

export async function createEaRelationship(
  input: CreateEaRelationshipInput,
): Promise<{ error: string } | void> {
  const { userId } = await requireManageEaModel();

  const rt = await prisma.eaRelationshipType.findUnique({
    where: { id: input.relationshipTypeId },
    select: { neoType: true, slug: true, notation: { select: { slug: true } } },
  });
  if (!rt) throw new Error("Relationship type not found");

  // Validate against viewpoint if a view context is provided
  if (input.viewId) {
    const view = await prisma.eaView.findUnique({
      where: { id: input.viewId },
      select: { viewpoint: { select: { allowedRelTypeSlugs: true } } },
    });
    if (view?.viewpoint && !view.viewpoint.allowedRelTypeSlugs.includes(rt.slug)) {
      return { error: "RelationshipTypeNotAllowedByViewpoint" };
    }
  }

  const validation = await validateEaRelationship(
    input.fromElementId,
    input.toElementId,
    input.relationshipTypeId,
  );
  if (!validation.valid) throw new Error(validation.reason);

  const rel = await prisma.eaRelationship.create({
    data: {
      fromElementId:      input.fromElementId,
      toElementId:        input.toElementId,
      relationshipTypeId: input.relationshipTypeId,
      notationSlug:       rt.notation.slug,
      properties:         (input.properties ?? {}) as Prisma.InputJsonValue,
      createdById:        userId,
    },
  });

  void Promise.resolve(syncEaRelationship({
    id:                   rel.id,
    fromElementId:        rel.fromElementId,
    toElementId:          rel.toElementId,
    neoType:              rt.neoType,
    notationSlug:         rt.notation.slug,
    relationshipTypeSlug: rt.slug,
  })).catch(console.error);
}

export async function deleteEaRelationship(id: string): Promise<void> {
  await requireManageEaModel();
  await prisma.eaRelationship.delete({ where: { id } });
  void Promise.resolve(neo4jDeleteEaRelationship(id)).catch(console.error);
}

// ─── Lifecycle advance ────────────────────────────────────────────────────────

export async function advanceEaLifecycle(
  id: string,
  targetStage: string,
): Promise<{ advanced: boolean; canProceed: boolean; violations: DqViolation[] }> {
  await requireManageEaModel();

  const violations = await checkEaDqRules(id, targetStage);
  const hasErrors  = violations.some((v) => v.severity === "error");
  const hasWarns   = violations.some((v) => v.severity === "warn");

  if (hasErrors) {
    return { advanced: false, canProceed: false, violations };
  }

  // Structurally validate the target stage/status before fetching the element
  // We need the elementTypeId — fetch it first
  const elementForValidation = await prisma.eaElement.findUnique({
    where: { id },
    select: { elementTypeId: true, lifecycleStatus: true },
  });
  if (!elementForValidation) throw new Error("Element not found");

  const stageValidation = await validateEaLifecycle(
    elementForValidation.elementTypeId,
    targetStage,
    elementForValidation.lifecycleStatus,
  );
  if (!stageValidation.valid) throw new Error(stageValidation.reason);

  const element = await prisma.eaElement.findUnique({
    where: { id },
    select: {
      elementType: {
        select: {
          validLifecycleStatuses: true,
          neoLabel: true,
          slug: true,
          notation: { select: { slug: true } },
        },
      },
      digitalProductId: true,
      infraCiKey: true,
      portfolioId: true,
      taxonomyNodeId: true,
    },
  });
  if (!element) throw new Error("Element not found");

  const validStatuses = element.elementType.validLifecycleStatuses;
  const newStatus = validStatuses.includes("draft")
    ? "draft"
    : (validStatuses[0] ?? "draft");

  const updated = await prisma.eaElement.update({
    where: { id },
    data: { lifecycleStage: targetStage, lifecycleStatus: newStatus },
    include: { portfolio: { select: { slug: true } } },
  });

  void Promise.resolve(syncEaElement({
    id:               updated.id,
    neoLabel:         element.elementType.neoLabel,
    notationSlug:     element.elementType.notation.slug,
    elementTypeSlug:  element.elementType.slug,
    name:             updated.name,
    lifecycleStage:   updated.lifecycleStage,
    lifecycleStatus:  updated.lifecycleStatus,
    digitalProductId: element.digitalProductId,
    infraCiKey:       element.infraCiKey,
    portfolioSlug:    updated.portfolio?.slug ?? null,
    taxonomyNodeId:   element.taxonomyNodeId,
  })).catch(console.error);

  return { advanced: true, canProceed: true, violations: hasWarns ? violations : [] };
}

// ─── View actions ─────────────────────────────────────────────────────────────

type CreateEaViewInput = {
  notationId: string;
  name: string;
  description?: string;
  layoutType: string;
  scopeType: string;
  scopeRef?: string;
  viewpointId?: string;
};

export async function createEaView(input: CreateEaViewInput): Promise<void> {
  const { userId } = await requireManageEaModel();
  await prisma.eaView.create({
    data: {
      notationId:  input.notationId,
      name:        input.name,
      description: input.description ?? null,
      layoutType:  input.layoutType,
      scopeType:   input.scopeType,
      scopeRef:    input.scopeRef ?? null,
      viewpointId: input.viewpointId ?? null,
      createdById: userId,
    },
  });
}

export async function updateEaView(id: string, input: Partial<CreateEaViewInput>): Promise<void> {
  await requireManageEaModel();
  await prisma.eaView.update({
    where: { id },
    data: {
      ...(input.name        !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.layoutType  !== undefined && { layoutType: input.layoutType }),
      ...(input.scopeType   !== undefined && { scopeType: input.scopeType }),
      ...(input.scopeRef    !== undefined && { scopeRef: input.scopeRef }),
    },
  });
}

// ─── View element actions ─────────────────────────────────────────────────────

type UpdateReferenceAssessmentInput = {
  assessmentId: string;
  coverageStatus: ReferenceCoverageStatus;
  rationale?: string;
  evidenceSummary?: string;
  mvpIncluded?: boolean;
  confidence?: string;
};

export async function updateReferenceAssessment(input: UpdateReferenceAssessmentInput) {
  await requireManageEaModel();
  assertCoverageStatus(input.coverageStatus);

  return prisma.eaReferenceAssessment.update({
    where: { id: input.assessmentId },
    data: {
      coverageStatus: input.coverageStatus,
      ...(input.rationale !== undefined && { rationale: input.rationale }),
      ...(input.evidenceSummary !== undefined && { evidenceSummary: input.evidenceSummary }),
      ...(input.mvpIncluded !== undefined && { mvpIncluded: input.mvpIncluded }),
      ...(input.confidence !== undefined && { confidence: input.confidence }),
    },
    select: {
      id: true,
      coverageStatus: true,
      rationale: true,
      mvpIncluded: true,
      confidence: true,
    },
  });
}

type ReviewReferenceProposalInput = {
  proposalId: string;
  status: ReferenceProposalStatus;
  reviewNotes?: string;
};

export async function reviewReferenceProposal(input: ReviewReferenceProposalInput) {
  await requireManageEaModel();
  assertProposalStatus(input.status);

  return prisma.eaReferenceProposal.update({
    where: { id: input.proposalId },
    data: {
      status: input.status,
      ...(input.reviewNotes !== undefined && { reviewNotes: input.reviewNotes }),
    },
    select: {
      id: true,
      status: true,
      reviewNotes: true,
    },
  });
}

export async function addElementToView(input: {
  viewId: string;
  mode: "new" | "reference" | "propose";
  elementTypeId?: string;
  name?: string;
  elementId?: string;
  initialX: number;
  initialY: number;
}): Promise<{ viewElement: { id: string; mode: string; elementId: string } } | { error: string }> {
  const { userId } = await requireManageEaModel();

  // Fetch view + viewpoint
  const view = await prisma.eaView.findUnique({
    where: { id: input.viewId },
    select: {
      viewpoint: { select: { allowedElementTypeSlugs: true, allowedRelTypeSlugs: true } },
      canvasState: true,
    },
  });
  if (!view) return { error: "ViewNotFound" };

  try {
    let resolvedElementId: string;

    if (input.mode === "new") {
      if (!input.elementTypeId || !input.name) return { error: "MissingRequiredFields" };

      // Validate element type against viewpoint
      const et = await prisma.eaElementType.findUnique({
        where: { id: input.elementTypeId },
        select: { slug: true, neoLabel: true, notation: { select: { slug: true } } },
      });
      if (!et) return { error: "ElementTypeNotFound" };

      if (
        view.viewpoint &&
        !view.viewpoint.allowedElementTypeSlugs.includes(et.slug)
      ) {
        return { error: "ElementTypeNotAllowedByViewpoint" };
      }

      const validation = await validateEaLifecycle(input.elementTypeId, "plan", "draft");
      if (!validation.valid) return { error: validation.reason ?? "InvalidLifecycle" };

      const element = await prisma.eaElement.create({
        data: {
          elementTypeId:   input.elementTypeId,
          name:            input.name,
          lifecycleStage:  "plan",
          lifecycleStatus: "draft",
          properties:      {} as Prisma.InputJsonValue,
          createdById:     userId,
        },
      });
      resolvedElementId = element.id;
    } else {
      if (!input.elementId) return { error: "MissingRequiredFields" };

      // Validate element type against viewpoint
      const element = await prisma.eaElement.findUnique({
        where: { id: input.elementId },
        select: { elementType: { select: { slug: true } } },
      });
      if (!element) return { error: "ElementNotFound" };

      if (
        view.viewpoint &&
        !view.viewpoint.allowedElementTypeSlugs.includes(element.elementType.slug)
      ) {
        return { error: "ElementTypeNotAllowedByViewpoint" };
      }

      resolvedElementId = input.elementId;
    }

    // Wrap viewElement create + canvasState update in a transaction for atomicity.
    const viewElement = await prisma.$transaction(async (tx) => {
      const ve = await tx.eaViewElement.create({
        data: {
          viewId:    input.viewId,
          elementId: resolvedElementId,
          mode:      input.mode,
        },
        select: { id: true, mode: true, elementId: true },
      });

      // Write initial position into canvasState in the same transaction
      const existing = (view.canvasState as CanvasState | null) ?? {
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: {},
      };
      const updated: CanvasState = {
        ...existing,
        nodes: { ...existing.nodes, [ve.id]: { x: input.initialX, y: input.initialY } },
      };
      await tx.eaView.update({
        where: { id: input.viewId },
        data: { canvasState: updated as unknown as Prisma.InputJsonValue },
      });

      return ve;
    });

    return { viewElement };
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === "P2002") return { error: "ElementAlreadyOnView" };
    throw err;
  }
}

type StructuredMutationRecord = {
  id: string;
  elementId: string;
  parentViewElementId: string | null;
  orderIndex: number | null;
};

type StructuredConformanceWarning = {
  issueType: "missing_required_children" | "detached_child" | "duplicate_order_index";
  severity: "warn" | "error";
  message: string;
  viewElementIds: string[];
  details?: Record<string, unknown>;
};

function sortStructuredMutationRecords(records: StructuredMutationRecord[]): StructuredMutationRecord[] {
  return [...records].sort((left, right) => {
    const leftOrder = left.orderIndex ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.orderIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
  });
}

function resequenceStructuredChildren(
  records: StructuredMutationRecord[],
  parentViewElementId: string,
): StructuredMutationRecord[] {
  return sortStructuredMutationRecords(records).map((record, index) => ({
    ...record,
    parentViewElementId,
    orderIndex: index,
  }));
}

function insertStructuredChild(
  records: StructuredMutationRecord[],
  movingRecord: StructuredMutationRecord,
  parentViewElementId: string,
  targetOrderIndex: number | null,
): StructuredMutationRecord[] {
  const ordered = sortStructuredMutationRecords(records.filter((record) => record.id !== movingRecord.id));
  const insertionIndex = targetOrderIndex == null
    ? ordered.length
    : Math.max(0, Math.min(targetOrderIndex, ordered.length));

  ordered.splice(insertionIndex, 0, {
    ...movingRecord,
    parentViewElementId,
  });

  return ordered.map((record, index) => ({
    ...record,
    parentViewElementId,
    orderIndex: index,
  }));
}

function deriveStructuredWarnings(input: {
  parentViewElementId: string;
  minChildren: number;
  children: StructuredMutationRecord[];
}): StructuredConformanceWarning[] {
  const warnings: StructuredConformanceWarning[] = [];
  const attachedChildren = input.children.filter(
    (child) => child.parentViewElementId === input.parentViewElementId,
  );
  const detachedChildren = input.children.filter(
    (child) => child.parentViewElementId !== input.parentViewElementId,
  );

  if (attachedChildren.length < input.minChildren) {
    warnings.push({
      issueType: "missing_required_children",
      severity: "warn",
      message: `Expected at least ${input.minChildren} structured child elements`,
      viewElementIds: [input.parentViewElementId],
      details: {
        minChildren: input.minChildren,
        attachedChildCount: attachedChildren.length,
      },
    });
  }

  for (const child of detachedChildren) {
    warnings.push({
      issueType: "detached_child",
      severity: "warn",
      message: "Structured child is detached from its expected parent",
      viewElementIds: [child.id],
      details: {
        expectedParentViewElementId: input.parentViewElementId,
        actualParentViewElementId: child.parentViewElementId,
      },
    });
  }

  const siblingsByOrderIndex = new Map<number, string[]>();
  for (const child of attachedChildren) {
    if (child.orderIndex == null) continue;
    const siblings = siblingsByOrderIndex.get(child.orderIndex) ?? [];
    siblings.push(child.id);
    siblingsByOrderIndex.set(child.orderIndex, siblings);
  }

  for (const [orderIndex, siblings] of siblingsByOrderIndex) {
    if (siblings.length < 2) continue;
    warnings.push({
      issueType: "duplicate_order_index",
      severity: "warn",
      message: `Multiple structured children share order index ${orderIndex}`,
      viewElementIds: siblings,
      details: { orderIndex },
    });
  }

  return warnings;
}

export async function moveStructuredViewElement(input: {
  viewElementId: string;
  targetParentViewElementId: string | null;
  targetOrderIndex: number | null;
}): Promise<{ error?: string }> {
  await requireManageEaModel();

  const existing = await prisma.eaViewElement.findUnique({
    where: { id: input.viewElementId },
    select: {
      id: true,
      viewId: true,
      elementId: true,
      parentViewElementId: true,
      orderIndex: true,
      element: { select: { id: true } },
    },
  });

  if (!existing) return { error: "ViewElementNotFound" };

  const oldParentViewElementId = existing.parentViewElementId;
  const targetParentViewElementId = input.targetParentViewElementId;

  await prisma.$transaction(async (tx) => {
    const affectedParentViewElementIds = Array.from(
      new Set([oldParentViewElementId, targetParentViewElementId].filter((value): value is string => value != null)),
    );

    const siblingCandidates = affectedParentViewElementIds.length > 0
      ? await tx.eaViewElement.findMany({
          where: {
            viewId: existing.viewId,
            OR: affectedParentViewElementIds.map((parentViewElementId) => ({ parentViewElementId })),
          },
          select: {
            id: true,
            elementId: true,
            parentViewElementId: true,
            orderIndex: true,
          },
        })
      : [];

    const recordsById = new Map<string, StructuredMutationRecord>();
    for (const record of siblingCandidates) {
      recordsById.set(record.id, record);
    }
    recordsById.set(existing.id, {
      id: existing.id,
      elementId: existing.elementId,
      parentViewElementId: existing.parentViewElementId,
      orderIndex: existing.orderIndex,
    });

    const movingRecord = recordsById.get(existing.id)!;
    const oldSiblings = oldParentViewElementId == null
      ? []
      : sortStructuredMutationRecords(
          Array.from(recordsById.values()).filter((record) => record.parentViewElementId === oldParentViewElementId),
        );
    const targetSiblings = targetParentViewElementId == null
      ? []
      : oldParentViewElementId === targetParentViewElementId
        ? oldSiblings
        : sortStructuredMutationRecords(
            Array.from(recordsById.values()).filter((record) => record.parentViewElementId === targetParentViewElementId),
          );

    const finalRecordsById = new Map<string, StructuredMutationRecord>();
    const warningInputs = new Map<string, StructuredMutationRecord[]>();

    if (oldParentViewElementId && oldParentViewElementId === targetParentViewElementId) {
      const resequenced = insertStructuredChild(
        oldSiblings,
        movingRecord,
        oldParentViewElementId,
        input.targetOrderIndex,
      );
      warningInputs.set(oldParentViewElementId, resequenced);
      for (const record of resequenced) {
        finalRecordsById.set(record.id, record);
      }
    } else {
      const movingFinalRecord: StructuredMutationRecord = {
        ...movingRecord,
        parentViewElementId: targetParentViewElementId,
        orderIndex: targetParentViewElementId == null ? null : movingRecord.orderIndex,
      };

      if (oldParentViewElementId) {
        const resequencedOldSiblings = resequenceStructuredChildren(
          oldSiblings.filter((record) => record.id !== movingRecord.id),
          oldParentViewElementId,
        );
        warningInputs.set(oldParentViewElementId, [...resequencedOldSiblings, movingFinalRecord]);
        for (const record of resequencedOldSiblings) {
          finalRecordsById.set(record.id, record);
        }
      }

      if (targetParentViewElementId) {
        const resequencedTargetSiblings = insertStructuredChild(
          targetSiblings,
          movingRecord,
          targetParentViewElementId,
          input.targetOrderIndex,
        );
        warningInputs.set(targetParentViewElementId, resequencedTargetSiblings);
        for (const record of resequencedTargetSiblings) {
          finalRecordsById.set(record.id, record);
        }
      } else {
        finalRecordsById.set(movingRecord.id, movingFinalRecord);
      }
    }

    if (affectedParentViewElementIds.length > 0) {
      await tx.eaViewElement.updateMany({
        where: {
          viewId: existing.viewId,
          OR: affectedParentViewElementIds.map((parentViewElementId) => ({ parentViewElementId })),
        },
        data: { orderIndex: null },
      });
    }

    for (const record of finalRecordsById.values()) {
      await tx.eaViewElement.update({
        where: { id: record.id },
        data: {
          parentViewElementId: record.parentViewElementId,
          orderIndex: record.orderIndex,
        },
      });
    }

    await tx.eaConformanceIssue.deleteMany({
      where: {
        viewId: existing.viewId,
        issueType: {
          in: ["missing_required_children", "detached_child", "duplicate_order_index"],
        },
      },
    });

    const warnings = Array.from(warningInputs.entries()).flatMap(([parentViewElementId, children]) =>
      deriveStructuredWarnings({
        parentViewElementId,
        minChildren: 1,
        children,
      }),
    );

    if (warnings.length > 0) {
      await tx.eaConformanceIssue.createMany({
        data: warnings.map((warning) => {
          const issueViewElementId = warning.viewElementIds[0] ?? null;
          return {
            viewId: existing.viewId,
            elementId: issueViewElementId ? recordsById.get(issueViewElementId)?.elementId ?? null : null,
            issueType: warning.issueType,
            severity: warning.severity,
            message: warning.message,
            status: "open",
            detailsJson: (warning.details ?? {}) as Prisma.InputJsonValue,
          };
        }),
      });
    }
  });

  return {};
}

export async function removeElementFromView(input: {
  viewElementId: string;
}): Promise<{ error?: string }> {
  await requireManageEaModel();
  try {
    await prisma.eaViewElement.delete({ where: { id: input.viewElementId } });
    return {};
  } catch (err) {
    const prismaErr = err as { code?: string };
    if (prismaErr.code === "P2025") return { error: "ViewElementNotFound" };
    throw err;
  }
}

export async function updateProposedProperties(input: {
  viewElementId: string;
  properties: Record<string, unknown>;
}): Promise<{ error?: string }> {
  await requireManageEaModel();

  const ve = await prisma.eaViewElement.findUnique({
    where: { id: input.viewElementId },
    select: { mode: true },
  });
  if (!ve) return { error: "ViewElementNotFound" };
  if (ve.mode === "reference") return { error: "CannotEditReference" };

  await prisma.eaViewElement.update({
    where: { id: input.viewElementId },
    data: { proposedProperties: input.properties as Prisma.InputJsonValue },
  });
  return {};
}

export async function saveCanvasState(input: {
  viewId: string;
  canvasState: CanvasState;
}): Promise<void> {
  await requireManageEaModel();
  await prisma.eaView.update({
    where: { id: input.viewId },
    data: { canvasState: input.canvasState as unknown as Prisma.InputJsonValue },
  });
}

export async function getDefaultRelTypeIdForView(
  viewId: string,
  fromElementId?: string,
  toElementId?: string,
): Promise<string | null> {
  await requireManageEaModel();
  const view = await prisma.eaView.findUnique({
    where: { id: viewId },
    select: {
      notation: { select: { id: true } },
      viewpoint: { select: { allowedRelTypeSlugs: true } },
    },
  });
  if (!view?.viewpoint?.allowedRelTypeSlugs.length) return null;
  const allowedSlugs = view.viewpoint.allowedRelTypeSlugs;
  const notationId = view.notation.id;

  // If element IDs are supplied, find the first allowed rel type that has a rule for this pair.
  if (fromElementId && toElementId) {
    const [fromEl, toEl] = await Promise.all([
      prisma.eaElement.findUnique({ where: { id: fromElementId }, select: { elementTypeId: true } }),
      prisma.eaElement.findUnique({ where: { id: toElementId },   select: { elementTypeId: true } }),
    ]);
    if (fromEl && toEl) {
      for (const slug of allowedSlugs) {
        const rt = await prisma.eaRelationshipType.findUnique({
          where: { notationId_slug: { notationId, slug } },
          select: { id: true },
        });
        if (!rt) continue;
        const rule = await prisma.eaRelationshipRule.findFirst({
          where: {
            fromElementTypeId:  fromEl.elementTypeId,
            toElementTypeId:    toEl.elementTypeId,
            relationshipTypeId: rt.id,
          },
          select: { id: true },
        });
        if (rule) return rt.id;
      }
      // No specific rule found — fall back to associated_with if it's allowed
      const fallbackSlug = allowedSlugs.includes("associated_with") ? "associated_with" : allowedSlugs[0];
      if (!fallbackSlug) return null;
      const fallback = await prisma.eaRelationshipType.findUnique({
        where: { notationId_slug: { notationId, slug: fallbackSlug } },
        select: { id: true },
      });
      return fallback?.id ?? null;
    }
  }

  // No element context — return first allowed rel type.
  const slug = allowedSlugs[0];
  if (!slug) return null;
  const rt = await prisma.eaRelationshipType.findUnique({
    where: { notationId_slug: { notationId, slug } },
    select: { id: true },
  });
  return rt?.id ?? null;
}

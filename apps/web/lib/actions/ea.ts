"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
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
      properties:      input.properties ?? {},
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
      ...(input.properties      !== undefined && { properties: input.properties }),
      ...(input.digitalProductId !== undefined && { digitalProductId: input.digitalProductId }),
      ...(input.infraCiKey       !== undefined && { infraCiKey: input.infraCiKey }),
      ...(input.portfolioId      !== undefined && { portfolioId: input.portfolioId }),
      ...(input.taxonomyNodeId   !== undefined && { taxonomyNodeId: input.taxonomyNodeId }),
    },
    include: {
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
};

export async function createEaRelationship(input: CreateEaRelationshipInput): Promise<void> {
  const { userId } = await requireManageEaModel();

  const validation = await validateEaRelationship(
    input.fromElementId,
    input.toElementId,
    input.relationshipTypeId,
  );
  if (!validation.valid) throw new Error(validation.reason);

  const rt = await prisma.eaRelationshipType.findUnique({
    where: { id: input.relationshipTypeId },
    select: { neoType: true, slug: true, notation: { select: { slug: true } } },
  });
  if (!rt) throw new Error("Relationship type not found");

  const rel = await prisma.eaRelationship.create({
    data: {
      fromElementId:      input.fromElementId,
      toElementId:        input.toElementId,
      relationshipTypeId: input.relationshipTypeId,
      notationSlug:       rt.notation.slug,
      properties:         input.properties ?? {},
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
};

export async function createEaView(input: CreateEaViewInput): Promise<void> {
  await requireManageEaModel();
  const session = await auth();
  await prisma.eaView.create({
    data: {
      notationId:  input.notationId,
      name:        input.name,
      description: input.description ?? null,
      layoutType:  input.layoutType,
      scopeType:   input.scopeType,
      scopeRef:    input.scopeRef ?? null,
      createdById: session?.user?.id ?? null,
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

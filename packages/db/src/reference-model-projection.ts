import type { Prisma } from "../generated/client/client";
import { prisma } from "./client";

export type ReferenceProjectionType = "value_stream_view";

type ProjectionResult = {
  viewId: string;
  createdView: boolean;
  createdElements: number;
  updatedElements: number;
  createdViewElements: number;
  updatedViewElements: number;
};

type ReferenceProjectionElement = {
  id: string;
  parentId: string | null;
  kind: string;
  slug: string;
  name: string;
  description: string | null;
  properties: Record<string, unknown> | null;
};

function buildProjectionScopeRef(referenceModelSlug: string, projectionType: ReferenceProjectionType): string {
  return `${referenceModelSlug}:${projectionType}`;
}

function buildProjectionMetadata(input: {
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
  layoutRole: "stream_band" | "stream_stage";
  referenceElementSlug: string;
}): Prisma.InputJsonValue {
  return {
    projection: {
      layoutRole: input.layoutRole,
      referenceModelSlug: input.referenceModelSlug,
      projectionType: input.projectionType,
      referenceElementSlug: input.referenceElementSlug,
    },
  } satisfies Prisma.InputJsonValue;
}

function readSequenceNumber(element: ReferenceProjectionElement): number | null {
  const value = element.properties?.sequenceNumber;
  return typeof value === "number" ? value : null;
}

async function resolveProjectionElement(input: {
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
  referenceElement: ReferenceProjectionElement;
  elementTypeId: string;
}) {
  const existing = await prisma.eaElement.findFirst({
    where: {
      elementTypeId: input.elementTypeId,
      AND: [
        {
          properties: {
            path: ["projection", "referenceModelSlug"],
            equals: input.referenceModelSlug,
          },
        },
        {
          properties: {
            path: ["projection", "projectionType"],
            equals: input.projectionType,
          },
        },
        {
          properties: {
            path: ["projection", "referenceElementSlug"],
            equals: input.referenceElement.slug,
          },
        },
      ],
    },
    select: { id: true },
  });

  const properties = buildProjectionMetadata({
    layoutRole: input.referenceElement.kind === "value_stream" ? "stream_band" : "stream_stage",
    referenceModelSlug: input.referenceModelSlug,
    projectionType: input.projectionType,
    referenceElementSlug: input.referenceElement.slug,
  });

  if (existing) {
    const updated = await prisma.eaElement.update({
      where: { id: existing.id },
      data: {
        name: input.referenceElement.name,
        description: input.referenceElement.description,
        properties,
        lifecycleStage: "design",
        lifecycleStatus: "draft",
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.eaElement.create({
    data: {
      elementTypeId: input.elementTypeId,
      name: input.referenceElement.name,
      description: input.referenceElement.description,
      properties,
      lifecycleStage: "design",
      lifecycleStatus: "draft",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function resolveProjectionView(input: {
  notationId: string;
  viewpointId: string | null;
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
}) {
  const scopeRef = buildProjectionScopeRef(input.referenceModelSlug, input.projectionType);
  const existing = await prisma.eaView.findFirst({
    where: {
      scopeType: "reference_model_projection",
      scopeRef,
    },
    select: { id: true },
  });

  const data = {
    notationId: input.notationId,
    name: `${input.referenceModelSlug} value streams`,
    description: `Reference model projection for ${input.referenceModelSlug} (${input.projectionType})`,
    layoutType: "graph",
    scopeType: "reference_model_projection",
    scopeRef,
    viewpointId: input.viewpointId,
    status: "draft",
  };

  if (existing) {
    const updated = await prisma.eaView.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.eaView.create({
    data,
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function resolveViewElement(input: {
  viewId: string;
  elementId: string;
  parentViewElementId: string | null;
  orderIndex: number | null;
}) {
  const existing = await prisma.eaViewElement.findUnique({
    where: {
      viewId_elementId: {
        viewId: input.viewId,
        elementId: input.elementId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    const updated = await prisma.eaViewElement.update({
      where: { id: existing.id },
      data: {
        parentViewElementId: input.parentViewElementId,
        orderIndex: input.orderIndex,
        mode: "reference",
      },
      select: { id: true },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.eaViewElement.create({
    data: {
      viewId: input.viewId,
      elementId: input.elementId,
      parentViewElementId: input.parentViewElementId,
      orderIndex: input.orderIndex,
      mode: "reference",
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

export async function projectReferenceModel(input: {
  referenceModelSlug: string;
  projectionType: ReferenceProjectionType;
}): Promise<ProjectionResult> {
  if (input.projectionType !== "value_stream_view") {
    throw new Error(`Unsupported projection type: ${input.projectionType}`);
  }

  const referenceModel = await prisma.eaReferenceModel.findUnique({
    where: { slug: input.referenceModelSlug },
    select: { id: true, slug: true, name: true },
  });
  if (!referenceModel) throw new Error("Reference model not found");

  const referenceElements = (await prisma.eaReferenceModelElement.findMany({
    where: {
      modelId: referenceModel.id,
      kind: { in: ["value_stream", "value_stream_stage"] },
    },
    select: {
      id: true,
      parentId: true,
      kind: true,
      slug: true,
      name: true,
      description: true,
      properties: true,
    },
    orderBy: [{ name: "asc" }],
  })) as ReferenceProjectionElement[];

  const streams = referenceElements.filter((element) => element.kind === "value_stream");
  const stages = referenceElements.filter((element) => element.kind === "value_stream_stage");
  if (streams.length === 0) {
    return { viewId: "", createdView: false, createdElements: 0, updatedElements: 0, createdViewElements: 0, updatedViewElements: 0 };
  }

  const notation = await prisma.eaNotation.findUnique({
    where: { slug: "archimate4" },
    select: { id: true },
  });
  if (!notation) throw new Error("ArchiMate 4 notation is not seeded");

  const viewpoint = await prisma.viewpointDefinition.findUnique({
    where: { name: "Business Architecture" },
    select: { id: true },
  });

  const [valueStreamType, valueStreamStageType, flowRelationshipType] = await Promise.all([
    prisma.eaElementType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "value_stream" } },
      select: { id: true },
    }),
    prisma.eaElementType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "value_stream_stage" } },
      select: { id: true },
    }),
    prisma.eaRelationshipType.findUnique({
      where: { notationId_slug: { notationId: notation.id, slug: "flows_to" } },
      select: { id: true },
    }),
  ]);

  if (!valueStreamType || !valueStreamStageType) {
    throw new Error("Required ArchiMate value stream types are not seeded");
  }

  const projectionView = await resolveProjectionView({
    notationId: notation.id,
    viewpointId: viewpoint?.id ?? null,
    referenceModelSlug: input.referenceModelSlug,
    projectionType: input.projectionType,
  });

  let createdElements = 0;
  let updatedElements = 0;
  let createdViewElements = 0;
  let updatedViewElements = 0;

  const viewElementIdByReferenceId = new Map<string, string>();
  const elementIdByReferenceId = new Map<string, string>();

  for (const stream of streams) {
    const projectedStream = await resolveProjectionElement({
      referenceModelSlug: input.referenceModelSlug,
      projectionType: input.projectionType,
      referenceElement: stream,
      elementTypeId: valueStreamType.id,
    });
    if (projectedStream.created) createdElements += 1;
    else updatedElements += 1;
    elementIdByReferenceId.set(stream.id, projectedStream.id);

    const projectedStreamViewElement = await resolveViewElement({
      viewId: projectionView.id,
      elementId: projectedStream.id,
      parentViewElementId: null,
      orderIndex: null,
    });
    if (projectedStreamViewElement.created) createdViewElements += 1;
    else updatedViewElements += 1;
    viewElementIdByReferenceId.set(stream.id, projectedStreamViewElement.id);

    const childStages = stages
      .filter((stage) => stage.parentId === stream.id)
      .map((stage, index) => ({
        stage,
        sequenceNumber: readSequenceNumber(stage) ?? index,
        orderIndex: index,
      }));

    const sortedForFlow = [...childStages].sort((left, right) => {
      if (left.sequenceNumber !== right.sequenceNumber) return left.sequenceNumber - right.sequenceNumber;
      return left.stage.slug.localeCompare(right.stage.slug);
    });

    sortedForFlow.forEach((child, index) => {
      child.orderIndex = index;
    });

    for (const child of childStages) {
      const projectedStage = await resolveProjectionElement({
        referenceModelSlug: input.referenceModelSlug,
        projectionType: input.projectionType,
        referenceElement: child.stage,
        elementTypeId: valueStreamStageType.id,
      });
      if (projectedStage.created) createdElements += 1;
      else updatedElements += 1;
      elementIdByReferenceId.set(child.stage.id, projectedStage.id);

      const projectedStageViewElement = await resolveViewElement({
        viewId: projectionView.id,
        elementId: projectedStage.id,
        parentViewElementId: projectedStreamViewElement.id,
        orderIndex: child.orderIndex,
      });
      if (projectedStageViewElement.created) createdViewElements += 1;
      else updatedViewElements += 1;
      viewElementIdByReferenceId.set(child.stage.id, projectedStageViewElement.id);
    }

    if (flowRelationshipType) {
      for (let index = 0; index < sortedForFlow.length - 1; index += 1) {
        const fromStage = sortedForFlow[index];
        const toStage = sortedForFlow[index + 1];
        if (!fromStage || !toStage) continue;

        const fromElementId = elementIdByReferenceId.get(fromStage.stage.id);
        const toElementId = elementIdByReferenceId.get(toStage.stage.id);
        if (!fromElementId || !toElementId) continue;

        const existingRelationship = await prisma.eaRelationship.findFirst({
          where: {
            fromElementId,
            toElementId,
            relationshipTypeId: flowRelationshipType.id,
          },
          select: { id: true },
        });

        if (!existingRelationship) {
          await prisma.eaRelationship.create({
            data: {
              fromElementId,
              toElementId,
              relationshipTypeId: flowRelationshipType.id,
              notationSlug: "archimate4",
              properties: {
                projection: {
                  referenceModelSlug: input.referenceModelSlug,
                  projectionType: input.projectionType,
                },
              } satisfies Prisma.InputJsonValue,
            },
            select: { id: true },
          });
        }
      }
    }
  }

  await prisma.eaConformanceIssue.deleteMany({
    where: {
      viewId: projectionView.id,
      issueType: { in: ["detached_child", "missing_required_children", "duplicate_order_index"] },
    },
  });

  return {
    viewId: projectionView.id,
    createdView: projectionView.created,
    createdElements,
    updatedElements,
    createdViewElements,
    updatedViewElements,
  };
}

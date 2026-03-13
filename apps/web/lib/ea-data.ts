import { cache } from "react";
import { prisma } from "@dpf/db";
import type { SerializedViewElement, SerializedEdge, CanvasState } from "./ea-types";
import type {
  CoverageStatus,
  ReferenceModelPortfolioRollup,
  ReferenceModelPortfolioRollupRow,
  ReferenceModelSummary,
} from "./reference-model-types";

export const getEaView = cache(async (id: string) => {
  const view = await prisma.eaView.findUnique({
    where: { id },
    select: {
      id: true,
      notationId: true,
      name: true,
      description: true,
      layoutType: true,
      scopeType: true,
      scopeRef: true,
      status: true,
      canvasState: true,
      viewpoint: {
        select: {
          id: true,
          name: true,
          allowedElementTypeSlugs: true,
          allowedRelTypeSlugs: true,
        },
      },
      viewElements: {
        select: {
          id: true,
          elementId: true,
          mode: true,
          proposedProperties: true,
          element: {
            select: {
              name: true,
              description: true,
              lifecycleStage: true,
              lifecycleStatus: true,
              elementType: {
                select: { slug: true, name: true, neoLabel: true },
              },
            },
          },
        },
      },
    },
  });

  if (!view) return null;

  const elementIds = view.viewElements.map((ve) => ve.elementId);
  // Map elementId → viewElementId for edge source/target resolution.
  // React Flow node IDs are EaViewElement.id, not EaElement.id.
  const elementIdToViewElementId = new Map(
    view.viewElements.map((ve) => [ve.elementId, ve.id])
  );

  // Load edges where both endpoints are on this view
  const relationships = elementIds.length > 1
    ? await prisma.eaRelationship.findMany({
        where: {
          fromElementId: { in: elementIds },
          toElementId: { in: elementIds },
        },
        select: {
          id: true,
          fromElementId: true,
          toElementId: true,
          relationshipType: { select: { slug: true, name: true, neoType: true } },
        },
      })
    : [];

  const serializedElements: SerializedViewElement[] = view.viewElements.map((ve) => ({
    viewElementId: ve.id,
    elementId: ve.elementId,
    mode: ve.mode as SerializedViewElement["mode"],
    proposedProperties: ve.proposedProperties as Record<string, unknown> | null,
    elementType: ve.element.elementType,
    element: {
      name: ve.element.name,
      description: ve.element.description,
      lifecycleStage: ve.element.lifecycleStage,
      lifecycleStatus: ve.element.lifecycleStatus,
    },
  }));

  const serializedEdges: SerializedEdge[] = relationships
    .filter(
      (r) =>
        elementIdToViewElementId.has(r.fromElementId) &&
        elementIdToViewElementId.has(r.toElementId)
    )
    .map((r) => ({
      id: r.id,
      fromElementId: r.fromElementId,
      toElementId: r.toElementId,
      // Use viewElementId as React Flow source/target — node IDs are EaViewElement.id
      fromViewElementId: elementIdToViewElementId.get(r.fromElementId)!,
      toViewElementId: elementIdToViewElementId.get(r.toElementId)!,
      relationshipType: r.relationshipType,
    }));

  return {
    id: view.id,
    notationId: view.notationId,
    name: view.name,
    description: view.description,
    layoutType: view.layoutType,
    status: view.status,
    canvasState: view.canvasState as CanvasState | null,
    viewpoint: view.viewpoint,
    elements: serializedElements,
    edges: serializedEdges,
  };
});

export const getViewpoints = cache(async () => {
  return prisma.viewpointDefinition.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
});

export const getRelationshipTypeId = cache(async (notationId: string, slug: string) => {
  const rt = await prisma.eaRelationshipType.findUnique({
    where: { notationId_slug: { notationId, slug } },
    select: { id: true },
  });
  return rt?.id ?? null;
});

export const getReferenceModelsSummary = cache(async (): Promise<ReferenceModelSummary[]> => {
  const models = await prisma.eaReferenceModel.findMany({
    orderBy: [{ name: "asc" }, { version: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      version: true,
      status: true,
      _count: {
        select: {
          elements: true,
          assessments: true,
          proposals: true,
        },
      },
    },
  });

  return models.map((model) => ({
    id: model.id,
    slug: model.slug,
    name: model.name,
    version: model.version,
    status: model.status,
    criteriaCount: model._count.elements,
    assessmentCount: model._count.assessments,
    proposalCount: model._count.proposals,
  }));
});

const COVERAGE_STATUSES: CoverageStatus[] = [
  "implemented",
  "partial",
  "planned",
  "not_started",
  "out_of_mvp",
];

function emptyCoverageCounts(): Record<CoverageStatus, number> {
  return {
    implemented: 0,
    partial: 0,
    planned: 0,
    not_started: 0,
    out_of_mvp: 0,
  };
}

export const getReferenceModelPortfolioRollup = cache(
  async (slug: string): Promise<ReferenceModelPortfolioRollup> => {
    const model = await prisma.eaReferenceModel.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, version: true },
    });
    if (!model) throw new Error("Reference model not found");

    const assessments = await prisma.eaReferenceAssessment.findMany({
      where: {
        modelId: model.id,
        modelElement: { kind: "criterion" },
        scope: { scopeType: "portfolio" },
      },
      orderBy: [{ scope: { scopeRef: "asc" } }],
      select: {
        coverageStatus: true,
        mvpIncluded: true,
        scope: {
          select: { scopeRef: true, name: true },
        },
        modelElement: {
          select: { kind: true },
        },
      },
    });

    const rowsByScope = new Map<string, ReferenceModelPortfolioRollupRow>();

    for (const assessment of assessments) {
      const key = assessment.scope.scopeRef;
      let row = rowsByScope.get(key);
      if (!row) {
        row = {
          scopeRef: assessment.scope.scopeRef,
          scopeName: assessment.scope.name,
          counts: emptyCoverageCounts(),
          mvpIncludedCount: 0,
          outOfMvpCount: 0,
        };
        rowsByScope.set(key, row);
      }

      const status = COVERAGE_STATUSES.includes(assessment.coverageStatus as CoverageStatus)
        ? (assessment.coverageStatus as CoverageStatus)
        : "not_started";
      row.counts[status] += 1;
      if (assessment.mvpIncluded) row.mvpIncludedCount += 1;
      else row.outOfMvpCount += 1;
    }

    return {
      model,
      rows: Array.from(rowsByScope.values()),
    };
  }
);

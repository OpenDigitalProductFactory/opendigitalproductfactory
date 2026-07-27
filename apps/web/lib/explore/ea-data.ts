import { cache } from "react";
import { prisma } from "@dpf/db";
import { shapeIt4itCoverageHeatmap } from "./it4it-coverage-view";
import {
  shapeIt4itParticipationGrid,
  type It4itParticipationGrid,
  type It4itStageParticipationRow,
} from "./it4it-participation-view";
import type { SerializedViewElement, SerializedEdge, CanvasState } from "./ea-types";
import { loadArchitectureDrillthroughForView } from "@/lib/ea/architecture-drillthrough-data";
import type {
  CoverageStatus,
  It4itCoverageHeatmap,
  ReferenceModelDetail,
  ReferenceModelElementNode,
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
      notation: { select: { slug: true } },
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
          parentViewElementId: true,
          orderIndex: true,
          proposedProperties: true,
          element: {
            select: {
              name: true,
              description: true,
              lifecycleStage: true,
              lifecycleStatus: true,
              properties: true,
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
  const elementTypeSlugs = Array.from(new Set(view.viewElements.map((ve) => ve.element.elementType.slug)));
  // Map elementId → viewElementId for edge source/target resolution.
  // React Flow node IDs are EaViewElement.id, not EaElement.id.
  const elementIdToViewElementId = new Map(
    view.viewElements.map((ve) => [ve.elementId, ve.id])
  );

  const [structureRules, conformanceIssues] = await Promise.all([
    elementTypeSlugs.length > 0
      ? prisma.eaStructureRule.findMany({
          where: {
            notationId: view.notationId,
            parentElementType: { slug: { in: elementTypeSlugs } },
          },
          select: {
            rendererHint: true,
            parentElementType: { select: { slug: true } },
          },
        })
      : Promise.resolve([]),
    elementIds.length > 0
      ? prisma.eaConformanceIssue.findMany({
          where: {
            viewId: view.id,
            status: "open",
            elementId: { in: elementIds },
          },
          select: { elementId: true },
        })
      : Promise.resolve([]),
  ]);

  const rendererHintByElementTypeSlug = new Map<string, string | null>(
    structureRules.map((rule) => [rule.parentElementType.slug, rule.rendererHint]),
  );
  const issueCountByElementId = new Map<string, number>();
  for (const issue of conformanceIssues) {
    if (!issue.elementId) continue;
    issueCountByElementId.set(issue.elementId, (issueCountByElementId.get(issue.elementId) ?? 0) + 1);
  }

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

  const baseSerializedElements: SerializedViewElement[] = view.viewElements.map((ve) => ({
    viewElementId: ve.id,
    elementId: ve.elementId,
    mode: ve.mode as SerializedViewElement["mode"],
    parentViewElementId: ve.parentViewElementId,
    orderIndex: ve.orderIndex,
    rendererHint: rendererHintByElementTypeSlug.get(ve.element.elementType.slug) ?? null,
    layoutRole:
      ((ve.element.properties as Record<string, unknown> | null)?.projection as
        | { layoutRole?: SerializedViewElement["layoutRole"] }
        | undefined)?.layoutRole ?? null,
    structureIssueCount: issueCountByElementId.get(ve.elementId) ?? 0,
    proposedProperties: ve.proposedProperties as Record<string, unknown> | null,
    elementType: ve.element.elementType,
    element: {
      name: ve.element.name,
      description: ve.element.description,
      lifecycleStage: ve.element.lifecycleStage,
      lifecycleStatus: ve.element.lifecycleStatus,
      properties: (ve.element.properties as Record<string, unknown> | null) ?? null,
    },
  }));
  const drillthrough = await loadArchitectureDrillthroughForView({
    viewId: view.id,
    elements: baseSerializedElements.map((entry) => ({
      id: entry.elementId,
      name: entry.element.name,
      notationSlug: view.notation.slug,
      properties: entry.element.properties ?? {},
    })),
  });
  const serializedElements = baseSerializedElements.map((entry) => ({
    ...entry,
    drillthrough: drillthrough[entry.elementId] ?? null,
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
    notationSlug: view.notation.slug,
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

export const getReferenceModelElements = cache(
  async (slug: string): Promise<ReferenceModelElementNode[]> => {
    const model = await prisma.eaReferenceModel.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!model) return [];

    const rows = await prisma.eaReferenceModelElement.findMany({
      where: { modelId: model.id },
      select: {
        id: true,
        parentId: true,
        kind: true,
        name: true,
        description: true,
        properties: true,
      },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      kind: r.kind,
      name: r.name,
      description: r.description,
      properties: (r.properties as Record<string, unknown>) ?? {},
    }));
  }
);

export const getReferenceModelDetail = cache(
  async (slug: string): Promise<ReferenceModelDetail> => {
    const model = await prisma.eaReferenceModel.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        version: true,
        status: true,
        authorityType: true,
        description: true,
        artifacts: {
          orderBy: [{ authority: "asc" }, { path: "asc" }],
          select: {
            id: true,
            path: true,
            kind: true,
            authority: true,
          },
        },
        proposals: {
          orderBy: [{ createdAt: "desc" }],
          select: {
            id: true,
            proposalType: true,
            status: true,
            proposedByType: true,
            reviewNotes: true,
          },
        },
      },
    });

    if (!model) throw new Error("Reference model not found");

    const valueStreamProjection = await prisma.eaView.findFirst({
      where: {
        scopeType: "reference_model_projection",
        scopeRef: `${slug}:value_stream_view`,
      },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      ...model,
      valueStreamProjection: {
        viewId: valueStreamProjection?.id ?? null,
        viewName: valueStreamProjection?.name ?? null,
        isProjected: valueStreamProjection != null,
      },
    };
  }
);

// ── IT4IT functional-coverage heatmap (EP-IT4IT-CONFORMANCE) ──────────────────
// Cached query over the platform-scope EaReferenceAssessment rows written by the
// it4it-coverage steward projection; the grouping + rollup math lives in the pure,
// unit-tested it4it-coverage-view module. Renders an empty state until the first steward
// pass has written assessments.
export const getIt4itCoverageHeatmap = cache(
  async (slug: string): Promise<It4itCoverageHeatmap> => {
    const model = await prisma.eaReferenceModel.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });
    if (!model) throw new Error("Reference model not found");

    const [elements, assessments] = await Promise.all([
      prisma.eaReferenceModelElement.findMany({
        where: {
          modelId: model.id,
          kind: { in: ["capability_group", "function", "component", "criterion"] },
        },
        select: { id: true, parentId: true, kind: true, name: true, normativeClass: true, sourceReference: true },
      }),
      prisma.eaReferenceAssessment.findMany({
        where: { modelId: model.id, scope: { scopeType: "platform" } },
        select: { modelElementId: true, coverageStatus: true, confidence: true, evidenceSummary: true, updatedAt: true },
      }),
    ]);

    return shapeIt4itCoverageHeatmap({ slug, modelName: model.name, elements, assessments });
  },
);

// ── IT4IT participation grid (EP-IT4IT-CONFORMANCE, BI-D51A5A4A) ──────────────
// Cross-tabs functional components against the 7 value streams using the seeded FC
// Participation Matrix (participationByColumn on each value-stream stage), tinted by each
// component's coverage status. Grouping/collapse math lives in it4it-participation-view.
export const getIt4itParticipationGrid = cache(
  async (slug: string): Promise<It4itParticipationGrid> => {
    const heatmap = await getIt4itCoverageHeatmap(slug);
    const components = heatmap.groups.flatMap((g) => g.components);

    const model = await prisma.eaReferenceModel.findUnique({ where: { slug }, select: { id: true } });
    if (!model) return { hasData: false, streams: [], groups: [] };

    const elements = await prisma.eaReferenceModelElement.findMany({
      where: { modelId: model.id, kind: { in: ["value_stream", "value_stream_stage"] } },
      select: { id: true, kind: true, name: true, parentId: true, properties: true },
    });

    const streamNameById = new Map<string, string>();
    for (const e of elements) if (e.kind === "value_stream") streamNameById.set(e.id, e.name);
    const valueStreams = elements.filter((e) => e.kind === "value_stream").map((e) => e.name);

    const stageParticipation: It4itStageParticipationRow[] = [];
    for (const e of elements) {
      if (e.kind !== "value_stream_stage" || !e.parentId) continue;
      const stream = streamNameById.get(e.parentId);
      if (!stream) continue;
      const props =
        (e.properties as { participationByColumn?: Record<string, string | null> } | null) ?? {};
      stageParticipation.push({ stream, participation: props.participationByColumn ?? {} });
    }

    return shapeIt4itParticipationGrid({ components, valueStreams, stageParticipation });
  },
);

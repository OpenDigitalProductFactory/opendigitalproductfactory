import { cache } from "react";
import { prisma } from "@dpf/db";
import type { SerializedViewElement, SerializedEdge, CanvasState } from "./ea-types";

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

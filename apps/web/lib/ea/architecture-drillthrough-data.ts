import { prisma } from "@dpf/db";

import {
  buildArchitectureDrillthrough,
  type ArchitectureDrillthrough,
} from "./architecture-drillthrough";
import { AI_ROUTING_ARCHITECTURE_VERSION } from "./ai-routing-architecture-registry";

export async function loadArchitectureDrillthroughForView(input: {
  viewId: string;
  elements: Array<{
    id: string;
    name: string;
    notationSlug: string;
    properties: Record<string, unknown>;
  }>;
}): Promise<Record<string, ArchitectureDrillthrough>> {
  if (input.elements.length === 0) return {};

  const selectedIds = input.elements.map((element) => element.id);
  const routingArchitecture = hasRoutingElement(input.elements);
  const projectedRoutingElements = routingArchitecture
    ? await prisma.eaElement.findMany({
        where: {
          properties: {
            path: ["sourceVersion"],
            equals: AI_ROUTING_ARCHITECTURE_VERSION,
          },
        },
        select: {
          id: true,
          name: true,
          properties: true,
          elementType: {
            select: { notation: { select: { slug: true } } },
          },
        },
      })
    : [];
  const seedElements = [
    ...new Map(
      [
        ...input.elements.map((element) => ({
          id: element.id,
          name: element.name,
          properties: element.properties,
          elementType: { notation: { slug: element.notationSlug } },
        })),
        ...projectedRoutingElements,
      ].map((element) => [element.id, element]),
    ).values(),
  ];
  const seedIds = Array.from(new Set([...selectedIds, ...seedElements.map((element) => element.id)]));
  const relationships = await prisma.eaRelationship.findMany({
    where: {
      OR: [
        { fromElementId: { in: seedIds } },
        { toElementId: { in: seedIds } },
      ],
    },
    select: {
      id: true,
      fromElementId: true,
      toElementId: true,
      relationshipType: { select: { name: true } },
    },
  });
  const discoveredIds = Array.from(new Set([
    ...seedIds,
    ...relationships.flatMap((relationship) => [
      relationship.fromElementId,
      relationship.toElementId,
    ]),
  ]));
  const [elements, memberships, evidence] = await Promise.all([
    routingArchitecture
      ? Promise.resolve(seedElements)
      : prisma.eaElement.findMany({
          where: { id: { in: discoveredIds } },
          select: {
            id: true,
            name: true,
            properties: true,
            elementType: {
              select: { notation: { select: { slug: true } } },
            },
          },
        }),
    prisma.eaViewElement.findMany({
      where: { elementId: { in: discoveredIds } },
      select: {
        elementId: true,
        view: {
          select: {
            id: true,
            name: true,
            notation: { select: { slug: true, name: true } },
          },
        },
      },
    }),
    routingArchitecture
      ? prisma.routeDecisionLog.aggregate({ _max: { createdAt: true } })
      : Promise.resolve({ _max: { createdAt: null } }),
  ]);

  return buildArchitectureDrillthrough({
    currentViewId: input.viewId,
    selectedElementIds: input.elements.map((element) => element.id),
    elements: elements.map((element) => ({
      id: element.id,
      name: element.name,
      notationSlug: element.elementType.notation.slug,
      properties: asProperties(element.properties),
    })),
    relationships: relationships.map((relationship) => ({
      fromElementId: relationship.fromElementId,
      toElementId: relationship.toElementId,
      relationshipLabel: relationship.relationshipType.name,
    })),
    memberships: memberships.map((membership) => ({
      elementId: membership.elementId,
      viewId: membership.view.id,
      viewName: membership.view.name,
      notationSlug: membership.view.notation.slug,
      notationName: membership.view.notation.name,
    })),
    latestEvidenceAt: evidence._max.createdAt?.toISOString() ?? null,
  });
}

function hasRoutingElement(
  elements: Array<{ properties: Record<string, unknown> }>,
): boolean {
  return elements.some((element) => {
    const sourceVersion = String(element.properties.sourceVersion ?? "");
    const sourceKey = String(element.properties.sourceKey ?? "");
    return (
      typeof element.properties.registryKey === "string" ||
      sourceVersion === AI_ROUTING_ARCHITECTURE_VERSION ||
      sourceKey.includes("ai-routing") ||
      sourceKey.includes("routed-inference")
    );
  });
}

function asProperties(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

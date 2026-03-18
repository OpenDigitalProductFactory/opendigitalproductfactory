import { prisma } from "./client.js";
import type { PrismaClient } from "../generated/client/client";

export type EaStructureRuleSeed = {
  notationSlug: string;
  parentElementTypeSlug: string;
  childElementTypeSlug: string;
  patternSlug: string;
  minChildren: number | null;
  maxChildren: number | null;
  orderedChildren: boolean;
  impliedRelationshipSlug: string | null;
  defaultSeverity: string;
  rendererHint: string | null;
};

export function getDefaultEaStructureRules(): EaStructureRuleSeed[] {
  return [
    {
      notationSlug: "archimate4",
      parentElementTypeSlug: "value_stream",
      childElementTypeSlug: "value_stream_stage",
      patternSlug: "nested_chevron_sequence",
      minChildren: 1,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: "flows_to",
      defaultSeverity: "warn",
      rendererHint: "nested_chevron_sequence",
    },
  ];
}

export async function seedEaStructureRules(prismaClient: PrismaClient = prisma): Promise<void> {
  for (const rule of getDefaultEaStructureRules()) {
    const notation = await prismaClient.eaNotation.findUniqueOrThrow({
      where: { slug: rule.notationSlug },
      select: { id: true },
    });

    const [parentElementType, childElementType] = await Promise.all([
      prismaClient.eaElementType.findUniqueOrThrow({
        where: {
          notationId_slug: {
            notationId: notation.id,
            slug: rule.parentElementTypeSlug,
          },
        },
        select: { id: true },
      }),
      prismaClient.eaElementType.findUniqueOrThrow({
        where: {
          notationId_slug: {
            notationId: notation.id,
            slug: rule.childElementTypeSlug,
          },
        },
        select: { id: true },
      }),
    ]);

    await prismaClient.eaStructureRule.upsert({
      where: {
        notationId_parentElementTypeId_childElementTypeId_patternSlug: {
          notationId: notation.id,
          parentElementTypeId: parentElementType.id,
          childElementTypeId: childElementType.id,
          patternSlug: rule.patternSlug,
        },
      },
      update: {
        minChildren: rule.minChildren,
        maxChildren: rule.maxChildren,
        orderedChildren: rule.orderedChildren,
        impliedRelationshipSlug: rule.impliedRelationshipSlug,
        defaultSeverity: rule.defaultSeverity,
        rendererHint: rule.rendererHint,
      },
      create: {
        notationId: notation.id,
        parentElementTypeId: parentElementType.id,
        childElementTypeId: childElementType.id,
        patternSlug: rule.patternSlug,
        minChildren: rule.minChildren,
        maxChildren: rule.maxChildren,
        orderedChildren: rule.orderedChildren,
        impliedRelationshipSlug: rule.impliedRelationshipSlug,
        defaultSeverity: rule.defaultSeverity,
        rendererHint: rule.rendererHint,
      },
    });
  }
}

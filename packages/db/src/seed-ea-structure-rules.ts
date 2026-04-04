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
    // ── BPMN 2.0 structure rules ──────────────────────────────────────────
    // Process contains tasks (ordered sequence)
    {
      notationSlug: "bpmn20",
      parentElementTypeSlug: "bpmn_process",
      childElementTypeSlug: "bpmn_service_task",
      patternSlug: "bpmn_horizontal_flow",
      minChildren: null,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: "sequence_flow",
      defaultSeverity: "warn",
      rendererHint: "bpmn_horizontal_flow",
    },
    {
      notationSlug: "bpmn20",
      parentElementTypeSlug: "bpmn_process",
      childElementTypeSlug: "bpmn_user_task",
      patternSlug: "bpmn_horizontal_flow",
      minChildren: null,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: "sequence_flow",
      defaultSeverity: "warn",
      rendererHint: "bpmn_horizontal_flow",
    },
    // Pool contains lanes (swimlane layout)
    {
      notationSlug: "bpmn20",
      parentElementTypeSlug: "bpmn_pool",
      childElementTypeSlug: "bpmn_lane",
      patternSlug: "bpmn_swimlane",
      minChildren: 1,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: null,
      defaultSeverity: "warn",
      rendererHint: "bpmn_swimlane",
    },
    // Sub-process contains tasks (collapsible container)
    {
      notationSlug: "bpmn20",
      parentElementTypeSlug: "bpmn_sub_process",
      childElementTypeSlug: "bpmn_service_task",
      patternSlug: "bpmn_subprocess_container",
      minChildren: null,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: "sequence_flow",
      defaultSeverity: "warn",
      rendererHint: "bpmn_subprocess_container",
    },
    {
      notationSlug: "bpmn20",
      parentElementTypeSlug: "bpmn_sub_process",
      childElementTypeSlug: "bpmn_user_task",
      patternSlug: "bpmn_subprocess_container",
      minChildren: null,
      maxChildren: null,
      orderedChildren: true,
      impliedRelationshipSlug: "sequence_flow",
      defaultSeverity: "warn",
      rendererHint: "bpmn_subprocess_container",
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

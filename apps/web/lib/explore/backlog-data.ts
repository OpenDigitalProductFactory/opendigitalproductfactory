// apps/web/lib/backlog-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  BacklogItemWithRelations,
  DigitalProductSelect,
  TaxonomyNodeSelect,
  PortfolioForSelect,
  EpicWithRelations,
} from "./backlog";
import {
  activeWorkroomsByBacklogItem,
  loadBacklogWorkroomOwnership,
} from "@/lib/work-capsules/backlog-workroom-ownership";

export type { PortfolioForSelect };

async function attachActiveWorkrooms<T extends BacklogItemWithRelations>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const ownership = await loadBacklogWorkroomOwnership(
    prisma,
    items.flatMap((item) => [item.itemId, item.id]),
  );
  const byItem = activeWorkroomsByBacklogItem(items, ownership.liveWorkrooms);
  return items.map((item) => ({ ...item, activeWorkrooms: byItem.get(item.itemId) ?? [] }));
}

export const getBacklogItems = cache(async (): Promise<BacklogItemWithRelations[]> => {
  const items = await prisma.backlogItem.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
      type: true,
      workType: true,
      source: true,
      body: true,
      priority: true,
      epicId: true,
      triageOutcome: true,
      duplicateOfId: true,
      effortSize: true,
      activeBuildId: true,
      scopeKind: true,
      archetypeCategories: true,
      archetypeIds: true,
      scopeRationale: true,
      lifecycleTags: true,
      activeBuild: { select: { buildId: true, phase: true } },
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      deferReason: true,
      deferTrigger: true,
      deferReviewAt: true,
      deferOwnerPrincipalId: true,
      deferredAt: true,
      deferOwnerPrincipal: { select: { principalId: true, displayName: true } },
      agentId: true,
      submittedBy: { select: { email: true } },
      digitalProduct: { select: { id: true, productId: true, name: true } },
      taxonomyNode: { select: { id: true, nodeId: true, name: true } },
      upstreamIssueNumber: true,
      upstreamIssueUrl: true,
      // Operator-triage inputs (BI-9952EA9E) — existing columns.
      claimStatus: true,
      stalenessDetectedAt: true,
      riskOpportunity: true,
      businessValue: true,
      timeCriticality: true,
      // Ownership for the mine-vs-company scope split (BI-01CC2356).
      claimedById: true,
    },
  });
  return attachActiveWorkrooms(items as BacklogItemWithRelations[]);
});

export const getEpics = cache(async (): Promise<EpicWithRelations[]> => {
  const epics = await prisma.epic.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      epicId: true,
      title: true,
      description: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      submittedBy: { select: { email: true } },
      agentId: true,
      completedAt: true,
      portfolios: {
        select: {
          epicId: true,
          portfolioId: true,
          portfolio: { select: { id: true, slug: true, name: true } },
        },
      },
      items: {
        orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          itemId: true,
          title: true,
          status: true,
          type: true,
          body: true,
          priority: true,
          epicId: true,
          triageOutcome: true,
          duplicateOfId: true,
          effortSize: true,
          activeBuildId: true,
          scopeKind: true,
          archetypeCategories: true,
          archetypeIds: true,
          scopeRationale: true,
          lifecycleTags: true,
          activeBuild: { select: { buildId: true, phase: true } },
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          deferReason: true,
          deferTrigger: true,
          deferReviewAt: true,
          deferOwnerPrincipalId: true,
          deferredAt: true,
          deferOwnerPrincipal: { select: { principalId: true, displayName: true } },
          agentId: true,
          submittedBy: { select: { email: true } },
          digitalProduct: { select: { id: true, productId: true, name: true } },
          taxonomyNode: { select: { id: true, nodeId: true, name: true } },
          upstreamIssueNumber: true,
          upstreamIssueUrl: true,
          // Operator-triage inputs (BI-9952EA9E) — existing columns.
          claimStatus: true,
          stalenessDetectedAt: true,
          riskOpportunity: true,
          businessValue: true,
          timeCriticality: true,
          // Ownership for the mine-vs-company scope split (BI-01CC2356).
          claimedById: true,
        },
      },
    },
  }) as EpicWithRelations[];
  const items = await attachActiveWorkrooms(epics.flatMap((epic) => epic.items));
  const byId = new Map(items.map((item) => [item.id, item]));
  return epics.map((epic) => ({
    ...epic,
    items: epic.items.map((item) => byId.get(item.id) ?? item),
  }));
});

export const getDigitalProductsForSelect = cache(async (): Promise<DigitalProductSelect[]> => {
  return prisma.digitalProduct.findMany({
    orderBy: { name: "asc" },
    select: { id: true, productId: true, name: true, lifecycleStage: true },
  });
});

export const getTaxonomyNodesFlat = cache(async (): Promise<TaxonomyNodeSelect[]> => {
  return prisma.taxonomyNode.findMany({
    where: { status: "active" },
    select: { id: true, nodeId: true, name: true },
    orderBy: { nodeId: "asc" },
  });
});

export const getPortfoliosForSelect = cache(async (): Promise<PortfolioForSelect[]> => {
  return prisma.portfolio.findMany({
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
  });
});

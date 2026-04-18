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

export type { PortfolioForSelect };

export const getBacklogItems = cache(async (): Promise<BacklogItemWithRelations[]> => {
  return prisma.backlogItem.findMany({
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
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      agentId: true,
      submittedBy: { select: { email: true } },
      digitalProduct: { select: { id: true, productId: true, name: true } },
      taxonomyNode: { select: { id: true, nodeId: true, name: true } },
      upstreamIssueNumber: true,
      upstreamIssueUrl: true,
    },
  });
});

export const getEpics = cache(async (): Promise<EpicWithRelations[]> => {
  return prisma.epic.findMany({
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
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          agentId: true,
          submittedBy: { select: { email: true } },
          digitalProduct: { select: { id: true, productId: true, name: true } },
          taxonomyNode: { select: { id: true, nodeId: true, name: true } },
        },
      },
    },
  }) as Promise<EpicWithRelations[]>;
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

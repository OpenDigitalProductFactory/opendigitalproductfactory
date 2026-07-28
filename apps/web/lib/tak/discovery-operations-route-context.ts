import { INVENTORY_ENTITY_CANONICAL_WHERE, prisma } from "@dpf/db";

export async function getDiscoveryOperationsContext(): Promise<string> {
  const [latestRun, connectionCount, needsReviewCount, openIssues] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        runKey: true,
        status: true,
        startedAt: true,
        completedAt: true,
        itemCount: true,
        relationshipCount: true,
      },
    }),
    prisma.discoveryConnection.count(),
    prisma.inventoryEntity.count({
      where: {
        ...INVENTORY_ENTITY_CANONICAL_WHERE,
        attributionStatus: "needs_review",
      },
    }),
    prisma.portfolioQualityIssue.groupBy({
      by: ["issueType"],
      where: { status: "open" },
      _count: true,
      orderBy: { _count: { issueType: "desc" } },
      take: 8,
    }),
  ]);

  const latestRunSummary = latestRun
    ? `${latestRun.runKey} [${latestRun.status}] items=${latestRun.itemCount}, relationships=${latestRun.relationshipCount}`
    : "No discovery run recorded";

  return [
    "\nPAGE DATA — Discovery Operations:",
    `Connections: ${connectionCount}`,
    `Needs review: ${needsReviewCount}`,
    `Latest run: ${latestRunSummary}`,
    "",
    "Open discovery issues:",
    ...(openIssues.length > 0
      ? openIssues.map((issue) => `- ${issue.issueType}: ${issue._count}`)
      : ["- none"]),
  ].join("\n");
}

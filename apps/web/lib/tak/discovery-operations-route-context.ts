import { getDiscoveryOperationsViewModel } from "@/lib/discovery-operations-view-model";
import { projectDiscoveryOperationsSurface } from "@/lib/coworker/surfaces/discovery-operations-surface";

export async function getDiscoveryOperationsContext(): Promise<string> {
  const model = await getDiscoveryOperationsViewModel();
  const projection = projectDiscoveryOperationsSurface({
    productsLinked: model.products.length,
    needsReview: model.triageQueues.metrics.total,
    latestRun: model.latestRun
      ? {
          runKey: model.latestRun.runKey,
          status: model.latestRun.status,
          itemCount: model.latestRun.itemCount,
          relationshipCount: model.latestRun.relationshipCount,
        }
      : null,
    openIssues: model.openIssues.reduce<Array<{ issueType: string; count: number }>>((issues, issue) => {
      const existing = issues.find((candidate) => candidate.issueType === issue.issueType);
      if (existing) existing.count += 1;
      else issues.push({ issueType: issue.issueType, count: 1 });
      return issues;
    }, []),
    detectedGateway: model.detectedGateway,
    connections: model.connections,
  });

  return [
    "\nPAGE DATA — Discovery Operations:",
    ...(projection.summary.highlights ?? []),
    "Use the Authorized Surface tools for current fields, values, validation, and actions. Do not infer controls from this text.",
  ].join("\n");
}

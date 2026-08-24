import type {
  MappedBacklogItem,
  PlanBacklogCoverageReceipt,
  PlanBacklogDeliverableV2,
} from "./plan-backlog-coverage";

export type PlanDependencyProjection = {
  state: "pass" | "missing" | "fail";
  unresolvedDeliverableKeys: string[];
};

/** Project live dependency readiness without treating a bare deferred status as success. */
export function projectPlanBacklogDependencies(
  receipt: PlanBacklogCoverageReceipt,
  mappedBacklogItems: MappedBacklogItem[],
): PlanDependencyProjection {
  const byKey = new Map(receipt.deliverables.map((deliverable) => [deliverable.key, deliverable]));
  const statusByItem = new Map(mappedBacklogItems.map((item) => [item.itemId, item.status]));
  const unresolved = new Set<string>();
  let hasExplicitFailure = false;

  for (const deliverable of receipt.deliverables) {
    for (const dependencyKey of deliverable.dependsOn ?? []) {
      const dependency = byKey.get(dependencyKey) as PlanBacklogDeliverableV2 | undefined;
      if (!dependency) {
        unresolved.add(dependencyKey);
        hasExplicitFailure = true;
        continue;
      }
      const status = dependency.backlogItemId ? statusByItem.get(dependency.backlogItemId) : undefined;
      if (status === "done") continue;
      const disposition = dependency.disposition;
      if (disposition && (disposition.decision === "deferred" || disposition.decision === "not-applicable")
        && disposition.reason.trim().length >= 20) continue;
      unresolved.add(dependency.key);
      if (status === "deferred" || (disposition && !disposition.reason.trim())) hasExplicitFailure = true;
    }
  }

  return {
    state: unresolved.size === 0 ? "pass" : hasExplicitFailure ? "fail" : "missing",
    unresolvedDeliverableKeys: [...unresolved].sort(),
  };
}

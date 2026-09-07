import { deriveAuthoritativeReadinessProfile, type InitiativeProfileSignals } from "@/lib/backlog/initiative-readiness/profiles";

type CoverageChild = { itemId: string; workType?: string | null };

export function projectMissingBaselineRecovery(args: {
  item: InitiativeProfileSignals & { itemId: string };
  mappedItems: readonly CoverageChild[];
}) {
  const profile = deriveAuthoritativeReadinessProfile(args.item) ?? "feature";
  if (["fix", "feature", "cross-domain", "archetype"].includes(profile)) {
    return {
      recovery: {
        kind: "scope-baseline-review-required" as const,
        itemId: args.item.itemId,
        nextTool: "claim_backlog_item_for_work" as const,
        workIntent: "implementation" as const,
      },
      instruction: "Call `claim_backlog_item_for_work` for this existing Workroom with workIntent=`implementation`, then execute the returned `recovery.reviewerRoutes` spec-approval `request_coworker` packet verbatim. That packet binds `record_initiative_design_review` to the immutable canonical design and an independent reviewer.",
    };
  }

  const implementationChildren = args.mappedItems
    .filter((item) => {
      const childProfile = deriveAuthoritativeReadinessProfile({ workType: item.workType });
      return childProfile != null && childProfile !== "doc-only";
    })
    .map((item) => item.itemId);
  return {
    recovery: {
      kind: "implementation-parent-binding-required" as const,
      documentationItemId: args.item.itemId,
      candidateImplementationItemIds: implementationChildren,
      nextTool: implementationChildren.length > 0
        ? "record_plan_backlog_coverage" as const
        : "claim_backlog_item_for_work" as const,
    },
    instruction: implementationChildren.length > 0
      ? `This documentation/fix item cannot own implementation coverage. Record coverage against the governed implementation child with a current scope baseline instead; candidate item(s): ${implementationChildren.join(", ")}.`
      : "This documentation/fix item cannot mint implementation coverage without a baseline. Bind the work to its governed implementation parent or child first; do not request a reviewer route for this item.",
  };
}

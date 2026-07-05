// Honest-by-default derivation of the auto-populated Feature Brief from an
// ideate designDoc (the saveBuildEvidence designDoc path backfills a missing
// brief so generate_code has one to build codegen prompts from).
//
// NEVER fabricates audience or ownership. The previous inline version in
// mcp-tools.ts hardcoded portfolioContext="manufacturing_and_delivery" and
// targetRoles=["admin","customer"], which surfaced verbatim in the Feature
// Brief of internal Build Studio meta-features (BI-4E84841D) — a
// wrong-but-plausible default is worse than an honest blank. Empty values
// degrade gracefully downstream: feature attribution skips portfolio scoping
// when portfolioContext is empty, and the business brief raises "Who is
// affected by this business change?" as an open question when targetRoles is
// empty.

export type AutoDerivedFeatureBrief = {
  title: string;
  description: string;
  portfolioContext: string;
  targetRoles: string[];
  inputs: string[];
  dataNeeds: string;
  acceptanceCriteria: string[];
};

export function deriveAutoBriefFromDesignDoc(
  doc: Record<string, unknown> | null,
  buildTitle: string,
): AutoDerivedFeatureBrief {
  return {
    title: buildTitle,
    description: typeof doc?.problemStatement === "string" && doc.problemStatement.trim()
      ? doc.problemStatement
      : buildTitle,
    portfolioContext: typeof doc?.portfolioContext === "string" ? doc.portfolioContext.trim() : "",
    targetRoles: Array.isArray(doc?.targetRoles)
      ? (doc.targetRoles as unknown[]).map(String).filter((r) => r.trim().length > 0)
      : [],
    inputs: [],
    dataNeeds: typeof doc?.proposedApproach === "string" ? doc.proposedApproach : "",
    acceptanceCriteria: Array.isArray(doc?.acceptanceCriteria)
      ? (doc.acceptanceCriteria as unknown[]).map(String).filter((c) => c.trim().length > 0)
      : [],
  };
}

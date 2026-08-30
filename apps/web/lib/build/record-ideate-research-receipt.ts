// apps/web/lib/build/record-ideate-research-receipt.ts
//
// BI-C5D978E9 — the I/O half of the ideate research attestation. The rule for
// WHETHER to attest lives in ideate-research-receipt.ts and is unit-tested
// there; this module only performs the write.

import { prisma } from "@dpf/db";

import { describeResearchAttestation, designDocEvidencesResearch } from "./ideate-research-receipt";

/**
 * Record the `research` gate receipt for a build's governed backlog subject.
 *
 * No-ops rather than throwing whenever the attestation would not be truthful or
 * the subject is not governed: a build with no backlog originator has no
 * initiative to be ready, and a design with no recorded audit has not done the
 * research the gate asks about.
 */
export async function recordIdeateResearchReceipt(args: {
  buildId: string;
  designDoc: unknown;
  revisionId: string;
  authorUserId: string;
  authorAgentId: string | null;
}): Promise<{ recorded: boolean; reason: string }> {
  if (!designDocEvidencesResearch(args.designDoc)) {
    return { recorded: false, reason: "design document records no research" };
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: { originator: { select: { itemId: true } } },
  });
  const itemId = build?.originator?.itemId ?? null;
  if (!itemId) return { recorded: false, reason: "build has no governed backlog subject" };

  const { recordInitiativeGateReceipt } = await import(
    "@/lib/backlog/initiative-readiness/receipt-repository"
  );
  const { INITIATIVE_READINESS_LANES } = await import(
    "@/lib/tak/initiative-readiness-tool-grants"
  );
  const lane = INITIATIVE_READINESS_LANES.record_initiative_evidence;

  const result = await recordInitiativeGateReceipt({
    itemId,
    allowedGates: lane.gates,
    requiredCapability: lane.capability,
    requiredGrant: lane.grant,
    actionKey: "ideate_research_attestation",
    gate: "research",
    decision: "pass",
    artifactRef: { kind: "feature-build-revision", revisionId: args.revisionId },
    reason: describeResearchAttestation(args.designDoc),
    findings: [],
    resolvedFindingRefs: [],
    reviewerUserId: args.authorUserId,
    reviewerAgentId: args.authorAgentId,
    authorityDecisionId: null,
    tokenScope: null,
    // The lane declares independent: false — the design author is the
    // accountable role for research, so no separate reviewer is required.
    requiresIndependentReviewer: lane.independent,
  });

  return result.ok
    ? { recorded: true, reason: "research receipt recorded" }
    : { recorded: false, reason: result.code ?? "receipt refused" };
}

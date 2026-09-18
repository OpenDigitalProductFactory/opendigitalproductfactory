// apps/web/lib/build/record-ideate-research-receipt.ts
//
// BI-C5D978E9 — the I/O half of the ideate research attestation. The rule for
// WHETHER to attest lives in ideate-research-receipt.ts and is unit-tested
// there; this module only performs the write.

import { prisma } from "@dpf/db";

import { describeResearchAttestation, designDocEvidencesResearch } from "./ideate-research-receipt";

/** The Build Lead coworker holds initiative_evidence_write (initiative-readiness runbook §4). */
export const IDEATE_ATTESTATION_AGENT_ID = "AGT-WS-BUILD";

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

  // BI-9257CF19 follow-up (2026-09-18, FB-6260B711): the receipt writer
  // requires an authenticated reviewer agent, an authority decision and a
  // token scope — the dual-control seam every governed receipt passes. This
  // path used to call the writer with all three null, so it was refused on
  // every build and the refusal was swallowed: 10 of 11 builds in 30 days
  // abandoned in ideate at RESEARCH_REQUIRED. The attestation now runs as a
  // governed tool call by the Build Lead coworker (holder of
  // initiative_evidence_write) on the authoring human's behalf, so the
  // authority gate judges it, records its decision, and the outcome is
  // returned to the caller in words instead of disappearing.
  const { prisma: db } = await import("@dpf/db");
  const author = await db.user.findUnique({
    where: { id: args.authorUserId },
    select: { isSuperuser: true },
  });
  if (!author) return { recorded: false, reason: `authoring user ${args.authorUserId} not found` };
  // The receipt binds to immutable bytes: the latest ACCEPTED designDoc
  // revision of this build (artifact-resolver's feature-build-revision
  // contract). A caller-supplied label such as "review:<build>" is not a
  // revision and used to fail artifact resolution silently.
  const revision = await db.buildArtifactRevision.findFirst({
    where: { buildId: args.buildId, field: "designDoc", status: "accepted" },
    orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
  if (!revision) return { recorded: false, reason: "build has no accepted designDoc revision to bind the receipt to" };
  const { governedExecuteTool } = await import("@/lib/mcp-governed-execute");
  const result = await governedExecuteTool({
    toolName: "record_initiative_evidence",
    rawParams: {
      itemId,
      gate: "research",
      decision: "pass",
      artifactRef: { kind: "feature-build-revision", revisionId: revision.id },
      reason: describeResearchAttestation(args.designDoc),
    },
    userId: args.authorUserId,
    userContext: { userId: args.authorUserId, platformRole: null, isSuperuser: author.isSuperuser },
    source: "agentic-loop",
    context: {
      agentId: args.authorAgentId ?? IDEATE_ATTESTATION_AGENT_ID,
      routeContext: "/build",
      featureBuildId: args.buildId,
      tokenScope: "write",
    },
  });
  if (result.success) return { recorded: true, reason: "research receipt recorded" };
  const rejected = result.governance?.rejected;
  const detail = [result.error, result.message].filter(Boolean).join(": ");
  return {
    recorded: false,
    reason: `${rejected ?? "receipt refused"}${detail ? ` — ${detail}` : ""}`,
  };
}

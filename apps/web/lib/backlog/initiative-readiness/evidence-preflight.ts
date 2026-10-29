import { prisma } from "@dpf/db";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import { resolveInitiativeArtifact } from "./artifact-resolver";
import { validateInitiativeDisposition } from "./disposition-contract";
import { isInitiativeArtifactRef } from "./receipt-schema";
import { resolveReviewerIdentity } from "./reviewer-identity";

const refusal = (error: string, message: string): ToolResult => ({ success: false, error, message });
// These readers normally run after authorization and may describe private room
// heads or sign-off identities in their errors. Before authority, expose only
// a fixed remedy, never their raw text or additional fields.
const ARTIFACT_REFUSAL_COPY = {
  ARTIFACT_AUTHOR_REQUIRED: "Artifact author provenance is unavailable or ambiguous. The source owner must reconcile recorded authorship before requesting approval.",
  CANONICAL_DESIGN_REQUIRED: "A current immutable artifact could not be verified. Use the source owner's supported inspection and recording flow before requesting approval.",
  CANONICAL_DESIGN_AMBIGUOUS: "The immutable artifact does not match the current governed work. Reconcile its source binding through a workroom you are admitted to before requesting approval.",
} as const;

/** Necessary prerequisites only. A successful read is never authorization to write. */
export async function preflightEvidenceArtifact(args: {
  params: Record<string, unknown>;
  userId: string;
  context?: ToolExecutionContext;
  workroomRef?: InitiativeReviewBinding["workroomRef"];
}): Promise<ToolResult | null> {
  const { params, context } = args;
  // This separate writer uses an issued objective-mapping packet, not an artifact receipt.
  if (params.operation === "objective-mapping") return null;
  if (params.operation !== undefined && params.operation !== "gate-receipt") {
    return refusal("malformed-receipt", "record_initiative_evidence does not support that operation.");
  }
  const lane = INITIATIVE_READINESS_LANES.record_initiative_evidence;
  if (typeof params.gate !== "string" || !lane.gates.includes(params.gate as never)) {
    return refusal("gate-not-authorized", "record_initiative_evidence cannot record that gate.");
  }
  const decision = params.decision;
  if ((decision !== "pass" && decision !== "fail" && decision !== "not-applicable")
    || typeof params.itemId !== "string" || !params.itemId.trim()
    || typeof params.reason !== "string" || !params.reason.trim()
    || !isInitiativeArtifactRef(params.artifactRef)
    || !Array.isArray(params.findings) || !Array.isArray(params.resolvedFindingRefs)
    || !params.resolvedFindingRefs.every(value => typeof value === "string" && value.trim())) {
    return refusal("malformed-receipt", "Supply an item, immutable artifact, decision, reason, findings and resolvedFindingRefs matching the governed receipt schema.");
  }
  const findings: Array<{ issue: string; severity: "critical" | "important" }> = [];
  for (const value of params.findings) {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.issue !== "string" || !value.issue.trim()
      || (value.severity !== "critical" && value.severity !== "important")) {
      return refusal("malformed-receipt", "findings must match the governed receipt schema.");
    }
    findings.push({ issue: value.issue, severity: value.severity });
  }
  const disposition = validateInitiativeDisposition(decision, findings, params.resolvedFindingRefs);
  if (disposition) return refusal("malformed-receipt", disposition);
  // The authority decision is created later by the gate. Agent and token context
  // already have to exist: a person's approval cannot manufacture either one.
  if (!context?.agentId || !context.tokenScope) {
    return refusal("AUTHORIZATION_DENIED", "Authenticated reviewer and token scope are required before requesting approval. Use the task's supported authenticated evidence writer; approving this request cannot supply its missing execution context.");
  }
  try {
    const item = await prisma.backlogItem.findUnique({ where: { itemId: params.itemId },
      select: { itemId: true, organizationId: true } });
    if (!item) return refusal("CANONICAL_DESIGN_REQUIRED", `BacklogItem ${params.itemId} was not found.`);
    const reviewer = await resolveReviewerIdentity(prisma, {
      reviewerUserId: args.userId, reviewerAgentId: context.agentId,
    });
    if (!reviewer) return refusal("ARTIFACT_AUTHOR_REQUIRED", "Reviewer principal identity is unavailable. Link the authenticated reviewer to a Principal before requesting an evidence approval.");
    const artifact = await resolveInitiativeArtifact({
      locator: params.artifactRef, subject: { kind: "backlog-item", id: item.itemId },
      organizationId: item.organizationId, workroomRef: args.workroomRef,
      // The non-independent research writer can admit a human-authored build
      // only under its existing author policy. Do not prematurely reject that
      // possible path here; the final writer still proves the policy itself.
      allowHumanResearchAuthor: params.gate === "research",
    });
    return artifact.ok ? null : refusal(artifact.code, ARTIFACT_REFUSAL_COPY[artifact.code]);
  } catch {
    return refusal("authority_evidence_unavailable", "Evidence prerequisites could not be checked. No approval was requested. Retry when the authenticated source is available; approval cannot replace missing provenance.");
  }
}

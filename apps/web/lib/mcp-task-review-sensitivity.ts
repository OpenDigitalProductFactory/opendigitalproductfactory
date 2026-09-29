import { prisma } from "@dpf/db";
import type { RouteSensitivity } from "./agent-sensitivity";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { requiredToolNames } from "./mcp-task-review-contract";
import { INITIATIVE_READINESS_LANES } from "./tak/initiative-readiness-tool-grants";
import { authorizeCoworkerRequest } from "./mcp/independent-review-request";

/** Activity classification is not clearance. The normal dispatch screen still
 * inspects the actual prompt and every subsequent tool response. */
export async function remoteReviewSensitivity(
  parsed: RemoteTaskSubmitParams, token: RemoteTaskSubmitAuth, fallback: RouteSensitivity,
): Promise<RouteSensitivity> {
  const binding = parsed.initiativeReviewBinding;
  const lane = binding && INITIATIVE_READINESS_LANES[binding.writerToolName];
  if (fallback === "restricted" || token.source !== "oauth" || !binding
    || !["record_initiative_design_review", "record_initiative_architecture_review"].includes(binding.writerToolName)
    || !lane?.gates.some((gate) => gate === binding.gate) || binding.eligibleEvidenceActivityIds?.length
    || parsed.routeContext !== "/build" || parsed.collaborationKind !== "handoff"
    || parsed.riskClass !== "bounded-write" || parsed.prompt !== parsed.objective) return fallback;
  try {
    const credential = await prisma.mcpApiToken.findUnique({ where: { id: token.tokenId },
      select: { userId: true, agentId: true, scopes: true } });
    if (!credential?.agentId || credential.userId !== token.userId) return fallback;
    // Reconstruct the original bounded request. The validator compares every
    // field with current server issuance, including reviewer and immutable head.
    const proof = await authorizeCoworkerRequest({
      targetAgent: parsed.agentId, objective: parsed.objective, questionPacketSummary: parsed.title,
      requestKey: parsed.idempotencyKey, tier: 2, enteredVia: "handoff",
      requiredToolNames: requiredToolNames(parsed.authorityScope), initiativeReviewBinding: binding,
    }, token.userId, { agentId: credential.agentId, apiTokenId: token.tokenId,
      authSource: token.source, tokenScope: token.capability, tokenGrantScopes: credential.scopes }, { sourceOnly: true });
    return proof.bounded && !proof.refusal ? "development" : fallback;
  } catch {
    // Missing proof never relaxes the existing classification.
    return fallback;
  }
}

import type { UserContext } from "./permissions";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { prepareRemoteReviewAttempt, preparePresentReassessmentInput } from "./mcp-task-reassessment-preparation";
import { readApprovedReassessmentPolicy, readAuthorizedReassessmentOriginals } from "./mcp-task-review-reassessment";
import { prepareReassessmentNativeCandidateRoute, precheckReassessmentNativeCandidate } from "./inference/reassessment-execution-qualification";
import { readCurrentReassessmentContract } from "./mcp-task-reassessment-contract";
import { createPresentReassessmentAuthority, type PresentReviewRequestAuthority } from "./mcp-task-reassessment-authority";
import { createPresentReassessmentAdmission } from "./mcp-task-reassessment-admission";

/** Resolve normal source, reviewer, routing and budget before allocating one
 * present assessment. Runtime HTTP is prohibited here; unknown native facts
 * can only be obtained later within that assessment's captured Q window. */
export async function preparePresentReassessmentSubmission(input: {
  parsed: RemoteTaskSubmitParams; token: RemoteTaskSubmitAuth; userContext: UserContext;
  threadId: string; taskRunId: string; requestDigest: string; requestAuthority?: PresentReviewRequestAuthority;
}, ports: Parameters<typeof prepareRemoteReviewAttempt>[1] & Parameters<typeof preparePresentReassessmentInput>[1]) {
  const { parsed, token } = input, relation = parsed.initiativeReviewBinding?.presentReassessment;
  if (!relation) return null;
  if (!input.requestAuthority || !input.requestAuthority.authorityDecisionId || !input.requestAuthority.actingAgentId
    || !Array.isArray(input.requestAuthority.tokenGrantScopes) || !input.requestAuthority.tokenGrantScopes.every(value => typeof value === "string" && !!value)
    || parsed.recipeId || parsed.reviewRecovery || parsed.riskClass !== "bounded-write" || token.source !== "oauth" || token.capability !== "write") {
    throw new Error("reassessment-authority-unproven");
  }
  const requestAuthority = Object.freeze({ authorityDecisionId: input.requestAuthority.authorityDecisionId,
    actingAgentId: input.requestAuthority.actingAgentId,
    tokenGrantScopes: Object.freeze([...input.requestAuthority.tokenGrantScopes]) });
  const proof = await readApprovedReassessmentPolicy({ authorizationItemId: relation.authorizationItemId,
    subjectItemId: parsed.initiativeReviewBinding!.itemId, userId: token.userId });
  const originals = await readAuthorizedReassessmentOriginals({ proof, userId: token.userId,
    actingAgentId: requestAuthority.actingAgentId, tokenGrantScopes: [...requestAuthority.tokenGrantScopes] });
  const turn = await prepareRemoteReviewAttempt({ parsed, userContext: input.userContext, restricted: true }, ports);
  const preparedInput = await preparePresentReassessmentInput({ turn, parsed, token, threadId: input.threadId,
    taskRunId: input.taskRunId, requestDigest: input.requestDigest }, ports);
  const route = await prepareReassessmentNativeCandidateRoute(preparedInput);
  if (route.status === "unsupported-normal-winner" || !route.candidatePlan) throw new Error("reassessment-native-normal-selection-unsupported");
  const candidate = await precheckReassessmentNativeCandidate(preparedInput, route.candidatePlan);
  const compatibility = await readCurrentReassessmentContract();
  const validateAuthority = createPresentReassessmentAuthority({ token, requestAuthority,
    budgetConfiguration: candidate.budgetConfiguration, compatibility });
  const admission = createPresentReassessmentAdmission({ parsed, taskRunId: input.taskRunId, userId: token.userId,
    actingAgentId: requestAuthority.actingAgentId, authorityDecisionId: requestAuthority.authorityDecisionId,
    proof, originals, candidate, compatibility }, { validateAuthority });
  return { ...admission, requestAuthority };
}

import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { loadPersistedReassessmentQualificationRoot, withPersistedReassessmentQualification,
  type PersistedReassessmentExecutionInput } from "./mcp-task-reassessment-capture";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import type { UserContext } from "./permissions";
import { prepareRemoteReviewAttempt, preparePresentReassessmentInput } from "./mcp-task-reassessment-preparation";
import { readCurrentReassessmentContract, assertCurrentReassessmentContract } from "./mcp-task-reassessment-contract";
import { readApprovedReassessmentPolicy, readAuthorizedReassessmentOriginals } from "./mcp-task-review-reassessment";
import { createPresentReassessmentAuthority } from "./mcp-task-reassessment-authority";
import { sealPresentReassessmentExecution } from "./mcp-task-reassessment-admission";
import { prepareReassessmentNativeCandidateRoute, precheckReassessmentNativeCandidate,
  qualifyReassessmentExecution } from "./inference/reassessment-execution-qualification";
import { captureReassessmentNativeRuntime } from "./inference/reassessment-native-runtime";
import { providerInferenceFetch } from "./inference/provider-inference-transport";
import { promoteReassessmentExecution, refuseReassessmentExecution } from "./routing/reassessment-execution-scope";
import { expandGrants } from "./tak/agent-grants";
export type PresentReassessmentWorkerInput = {
  persistedInput: PersistedReassessmentExecutionInput; parsed: RemoteTaskSubmitParams; token: RemoteTaskSubmitAuth;
  userContext: UserContext; threadId: string; resumeKind?: "capacity" | "terminal-writer"; terminalWriterContext?: string;
};
type PreparationPorts = Parameters<typeof prepareRemoteReviewAttempt>[1] & Parameters<typeof preparePresentReassessmentInput>[1];
const equal = (left: unknown, right: unknown) => canonicalJson(left ?? null) === canonicalJson(right ?? null);
function refuse(code: string): never { return refuseReassessmentExecution(code); }

/** Resume the already counted candidate. Every runtime read belongs to its
 * original captured window; only its persisted execution seal can promote it. */
export async function withPresentReassessmentWorker<T>(input: PresentReassessmentWorkerInput,
  ports: PreparationPorts, execute: () => Promise<T>): Promise<T> {
  const { persistedInput, parsed, token } = input;
  const { seed, requestAuthority } = await loadPersistedReassessmentQualificationRoot(persistedInput);
  const relation = parsed.initiativeReviewBinding?.presentReassessment;
  if (!relation || !equal(parsed.initiativeReviewBinding, seed.binding) || token.userId !== seed.userId
    || resolveCanonicalAgentId(parsed.agentId) !== resolveCanonicalAgentId(seed.agentId)) refuse("reassessment-manifest-changed");
  const compatibility = await readCurrentReassessmentContract();
  assertCurrentReassessmentContract(seed.compatibility);
  if (!equal(compatibility, seed.compatibility)) refuse("reassessment-compatibility-changed");
  const turn = await prepareRemoteReviewAttempt({ parsed, userContext: input.userContext, restricted: true,
    resumeKind: input.resumeKind, terminalWriterContext: input.terminalWriterContext,
    validateResolvedAgent: resolved => {
      if (resolveCanonicalAgentId(resolved) !== resolveCanonicalAgentId(seed.agentId)) refuse("reassessment-execution-conflict");
    } }, ports);
  const prepared = await preparePresentReassessmentInput({ turn, parsed, token, threadId: input.threadId,
    taskRunId: seed.taskRunId, requestDigest: seed.requestDigest }, ports);
  const preparedInput = { ...prepared, options: { ...prepared.options, mcpSession: {
    ...prepared.options.mcpSession, taskExecutionFence: seed.executionFence,
  } } };
  const route = await prepareReassessmentNativeCandidateRoute(preparedInput);
  if (route.status === "unsupported-normal-winner" || !route.candidatePlan) refuse("reassessment-native-normal-selection-unsupported");
  const candidate = await precheckReassessmentNativeCandidate(preparedInput, route.candidatePlan);
  const assertCandidate = (current: typeof candidate) => {
    if (!equal(current.budgetConfiguration, seed.budgetConfiguration) || !equal(current.bounds, seed.bounds)
      || !equal(current.nativeObservationUrls, seed.nativeObservationUrls)
      || current.providerConfigurationDigest !== candidate.providerConfigurationDigest
      || current.spendAwareBudgetClass !== candidate.spendAwareBudgetClass) refuse("reassessment-current-candidate-changed");
  };
  assertCandidate(candidate);
  const proof = await readApprovedReassessmentPolicy({ authorizationItemId: relation.authorizationItemId,
    subjectItemId: seed.binding.itemId, userId: token.userId });
  const credential = await prisma.mcpApiToken.findUnique({ where: { id: token.tokenId },
    select: { userId: true, agentId: true, capability: true, scopes: true } });
  if (!credential || credential.userId !== token.userId || credential.capability !== "write" || !credential.agentId
    || resolveCanonicalAgentId(credential.agentId) !== resolveCanonicalAgentId(requestAuthority.actingAgentId)) refuse("reassessment-authority-unproven");
  const currentScopes = new Set(expandGrants(credential.scopes));
  const tokenGrantScopes = expandGrants(requestAuthority.tokenGrantScopes).filter(scope => currentScopes.has(scope));
  const originals = await readAuthorizedReassessmentOriginals({ proof, userId: token.userId,
    actingAgentId: requestAuthority.actingAgentId, tokenGrantScopes });
  const validateAuthority = createPresentReassessmentAuthority({ token, requestAuthority,
    budgetConfiguration: candidate.budgetConfiguration, compatibility });
  const authorityContext = { proof, originals, parsed, root: seed };
  const assertAuthority = () => prisma.$transaction(tx => validateAuthority(tx, authorityContext));
  await assertAuthority();
  return withPersistedReassessmentQualification(persistedInput, async () => {
    const observation = await captureReassessmentNativeRuntime({ provider: candidate.provider,
      modelRef: candidate.candidatePlan.modelId, fetchImpl: providerInferenceFetch,
      assertCurrent: async () => {
        assertCurrentReassessmentContract(seed.compatibility);
        assertCandidate(await precheckReassessmentNativeCandidate(preparedInput, candidate.candidatePlan));
        await assertAuthority();
      } });
    const qualification = await qualifyReassessmentExecution(preparedInput, observation);
    if (!equal(qualification.budgetConfiguration, seed.budgetConfiguration) || !equal(qualification.bounds, seed.bounds)
      || qualification.providerConfigurationDigest !== candidate.providerConfigurationDigest
      || qualification.nativeRuntime?.spendAwareBudgetClass !== candidate.spendAwareBudgetClass) refuse("reassessment-current-qualification-changed");
    await sealPresentReassessmentExecution({ persistedInput, parsed, proof, originals, qualification,
      authorityDecisionId: requestAuthority.authorityDecisionId }, { validateAuthority });
    return promoteReassessmentExecution(execute);
  }, { validateExecutionAuthority: (tx, root, seal) => validateAuthority(tx, { proof, originals, parsed, root,
    qualification: seal.qualification }) });
}

import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma } from "@dpf/db";
import { callProvider } from "@/lib/ai-inference";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { expandGrants, isToolAllowedByGrants } from "@/lib/agent-grants";
import { loadPlatformVersion } from "@/lib/platform/version";
import { getLocalThinkingBudgetEvidence } from "@/lib/inference/dmr-runtime-config";
import { getOllamaApiRoot } from "@/lib/inference/ollama-url";
import { canonicalLocalModelKey } from "@/lib/inference/local-model-management";
import type { LocalThinkingBudgetEvidence } from "@/lib/routing/types";
import { isRecord } from "@/lib/shared/coerce";
import { loadEndpointManifests, invalidateRoutingLoaderCache } from "@/lib/routing/loader";
import { endpointGenuinelyClearsSensitivity } from "@/lib/routing/sensitivity-clearance";
import { resolveDefaultExecutionAdapter } from "@/lib/routing/execution-plan";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { createRoutingTraceId } from "@/lib/routing/routing-trace";
import { currentInferenceSignal, withInferenceCancellation, awaitInferenceCancellation,
  currentInferenceOrigin, currentGovernedInferenceDeadline, withInferenceAuthorityCheck,
  assertGovernedInferenceAuthority } from "@/lib/routing/governed-inference-deadline";
import { resolveAcquireTimeoutMs, withInferenceAdmissionObserver } from "@/lib/inference/inference-admission";
import { resolveInferenceRuntimePolicy } from "@/lib/routing/local-inference-runtime-policy";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { resolveMcpTaskAuthorityKey } from "@/lib/auth/oauth-task-authority";
import { loadRoomTurnAuthority } from "@/lib/work-management/room-turn-authority.server";
import { toRoomAuthorityContext } from "@/lib/work-management/room-turn-authority";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { createFidelityCheckpoint, claimFidelityObservation, completeFidelityObservation, fidelityRunIdFor, fidelityCohorts,
  type FidelityObservation as Observation } from "./tool-fidelity-checkpoint";
import { GOLDEN_CASES, buildToolFidelitySurface, scoreToolFidelityExecution, scoreToolFidelitySelection } from "@/lib/routing/tool-fidelity-harness";

type Selection = { endpointId: string; modelId: string; providerConnectionId: string;
  fidelityRunId?: string; fidelityObservationIndex?: number };
const SURFACES = [8, 15, 24, 32, 48] as const;
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const refusal = (message: string): ToolResult => ({ success: false, error: "fidelity_unrun", message });

function responseModelMatches(actual: string, requested: string, proof: LocalThinkingBudgetEvidence): boolean {
  if (canonicalLocalModelKey(actual) === canonicalLocalModelKey(requested)) return true;
  // DMR can return its absolute GGUF bundle path instead of the registry name.
  // Bind that representation to the independently observed runtime digest.
  const path = actual.replace(/\\/g, "/");
  if (proof.dialect !== "llama.cpp-b9879" || !/^sha256:[a-f0-9]{64}$/.test(proof.modelDigest)
    || !/^(?:[A-Za-z]:\/|\/(?!\/))/.test(path) || /[\u0000-\u001f\u007f]/.test(path)
    || path.split("/").some(part => part === "." || part === "..")) return false;
  const bundle = /\/bundles\/sha256\/([a-f0-9]{64})\/model\/model\.gguf$/.exec(path);
  return !!bundle && `sha256:${bundle[1]}` === proof.modelDigest;
}

async function authoritySnapshot(userId: string, context: ToolExecutionContext) {
  if (!context.agentId || !context.governedRoomAuthority) return null;
  const [human, agent] = await Promise.all([currentUserContext(userId),
    prisma.agent.findUnique({ where: { agentId: context.agentId }, select: { status: true, archived: true } })]);
  if (!human || !agent || agent.status !== "active" || agent.archived) return null;
  const humanRoles = [...(human.platformRoles ?? (human.platformRole ? [human.platformRole] : []))].sort();
  const admitted = context.userContext;
  const admittedRoles = [...(admitted?.platformRoles ?? (admitted?.platformRole ? [admitted.platformRole] : []))].sort();
  if (!admitted || human.isSuperuser !== admitted.isSuperuser || hash(humanRoles) !== hash(admittedRoles)) return null;
  const room = structuredClone(context.governedRoomAuthority());
  if (room) {
    const row = await prisma.workroom.findUnique({ where: { capsuleId: room.workroomId! },
      select: { id: true, status: true, archivedAt: true } });
    if (!row || row.archivedAt || TERMINAL_WORKROOM_STATUSES.has(row.status)) return null;
    const [access, current] = await Promise.all([
      resolveAgentWorkroomAccess({ userId, agentId: context.agentId, workroomId: row.id, requested: "content" }),
      loadRoomTurnAuthority({ agentId: context.agentId, capsuleId: room.workroomId }),
    ]);
    if (access.decision.level !== "content" || hash(toRoomAuthorityContext(current)) !== hash(room)) return null;
  }
  let authorityKey = `portal:${userId}`;
  let token: unknown = null;
  if (context.apiTokenId) {
    const row = await prisma.mcpApiToken.findUnique({ where: { id: context.apiTokenId }, select: {
      userId: true, agentId: true, scopes: true, scope: true, kind: true, revokedAt: true, expiresAt: true,
      workroomRef: true, runRef: true } });
    const scopes = expandGrants(row?.scopes ?? []).sort();
    if (!row || row.userId !== userId || (row.agentId && row.agentId !== context.agentId)
      || row.revokedAt || hash(scopes) !== hash([...new Set(context.tokenGrantScopes ?? [])].sort())
      || row.scope !== context.tokenScope || (row.workroomRef && row.workroomRef !== room?.workroomId)) return null;
    if (context.authSource !== "oauth" && row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
    const key = await resolveMcpTaskAuthorityKey({ tokenId: context.apiTokenId, userId, source: context.authSource ?? "" });
    if (!key) return null;
    authorityKey = key;
    token = { scopes, scope: row.scope, agentId: row.agentId,
      kind: row.kind, workroomRef: row.workroomRef, runRef: row.runRef };
  }
  return { ownerHash: hash({ userId, agentId: context.agentId, authorityKey }),
    human: { isSuperuser: human.isSuperuser, roles: humanRoles }, room, token };
}

/** Existing diagnostic mode; no public injection seam, retries, fallback or cap writes. */
export async function runLocalToolFidelityDiagnostic(
  selection: Selection, userId: string, context: ToolExecutionContext | undefined,
): Promise<ToolResult> {
  if (!isLocalProviderId(selection.endpointId) || !selection.modelId?.trim()
    || selection.modelId === "default" || !selection.providerConnectionId?.trim()) {
    return refusal("Fidelity requires one explicit local provider, account and model.");
  }
  if (!context?.agentId || !context.userContext || !context.governedDispatch || !context.governedReadToolCatalog
    || !context.governedRoomAuthority || (context.apiTokenId && !context.tokenGrantScopes)) {
    return refusal("Fidelity requires the original governed actor, catalog and dispatch authority.");
  }
  const { agentId, threadId, governedDispatch, governedReadToolCatalog } = context;
  if (!Number.isInteger(selection.fidelityObservationIndex) || selection.fidelityObservationIndex! < 0
    || selection.fidelityObservationIndex! >= 45) return refusal("Choose one explicit observation index from 0 to 44.");
  const outerSignal = currentInferenceSignal();
  let authority: Awaited<ReturnType<typeof authoritySnapshot>>;
  try { authority = await authoritySnapshot(userId, context); } catch { authority = null; }
  if (!authority) return refusal("Current human, token, agent or room authority is unverified.");
  const version = await loadPlatformVersion();
  if (!/^[a-f0-9]{40}$/.test(version.gitSha ?? "") || !/^[a-f0-9]{64}$/.test(version.sourceContentHash ?? "")) {
    return refusal("The served source and runtime identity are unavailable.");
  }
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: selection.endpointId },
    select: { providerId: true, baseUrl: true, endpoint: true } });
  if (!provider) return refusal("The selected local provider is unavailable.");
  const apiRoot = getOllamaApiRoot(provider);
  const readIdentity = async () => {
    invalidateRoutingLoaderCache();
    const [manifests, proof] = await Promise.all([
      loadEndpointManifests(), getLocalThinkingBudgetEvidence(apiRoot, selection.modelId),
    ]);
    const candidates = manifests.filter(m => m.providerId === selection.endpointId && m.modelId === selection.modelId
      && m.providerConnectionId === selection.providerConnectionId);
    const endpoint = candidates.length === 1 ? candidates[0]! : null;
    if (!endpoint || !["active", "degraded"].includes(endpoint.status)
      || endpoint.supportsToolUse === false || !["chat", "reasoning", "code"].includes(endpoint.modelClass)
      || !endpointGenuinelyClearsSensitivity(endpoint, "public") || !endpoint.providerConnectionVersion || !proof) return null;
    const { observedAt: _observedAt, ...runtime } = proof;
    const identity = { providerId: selection.endpointId, modelId: selection.modelId,
      providerConnectionId: selection.providerConnectionId, accountVersion: endpoint.providerConnectionVersion,
      executionAdapter: resolveDefaultExecutionAdapter(selection.endpointId), sensitivity: "public",
      sourceSha: version.gitSha, sourceContentHash: version.sourceContentHash, runtime };
    return { endpoint, proof, identity, fingerprint: hash(identity) };
  };
  const initial = await readIdentity();
  if (!initial) return refusal("Exact eligible account/model and observed local runtime digest are unavailable; no inference ran.");
  const readCatalog = async () => {
    const tools = await governedReadToolCatalog();
    return tools.filter(tool => tool.sideEffect === false && !tool.consequence && !tool.consequenceForCall && !tool.requiresExternalAccess
      && !tool.secretResultKeys?.length && (!context.apiTokenId
        || isToolAllowedByGrants(tool.name, context.tokenGrantScopes!)))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const catalog = await readCatalog();
  const catalogDigest = hash(catalog);
  const goldenDigest = hash(GOLDEN_CASES);
  const executionMs = resolveInferenceRuntimePolicy(selection.endpointId, selection.modelId,
    { localTimeoutMs: process.env.DPF_LOCAL_INFERENCE_TIMEOUT_MS }).effectiveTimeoutMs;
  const admissionMs = resolveAcquireTimeoutMs(currentInferenceOrigin());
  const stepBudgetMs = admissionMs + executionMs;
  if (!Number.isSafeInteger(stepBudgetMs) || stepBudgetMs <= 0 || stepBudgetMs > 2_147_483_647) {
    return refusal("The configured admission and execution policies do not provide a finite supported window.");
  }
  const bindingHash = hash({ identity: initial.identity, catalogDigest, goldenDigest, authority });
  const expectedRunId = fidelityRunIdFor(userId, authority.ownerHash, bindingHash);
  if (selection.fidelityRunId && selection.fidelityRunId !== expectedRunId) return refusal("The requested run does not match current authority and cohort identity.");
  if (!selection.fidelityRunId && selection.fidelityObservationIndex !== 0) return refusal("Continuation requires the server-issued run ID.");
  const schedule: Observation[] = SURFACES.flatMap(surfaceSize => GOLDEN_CASES.map((golden, caseIndex) => ({
    surfaceSize, caseIndex, taskClass: golden.taskClass, status: "unrun", selectionPassed: false,
    executionPassed: false, reason: "not_dispatched" })));
  const checkpoint = await createFidelityCheckpoint({ userId, ownerHash: authority.ownerHash, bindingHash,
    identity: { ...initial.identity, catalogDigest, goldenDigest }, endpointId: selection.endpointId,
    modelId: selection.modelId, now: Date.now(), stepBudgetMs, schedule });
  const { runId } = checkpoint;
  const request = { runId, userId, ownerHash: authority.ownerHash, bindingHash,
    observationIndex: selection.fidelityObservationIndex!, now: Date.now() };
  const claim = await claimFidelityObservation(request);
  let stored = claim.stored;
  if (claim.kind === "claimed") {
    const observation = { ...stored.observations[claim.observationIndex]! };
    const { surfaceSize, caseIndex } = observation;
    const golden = GOLDEN_CASES[caseIndex]!;
    const executions = new Set(stored.observations.flatMap(o => o.toolExecutionId ? [o.toolExecutionId] : []));
    const controller = new AbortController();
    let turnDeadline = Math.min(claim.expiresAt, Date.now() + stepBudgetMs,
      currentGovernedInferenceDeadline()?.deadlineAt ?? Infinity);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timing: NonNullable<Observation["timing"]> = { phaseAtStop: "unknown", providerDispatch: "unverified" };
    observation.timing = timing;
    const armTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error("fidelity_observation_expired")), Math.max(0, turnDeadline - Date.now()));
      timer.unref?.();
    };
    const stopExpiredTurn = () => {
      if (Date.now() < turnDeadline && !controller.signal.aborted && !outerSignal?.aborted) return false;
      observation.status = "incomplete"; observation.reason = "budget_or_cancellation";
      observation.selectionPassed = false; observation.executionPassed = false;
      return true;
    };
    const verifyCurrent = async () => {
      if (stopExpiredTurn()) return false;
      const current = await authoritySnapshot(userId, context);
      const actual = await readIdentity();
      return !!current && hash(current) === hash(authority) && !!actual
        && actual.fingerprint === initial.fingerprint && hash(await readCatalog()) === catalogDigest && !stopExpiredTurn();
    };
    armTimer();
    try {
    const surface = buildToolFidelitySurface(catalog, surfaceSize);
      await withInferenceCancellation(controller.signal, () => withInferenceAuthorityCheck(verifyCurrent, async () => {
        if (!surface) { observation.reason = "insufficient_authorized_catalog"; return; }
        const before = await readIdentity();
        if (!before || !await verifyCurrent()) {
          observation.reason = "identity_catalog_or_authority_changed"; return;
        }
        if (stopExpiredTurn()) return;
        const traceId = createRoutingTraceId();
        observation.traceId = traceId;
          if (stopExpiredTurn()) return;
          const answer = await withInferenceAdmissionObserver(event => {
            if (event.phase === "queued") timing.queuedAt = event.at;
            if (event.phase === "acquired") {
              timing.acquiredAt = event.at;
              turnDeadline = Math.min(turnDeadline, event.at + executionMs);
              armTimer();
            }
            if (event.phase === "released") timing.releasedAt = event.at;
            if (event.phase === "canceled") timing.canceledAt = event.at;
            if (event.phase === "timed-out") timing.admissionTimedOutAt = event.at;
          }, () => awaitInferenceCancellation(
            callProvider(selection.endpointId, selection.modelId, [{ role: "user", content: golden.prompt }],
              "Select an appropriate read tool for this question. Do not claim an action completed.",
              surface.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
              { providerId: selection.endpointId, modelId: selection.modelId,
                providerConnectionId: selection.providerConnectionId, providerConnectionVersion: before.endpoint.providerConnectionVersion,
                accountAuthMethod: before.endpoint.accountAuthMethod, executionChannel: before.endpoint.executionChannel,
                recipeId: null, contractFamily: "model-calibration.endpoint-diagnostic", executionAdapter: initial.identity.executionAdapter,
                maxTokens: 512, providerSettings: {}, toolPolicy: { toolChoice: "auto", allowParallelToolCalls: false }, responsePolicy: {} },
              undefined, undefined, { traceId, agentId, threadId,
                ...(context.featureBuildId ? { buildId: context.featureBuildId } : {}) }), currentInferenceSignal()!));
          const after = await readIdentity();
          const actualModel = isRecord(answer.raw) && typeof answer.raw.model === "string" ? answer.raw.model : null;
          if (!after || after.fingerprint !== initial.fingerprint || !actualModel
            || !responseModelMatches(actualModel, selection.modelId, after.proof)) {
            observation.status = "incomplete"; observation.reason = "model_identity_unverified"; return;
          }
          if (stopExpiredTurn()) return;
          const scored = scoreToolFidelitySelection(golden, surface, answer);
          observation.status = scored.status;
          observation.reason = scored.status === "passed" ? "execution_unverified" : "selection_not_verified";
          if (stopExpiredTurn()) return;
          if (scored.status !== "passed" || !scored.call) return;
          observation.selectionPassed = true;
          await assertGovernedInferenceAuthority();
          if (stopExpiredTurn()) return;
          const executed = await awaitInferenceCancellation(governedDispatch(scored.call.name, scored.call.arguments),
            outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal);
          const id = executed.governance?.toolExecutionId;
          const row = id && !executions.has(id) ? await prisma.toolExecution.findUnique({ where: { id },
            select: { id: true, toolName: true, parameters: true, userId: true, agentId: true, threadId: true,
              taskRunId: true, success: true, durationMs: true, result: true, auditClass: true } }) : null;
          if (id) { observation.toolExecutionId = id; executions.add(id); }
          if (!await verifyCurrent()) {
            observation.status = "incomplete"; observation.reason = "authority_or_identity_unverified";
            observation.selectionPassed = false; observation.executionPassed = false; return;
          }
          observation.executionPassed = executed.success && scoreToolFidelityExecution({ toolName: scored.call.name,
            parameters: scored.call.arguments, userId, agentId, threadId: threadId ?? "", taskRunId: context.taskRunId ?? null }, id, row, executed);
          observation.status = observation.executionPassed ? "passed" : "failed";
          observation.reason = observation.executionPassed ? "verified_governed_read" : "execution_not_verified";
          stopExpiredTurn();
      }));
      } catch {
        observation.status = "incomplete"; observation.reason = "observation_incomplete";
        observation.selectionPassed = false; observation.executionPassed = false;
      } finally {
        if (timer) clearTimeout(timer);
        timing.phaseAtStop = timing.acquiredAt !== undefined ? "after-acquisition"
          : timing.queuedAt !== undefined ? "waiting" : "unknown";
      }
    stopExpiredTurn();
    await completeFidelityObservation(claim, observation, Date.now());
    // Read after CAS, never return an optimistic result rejected by a newer fence.
    stored = (await claimFidelityObservation({ ...request, now: Date.now() })).stored;
  }
  const observations = stored.observations;
  const cohorts = fidelityCohorts(observations);
  const qualified = stored.checkpoint.state === "completed" && cohorts.every(c => c.qualified);
  const result = { runId, identity: initial.identity, identityFingerprint: initial.fingerprint,
    catalogDigest, goldenDigest, sensitivity: "public", cohorts, observations, qualified,
    checkpoint: stored.checkpoint, capChanged: false, classSpecificQualification: false, runtimeAcceptance: "unverified" };
  return { success: true, message: "One local fidelity observation or its existing checkpoint returned. Explicit continuation is required; production caps are unchanged.", data: result };
}

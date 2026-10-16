import { randomUUID, createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";
import { callProvider } from "@/lib/ai-inference";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { isToolAllowedByGrants } from "@/lib/agent-grants";
import { loadPlatformVersion } from "@/lib/platform/version";
import { getLocalThinkingBudgetEvidence } from "@/lib/inference/dmr-runtime-config";
import { getOllamaApiRoot } from "@/lib/inference/ollama-url";
import { canonicalLocalModelKey } from "@/lib/inference/local-model-management";
import { isRecord } from "@/lib/shared/coerce";
import { boundLargeStrings } from "@/lib/evidence/bounded-evidence-output";
import { loadEndpointManifests, invalidateRoutingLoaderCache } from "@/lib/routing/loader";
import { endpointGenuinelyClearsSensitivity } from "@/lib/routing/sensitivity-clearance";
import { resolveDefaultExecutionAdapter } from "@/lib/routing/execution-plan";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { createRoutingTraceId } from "@/lib/routing/routing-trace";
import { currentInferenceSignal, withInferenceCancellation, awaitInferenceCancellation } from "@/lib/routing/governed-inference-deadline";
import { GOLDEN_CASES, scoreToolFidelityExecution, scoreToolFidelitySelection } from "@/lib/routing/tool-fidelity-harness";
import { DEFAULT_FIDELITY_THRESHOLD, DEFAULT_MIN_SAMPLE_COUNT } from "@/lib/routing/tool-fidelity-policy";

type Selection = { endpointId: string; modelId: string; providerConnectionId: string };
type Observation = { surfaceSize: number; caseIndex: number; taskClass: string;
  status: "unrun" | "incomplete" | "failed" | "passed"; selectionPassed: boolean;
  executionPassed: boolean; reason: string; traceId?: string; toolExecutionId?: string };
const SURFACES = [8, 15, 24, 32, 48] as const;
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
const refusal = (message: string): ToolResult => ({ success: false, error: "fidelity_unrun", message });

/** Existing diagnostic mode; no public injection seam, retries, fallback or cap writes. */
export async function runLocalToolFidelityDiagnostic(
  selection: Selection, userId: string, context: ToolExecutionContext | undefined,
): Promise<ToolResult> {
  if (!isLocalProviderId(selection.endpointId) || !selection.modelId?.trim()
    || selection.modelId === "default" || !selection.providerConnectionId?.trim()) {
    return refusal("Fidelity requires one explicit local provider, account and model.");
  }
  if (!context?.agentId || !context.userContext || !context.governedDispatch || !context.governedReadToolCatalog
    || (context.apiTokenId && !context.tokenGrantScopes)) {
    return refusal("Fidelity requires the original governed actor, catalog and dispatch authority.");
  }
  const { agentId, threadId, governedDispatch, governedReadToolCatalog } = context;
  const deadline = Date.now() + 240_000;
  const outerSignal = currentInferenceSignal();
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
  const runId = `fidelity-${randomUUID()}`;
  const run = await prisma.endpointTestRun.create({ data: { runId, endpointId: selection.endpointId,
    modelId: selection.modelId, taskType: "tool-fidelity", triggeredBy: userId, probesOnly: false, status: "running" } });
  const observations: Observation[] = [];
  const executions = new Set<string>();
  let stopped = false;
  for (const surfaceSize of SURFACES) {
    // Prefer a correct read that needs no target identifiers absent from the prompt.
    // Every entry still comes from the original authorized catalog; no stub padding.
    const pinned = new Set(GOLDEN_CASES.map(golden => {
      const matches = catalog.filter(tool => golden.correctToolNames.includes(tool.name));
      return (matches.find(tool => !Array.isArray(tool.inputSchema.required) || tool.inputSchema.required.length === 0) ?? matches[0])?.name;
    }));
    const surface: ToolDefinition[] = [...catalog.filter(tool => pinned.has(tool.name)), ...catalog.filter(tool => !pinned.has(tool.name))].slice(0, surfaceSize);
    const validSurface = surface.length === surfaceSize && new Set(surface.map(tool => tool.name)).size === surfaceSize
      && GOLDEN_CASES.every(golden => surface.some(tool => golden.correctToolNames.includes(tool.name)));
    for (const [caseIndex, golden] of GOLDEN_CASES.entries()) {
      const observation: Observation = { surfaceSize, caseIndex, taskClass: golden.taskClass, status: "unrun",
        selectionPassed: false, executionPassed: false, reason: "not_dispatched" };
      observations.push(observation);
      if (stopped || Date.now() >= deadline || outerSignal?.aborted) { stopped = true; observation.reason = "budget_or_cancellation"; continue; }
      if (!validSurface) { observation.reason = "insufficient_authorized_catalog"; continue; }
      try {
        const before = await readIdentity();
        if (!before || before.fingerprint !== initial.fingerprint || hash(await readCatalog()) !== catalogDigest) {
          stopped = true; observation.reason = "identity_or_catalog_changed"; continue;
        }
        if (Date.now() >= deadline || outerSignal?.aborted) { stopped = true; observation.reason = "budget_or_cancellation"; continue; }
        const traceId = createRoutingTraceId();
        observation.traceId = traceId;
        const controller = new AbortController();
        const turnDeadline = Math.min(deadline, Date.now() + 30_000);
        const stopExpiredTurn = () => {
          if (Date.now() < turnDeadline && !controller.signal.aborted && !outerSignal?.aborted) return false;
          stopped = true; observation.status = "incomplete"; observation.reason = "budget_or_cancellation";
          observation.executionPassed = false;
          return true;
        };
        const timer = setTimeout(() => controller.abort(), Math.max(0, turnDeadline - Date.now()));
        timer.unref?.();
        try {
          if (stopExpiredTurn()) continue;
          const answer = await withInferenceCancellation(controller.signal, () => awaitInferenceCancellation(
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
            || canonicalLocalModelKey(actualModel) !== canonicalLocalModelKey(selection.modelId)) {
            stopped = true; observation.status = "incomplete"; observation.reason = "model_identity_unverified"; continue;
          }
          if (stopExpiredTurn()) continue;
          const scored = scoreToolFidelitySelection(golden, surface, answer);
          observation.status = scored.status;
          observation.reason = scored.status === "passed" ? "execution_unverified" : "selection_not_verified";
          if (stopExpiredTurn()) continue;
          if (scored.status !== "passed" || !scored.call) continue;
          observation.selectionPassed = true;
          if (stopExpiredTurn()) continue;
          const executed = await awaitInferenceCancellation(governedDispatch(scored.call.name, scored.call.arguments),
            outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal);
          const id = executed.governance?.toolExecutionId;
          const row = id && !executions.has(id) ? await prisma.toolExecution.findUnique({ where: { id },
            select: { id: true, toolName: true, parameters: true, userId: true, agentId: true, threadId: true,
              taskRunId: true, success: true, durationMs: true, result: true, auditClass: true } }) : null;
          if (id) { observation.toolExecutionId = id; executions.add(id); }
          observation.executionPassed = executed.success && scoreToolFidelityExecution({ toolName: scored.call.name,
            parameters: scored.call.arguments, userId, agentId, threadId: threadId ?? "", taskRunId: context.taskRunId ?? null }, id, row, executed);
          observation.status = observation.executionPassed ? "passed" : "failed";
          observation.reason = observation.executionPassed ? "verified_governed_read" : "execution_not_verified";
          stopExpiredTurn();
        } finally { clearTimeout(timer); }
      } catch {
        observation.status = "incomplete"; observation.reason = "observation_incomplete";
        // Unknown dispatch/admission failures are not invitations to retry or switch models.
        stopped = true;
      }
    }
  }
  const cohorts = SURFACES.map(surfaceSize => {
    const group = observations.filter(o => o.surfaceSize === surfaceSize);
    const complete = group.length === GOLDEN_CASES.length && group.every(o => o.status === "passed" || o.status === "failed");
    const selectionAccuracy = group.filter(o => o.selectionPassed).length / GOLDEN_CASES.length;
    const executionAccuracy = group.filter(o => o.executionPassed).length / GOLDEN_CASES.length;
    return { surfaceSize, sampleCount: group.filter(o => o.status === "passed" || o.status === "failed").length,
      complete, selectionAccuracy, executionAccuracy, qualified: complete && group.length >= DEFAULT_MIN_SAMPLE_COUNT
        && selectionAccuracy >= DEFAULT_FIDELITY_THRESHOLD && executionAccuracy >= DEFAULT_FIDELITY_THRESHOLD };
  });
  const qualified = cohorts.every(c => c.qualified);
  const result = { runId, identity: initial.identity, identityFingerprint: initial.fingerprint,
    catalogDigest, goldenDigest, sensitivity: "public", cohorts, observations, qualified,
    capChanged: false, classSpecificQualification: false, runtimeAcceptance: "unverified" };
  await prisma.endpointTestRun.update({ where: { id: run.id }, data: { completedAt: new Date(),
    status: cohorts.every(c => c.complete) ? "completed" : "incomplete", results: boundLargeStrings(result) as unknown as Prisma.InputJsonValue } });
  return { success: true, message: "Bounded local fidelity observation recorded; production caps are unchanged.", data: result };
}

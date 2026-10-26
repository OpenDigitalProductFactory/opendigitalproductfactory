import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma } from "@dpf/db";
import type { ChatMessage } from "../routing/chat-message-types";
import type { RouteSensitivity } from "../agent-sensitivity";
import type { RoutedExecutionPlan } from "../routing/recipe-types";
import { parseExecutionAdapterSelector } from "../routing/execution-adapter-types";
import { accountAuthMethod, providerAccountExecutionBlock } from "../routing/provider-account-candidates";
import { currentFiniteReassessmentExecution, refuseReassessmentExecution, type QualifiedReassessmentExecution } from "../routing/reassessment-execution-scope";
import type { RouteAndCallOptions } from "./routed-inference-options";
import { readReassessmentBudgetConfiguration, checkReassessmentBudget } from "./budget-gate";
import { readReassessmentProviderAuthHeaders } from "./provider-account-credentials";
import { getLocalOnlyInferenceFresh } from "./local-only";
import { isLocalProviderId } from "../routing/provider-locality";
import { reassessmentNativeRuntimeUrls, nativeRuntimeReaderFor, captureReassessmentNativeRuntime,
  assertNativeRuntimeMatches, type ReassessmentNativeRuntimeObservation } from "./reassessment-native-runtime";
import { reassessmentNativeCatalogDigest, validAuditedReassessmentNativeQualification } from "../shared/reassessment-native-composition";
import { spendAwareBudgetClass } from "./spend-aware-routing";
import { REASSESSMENT_NATIVE_COMPOSITION } from "../shared/reassessment-native-composition";
import { canonicalLocalModelKey } from "./local-model-management";
import { buildDefaultPlan, bindActivityExecutionPlan } from "../routing/execution-plan";
import { bindProviderAccountExecution } from "../routing/provider-account-candidates";
import { applyCallerExecutionPlanOverrides } from "./routed-inference-plan-overrides";
export type { QualifiedReassessmentExecution } from "../routing/reassessment-execution-scope";

const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
function refuse(code: string): never { return refuseReassessmentExecution(code); }
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const jsonSnapshot = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function jsonPlan(plan: RoutedExecutionPlan): RoutedExecutionPlan {
  const seen = new Set<object>();
  const validate = (value: unknown): void => {
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || seen.has(value)
      || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) refuse("reassessment-plan-invalid");
    seen.add(value); Object.values(value).forEach(validate); seen.delete(value);
  };
  validate(plan);
  // Optional undefined properties have no JSON/wire value; normalize them
  // before sealing rather than presenting them as lossless captured fields.
  return JSON.parse(canonicalJson(plan)) as RoutedExecutionPlan;
}

/** These are static composition facts, never a connectivity/model smoke test. */
function assertSupportedPlan(plan: RoutedExecutionPlan, native = false): void {
  const nativeAccount = native && plan.providerId === "local" && plan.executionChannel === "local-runtime" && plan.accountAuthMethod === "none";
  if (!plan.providerConnectionId || !/^[a-f0-9]{64}$/.test(plan.providerConnectionVersion ?? "")
    || !nativeAccount && plan.executionChannel !== "direct-api" || !["api_key", "none"].includes(plan.accountAuthMethod ?? "")
    || !positive(plan.maxTokens) || plan.providerId === "chatgpt"
    || plan.providerSettings.providerTools !== undefined || plan.providerSettings.thinking_budget_tokens !== undefined
    || !native && plan.localThinkingBudgetEvidence !== undefined || plan.capabilityRequirements?.some(requirement => requirement.required)) {
    refuse("reassessment-composition-unsupported");
  }
  if (native && (!nativeAccount || Object.keys(plan.providerSettings).length || plan.localThinkingBudgetRequest !== undefined)) refuse("reassessment-native-settings-unsupported");
  if (plan.executionAdapter !== "responses") {
    let kind: string;
    try { kind = parseExecutionAdapterSelector(plan.executionAdapter).kind; }
    catch { return refuse("reassessment-adapter-unproven"); }
    if (!["http-generic", "http-anthropic", "http-openai", "http-gemini", "http-ollama"].includes(kind)) {
      refuse("reassessment-adapter-unsupported");
    }
  }
  // Anthropic's ordinary thinking path raises max_tokens unless an admitted
  // activity supplies the explicit total completion allowance.
  const thinking = plan.providerSettings.thinking;
  const effort = plan.providerSettings.effort;
  if ((plan.providerId === "anthropic" || plan.providerId.startsWith("anthropic-"))
    && (thinking || typeof effort === "string" && ["medium", "high", "max"].includes(effort))
    && plan.completionAllowance !== plan.maxTokens) refuse("reassessment-output-bound-unproven");
  if (plan.completionAllowance !== undefined && plan.completionAllowance !== plan.maxTokens) {
    refuse("reassessment-output-bound-conflict");
  }
}

async function readProviderConfiguration(plan: RoutedExecutionPlan, native = false) {
  const [provider, account, model] = await Promise.all([
    prisma.modelProvider.findUnique({ where: { providerId: plan.providerId } }),
    prisma.aiProviderConnection.findUnique({ where: { connectionId: plan.providerConnectionId! },
      select: { connectionId: true, providerId: true, status: true, authMethod: true, executionChannel: true,
        credentialEntryId: true, updatedAt: true, credentialEntry: { select: { status: true, updatedAt: true } },
        accessibleModelIds: true, modelsVerifiedAt: true, evidenceStatus: true, accountClass: true,
        supplierContractId: true, lastReviewedAt: true } }),
    prisma.modelProfile.findUnique({ where: { providerId_modelId: { providerId: plan.providerId, modelId: plan.modelId } } }),
  ]);
  const accountBlock = providerAccountExecutionBlock(account, plan);
  if (accountBlock) refuse("reassessment-provider-account-changed");
  if (!provider || !account || !model || !["active", "degraded"].includes(provider.status)
    || !["active", "degraded"].includes(model.modelStatus) || provider.retiredAt || model.retiredAt
    || account.executionChannel !== (native ? "local-runtime" : "direct-api") || accountAuthMethod(account.authMethod) !== plan.accountAuthMethod
    || !["llm", "chat", "responses", "gemini", "ollama"].includes(provider.endpointType)
    || !["api_key", "none"].includes(plan.accountAuthMethod ?? "")) refuse("reassessment-provider-configuration-unproven");
  const baseUrl = provider.baseUrl ?? provider.endpoint;
  let endpoint: URL;
  try { endpoint = new URL(baseUrl!); }
  catch { return refuse("reassessment-provider-endpoint-unproven"); }
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    refuse("reassessment-provider-endpoint-unproven");
  }
  if (plan.accountAuthMethod === "api_key" && !provider.authHeader) refuse("reassessment-provider-auth-unproven");
  if (model.maxOutputTokens !== null && model.maxOutputTokens !== undefined
    && (!positive(model.maxOutputTokens) || plan.maxTokens > model.maxOutputTokens)) refuse("reassessment-output-bound-conflict");
  const nativeObservationUrls = native ? reassessmentNativeRuntimeUrls(provider, plan.modelId) : undefined;
  return { provider, configurationDigest: digest(jsonSnapshot({ provider, account, model, ...(native ? { nativeObservationUrls } : {}) })), nativeObservationUrls };
}

export type ReassessmentQualificationInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  sensitivity: RouteSensitivity;
  options: RouteAndCallOptions & { agentId: string };
  effortWarrant: { maxIterations: number; maxDurationMs: number };
  toolSurfaceDigest: string;
};

function assertInput(input: ReassessmentQualificationInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.toolSurfaceDigest) || !positive(input.effortWarrant.maxIterations)
    || !positive(input.effortWarrant.maxDurationMs) || input.effortWarrant.maxIterations > 200
    || input.options.maxDurationMs !== undefined && !positive(input.options.maxDurationMs)) refuse("reassessment-current-bounds-unproven");
}

/** Source-owned catalog/account candidate only. This performs no HTTP, normal
 * selection, allocation or execution admission; absent runtime facts stay absent. */
export async function precheckReassessmentNativeCandidate(input: ReassessmentQualificationInput, candidatePlan: RoutedExecutionPlan) {
  assertInput(input); const plan = jsonPlan(candidatePlan); assertSupportedPlan(plan, true);
  if (canonicalLocalModelKey(plan.modelId) !== canonicalLocalModelKey(REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef)) refuse("reassessment-native-catalog-model-unsupported");
  const budgetConfiguration = await readReassessmentBudgetConfiguration(input.options.agentId);
  if (!positive(budgetConfiguration.configuredPerTaskLimit)) refuse("reassessment-native-finite-budget-required");
  const daily = await checkReassessmentBudget(budgetConfiguration);
  if (plan.maxTokens > budgetConfiguration.configuredMaxOutputTokens) refuse("reassessment-output-bound-conflict");
  const current = await readProviderConfiguration(plan, true);
  await readReassessmentProviderAuthHeaders({ providerId: plan.providerId, authMethod: "none", authHeader: current.provider.authHeader,
    connectionId: plan.providerConnectionId, expectedExecutionVersion: plan.providerConnectionVersion });
  return { schemaVersion: 1 as const, kind: "supported-native-method" as const, catalogDigest: reassessmentNativeCatalogDigest(),
    candidatePlan: plan, provider: current.provider, providerConfigurationDigest: current.configurationDigest, budgetConfiguration,
    nativeObservationUrls: current.nativeObservationUrls!,
    spendAwareBudgetClass: spendAwareBudgetClass(input.options.budgetClass, daily.status),
    bounds: { maxProviderStarts: input.effortWarrant.maxIterations, maxOutputTokens: plan.maxTokens,
      maxDurationMs: Math.min(input.effortWarrant.maxDurationMs, budgetConfiguration.configuredTimeoutMs,
        input.options.maxDurationMs ?? input.effortWarrant.maxDurationMs) } };
}

/** Normal current V2 preview with explicit unknown local facts and zero runtime
 * HTTP. A catalog plan returned for an unknown-only exclusion is support-only;
 * it grants no execution permission or assertion that local will win. */
export async function prepareReassessmentNativeCandidateRoute(input: ReassessmentQualificationInput) {
  assertInput(input);
  const budget = await readReassessmentBudgetConfiguration(input.options.agentId), daily = await checkReassessmentBudget(budget);
  const { prepareReassessmentNativeStaticRoute } = await import("./routed-inference");
  const route = await prepareReassessmentNativeStaticRoute(input.messages, input.systemPrompt, input.sensitivity, input.options,
    { reader: async () => null, budgetStatus: daily.status });
  if (route.decision.routingConfidence?.qualityFloorRelaxed) refuse("reassessment-native-quality-floor-relaxed");
  const native = route.manifests.filter(endpoint => endpoint.providerId === "local" && endpoint.executionChannel === "local-runtime"
    && endpoint.accountAuthMethod === "none" && canonicalLocalModelKey(endpoint.modelId) === canonicalLocalModelKey(REASSESSMENT_NATIVE_COMPOSITION.logicalModelRef));
  const selected = native.find(endpoint => endpoint.id === route.decision.selectedEndpoint);
  const unknownReasons = ["Activity completion capacity is unknown; refresh endpoint capacity evidence", "Activity context capacity is unknown; refresh endpoint capacity evidence"];
  const unknown = native.filter(endpoint => unknownReasons.includes(route.decision.candidates.find(candidate => candidate.endpointId === endpoint.id)?.excludedReason ?? ""));
  const candidate = selected ?? (unknown.length === 1 ? unknown[0] : undefined);
  if (!candidate) return { status: "unsupported-normal-winner" as const, route, budgetConfiguration: budget, candidatePlan: null };
  let plan = selected && route.decision.executionPlan ? route.decision.executionPlan : buildDefaultPlan(candidate, route.contract);
  if (!selected && input.options.activityContract) plan = bindActivityExecutionPlan(plan, input.options.activityContract,
    { providerId: candidate.providerId, modelId: candidate.modelId });
  plan = bindProviderAccountExecution(plan, candidate)!;
  plan = applyCallerExecutionPlanOverrides(plan, { maxOutputTokens: input.options.activityContract?.tokenEnvelope.maxOutputTokens,
    effort: input.options.effort ?? route.posture?.effort, toolChoice: input.options.toolChoice, terminalWriterToolName: input.options.terminalWriterToolName });
  return { status: selected ? "normal-native-selected" as const : "runtime-facts-required" as const, route,
    budgetConfiguration: budget, candidatePlan: plan };
}

/** Read-only qualification. It neither admits a TaskRun nor starts a provider. */
export async function qualifyReassessmentExecution(input: ReassessmentQualificationInput, nativeObservation?: ReassessmentNativeRuntimeObservation): Promise<QualifiedReassessmentExecution> {
  if (!/^[a-f0-9]{64}$/.test(input.toolSurfaceDigest) || !positive(input.effortWarrant.maxIterations)
    || !positive(input.effortWarrant.maxDurationMs) || input.effortWarrant.maxIterations > 200) refuse("reassessment-current-bounds-unproven");
  const budgetConfiguration = await readReassessmentBudgetConfiguration(input.options.agentId);
  // per_task_limit is recorded as total input+output. Current ordinary runtime
  // has no authenticated input-bound producer; estimates are not a proof. A
  // future producer must close that boundary before a finite policy qualifies.
  if (budgetConfiguration.configuredPerTaskLimit !== 0 && !nativeObservation) refuse("reassessment-total-bound-unproven");
  if (nativeObservation && !positive(budgetConfiguration.configuredPerTaskLimit)) refuse("reassessment-native-finite-budget-required");
  const daily = await checkReassessmentBudget(budgetConfiguration);
  const { prepareReassessmentRoute } = await import("./routed-inference");
  const routed = await prepareReassessmentRoute(input.messages, input.systemPrompt, input.sensitivity, input.options,
    nativeObservation ? { reader: nativeRuntimeReaderFor(nativeObservation), budgetStatus: daily.status } : undefined);
  if (nativeObservation && routed.decision?.routingConfidence?.qualityFloorRelaxed) refuse("reassessment-native-quality-floor-relaxed");
  const plan = jsonPlan(routed.executionPlan);
  if (nativeObservation && (plan.providerId !== "local" || plan.modelId !== nativeObservation.modelRef)) refuse("reassessment-native-normal-selection-unsupported");
  assertSupportedPlan(plan, !!nativeObservation);
  if (plan.maxTokens > budgetConfiguration.configuredMaxOutputTokens) refuse("reassessment-output-bound-conflict");
  if (input.options.maxDurationMs !== undefined && !positive(input.options.maxDurationMs)) refuse("reassessment-current-bounds-unproven");
  const current = await readProviderConfiguration(plan, !!nativeObservation);
  await readReassessmentProviderAuthHeaders({ providerId: plan.providerId, authMethod: plan.accountAuthMethod!,
    authHeader: current.provider.authHeader, connectionId: plan.providerConnectionId,
    expectedExecutionVersion: plan.providerConnectionVersion });
  const qualification = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const,
    providerId: plan.providerId, providerConnectionId: plan.providerConnectionId!, providerConnectionVersion: plan.providerConnectionVersion!,
    modelId: plan.modelId, executionPlan: structuredClone(plan), providerConfigurationDigest: current.configurationDigest,
    toolSurfaceDigest: input.toolSurfaceDigest, budgetConfiguration,
    ...(nativeObservation ? { finiteTokenProof: nativeObservation.finiteTokenProof, nativeRuntime: { schemaVersion: 2 as const,
      catalogDigest: nativeObservation.catalogDigest, observationDigest: nativeObservation.observationDigest,
      requestedBudgetClass: routed.requestedBudgetClass, spendAwareBudgetClass: routed.contract.budgetClass } } : {}),
    bounds: { maxProviderStarts: input.effortWarrant.maxIterations,
      maxDurationMs: Math.min(input.effortWarrant.maxDurationMs, budgetConfiguration.configuredTimeoutMs,
        input.options.maxDurationMs ?? input.effortWarrant.maxDurationMs), maxOutputTokens: plan.maxTokens } };
  const result = { ...qualification, qualificationDigest: digest(qualification) };
  if (nativeObservation && !validAuditedReassessmentNativeQualification(result)) refuse("reassessment-native-qualification-unproven");
  return result;
}

/** Recheck immediately after capacity admission and before every actual POST. */
export async function assertReassessmentQualificationCurrent(qualification: QualifiedReassessmentExecution): Promise<void> {
  const { qualificationDigest, ...unsigned } = qualification;
  if (digest(unsigned) !== qualificationDigest) refuse("reassessment-qualification-changed");
  const native = qualification.nativeRuntime !== undefined;
  if (native && !validAuditedReassessmentNativeQualification(qualification)) refuse("reassessment-native-qualification-changed");
  assertSupportedPlan(qualification.executionPlan, native);
  const budget = await readReassessmentBudgetConfiguration(qualification.budgetConfiguration.agentId);
  if (budget.configurationDigest !== qualification.budgetConfiguration.configurationDigest
    || !native && budget.configuredPerTaskLimit !== 0) refuse("reassessment-budget-configuration-changed");
  if (await getLocalOnlyInferenceFresh() && !isLocalProviderId(qualification.providerId)) {
    refuse("reassessment-residency-policy-changed");
  }
  const daily = await checkReassessmentBudget(budget);
  if (native && spendAwareBudgetClass(qualification.nativeRuntime!.requestedBudgetClass, daily.status)
    !== qualification.nativeRuntime!.spendAwareBudgetClass) refuse("reassessment-spend-policy-changed");
  const current = await readProviderConfiguration(qualification.executionPlan, native);
  if (current.configurationDigest !== qualification.providerConfigurationDigest) refuse("reassessment-provider-configuration-changed");
}

/** Fresh captured logical facts. Current server checks never recurse into this
 * runtime reader; each of its bounded GETs independently pays the same window. */
export async function refreshReassessmentNativeRuntime(qualification: QualifiedReassessmentExecution, fetchImpl: typeof fetch) {
  await assertReassessmentQualificationCurrent(qualification);
  const current = await readProviderConfiguration(qualification.executionPlan, true);
  const observed = await captureReassessmentNativeRuntime({ provider: current.provider, modelRef: qualification.modelId,
    fetchImpl, assertCurrent: () => assertReassessmentQualificationCurrent(qualification) });
  assertNativeRuntimeMatches(qualification, observed);
  return observed;
}

/** Actual E scopes re-run normal ranking with freshly captured logical facts. */
export async function prepareCurrentReassessmentNativeRouting() {
  const current = currentFiniteReassessmentExecution();
  if (!current) return undefined;
  const [{ currentGovernedInferenceDeadline }, { providerInferenceFetch, withInferenceCancellationFetch }] = await Promise.all([
    import("../routing/governed-inference-deadline"), import("./provider-inference-transport"),
  ]);
  const parent = currentGovernedInferenceDeadline()?.localFetch;
  const observed = await refreshReassessmentNativeRuntime(current.qualification, parent ? withInferenceCancellationFetch(parent) : providerInferenceFetch);
  const daily = await checkReassessmentBudget(current.qualification.budgetConfiguration);
  return { reader: nativeRuntimeReaderFor(observed), budgetStatus: daily.status };
}

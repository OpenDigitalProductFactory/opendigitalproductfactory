import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma } from "@dpf/db";
import type { ChatMessage } from "../routing/chat-message-types";
import type { RouteSensitivity } from "../agent-sensitivity";
import type { RoutedExecutionPlan } from "../routing/recipe-types";
import { parseExecutionAdapterSelector } from "../routing/execution-adapter-types";
import { accountAuthMethod, providerAccountExecutionBlock } from "../routing/provider-account-candidates";
import { refuseReassessmentExecution, type QualifiedReassessmentExecution } from "../routing/reassessment-execution-scope";
import type { EffortWarrant } from "../tak/effort-warrant";
import type { RouteAndCallOptions } from "./routed-inference-options";
import { readReassessmentBudgetConfiguration, checkReassessmentBudget } from "./budget-gate";
import { readReassessmentProviderAuthHeaders } from "./provider-account-credentials";
import { getLocalOnlyInferenceFresh } from "./local-only";
import { isLocalProviderId } from "../routing/provider-locality";
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
function assertSupportedPlan(plan: RoutedExecutionPlan): void {
  if (!plan.providerConnectionId || !/^[a-f0-9]{64}$/.test(plan.providerConnectionVersion ?? "")
    || plan.executionChannel !== "direct-api" || !["api_key", "none"].includes(plan.accountAuthMethod ?? "")
    || !positive(plan.maxTokens) || plan.providerId === "chatgpt"
    || plan.providerSettings.providerTools !== undefined || plan.providerSettings.thinking_budget_tokens !== undefined
    || plan.localThinkingBudgetEvidence !== undefined || plan.capabilityRequirements?.some(requirement => requirement.required)) {
    refuse("reassessment-composition-unsupported");
  }
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

async function readProviderConfiguration(plan: RoutedExecutionPlan) {
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
    || account.executionChannel !== "direct-api" || accountAuthMethod(account.authMethod) !== plan.accountAuthMethod
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
  return { provider, configurationDigest: digest(jsonSnapshot({ provider, account, model })) };
}

export type ReassessmentQualificationInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  sensitivity: RouteSensitivity;
  options: RouteAndCallOptions & { agentId: string };
  effortWarrant: EffortWarrant;
  toolSurfaceDigest: string;
};

/** Read-only qualification. It neither admits a TaskRun nor starts a provider. */
export async function qualifyReassessmentExecution(input: ReassessmentQualificationInput): Promise<QualifiedReassessmentExecution> {
  if (!/^[a-f0-9]{64}$/.test(input.toolSurfaceDigest) || !positive(input.effortWarrant.maxIterations)
    || !positive(input.effortWarrant.maxDurationMs) || input.effortWarrant.maxIterations > 200) refuse("reassessment-current-bounds-unproven");
  const budgetConfiguration = await readReassessmentBudgetConfiguration(input.options.agentId);
  // per_task_limit is recorded as total input+output. Current ordinary runtime
  // has no authenticated input-bound producer; estimates are not a proof. A
  // future producer must close that boundary before a finite policy qualifies.
  if (budgetConfiguration.configuredPerTaskLimit !== 0) refuse("reassessment-total-bound-unproven");
  await checkReassessmentBudget(budgetConfiguration);
  const { prepareReassessmentRoute } = await import("./routed-inference");
  const routed = await prepareReassessmentRoute(input.messages, input.systemPrompt, input.sensitivity, input.options);
  const plan = jsonPlan(routed.executionPlan);
  assertSupportedPlan(plan);
  if (plan.maxTokens > budgetConfiguration.configuredMaxOutputTokens) refuse("reassessment-output-bound-conflict");
  if (input.options.maxDurationMs !== undefined && !positive(input.options.maxDurationMs)) refuse("reassessment-current-bounds-unproven");
  const current = await readProviderConfiguration(plan);
  await readReassessmentProviderAuthHeaders({ providerId: plan.providerId, authMethod: plan.accountAuthMethod!,
    authHeader: current.provider.authHeader, connectionId: plan.providerConnectionId,
    expectedExecutionVersion: plan.providerConnectionVersion });
  const qualification = { schemaVersion: 1 as const, compositionVersion: "restricted-review-http-v1" as const,
    providerId: plan.providerId, providerConnectionId: plan.providerConnectionId!, providerConnectionVersion: plan.providerConnectionVersion!,
    modelId: plan.modelId, executionPlan: structuredClone(plan), providerConfigurationDigest: current.configurationDigest,
    toolSurfaceDigest: input.toolSurfaceDigest, budgetConfiguration,
    bounds: { maxProviderStarts: input.effortWarrant.maxIterations,
      maxDurationMs: Math.min(input.effortWarrant.maxDurationMs, budgetConfiguration.configuredTimeoutMs,
        input.options.maxDurationMs ?? input.effortWarrant.maxDurationMs), maxOutputTokens: plan.maxTokens } };
  return { ...qualification, qualificationDigest: digest(qualification) };
}

/** Recheck immediately after capacity admission and before every actual POST. */
export async function assertReassessmentQualificationCurrent(qualification: QualifiedReassessmentExecution): Promise<void> {
  const { qualificationDigest, ...unsigned } = qualification;
  if (digest(unsigned) !== qualificationDigest) refuse("reassessment-qualification-changed");
  assertSupportedPlan(qualification.executionPlan);
  const budget = await readReassessmentBudgetConfiguration(qualification.budgetConfiguration.agentId);
  if (budget.configurationDigest !== qualification.budgetConfiguration.configurationDigest
    || budget.configuredPerTaskLimit !== 0) refuse("reassessment-budget-configuration-changed");
  if (await getLocalOnlyInferenceFresh() && !isLocalProviderId(qualification.providerId)) {
    refuse("reassessment-residency-policy-changed");
  }
  await checkReassessmentBudget(budget);
  const current = await readProviderConfiguration(qualification.executionPlan);
  if (current.configurationDigest !== qualification.providerConfigurationDigest) refuse("reassessment-provider-configuration-changed");
}

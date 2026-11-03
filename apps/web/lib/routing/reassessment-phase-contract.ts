import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { InitiativeReviewBinding } from "../mcp-task-review-contract";
import type { TaskExecutionFence } from "../shared/task-execution-fence";
import type { ReassessmentBudgetConfiguration } from "../shared/reassessment-budget-contract";
import type { RoutedExecutionPlan } from "./recipe-types";
import type { ReassessmentRuntimeCompatibility } from "../shared/reassessment-owner-versions";

export type ReassessmentFiniteTokenProof = {
  schemaVersion: 1; kind: "dmr-native-messages-v1"; apiRoot: string; runtimeVersion: "v1.2.8";
  modelDigest: string; engineIdentity: string; engineArtifactDigest: string; engineSourceCommit: "72874f5";
  templateDigest: string; configDigest: string;
};
export type ReassessmentTokenReservation = {
  schemaVersion: 1; reservationId: string; bodySha256: string; inputTokens: number; maxOutputTokens: number; reservedTokens: number;
};
export type ReassessmentBudgetClass = "minimize_cost" | "balanced" | "quality_first";
export type ReassessmentNativeRuntimeV2 = { schemaVersion: 2; catalogDigest: string; observationDigest: string;
  spendAwareBudgetClass: ReassessmentBudgetClass; requestedBudgetClass?: ReassessmentBudgetClass };
export type QualifiedReassessmentExecution = {
  schemaVersion: 1; compositionVersion: "restricted-review-http-v1";
  providerId: string; providerConnectionId: string; providerConnectionVersion: string; modelId: string;
  executionPlan: RoutedExecutionPlan; providerConfigurationDigest: string; toolSurfaceDigest: string;
  budgetConfiguration: ReassessmentBudgetConfiguration;
  bounds: { maxProviderStarts: number; maxDurationMs: number; maxOutputTokens: number };
  qualificationDigest: string; finiteTokenProof?: ReassessmentFiniteTokenProof; nativeRuntime?: ReassessmentNativeRuntimeV2;
};
export type ReassessmentExecutionManifest = {
  schemaVersion: 1; taskRunId: string; userId: string; agentId: string; requestDigest: string;
  executionFence: TaskExecutionFence; binding: InitiativeReviewBinding; qualification: QualifiedReassessmentExecution;
  startedAt: string; deadlineAt: string;
};
export type ReassessmentExecutionSeed = ReassessmentExecutionManifest & { manifest: { artifactId: string; digest: string } };
export type ReassessmentExecutionLocator = { schemaVersion: 1; manifestArtifactId: string; manifestDigest: string };
export type ReassessmentExecutionContext = Readonly<ReassessmentExecutionSeed>;
export type ReassessmentEffect = { kind: "provider" | "tool"; name: string; input: unknown };
export type ReassessmentCaptureEvent = ReassessmentEffect & { sequence: number; providerReservationOrdinal: number | null; observedAt: string };
export type ReassessmentCaptureReservation = { reservationId: string };
export type ReassessmentExecutionState = {
  providerReservations: number; providerStarts: number; reservedTokens: number; unknownEffects: number; held: boolean; closed: boolean;
};
export type ReassessmentCaptureHooks = {
  open(context: ReassessmentExecutionContext): Promise<void>;
  reserve(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent): Promise<ReassessmentCaptureReservation>;
  complete(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, output: unknown): Promise<void>;
  uncertain?(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, error: { code: string; message: string }): Promise<void>;
  close?(context: ReassessmentExecutionContext, state: Readonly<ReassessmentExecutionState>): Promise<void>;
};
export type ReassessmentQualificationManifestV2 = {
  schemaVersion: 2; phase: "qualification"; taskRunId: string; userId: string; agentId: string; requestDigest: string;
  executionFence: TaskExecutionFence; binding: InitiativeReviewBinding; budgetConfiguration: ReassessmentBudgetConfiguration;
  bounds: QualifiedReassessmentExecution["bounds"]; nativeObservationUrls: string[]; startedAt: string; deadlineAt: string;
  compatibility: ReassessmentRuntimeCompatibility;
};
export type ReassessmentQualificationSeedV2 = ReassessmentQualificationManifestV2 & { manifest: { artifactId: string; digest: string } };
export type ReassessmentRootLocatorV2 = { schemaVersion: 2; manifestArtifactId: string; manifestDigest: string };
export type ReassessmentQualificationPrefix = { eventCount: number; digest: string; providerReservations: number; providerStarts: number };
export type ReassessmentExecutionSealV2 = {
  schemaVersion: 2; root: ReassessmentRootLocatorV2; taskRunId: string; userId: string; agentId: string; requestDigest: string;
  executionFence: TaskExecutionFence; binding: InitiativeReviewBinding; qualificationPrefix: ReassessmentQualificationPrefix;
  qualification: QualifiedReassessmentExecution; authorityDecisionId: string; sealedAt: string;
};

const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => integer(value) && value > 0;
const oneOf = (value: unknown, choices: readonly string[]) => typeof value === "string" && choices.includes(value);
const nullableIdentity = (value: unknown) => value === null || nonempty(value) && value.length <= 1024;
function shape(value: unknown, required: string, optional = ""): value is Record<string, unknown> {
  const keys = required.split(" ").filter(Boolean), allowed = [...keys, ...optional.split(" ").filter(Boolean)];
  return object(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.includes(key));
}
/** Reject values canonical JSON would erase, invoke or silently normalize. */
function json(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || active.has(value)
    || !Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value), array = Array.isArray(value);
  if (array && keys.length !== value.length + 1) return false;
  active.add(value);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !descriptor?.enumerable || !Object.hasOwn(descriptor, "value")
      || array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
      || !json(descriptor.value, active)) return false;
  }
  active.delete(value); return true;
}
function validFence(value: unknown, requestDigest: string): boolean {
  return shape(value, "schemaVersion reservation dispatchClaim authorityDigest requestDigest") && value.schemaVersion === 1
    && nullableIdentity(value.reservation) && nullableIdentity(value.dispatchClaim)
    && (value.authorityDigest === null || digest(value.authorityDigest)) && value.requestDigest === requestDigest;
}
function validLimits(value: unknown): value is ReassessmentBudgetConfiguration["registryLimits"] {
  return shape(value, "dailyTokenLimit perTaskTokenLimit timeoutSeconds maxTokens executionType")
    && integer(value.dailyTokenLimit) && integer(value.perTaskTokenLimit) && positive(value.timeoutSeconds)
    && Number.isSafeInteger(value.timeoutSeconds * 1000) && positive(value.maxTokens) && value.executionType === "in_process";
}
export function validReassessmentBudgetConfiguration(value: unknown, agentId: string): value is ReassessmentBudgetConfiguration {
  if (!shape(value, "source agentId registryAgentId registryAgentName executionAgentRowId executionConfigId registryLimits executionConfigLimits registryConfigurationDigest executionConfigurationDigest configuredDailyLimit configuredPerTaskLimit configuredTimeoutMs configuredMaxOutputTokens configurationDigest")
    || value.source !== "registry-and-execution-config" || value.agentId !== agentId
    || ![value.registryAgentId, value.registryAgentName, value.executionAgentRowId, value.executionConfigId].every(nonempty)
    || ![value.registryConfigurationDigest, value.executionConfigurationDigest, value.configurationDigest].every(digest)
    || !validLimits(value.registryLimits) || !validLimits(value.executionConfigLimits)) return false;
  const a = value.registryLimits, b = value.executionConfigLimits, { configurationDigest, ...unsigned } = value;
  const intersect = (left: number, right: number) => left === 0 ? right : right === 0 ? left : Math.min(left, right);
  return value.configuredDailyLimit === intersect(a.dailyTokenLimit, b.dailyTokenLimit)
    && value.configuredPerTaskLimit === intersect(a.perTaskTokenLimit, b.perTaskTokenLimit)
    && value.configuredTimeoutMs === Math.min(a.timeoutSeconds, b.timeoutSeconds) * 1000
    && value.configuredMaxOutputTokens === Math.min(a.maxTokens, b.maxTokens) && hash(unsigned) === configurationDigest;
}
function validFiniteProof(value: unknown): boolean {
  if (!shape(value, "schemaVersion kind apiRoot runtimeVersion modelDigest engineIdentity engineArtifactDigest engineSourceCommit templateDigest configDigest")
    || value.schemaVersion !== 1 || value.kind !== "dmr-native-messages-v1" || value.runtimeVersion !== "v1.2.8"
    || value.engineSourceCommit !== "72874f5" || !nonempty(value.apiRoot) || !nonempty(value.modelDigest) || !nonempty(value.engineIdentity)
    || typeof value.engineArtifactDigest !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(value.engineArtifactDigest)
    || !digest(value.templateDigest) || !digest(value.configDigest)) return false;
  try { const url = new URL(value.apiRoot); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}
function validPlan(value: unknown, q: Record<string, unknown>): boolean {
  if (!shape(value, "providerId providerConnectionId providerConnectionVersion accountAuthMethod executionChannel modelId recipeId contractFamily executionAdapter maxTokens providerSettings toolPolicy responsePolicy",
    "capabilityRequirements completionAllowance localThinkingBudgetEvidence localThinkingBudgetRequest temperature openRouterPolicy openRouterObligations harness sampling effortUnexpressed")
    || value.providerId !== q.providerId || value.providerConnectionId !== q.providerConnectionId || value.providerConnectionVersion !== q.providerConnectionVersion
    || value.modelId !== q.modelId || value.providerId === "chatgpt" || !["direct-api", "local-runtime"].includes(String(value.executionChannel))
    || !oneOf(value.accountAuthMethod, ["api_key", "none"]) || !nonempty(value.contractFamily)
    || !(value.recipeId === null || nonempty(value.recipeId)) || !positive(value.maxTokens)
    || !object(value.providerSettings) || Object.hasOwn(value.providerSettings, "providerTools") || Object.hasOwn(value.providerSettings, "thinking_budget_tokens")
    || Object.hasOwn(value, "localThinkingBudgetRequest") || value.completionAllowance !== undefined && value.completionAllowance !== value.maxTokens
    || !shape(value.toolPolicy, "", "toolChoice allowParallelToolCalls") || !shape(value.responsePolicy, "", "strictSchema stream terminalWriterToolName")) return false;
  if (Object.hasOwn(value, "localThinkingBudgetEvidence")) {
    const evidence = value.localThinkingBudgetEvidence, proof = q.finiteTokenProof;
    if (!object(q.nativeRuntime) || q.nativeRuntime.schemaVersion !== 2 || value.executionChannel !== "local-runtime" || !object(proof)
      || !shape(evidence, "dialect modelDigest engineIdentity templateDigest configDigest observedAt") || evidence.dialect !== "llama.cpp-b9879"
      || !integer(evidence.observedAt) || ["modelDigest", "engineIdentity", "templateDigest", "configDigest"].some(key => evidence[key] !== proof[key])) return false;
  }
  const adapter = value.executionAdapter;
  if (adapter !== "chat" && adapter !== "responses" && !(shape(adapter, "kind authMode", "version containerHint")
    && oneOf(adapter.kind, ["http-generic", "http-anthropic", "http-openai", "http-gemini", "http-ollama"])
    && oneOf(adapter.authMode, ["api-key", "oauth", "local"])
    && [adapter.version, adapter.containerHint].every(entry => entry === undefined || nonempty(entry)))) return false;
  if (value.capabilityRequirements !== undefined && (!Array.isArray(value.capabilityRequirements)
    || !value.capabilityRequirements.every(entry => shape(entry, "capability required") && nonempty(entry.capability) && entry.required === false))) return false;
  return (value.toolPolicy.toolChoice === undefined || oneOf(value.toolPolicy.toolChoice, ["auto", "required", "none"]))
    && (value.toolPolicy.allowParallelToolCalls === undefined || typeof value.toolPolicy.allowParallelToolCalls === "boolean")
    && [value.responsePolicy.strictSchema, value.responsePolicy.stream].every(entry => entry === undefined || typeof entry === "boolean")
    && (value.responsePolicy.terminalWriterToolName === undefined || nonempty(value.responsePolicy.terminalWriterToolName))
    && (!(value.providerId === "anthropic" || typeof value.providerId === "string" && value.providerId.startsWith("anthropic-"))
      || !(value.providerSettings.thinking || oneOf(value.providerSettings.effort, ["medium", "high", "max"])) || value.completionAllowance === value.maxTokens);
}
function validQualification(value: unknown, agentId: string): value is QualifiedReassessmentExecution {
  if (!shape(value, "schemaVersion compositionVersion providerId providerConnectionId providerConnectionVersion modelId executionPlan providerConfigurationDigest toolSurfaceDigest budgetConfiguration bounds qualificationDigest nativeRuntime", "finiteTokenProof")
    || value.schemaVersion !== 1 || value.compositionVersion !== "restricted-review-http-v1"
    || ![value.providerId, value.providerConnectionId, value.modelId].every(nonempty)
    || ![value.providerConnectionVersion, value.providerConfigurationDigest, value.toolSurfaceDigest, value.qualificationDigest].every(digest)
    || !validReassessmentBudgetConfiguration(value.budgetConfiguration, agentId) || !validPlan(value.executionPlan, value)
    || !shape(value.bounds, "maxProviderStarts maxDurationMs maxOutputTokens") || !Object.values(value.bounds).every(positive)
    || (value.bounds.maxProviderStarts as number) > 200 || (value.bounds.maxDurationMs as number) > value.budgetConfiguration.configuredTimeoutMs
    || (value.bounds.maxOutputTokens as number) > value.budgetConfiguration.configuredMaxOutputTokens
    || value.bounds.maxOutputTokens !== (value.executionPlan as Record<string, unknown>).maxTokens
    || (value.finiteTokenProof !== undefined || value.budgetConfiguration.configuredPerTaskLimit > 0) && !validFiniteProof(value.finiteTokenProof)) return false;
  const runtime = value.nativeRuntime, classes = ["minimize_cost", "balanced", "quality_first"];
  if (!shape(runtime, "schemaVersion catalogDigest observationDigest spendAwareBudgetClass", "requestedBudgetClass") || runtime.schemaVersion !== 2
    || !digest(runtime.catalogDigest) || !digest(runtime.observationDigest) || !oneOf(runtime.spendAwareBudgetClass, classes)
    || runtime.requestedBudgetClass !== undefined && !oneOf(runtime.requestedBudgetClass, classes)) return false;
  const { qualificationDigest, ...unsigned } = value; return hash(unsigned) === qualificationDigest;
}
export function deriveReassessmentExecutionSealArtifactId(input: { taskRunId: string; rootArtifactId: string; rootDigest: string }): string {
  return `ta-reassessment-execution-seal-${hash({ taskRunId: input.taskRunId, rootArtifactId: input.rootArtifactId, rootDigest: input.rootDigest })}`;
}
/** Only authenticated, completed observations may be supplied by the capture owner. */
export function reassessmentQualificationPrefix(events: readonly { event: ReassessmentCaptureEvent; reservationId: string; output: unknown }[]): ReassessmentQualificationPrefix {
  if (!json(events)) throw new Error("reassessment-qualification-prefix-invalid");
  const providers = events.filter(entry => entry.event.kind === "provider").length;
  return { eventCount: events.length, digest: hash(events), providerReservations: providers, providerStarts: providers };
}
export function parseReassessmentRootLocatorV2(value: unknown): ReassessmentRootLocatorV2 | null {
  return json(value) && shape(value, "schemaVersion manifestArtifactId manifestDigest") && value.schemaVersion === 2
    && nonempty(value.manifestArtifactId) && digest(value.manifestDigest) ? value as ReassessmentRootLocatorV2 : null;
}
/** Structural integrity only: persisted root, exact binding, current policy and grants remain capture-owner obligations. */
export function parseReassessmentExecutionSealV2(value: unknown): ReassessmentExecutionSealV2 | null {
  if (!json(value) || !shape(value, "schemaVersion root taskRunId userId agentId requestDigest executionFence binding qualificationPrefix qualification authorityDecisionId sealedAt")
    || value.schemaVersion !== 2 || !parseReassessmentRootLocatorV2(value.root)
    || ![value.taskRunId, value.userId, value.agentId, value.authorityDecisionId].every(nonempty)
    || !digest(value.requestDigest) || !validFence(value.executionFence, value.requestDigest) || !object(value.binding)
    || !validQualification(value.qualification, value.agentId as string) || !nonempty(value.sealedAt) || !Number.isFinite(Date.parse(value.sealedAt))) return null;
  const prefix = value.qualificationPrefix;
  if (!shape(prefix, "eventCount digest providerReservations providerStarts") || !digest(prefix.digest)
    || ![prefix.eventCount, prefix.providerReservations, prefix.providerStarts].every(integer)
    || prefix.providerStarts !== prefix.providerReservations || (prefix.providerReservations as number) > (prefix.eventCount as number)) return null;
  return value as ReassessmentExecutionSealV2;
}

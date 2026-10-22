import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { initiativeReviewWriterArgumentContract, parseInitiativeReviewBinding, type InitiativeReviewBinding } from "../mcp-task-review-contract";
import { parseTaskExecutionFence, sameTaskExecutionFence, type TaskExecutionFence } from "../shared/task-execution-fence";
import { createInitiativeReviewTerminalToolPolicy, normalizeTerminalToolArguments } from "../tak/terminal-tool-policy";
import type { RoutedExecutionPlan } from "./recipe-types";
import type { ReassessmentBudgetConfiguration } from "../inference/budget-gate";

export type QualifiedReassessmentExecution = {
  schemaVersion: 1;
  compositionVersion: "restricted-review-http-v1";
  providerId: string;
  providerConnectionId: string;
  providerConnectionVersion: string;
  modelId: string;
  executionPlan: RoutedExecutionPlan;
  providerConfigurationDigest: string;
  toolSurfaceDigest: string;
  budgetConfiguration: ReassessmentBudgetConfiguration;
  bounds: { maxProviderStarts: number; maxDurationMs: number; maxOutputTokens: number };
  qualificationDigest: string;
};

export type ReassessmentExecutionManifest = {
  schemaVersion: 1;
  taskRunId: string;
  userId: string;
  agentId: string;
  requestDigest: string;
  executionFence: TaskExecutionFence;
  binding: InitiativeReviewBinding;
  qualification: QualifiedReassessmentExecution;
  startedAt: string;
  deadlineAt: string;
};
export type ReassessmentExecutionSeed = ReassessmentExecutionManifest & { manifest: { artifactId: string; digest: string } };
export type ReassessmentExecutionLocator = { schemaVersion: 1; manifestArtifactId: string; manifestDigest: string };
export type ReassessmentExecutionContext = Readonly<ReassessmentExecutionSeed>;
export type ReassessmentEffect = { kind: "provider" | "tool"; name: string; input: unknown };
export type ReassessmentCaptureEvent = ReassessmentEffect & {
  sequence: number; providerReservationOrdinal: number | null; observedAt: string;
};
export type ReassessmentCaptureReservation = { reservationId: string };
export type ReassessmentExecutionState = {
  providerReservations: number; providerStarts: number; unknownEffects: number; held: boolean; closed: boolean;
};
export type ReassessmentCaptureHooks = {
  open(context: ReassessmentExecutionContext): Promise<void>;
  reserve(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent): Promise<ReassessmentCaptureReservation>;
  complete(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, output: unknown): Promise<void>;
  uncertain?(context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, error: { code: string; message: string }): Promise<void>;
  close?(context: ReassessmentExecutionContext, state: Readonly<ReassessmentExecutionState>): Promise<void>;
};

export class ReassessmentExecutionError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = "ReassessmentExecutionError"; }
}
export const isReassessmentExecutionError = (error: unknown): error is ReassessmentExecutionError => error instanceof ReassessmentExecutionError;

type Scope = { context: ReassessmentExecutionContext; hooks: ReassessmentCaptureHooks; state: ReassessmentExecutionState; sequence: number };
const execution = new AsyncLocalStorage<Scope>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const equal = (left: unknown, right: unknown) => canonicalJson(left ?? null) === canonicalJson(right ?? null);
function fail(code: string, message = code): never {
  const scope = execution.getStore();
  if (scope) scope.state.held = true;
  throw new ReassessmentExecutionError(code, message);
}

/** Provider/transport guards use the same permanent hold as tool guards. */
export function refuseReassessmentExecution(code: string, message = code): never { return fail(code, message); }

export function hasPersistedReassessmentExecution(metadata: unknown): boolean {
  return object(metadata) && Object.prototype.hasOwnProperty.call(metadata, "reassessmentExecution");
}

export function parseReassessmentExecutionLocator(value: unknown): ReassessmentExecutionLocator | null {
  if (!object(value) || Object.keys(value).length !== 3 || value.schemaVersion !== 1
    || typeof value.manifestArtifactId !== "string" || !value.manifestArtifactId.trim()
    || typeof value.manifestDigest !== "string" || !digest(value.manifestDigest)) return null;
  return { schemaVersion: 1, manifestArtifactId: value.manifestArtifactId, manifestDigest: value.manifestDigest };
}

/** The transport/approval guard uses this leaf predicate before an alternate
 * callback can reach any tool. A persisted marker never grants an unscoped
 * callback the authority to reconstruct an execution. */
export function matchesPersistedReassessmentScope(metadata: unknown, taskRunId: string): boolean {
  if (!hasPersistedReassessmentExecution(metadata)) return true;
  const scope = execution.getStore();
  const locator = parseReassessmentExecutionLocator(object(metadata) ? metadata.reassessmentExecution : null);
  return Boolean(scope && !scope.state.closed && !scope.state.held && locator
    && Date.now() < Date.parse(scope.context.deadlineAt) && scope.context.taskRunId === taskRunId
    && object(metadata) && metadata.requestDigest === scope.context.requestDigest
    && locator.manifestArtifactId === scope.context.manifest.artifactId && locator.manifestDigest === scope.context.manifest.digest);
}

/** Capture is lossless JSON, never a projection or a truncation. Authentication
 * is performed outside this payload; tokens/headers must never enter it. */
export function reassessmentCaptureValue(value: unknown): unknown {
  const active = new Set<object>();
  const visit = (entry: unknown): void => {
    if (entry === null || typeof entry === "string" || typeof entry === "boolean") return;
    if (typeof entry === "number" && Number.isFinite(entry)) return;
    if (typeof entry !== "object" || entry === null || active.has(entry)
      || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)) {
      fail("reassessment-capture-invalid", "The complete capture is not losslessly serializable JSON.");
    }
    const arrayLength = Array.isArray(entry) ? entry.length : null;
    const keys = Reflect.ownKeys(entry);
    if (arrayLength !== null && keys.length !== arrayLength + 1) {
      fail("reassessment-capture-invalid", "The complete capture is not losslessly serializable JSON.");
    }
    active.add(entry);
    for (const key of keys) {
      if (arrayLength !== null && key === "length") continue;
      const property = Object.getOwnPropertyDescriptor(entry, key);
      if (typeof key !== "string" || !property?.enumerable || !Object.prototype.hasOwnProperty.call(property, "value")
        || (arrayLength !== null && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= arrayLength))) {
        fail("reassessment-capture-invalid", "The complete capture is not losslessly serializable JSON.");
      }
      if (/^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|credential|credentials)$/i.test(key)) {
        fail("reassessment-capture-secret", "Authentication secrets cannot enter reassessment capture.");
      }
      visit(property.value);
    }
    active.delete(entry);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Seal the full ordered provider surface before adapter wire translation. */
export function reassessmentToolSurfaceDigest(tools: readonly unknown[]): string {
  return createHash("sha256").update(canonicalJson(reassessmentCaptureValue(tools))).digest("hex");
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function validateSeed(seed: ReassessmentExecutionSeed): void {
  const q = seed.qualification;
  const binding = parseInitiativeReviewBinding(seed.binding);
  const fence = parseTaskExecutionFence(seed.executionFence);
  const startedAt = Date.parse(seed.startedAt), deadlineAt = Date.parse(seed.deadlineAt);
  if (seed.schemaVersion !== 1 || !nonempty(seed.taskRunId) || !nonempty(seed.userId) || !nonempty(seed.agentId)
    || !digest(seed.requestDigest) || !fence || fence.requestDigest !== seed.requestDigest
    || !binding || !equal(binding, seed.binding) || binding.artifactRef.kind !== "repo-blob-at-commit"
    || !nonempty(seed.manifest?.artifactId) || !digest(seed.manifest?.digest)
    || q?.schemaVersion !== 1 || q.compositionVersion !== "restricted-review-http-v1"
    || !nonempty(q.providerId) || !nonempty(q.providerConnectionId) || !nonempty(q.providerConnectionVersion) || !nonempty(q.modelId)
    || !digest(q.providerConfigurationDigest) || !digest(q.toolSurfaceDigest) || !digest(q.qualificationDigest)
    || q.budgetConfiguration?.source !== "registry-and-execution-config" || !nonempty(q.budgetConfiguration.agentId)
    || !Number.isFinite(q.budgetConfiguration.configuredDailyLimit) || q.budgetConfiguration.configuredDailyLimit < 0
    || q.budgetConfiguration.configuredPerTaskLimit !== 0
    || !digest(q.budgetConfiguration.configurationDigest)
    || !positiveInteger(q.bounds?.maxProviderStarts) || !positiveInteger(q.bounds?.maxDurationMs) || !positiveInteger(q.bounds?.maxOutputTokens)
    || q.executionPlan?.providerId !== q.providerId || q.executionPlan.modelId !== q.modelId
    || !Number.isFinite(startedAt) || !Number.isFinite(deadlineAt) || deadlineAt <= startedAt
    || deadlineAt - startedAt > q.bounds.maxDurationMs || startedAt > Date.now()) {
    fail("reassessment-manifest-invalid", "The sealed reassessment execution identity, qualification or immutable bounds are invalid.");
  }
  if (Date.now() >= deadlineAt) fail("reassessment-deadline-exhausted", "The immutable reassessment deadline has expired.");
}

export function currentReassessmentExecution(): ReassessmentExecutionContext | null {
  return execution.getStore()?.context ?? null;
}

export function assertReassessmentActive(): ReassessmentExecutionContext | null {
  const scope = execution.getStore();
  if (!scope) return null;
  if (scope.state.closed) fail("reassessment-execution-closed", "The reassessment execution is closed.");
  if (scope.state.held) fail("reassessment-execution-held", "Further reassessment effects are held after incomplete capture.");
  if (Date.now() >= Date.parse(scope.context.deadlineAt)) {
    scope.state.held = true;
    fail("reassessment-deadline-exhausted", "The immutable reassessment deadline has expired.");
  }
  return scope.context;
}

/** Only the authenticated server wrapper supplies these hooks after reading a
 * persisted admission manifest. A model/tool argument never enables a scope. */
export async function runReassessmentExecution<T>(seed: ReassessmentExecutionSeed, hooks: ReassessmentCaptureHooks, fn: () => Promise<T>): Promise<T> {
  if (execution.getStore()) fail("reassessment-nested-execution", "A reassessment cannot open another execution scope.");
  const context = freeze(reassessmentCaptureValue(seed) as ReassessmentExecutionSeed);
  validateSeed(context);
  const scope: Scope = { context, hooks, sequence: 0, state: { providerReservations: 0, providerStarts: 0, unknownEffects: 0, held: false, closed: false } };
  try { await hooks.open(context); }
  catch { fail("reassessment-capture-unavailable", "The authenticated sealed manifest could not be captured before execution."); }
  return execution.run(scope, async () => {
    try { assertReassessmentActive(); return await fn(); }
    finally {
      // Descendants inherit this object, so leaving ALS never re-enables a
      // callback which retained its asynchronous execution context.
      scope.state.closed = true;
      try { await hooks.close?.(context, Object.freeze({ ...scope.state })); }
      catch { scope.state.held = true; }
    }
  });
}

async function captureUncertain(scope: Scope, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, error: unknown): Promise<void> {
  scope.state.held = true;
  scope.state.unknownEffects += 1;
  const description = { code: isReassessmentExecutionError(error) ? error.code : "effect-or-capture-incomplete",
    message: isReassessmentExecutionError(error) ? error.message : "An effect started without complete authoritative capture." };
  try { await scope.hooks.uncertain?.(scope.context, event, reservation, description); }
  catch { /* The pre-effect durable reservation remains an unknown effect. */ }
}

/** Called at each real HTTP POST/tool invocation, including transport retries.
 * An outstanding reservation consumes its full slot; a failure cannot replenish
 * the immutable allowance or silently choose a replacement route. */
export async function runReassessmentEffect<T>(effect: ReassessmentEffect, execute: () => Promise<T>, captureOutput?: (value: T) => unknown | Promise<unknown>): Promise<T> {
  const scope = execution.getStore();
  if (!scope) return execute();
  assertReassessmentActive();
  if (!nonempty(effect.name) || !["provider", "tool"].includes(effect.kind)) fail("reassessment-effect-invalid");
  if (effect.kind === "tool") assertReassessmentProposedToolCall({ toolName: effect.name, params: object(effect.input) ? effect.input : {} });
  const input = reassessmentCaptureValue(effect.input);
  if (effect.kind === "provider" && scope.state.providerReservations >= scope.context.qualification.bounds.maxProviderStarts) {
    fail("reassessment-provider-start-limit", "The immutable provider start allowance is exhausted.");
  }
  const ordinal = effect.kind === "provider" ? ++scope.state.providerReservations : null;
  const event = freeze({ ...effect, input, sequence: ++scope.sequence, providerReservationOrdinal: ordinal, observedAt: new Date().toISOString() });
  let reservation: ReassessmentCaptureReservation;
  try {
    reservation = await scope.hooks.reserve(scope.context, event);
    if (!nonempty(reservation?.reservationId)) throw new Error("missing reservation identity");
  } catch {
    scope.state.held = true;
    fail("reassessment-capture-unavailable", "The pre-effect capture reservation is unavailable; no effect was started.");
  }
  try { assertReassessmentActive(); }
  catch (error) {
    try { await scope.hooks.complete(scope.context, event, reservation, { executionStatus: "not-started" }); }
    catch { scope.state.held = true; }
    throw error;
  }
  if (effect.kind === "provider") scope.state.providerStarts += 1;
  let value: T;
  try { value = await execute(); }
  catch (error) {
    await captureUncertain(scope, event, reservation, error);
    fail("reassessment-effect-outcome-uncertain", "An effect started without a complete result. Its reservation remains consumed; further execution is held.");
  }
  try {
    const output = reassessmentCaptureValue(captureOutput ? await captureOutput(value) : value);
    await scope.hooks.complete(scope.context, event, reservation, output);
  } catch (error) {
    await captureUncertain(scope, event, reservation, error);
    fail("reassessment-capture-incomplete", "An effect started but its complete output capture failed. Reconcile genuine committed receipts before any further execution.");
  }
  return value;
}

const READER_KEYS = new Set(["repositoryFullName", "path", "version", "expectedBlobId", "startLine", "cursor", "maxLines", "maxChars"]);

export function assertReassessmentProposedToolCall(input: { toolName: string; params: Record<string, unknown> }): Record<string, unknown> {
  const context = assertReassessmentActive();
  if (!context) return input.params;
  const binding = context.binding;
  if (input.toolName !== "read_source_at_version" && input.toolName !== binding.writerToolName) {
    fail("reassessment-tool-unavailable", "The proposed tool is outside the exact immutable reader and canonical writer surface.");
  }
  if (!object(input.params)) fail("reassessment-tool-arguments-invalid");
  reassessmentCaptureValue(input.params);
  if (input.toolName === "read_source_at_version") {
    if (Object.keys(input.params).some(key => !READER_KEYS.has(key))) fail("reassessment-reader-arguments-invalid", "The immutable reader received undeclared arguments.");
    const policy = createInitiativeReviewTerminalToolPolicy(binding.writerToolName, ["read_source_at_version", binding.writerToolName], binding.artifactRef)!;
    const disposition = normalizeTerminalToolArguments(policy, input.toolName, input.params);
    if (disposition.kind === "refuse") fail(disposition.result.error, disposition.result.message);
    return disposition.arguments;
  }
  // The canonical tool pack injects these exact fields from its accepted task,
  // then its writer locks the task before the subject. Reject contradictory
  // caller claims here too, before lookup or any alternate dispatch path.
  const boundKeys = ["itemId", "gate", "artifactRef", "workroomRef", "expectedCurrentBaselineId"] as const;
  const contract = initiativeReviewWriterArgumentContract(binding);
  const allowed = new Set([...boundKeys, ...contract.writerPropertyNames]);
  if (Object.keys(input.params).some(key => !allowed.has(key))) {
    fail("reassessment-writer-arguments-invalid", "The canonical writer received arguments outside its declared assessment contract.");
  }
  for (const key of boundKeys) {
    if (Object.hasOwn(input.params, key) && !equal(input.params[key], binding[key])) {
      fail("reassessment-writer-binding-conflict", "The proposed canonical writer arguments conflict with the accepted review binding.");
    }
  }
  if (contract.objectiveMappingProposal && ((Object.hasOwn(input.params, "operation") && input.params.operation !== "objective-mapping")
    || (Object.hasOwn(input.params, "baselineId") && input.params.baselineId !== contract.currentBaselineId))) {
    fail("reassessment-writer-binding-conflict", "The objective mapping operation or baseline differs from its immutable binding.");
  }
  return input.params;
}

export function assertReassessmentToolCall(input: { toolName: string; params: Record<string, unknown>; userId: string; agentId: string; taskRunId?: string; executionFence?: TaskExecutionFence | null }): Record<string, unknown> {
  const context = assertReassessmentActive();
  if (context && (input.userId !== context.userId || input.agentId !== context.agentId || input.taskRunId !== context.taskRunId
    || !sameTaskExecutionFence(input.executionFence, context.executionFence))) {
    fail("reassessment-tool-execution-conflict", "The actual tool dispatch does not carry the captured actor, task and full execution fence.");
  }
  return assertReassessmentProposedToolCall(input);
}

export function assertReassessmentPlan(input: { providerId: string; modelId: string; plan: RoutedExecutionPlan; tools?: readonly unknown[] }): ReassessmentExecutionContext | null {
  const context = assertReassessmentActive();
  if (!context) return null;
  if (input.providerId !== context.qualification.providerId || input.modelId !== context.qualification.modelId
    || !equal(input.plan, context.qualification.executionPlan)) fail("reassessment-composition-changed", "The actual provider execution plan differs from the qualified immutable composition.");
  if (!input.tools || input.tools.length !== 2) fail("reassessment-tool-surface-changed", "A restricted provider requires exactly two function tools.");
  const names = input.tools.map(entry => {
    if (!object(entry) || entry.type !== "function") fail("reassessment-provider-tool-unavailable");
    const definition = object(entry.function) ? entry.function : entry;
    if (!nonempty(definition.name)) fail("reassessment-provider-tool-unavailable");
    return definition.name;
  });
  if (new Set(names).size !== 2 || !names.includes("read_source_at_version") || !names.includes(context.binding.writerToolName)) {
    fail("reassessment-tool-surface-changed", "The provider function tools differ from the exact admitted reader and writer.");
  }
  if (reassessmentToolSurfaceDigest(input.tools) !== context.qualification.toolSurfaceDigest) {
    fail("reassessment-tool-surface-changed", "The full ordered provider tool surface differs from the qualified immutable composition.");
  }
  return context;
}

export function validateReassessmentToolCalls(calls: readonly unknown[] | undefined): void {
  if (!assertReassessmentActive() || calls === undefined) return;
  if (!Array.isArray(calls)) fail("reassessment-provider-tool-call-invalid");
  for (const call of calls) {
    if (!object(call)) fail("reassessment-provider-tool-call-invalid");
    const definition = object(call.function) ? call.function : call;
    const toolName = definition.name;
    let params: unknown = definition.arguments ?? definition.args;
    if (typeof params === "string") {
      try { params = JSON.parse(params) as unknown; }
      catch { fail("reassessment-provider-tool-call-invalid", "The proposed function arguments are not complete JSON."); }
    }
    if (!nonempty(toolName) || !object(params)) fail("reassessment-provider-tool-call-invalid");
    assertReassessmentProposedToolCall({ toolName, params });
  }
}

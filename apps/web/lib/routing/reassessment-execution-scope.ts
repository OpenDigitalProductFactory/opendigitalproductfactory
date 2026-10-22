import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { initiativeReviewWriterArgumentContract, parseInitiativeReviewBinding, type InitiativeReviewBinding } from "../mcp-task-review-contract";
import { parseTaskExecutionFence, sameTaskExecutionFence, type TaskExecutionFence } from "../shared/task-execution-fence";
import { immutableReaderArgumentsFor, normalizeTerminalToolArguments } from "../shared/immutable-review-reader";
import type { RoutedExecutionPlan } from "./recipe-types";
import { parseReassessmentExecutionSealV2, parseReassessmentRootLocatorV2, reassessmentQualificationPrefix, validReassessmentBudgetConfiguration,
  type ReassessmentQualificationSeedV2, type ReassessmentQualificationPrefix, type ReassessmentExecutionSealV2 } from "./reassessment-phase-contract";
import { validAuditedReassessmentNativeQualification } from "../shared/reassessment-native-composition";
import { validateReassessmentRuntimeCompatibility } from "../shared/reassessment-owner-versions";

import type { ReassessmentFiniteTokenProof, ReassessmentTokenReservation, ReassessmentExecutionSeed, ReassessmentExecutionLocator,
  ReassessmentExecutionContext, ReassessmentEffect, ReassessmentCaptureEvent, ReassessmentCaptureReservation,
  ReassessmentExecutionState, ReassessmentCaptureHooks } from "./reassessment-phase-contract";
export type { ReassessmentFiniteTokenProof, ReassessmentTokenReservation, QualifiedReassessmentExecution, ReassessmentExecutionManifest,
  ReassessmentExecutionSeed, ReassessmentExecutionLocator, ReassessmentExecutionContext, ReassessmentEffect, ReassessmentCaptureEvent,
  ReassessmentCaptureReservation, ReassessmentExecutionState, ReassessmentCaptureHooks } from "./reassessment-phase-contract";

export class ReassessmentExecutionError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = "ReassessmentExecutionError"; }
}
export const isReassessmentExecutionError = (error: unknown): error is ReassessmentExecutionError => error instanceof ReassessmentExecutionError;

type Scope = { context: ReassessmentExecutionContext; hooks: ReassessmentCaptureHooks; state: ReassessmentExecutionState; sequence: { value: number }; root?: QualificationRoot };
const execution = new AsyncLocalStorage<Scope>();
/** Qualification deliberately has no execution plan or tool authority. */
export type ReassessmentQualificationContext = Readonly<ReassessmentQualificationSeedV2>;
export type ReassessmentPhaseCaptureContext = ReassessmentQualificationContext | ReassessmentExecutionContext;
export type ReassessmentQualificationHooks = {
  open(context: ReassessmentQualificationContext): Promise<void>;
  reserve(context: ReassessmentPhaseCaptureContext, event: ReassessmentCaptureEvent): Promise<ReassessmentCaptureReservation>;
  complete(context: ReassessmentPhaseCaptureContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, output: unknown): Promise<void>;
  uncertain?(context: ReassessmentPhaseCaptureContext, event: ReassessmentCaptureEvent, reservation: ReassessmentCaptureReservation, error: { code: string; message: string }): Promise<void>;
  close?(context: ReassessmentQualificationContext, state: Readonly<ReassessmentExecutionState>): Promise<void>;
  readExecutionSeal(context: ReassessmentQualificationContext, prefix: ReassessmentQualificationPrefix): Promise<ReassessmentExecutionSealV2 | null>;
  validateCommit?(transaction: unknown, context: ReassessmentQualificationContext, seal: ReassessmentExecutionSealV2): Promise<void>;
};
type QualificationRoot = { context: ReassessmentQualificationContext; hooks: ReassessmentQualificationHooks; state: ReassessmentExecutionState;
  sequence: { value: number }; activePhase: "qualification" | "execution"; pending: number; promoting: boolean;
  seal?: Readonly<ReassessmentExecutionSealV2>;
  observations: Array<{ event: ReassessmentCaptureEvent; reservationId: string; output: unknown }> };
const phase = new AsyncLocalStorage<{ root: QualificationRoot; phase: "qualification" | "execution" }>();
export function currentReassessmentQualification(): ReassessmentQualificationContext | null {
  const frame = phase.getStore();
  if (!frame) return null;
  if (frame.phase === "execution" && frame.root.activePhase === "execution") { assertReassessmentActive(); return null; }
  assertQualificationFrame(frame);
  return frame.root.context;
}
type TokenHandoff = { scope: Scope; reservation: Readonly<ReassessmentTokenReservation>; issued: boolean; consumed: boolean; closed: boolean };
const tokenHandoff = new AsyncLocalStorage<TokenHandoff>();
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const equal = (left: unknown, right: unknown) => canonicalJson(left ?? null) === canonicalJson(right ?? null);
function fail(code: string, message = code): never {
  const scope = execution.getStore();
  if (scope) scope.state.held = true;
  const frame = phase.getStore();
  // A stale Q callback must refuse without poisoning an already promoted E.
  if (frame && frame.phase === frame.root.activePhase) frame.root.state.held = true;
  throw new ReassessmentExecutionError(code, message);
}

/** Provider/transport guards use the same permanent hold as tool guards. */
export function refuseReassessmentExecution(code: string, message = code): never { return fail(code, message); }

export function validReassessmentFiniteTokenProof(value: unknown): value is ReassessmentFiniteTokenProof {
  if (!object(value) || Object.keys(value).length !== 10 || value.schemaVersion !== 1 || value.kind !== "dmr-native-messages-v1"
    || value.runtimeVersion !== "v1.2.8" || value.engineSourceCommit !== "72874f5" || !nonempty(value.apiRoot)
    || !nonempty(value.modelDigest) || !nonempty(value.engineIdentity) || typeof value.engineArtifactDigest !== "string"
    || !/^(sha256:)?[a-f0-9]{64}$/.test(value.engineArtifactDigest) || !digest(value.templateDigest) || !digest(value.configDigest)) return false;
  try { const url = new URL(value.apiRoot); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }
  catch { return false; }
}

export function parseReassessmentTokenReservation(value: unknown): ReassessmentTokenReservation | null {
  if (!object(value) || Object.keys(value).length !== 6 || value.schemaVersion !== 1 || typeof value.reservationId !== "string"
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.reservationId)
    || !digest(value.bodySha256) || !nonnegativeInteger(value.inputTokens) || !positiveInteger(value.maxOutputTokens)
    || !positiveInteger(value.reservedTokens) || value.reservedTokens !== value.inputTokens + value.maxOutputTokens) return null;
  return value as ReassessmentTokenReservation;
}

/** Native count evidence reserves the whole generation before any asynchronous callback. No allowance is refunded. */
export async function withReassessmentTokenReservation<T>(input: { bodyUtf8: string; inputTokens: number; maxOutputTokens: number }, fn: () => Promise<T>): Promise<T> {
  const scope = execution.getStore(); assertReassessmentActive();
  if (!scope || !scope.context.qualification.finiteTokenProof || scope.context.qualification.budgetConfiguration.configuredPerTaskLimit <= 0)
    fail("reassessment-finite-token-proof-required");
  if (tokenHandoff.getStore() || typeof input.bodyUtf8 !== "string" || !nonnegativeInteger(input.inputTokens)
    || input.maxOutputTokens !== scope.context.qualification.bounds.maxOutputTokens) fail("reassessment-token-reservation-invalid");
  const reservedTokens = input.inputTokens + input.maxOutputTokens;
  if (!positiveInteger(reservedTokens) || scope.state.reservedTokens + reservedTokens > scope.context.qualification.budgetConfiguration.configuredPerTaskLimit)
    fail("reassessment-token-limit", "The immutable whole-generation token allowance is exhausted.");
  scope.state.reservedTokens += reservedTokens;
  const reservation = Object.freeze({ schemaVersion: 1 as const, reservationId: randomUUID(),
    bodySha256: createHash("sha256").update(input.bodyUtf8, "utf8").digest("hex"), inputTokens: input.inputTokens, maxOutputTokens: input.maxOutputTokens, reservedTokens });
  const handoff: TokenHandoff = { scope, reservation, issued: false, consumed: false, closed: false };
  try { return await tokenHandoff.run(handoff, fn); } finally { handoff.closed = true; }
}

/** Only the exact single HTTP body can claim a server-owned count reservation. */
export function reassessmentTokenReservationFor(bodyUtf8: string): Readonly<ReassessmentTokenReservation> {
  const scope = execution.getStore(); const handoff = tokenHandoff.getStore(); assertReassessmentActive();
  if (!scope || !handoff || handoff.scope !== scope || handoff.closed || handoff.issued || typeof bodyUtf8 !== "string"
    || createHash("sha256").update(bodyUtf8, "utf8").digest("hex") !== handoff.reservation.bodySha256) fail("reassessment-token-handoff-invalid");
  handoff.issued = true;
  return handoff.reservation;
}

function consumeFiniteProviderReservation(scope: Scope, input: unknown): void {
  if (scope.context.qualification.budgetConfiguration.configuredPerTaskLimit === 0) return;
  if (!object(input) || !["configuration", "count", "generation"].includes(String(input.operation))) fail("reassessment-provider-operation-invalid");
  if (input.operation !== "generation") {
    if (Object.hasOwn(input, "tokenReservation")) fail("reassessment-token-reservation-invalid");
    return;
  }
  const handoff = tokenHandoff.getStore(); const reservation = parseReassessmentTokenReservation(input.tokenReservation);
  if (!reservation || !handoff || handoff.scope !== scope || handoff.closed || !handoff.issued || handoff.consumed
    || !equal(reservation, handoff.reservation) || typeof input.bodyUtf8 !== "string"
    || createHash("sha256").update(input.bodyUtf8, "utf8").digest("hex") !== reservation.bodySha256) fail("reassessment-token-reservation-invalid");
  handoff.consumed = true;
}

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
  const raw = object(metadata) ? metadata.reassessmentExecution : null;
  const locator = parseReassessmentExecutionLocator(raw) ?? parseReassessmentRootLocatorV2(raw);
  return Boolean(scope && !scope.state.closed && !scope.state.held && locator
    && (locator.schemaVersion === 1 ? !scope.root : scope.root?.activePhase === "execution" && phase.getStore()?.phase === "execution")
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

function assertExecutionPhase(): void {
  const frame = phase.getStore();
  if (frame && (frame.phase !== "execution" || frame.root.activePhase !== "execution")) {
    throw new ReassessmentExecutionError("reassessment-qualification-only", "Qualification cannot execute tools, count, generation or ordinary fallback.");
  }
}

function assertQualificationFrame(frame = phase.getStore()): QualificationRoot {
  if (!frame || frame.phase !== "qualification" || frame.root.activePhase !== "qualification") {
    throw new ReassessmentExecutionError("reassessment-qualification-phase-closed", "The qualification phase is absent or already sealed.");
  }
  const root = frame.root;
  if (root.state.closed || root.state.held) throw new ReassessmentExecutionError("reassessment-qualification-held", "Qualification is closed or held.");
  if (Date.now() >= Date.parse(root.context.deadlineAt)) {
    root.state.held = true; throw new ReassessmentExecutionError("reassessment-deadline-exhausted");
  }
  return root;
}

function validateQualificationRoot(context: ReassessmentQualificationContext): void {
  const { manifest, ...data } = context;
  const keys = ["schemaVersion", "phase", "taskRunId", "userId", "agentId", "requestDigest", "executionFence", "binding",
    "budgetConfiguration", "bounds", "nativeObservationUrls", "startedAt", "deadlineAt", "compatibility"];
  try { validateReassessmentRuntimeCompatibility(context.compatibility); }
  catch { throw new ReassessmentExecutionError("reassessment-compatibility-unproven"); }
  const binding = parseInitiativeReviewBinding(context.binding), fence = parseTaskExecutionFence(context.executionFence);
  const start = Date.parse(context.startedAt), end = Date.parse(context.deadlineAt);
  if (Object.keys(data).length !== keys.length || Object.keys(data).some(key => !keys.includes(key))
    || context.schemaVersion !== 2 || context.phase !== "qualification" || ![context.taskRunId, context.userId, context.agentId].every(nonempty)
    || !digest(context.requestDigest) || !fence || fence.requestDigest !== context.requestDigest
    || !binding || !equal(binding, context.binding) || binding.artifactRef.kind !== "repo-blob-at-commit"
    || !manifest || Object.keys(manifest).length !== 2 || !nonempty(manifest.artifactId) || !digest(manifest.digest)
    || !validReassessmentBudgetConfiguration(context.budgetConfiguration, context.agentId)
    || ![context.bounds?.maxProviderStarts, context.bounds?.maxDurationMs, context.bounds?.maxOutputTokens].every(positiveInteger)
    || Object.keys(context.bounds ?? {}).length !== 3 || context.bounds.maxProviderStarts > 200
    || context.bounds.maxOutputTokens > context.budgetConfiguration.configuredMaxOutputTokens
    || !Array.isArray(context.nativeObservationUrls) || !context.nativeObservationUrls.length
    || context.nativeObservationUrls.length > context.bounds.maxProviderStarts
    || new Set(context.nativeObservationUrls).size !== context.nativeObservationUrls.length
    || !context.nativeObservationUrls.every(url => {
      try { const parsed = new URL(url); return parsed.href === url && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash; }
      catch { return false; }
    }) || !Number.isFinite(start) || !Number.isFinite(end) || start > Date.now() || end <= start
    || end - start > context.bounds.maxDurationMs || context.bounds.maxDurationMs > context.budgetConfiguration.configuredTimeoutMs) {
    throw new ReassessmentExecutionError("reassessment-qualification-root-invalid");
  }
}

/** Opens the immutable root once. Promotion neither reopens capture nor changes its allowance. */
export async function runReassessmentQualification<T>(seed: ReassessmentQualificationSeedV2, hooks: ReassessmentQualificationHooks, fn: () => Promise<T>): Promise<T> {
  if (phase.getStore() || execution.getStore()) fail("reassessment-nested-execution");
  const context = freeze(reassessmentCaptureValue(seed) as ReassessmentQualificationSeedV2);
  validateQualificationRoot(context);
  const root: QualificationRoot = { context, hooks, sequence: { value: 0 }, activePhase: "qualification", pending: 0, promoting: false, observations: [],
    state: { providerReservations: 0, providerStarts: 0, reservedTokens: 0, unknownEffects: 0, held: false, closed: false } };
  try { await hooks.open(context); } catch { throw new ReassessmentExecutionError("reassessment-capture-unavailable"); }
  return phase.run({ root, phase: "qualification" }, async () => {
    try { assertQualificationFrame(); return await fn(); }
    finally { root.state.closed = true;
      try { await hooks.close?.(context, Object.freeze({ ...root.state })); } catch { root.state.held = true; }
    }
  });
}

/** The only Q effect port is the exact ordered server-selected GET inventory. */
export async function runReassessmentQualificationRequest<T>(request: { method: "GET"; url: string }, execute: () => Promise<T>,
  captureOutput?: (value: T) => unknown | Promise<unknown>): Promise<T> {
  const root = assertQualificationFrame();
  if (Object.keys(request).length !== 2 || request.method !== "GET" || root.pending || root.promoting
    || request.url !== root.context.nativeObservationUrls[root.observations.length]
    || root.state.providerReservations >= root.context.bounds.maxProviderStarts) {
    fail("reassessment-qualification-request-unavailable");
  }
  root.pending++;
  const event = freeze({ kind: "provider" as const, name: "native-runtime-observation", input: { operation: "configuration", method: "GET", url: request.url },
    sequence: ++root.sequence.value, providerReservationOrdinal: ++root.state.providerReservations, observedAt: new Date().toISOString() });
  let reservation: ReassessmentCaptureReservation | undefined;
  let started = false;
  try {
    reservation = await root.hooks.reserve(root.context, event);
    if (!nonempty(reservation?.reservationId)) throw new Error("missing reservation");
    assertQualificationFrame(); root.state.providerStarts++; started = true;
    const result = await execute();
    const output = reassessmentCaptureValue(captureOutput ? await captureOutput(result) : result);
    await root.hooks.complete(root.context, event, reservation, output);
    root.observations.push({ event, reservationId: reservation.reservationId, output });
    return result;
  } catch (error) {
    root.state.held = true;
    if (started && reservation) {
      root.state.unknownEffects++;
      try { await root.hooks.uncertain?.(root.context, event, reservation, { code: "qualification-outcome-uncertain", message: "An observation started without complete capture." }); } catch { /* Reserved is still unknown. */ }
    }
    throw new ReassessmentExecutionError(started ? "reassessment-capture-incomplete" : "reassessment-capture-unavailable",
      isReassessmentExecutionError(error) ? error.message : undefined);
  } finally { root.pending--; }
}

export function getReassessmentQualificationPrefix(): ReassessmentQualificationPrefix {
  const root = assertQualificationFrame();
  if (root.pending || root.promoting || root.state.unknownEffects || root.observations.length !== root.context.nativeObservationUrls.length
    || root.state.providerReservations !== root.observations.length || root.state.providerStarts !== root.observations.length) {
    throw new ReassessmentExecutionError("reassessment-qualification-prefix-incomplete");
  }
  return freeze(reassessmentQualificationPrefix(root.observations));
}

/** A caller supplies work, never a seal DTO. The authenticated storage hook rereads authority. */
export async function promoteReassessmentExecution<T>(fn: () => Promise<T>): Promise<T> {
  const root = assertQualificationFrame(); const prefix = getReassessmentQualificationPrefix(); root.promoting = true;
  try {
    const seal = parseReassessmentExecutionSealV2(await root.hooks.readExecutionSeal(root.context, prefix));
    assertQualificationFrame();
    const locator = { schemaVersion: 2, manifestArtifactId: root.context.manifest.artifactId, manifestDigest: root.context.manifest.digest };
    if (!seal || !equal(seal.root, locator) || !equal(seal.qualificationPrefix, prefix)
      || ["taskRunId", "userId", "agentId", "requestDigest", "executionFence", "binding"].some(key => !equal(seal[key as keyof typeof seal], root.context[key as keyof typeof root.context]))
      || !equal(seal.qualification.budgetConfiguration, root.context.budgetConfiguration) || !equal(seal.qualification.bounds, root.context.bounds)
      || Date.parse(seal.sealedAt) < Date.parse(root.context.startedAt) || Date.parse(seal.sealedAt) > Date.now()) {
      throw new ReassessmentExecutionError("reassessment-execution-seal-unproven");
    }
    const { phase: _phase, budgetConfiguration: _budget, bounds: _bounds, nativeObservationUrls: _urls, ...identity } = root.context;
    const context = freeze({ ...identity, schemaVersion: 1 as const, qualification: seal.qualification }); validateSeed(context);
    const hooks: ReassessmentCaptureHooks = { open: async () => {}, reserve: root.hooks.reserve, complete: root.hooks.complete,
      uncertain: root.hooks.uncertain };
    const scope: Scope = { context, hooks, state: root.state, sequence: root.sequence, root };
    root.seal = freeze(reassessmentCaptureValue(seal) as ReassessmentExecutionSealV2);
    root.activePhase = "execution";
    return await phase.run({ root, phase: "execution" }, () => execution.run(scope, fn));
  } finally { root.promoting = false; }
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
    || !nonnegativeInteger(q.budgetConfiguration.configuredPerTaskLimit)
    || (q.finiteTokenProof !== undefined && !validReassessmentFiniteTokenProof(q.finiteTokenProof))
    || (q.budgetConfiguration.configuredPerTaskLimit > 0 && !validReassessmentFiniteTokenProof(q.finiteTokenProof))
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
  assertExecutionPhase();
  return execution.getStore()?.context ?? null;
}

/** Finite production activation requires this server-promoted E frame, never an additive DTO on v1. */
export function currentFiniteReassessmentExecution(): ReassessmentExecutionContext | null {
  assertExecutionPhase();
  const scope = execution.getStore();
  if (!scope?.root) return null;
  const context = assertReassessmentActive()!;
  if (context.qualification.nativeRuntime?.schemaVersion !== 2 || !validReassessmentFiniteTokenProof(context.qualification.finiteTokenProof)
    || !validAuditedReassessmentNativeQualification(context.qualification)) {
    fail("reassessment-finite-execution-unproven");
  }
  return context;
}

/** The actual writer supplies its already locked transaction. No DTO can grant
 * this port: only the promoted E root retains the trusted storage callback. */
export async function validateReassessmentCommitBoundary(transaction: unknown, expected: {
  taskRunId: string; requestDigest: string; executionFence?: TaskExecutionFence | null;
}): Promise<void> {
  const context = currentFiniteReassessmentExecution();
  const root = execution.getStore()?.root;
  if (!context || !root?.seal || !root.hooks.validateCommit || context.taskRunId !== expected.taskRunId
    || context.requestDigest !== expected.requestDigest || !sameTaskExecutionFence(context.executionFence, expected.executionFence)) {
    fail("reassessment-commit-authority-unproven");
  }
  try { await root.hooks.validateCommit(transaction, root.context, root.seal); }
  catch { fail("reassessment-commit-authority-unproven"); }
  assertReassessmentActive();
}

export function assertReassessmentActive(): ReassessmentExecutionContext | null {
  assertExecutionPhase();
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
  if (execution.getStore() || phase.getStore()) fail("reassessment-nested-execution", "A reassessment cannot open another execution scope.");
  const context = freeze(reassessmentCaptureValue(seed) as ReassessmentExecutionSeed);
  validateSeed(context);
  const scope: Scope = { context, hooks, sequence: { value: 0 }, state: { providerReservations: 0, providerStarts: 0, reservedTokens: 0, unknownEffects: 0, held: false, closed: false } };
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
  const frame = phase.getStore();
  if (frame?.phase === "qualification" && frame.root.activePhase === "qualification") fail("reassessment-qualification-only");
  assertExecutionPhase();
  const scope = execution.getStore();
  if (!scope) return execute();
  assertReassessmentActive();
  if (!nonempty(effect.name) || !["provider", "tool"].includes(effect.kind)) fail("reassessment-effect-invalid");
  if (effect.kind === "tool") assertReassessmentProposedToolCall({ toolName: effect.name, params: object(effect.input) ? effect.input : {} });
  const input = reassessmentCaptureValue(effect.input);
  if (effect.kind === "provider") consumeFiniteProviderReservation(scope, input);
  if (effect.kind === "provider" && scope.state.providerReservations >= scope.context.qualification.bounds.maxProviderStarts) {
    fail("reassessment-provider-start-limit", "The immutable provider start allowance is exhausted.");
  }
  const ordinal = effect.kind === "provider" ? ++scope.state.providerReservations : null;
  const event = freeze({ ...effect, input, sequence: ++scope.sequence.value, providerReservationOrdinal: ordinal, observedAt: new Date().toISOString() });
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
    const policy = { readerToolNames: ["read_source_at_version"], immutableReaderArguments: immutableReaderArgumentsFor(binding.artifactRef) };
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
    || !sameReassessmentPlan(input.plan, context)) fail("reassessment-composition-changed", "The actual provider execution plan differs from the qualified immutable composition.");
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

function sameReassessmentPlan(actual: RoutedExecutionPlan, context: ReassessmentExecutionContext): boolean {
  const expected = context.qualification.executionPlan;
  if (!validAuditedReassessmentNativeQualification(context.qualification) || !actual.localThinkingBudgetEvidence || !expected.localThinkingBudgetEvidence) return equal(actual, expected);
  if (!nonnegativeInteger(actual.localThinkingBudgetEvidence.observedAt)) return false;
  return equal({ ...actual, localThinkingBudgetEvidence: { ...actual.localThinkingBudgetEvidence, observedAt: 0 } },
    { ...expected, localThinkingBudgetEvidence: { ...expected.localThinkingBudgetEvidence, observedAt: 0 } });
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

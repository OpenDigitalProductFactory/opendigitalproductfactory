import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { sameTaskExecutionFence, taskExecutionEligible, type TaskExecutionFence } from "./shared/task-execution-fence";
import {
  ReassessmentExecutionError, reassessmentCaptureValue, runReassessmentExecution,
  hasPersistedReassessmentExecution, parseReassessmentExecutionLocator,
  parseReassessmentTokenReservation, validReassessmentFiniteTokenProof,
  type ReassessmentCaptureHooks, type ReassessmentExecutionContext,
  type ReassessmentExecutionManifest, type ReassessmentExecutionSeed, type ReassessmentExecutionLocator, type ReassessmentCaptureEvent,
  runReassessmentQualification, type ReassessmentQualificationHooks,
} from "./routing/reassessment-execution-scope";
import { parseReassessmentRootLocatorV2, parseReassessmentExecutionSealV2, deriveReassessmentExecutionSealArtifactId, reassessmentQualificationPrefix,
  type ReassessmentRootLocatorV2, type ReassessmentQualificationSeedV2, type ReassessmentQualificationManifestV2,
  type ReassessmentExecutionSealV2, type ReassessmentQualificationPrefix } from "./routing/reassessment-phase-contract";
export { hasPersistedReassessmentExecution, parseReassessmentExecutionLocator } from "./routing/reassessment-execution-scope";

export type PersistedReassessmentExecutionInput = {
  taskRunRecordId: string; taskRunId: string; userId: string; agentId: string;
  binding: InitiativeReviewBinding | undefined; requestDigest: string; executionFence: TaskExecutionFence | null;
  a2aMetadata: unknown; progressPayload: unknown;
};
export type ReassessmentCaptureDatabase = Pick<typeof prisma, "$transaction">;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const equal = (left: unknown, right: unknown): boolean => canonicalJson(left ?? null) === canonicalJson(right ?? null);
const json = (value: unknown): Prisma.InputJsonValue => reassessmentCaptureValue(value) as Prisma.InputJsonValue;
function refuse(code: string, message: string): never { throw new ReassessmentExecutionError(code, message); }
const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

export const reassessmentExecutionManifestDigest = (manifest: ReassessmentExecutionManifest | ReassessmentQualificationManifestV2): string => hash(manifest);

async function readManifest(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput,
  locator: ReassessmentExecutionLocator, lock = false): Promise<{ seed: ReassessmentExecutionSeed; threadId: string }> {
  if (lock) await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${input.taskRunId} FOR UPDATE`;
  const row = await tx.taskRun.findUnique({ where: { taskRunId: input.taskRunId }, select: {
    id: true, taskRunId: true, userId: true, currentAgentId: true, status: true, threadId: true, a2aMetadata: true, progressPayload: true,
  } });
  const metadata = object(row?.a2aMetadata) ? row.a2aMetadata : {};
  if (!row || row.id !== input.taskRunRecordId || row.userId !== input.userId || row.currentAgentId !== input.agentId
    || metadata.trigger !== "external-mcp" || metadata.requestDigest !== input.requestDigest
    || !equal(metadata.initiativeReviewBinding, input.binding) || !equal(metadata.reassessmentExecution, locator)
    || !taskExecutionEligible({ status: row.status, progressPayload: row.progressPayload, requestDigest: input.requestDigest, executionFence: input.executionFence })) {
    refuse("reassessment-execution-displaced", "The accepted task, binding, actor, cancellation state or captured generation changed before capture.");
  }
  const stored = await tx.taskArtifact.findUnique({ where: { artifactId: locator.manifestArtifactId }, select: {
    taskRunId: true, parts: true,
  } });
  const part = Array.isArray(stored?.parts) && stored.parts.length === 1 && object(stored.parts[0]) ? stored.parts[0] : null;
  const manifest = part?.data;
  if (!stored || stored.taskRunId !== row.id || !part || part.type !== "reassessment-execution-manifest-v1"
    || !object(manifest) || hash(manifest) !== locator.manifestDigest
    || manifest.schemaVersion !== 1 || manifest.taskRunId !== input.taskRunId || manifest.userId !== input.userId || manifest.agentId !== input.agentId
    || manifest.requestDigest !== input.requestDigest || !equal(manifest.binding, input.binding)
    || !sameTaskExecutionFence(manifest.executionFence, input.executionFence)) {
    refuse("reassessment-manifest-unproven", "The server-admitted execution manifest is missing or does not match its pinned task, binding and full execution fence.");
  }
  // The leaf validates all qualification/version/bound fields before invoking
  // open. This cast does not confer admission; only the sealed accepted marker
  // and its exact persisted bytes enable this server-only execution wrapper.
  const seed = { ...manifest, manifest: { artifactId: locator.manifestArtifactId, digest: locator.manifestDigest } } as ReassessmentExecutionSeed;
  return { seed, threadId: row.threadId ?? row.taskRunId };
}

async function artifact(tx: Prisma.TransactionClient, context: ReassessmentExecutionContext, recordId: string,
  kind: string, data: unknown, key: unknown): Promise<void> {
  await tx.taskArtifact.create({ data: {
    id: randomUUID(), artifactId: `ta-reassessment-${hash({ taskRunId: context.taskRunId, manifestDigest: context.manifest.digest, kind, key })}`,
    taskRunId: recordId, name: kind, parts: json([{ type: kind, mimeType: "application/json", data }]),
    metadata: json({ schemaVersion: 1, requestDigest: context.requestDigest, manifestArtifactId: context.manifest.artifactId,
      manifestDigest: context.manifest.digest, compositionVersion: context.qualification.compositionVersion }),
    producerAgentId: context.agentId,
  } });
}

/** Every finite reservation is present in both existing owners in the same transaction. */
async function assertFiniteReservationLedger(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput,
  context: ReassessmentExecutionContext, event: ReassessmentCaptureEvent): Promise<void> {
  const limit = context.qualification.budgetConfiguration.configuredPerTaskLimit;
  if (limit === 0) return;
  function invalid(): never { return refuse("reassessment-token-accounting-unproven", "The current generation reservation accounting is missing, malformed or inconsistent."); }
  if (!Number.isSafeInteger(limit) || limit <= 0 || !validReassessmentFiniteTokenProof(context.qualification.finiteTokenProof)) invalid();
  const checkedEvent = (value: unknown): ReassessmentCaptureEvent => {
    if (!object(value) || !["provider", "tool"].includes(String(value.kind)) || typeof value.name !== "string" || !value.name
      || !Number.isSafeInteger(value.sequence) || Number(value.sequence) <= 0 || typeof value.observedAt !== "string"
      || !Number.isFinite(Date.parse(value.observedAt)) || !object(value.input)) invalid();
    if (value.kind === "tool") {
      if (value.providerReservationOrdinal !== null || !["read_source_at_version", context.binding.writerToolName].includes(value.name as string)) invalid();
    } else {
      if (!Number.isSafeInteger(value.providerReservationOrdinal) || Number(value.providerReservationOrdinal) <= 0
        || !["configuration", "count", "generation"].includes(String(value.input.operation))) invalid();
      if (value.input.operation === "generation") {
        const reservation = parseReassessmentTokenReservation(value.input.tokenReservation);
        if (!reservation || reservation.maxOutputTokens !== context.qualification.bounds.maxOutputTokens || typeof value.input.bodyUtf8 !== "string"
          || createHash("sha256").update(value.input.bodyUtf8, "utf8").digest("hex") !== reservation.bodySha256) invalid();
      } else if (Object.hasOwn(value.input, "tokenReservation")) invalid();
    }
    return value as ReassessmentCaptureEvent;
  };
  const [executions, artifacts] = await Promise.all([
    tx.toolExecution.findMany({ where: { taskRunId: context.taskRunId, toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture" }, select: { parameters: true, userId: true, agentId: true } }),
    tx.taskArtifact.findMany({ where: { taskRunId: input.taskRunRecordId, name: "reassessment-effect-reservation-v1" }, select: { parts: true, metadata: true, producerAgentId: true } }),
  ]);
  if (!Array.isArray(executions) || !Array.isArray(artifacts)) invalid();
  const executionEvents = new Map<number, ReassessmentCaptureEvent>(), artifactEvents = new Map<number, ReassessmentCaptureEvent>();
  const add = (events: Map<number, ReassessmentCaptureEvent>, raw: unknown): void => {
    const captured = checkedEvent(raw); if (events.has(captured.sequence)) invalid(); events.set(captured.sequence, captured);
  };
  for (const row of executions) {
    const parameters = object(row.parameters) ? row.parameters : null;
    if (row.userId !== context.userId || row.agentId !== context.agentId || !parameters || parameters.schemaVersion !== 1 || parameters.manifestArtifactId !== context.manifest.artifactId
      || parameters.manifestDigest !== context.manifest.digest || parameters.requestDigest !== context.requestDigest
      || !sameTaskExecutionFence(parameters.executionFence, context.executionFence)) invalid();
    add(executionEvents, parameters.event);
  }
  for (const row of artifacts) {
    const metadata = object(row.metadata) ? row.metadata : null;
    const part = Array.isArray(row.parts) && row.parts.length === 1 && object(row.parts[0]) ? row.parts[0] : null;
    const data = object(part?.data) ? part.data : null;
    if (row.producerAgentId !== context.agentId || !metadata || metadata.schemaVersion !== 1 || metadata.manifestArtifactId !== context.manifest.artifactId
      || metadata.manifestDigest !== context.manifest.digest || metadata.requestDigest !== context.requestDigest
      || metadata.compositionVersion !== context.qualification.compositionVersion || part?.type !== "reassessment-effect-reservation-v1"
      || !data || data.executionStatus !== "reserved" || data.requestDigest !== context.requestDigest
      || !sameTaskExecutionFence(data.executionFence, context.executionFence)) invalid();
    add(artifactEvents, data.event);
  }
  if (executionEvents.size !== artifactEvents.size || [...executionEvents].some(([sequence, value]) => !equal(value, artifactEvents.get(sequence)))) invalid();
  const summarize = (events: Map<number, ReassessmentCaptureEvent>) => {
    let tokens = 0, providers = 0; const reservations = new Set<string>();
    for (let sequence = 1; sequence <= events.size; sequence++) {
      const captured = events.get(sequence); if (!captured) invalid();
      if (captured.kind !== "provider") continue;
      if (captured.providerReservationOrdinal !== ++providers) invalid();
      if ((captured.input as Record<string, unknown>).operation !== "generation") continue;
      const reservation = parseReassessmentTokenReservation((captured.input as Record<string, unknown>).tokenReservation)!;
      if (reservations.has(reservation.reservationId)) invalid(); reservations.add(reservation.reservationId);
      tokens += reservation.reservedTokens; if (!Number.isSafeInteger(tokens) || tokens > limit) invalid();
    }
    return { tokens, providers, reservations };
  };
  const prior = summarize(executionEvents), mirror = summarize(artifactEvents), next = checkedEvent(event);
  if (prior.tokens !== mirror.tokens || next.sequence !== executionEvents.size + 1) invalid();
  if (next.kind === "provider" && (next.providerReservationOrdinal !== prior.providers + 1 || prior.providers >= context.qualification.bounds.maxProviderStarts)) invalid();
  if (next.kind !== "provider" || (next.input as Record<string, unknown>).operation !== "generation") return;
  const reservation = parseReassessmentTokenReservation((next.input as Record<string, unknown>).tokenReservation)!;
  if (prior.reservations.has(reservation.reservationId)) invalid();
  if (prior.tokens + reservation.reservedTokens > limit) refuse("reassessment-token-limit", "The immutable whole-generation token allowance is exhausted.");
}

/** Uses the existing TaskArtifact and ToolExecution owners. Capture rows have
 * their own audit-only name, so a captured writer output is never mistaken for
 * a canonical writer invocation or an independently issued domain receipt. */
export function createReassessmentCaptureHooks(input: PersistedReassessmentExecutionInput, locator: ReassessmentExecutionLocator,
  database: ReassessmentCaptureDatabase = prisma): ReassessmentCaptureHooks {
  return {
    open: async context => database.$transaction(async tx => {
      const current = await readManifest(tx, input, locator, true);
      if (!equal(current.seed, context)) refuse("reassessment-manifest-changed", "The execution manifest changed before opening capture.");
      // The unique deterministic artifact id makes a second worker/process
      // fail closed even after the first completed or lost its response.
      await artifact(tx, context, input.taskRunRecordId, "reassessment-execution-open-v1", context, "open");
    }),
    reserve: async (context, event) => database.$transaction(async tx => {
      const current = await readManifest(tx, input, locator, true);
      if (!equal(current.seed, context)) refuse("reassessment-manifest-changed", "The execution manifest changed before reservation.");
      await assertFiniteReservationLedger(tx, input, context, event);
      await artifact(tx, context, input.taskRunRecordId, "reassessment-effect-reservation-v1", {
        executionStatus: "reserved", event, requestDigest: context.requestDigest, executionFence: context.executionFence,
      }, event.sequence);
      const row = await tx.toolExecution.create({ data: {
        threadId: current.threadId, taskRunId: context.taskRunId, userId: context.userId, agentId: context.agentId,
        toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture", auditClass: "restricted-reassessment",
        parameters: json({ schemaVersion: 1, manifestArtifactId: locator.manifestArtifactId, manifestDigest: locator.manifestDigest,
          requestDigest: context.requestDigest, executionFence: context.executionFence, event }),
        result: json({ executionStatus: "reserved", consumption: "unknown-until-observed" }), success: false,
      }, select: { id: true } });
      return { reservationId: row.id };
    }),
    complete: async (context, event, reservation, output) => database.$transaction(async tx => {
      // Observation may arrive after cancellation or displacement. Persist it
      // against the original reservation, without publishing another effect or
      // erasing a genuine receipt already committed by the canonical writer.
      await artifact(tx, context, input.taskRunRecordId, "reassessment-effect-observed-v1", { event, reservation, output }, event.sequence);
      const updated = await tx.toolExecution.updateMany({ where: {
        id: reservation.reservationId, taskRunId: context.taskRunId, userId: context.userId, agentId: context.agentId,
        toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture", success: false,
      }, data: { result: json({ executionStatus: "observed", output }), success: true } });
      if (updated.count !== 1) refuse("reassessment-capture-reservation-changed", "The effect observation no longer identifies exactly one durable reservation.");
    }),
    uncertain: async (context, event, reservation, error) => database.$transaction(async tx => {
      // Preserve the original reserved ToolExecution if observation is lost.
      // A best-effort append records the hold; absence never means zero usage.
      await artifact(tx, context, input.taskRunRecordId, "reassessment-effect-uncertain-v1", {
        event, reservation, error, consumption: "unknown", holdFurtherEffects: true,
      }, event.sequence);
    }),
    close: async (context, state) => database.$transaction(async tx => {
      await artifact(tx, context, input.taskRunRecordId, "reassessment-execution-close-v1", state, "close");
    }),
  };
}

/** Missing marker is an ordinary task. A present malformed/unsupported marker
 * is a refusal. Request payloads and client switches are never consulted. R3
 * alone will produce the accepted marker and seal atomically with admission. */
export async function withPersistedReassessmentExecution<T>(input: PersistedReassessmentExecutionInput, fn: () => Promise<T>,
  dependencies: { database?: ReassessmentCaptureDatabase } = {}): Promise<T> {
  if (!hasPersistedReassessmentExecution(input.a2aMetadata)) return fn();
  const metadata = object(input.a2aMetadata) ? input.a2aMetadata : {};
  const locator = parseReassessmentExecutionLocator(metadata.reassessmentExecution);
  if (!locator || !input.binding || !input.executionFence) refuse("reassessment-manifest-invalid", "The accepted task has an invalid reassessment execution manifest locator.");
  const database = dependencies.database ?? prisma;
  const { seed } = await database.$transaction(tx => readManifest(tx, input, locator));
  return runReassessmentExecution(seed, createReassessmentCaptureHooks(input, locator, database), fn);
}

type QualificationAuthorityCheck = (tx: Prisma.TransactionClient, root: ReassessmentQualificationSeedV2, seal: ReassessmentExecutionSealV2) => Promise<void>;
type QualificationDependencies = { database?: ReassessmentCaptureDatabase; validateExecutionAuthority?: QualificationAuthorityCheck };
const phaseKind = "reassessment-qualification-root-v2";
const sealKind = "reassessment-execution-seal-v2";
function sealId(input: PersistedReassessmentExecutionInput, locator: ReassessmentRootLocatorV2): string {
  return deriveReassessmentExecutionSealArtifactId({ taskRunId: input.taskRunId, rootArtifactId: locator.manifestArtifactId, rootDigest: locator.manifestDigest });
}

async function readQualificationRoot(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput, locator: ReassessmentRootLocatorV2,
  lock = true): Promise<{ seed: ReassessmentQualificationSeedV2; threadId: string; taskMetadata: Record<string, unknown>; admissionMetadata: unknown }> {
  if (lock) await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${input.taskRunId} FOR UPDATE`;
  const row = await tx.taskRun.findUnique({ where: { taskRunId: input.taskRunId } });
  const metadata = object(row?.a2aMetadata) ? row.a2aMetadata : {};
  if (!row || row.id !== input.taskRunRecordId || row.userId !== input.userId || row.currentAgentId !== input.agentId
    || metadata.trigger !== "external-mcp" || metadata.requestDigest !== input.requestDigest
    || !equal(metadata.initiativeReviewBinding, input.binding) || !equal(metadata.reassessmentExecution, locator)
    || !taskExecutionEligible({ status: row.status, progressPayload: row.progressPayload, requestDigest: input.requestDigest, executionFence: input.executionFence })) {
    refuse("reassessment-execution-displaced", "The root task, actor, binding or captured generation changed.");
  }
  const stored = await tx.taskArtifact.findUnique({ where: { artifactId: locator.manifestArtifactId } });
  const part = Array.isArray(stored?.parts) && stored.parts.length === 1 && object(stored.parts[0]) ? stored.parts[0] : null;
  const root = part?.data;
  if (!stored || stored.taskRunId !== row.id || stored.producerAgentId !== input.agentId || part?.type !== phaseKind || !object(root)
    || hash(root) !== locator.manifestDigest || root.schemaVersion !== 2 || root.phase !== "qualification"
    || root.taskRunId !== input.taskRunId || root.userId !== input.userId || root.agentId !== input.agentId
    || root.requestDigest !== input.requestDigest || !equal(root.binding, input.binding) || !sameTaskExecutionFence(root.executionFence, input.executionFence)) {
    refuse("reassessment-manifest-unproven", "The immutable qualification root is missing or differs from its accepted task.");
  }
  return { seed: { ...root, manifest: { artifactId: locator.manifestArtifactId, digest: locator.manifestDigest } } as ReassessmentQualificationSeedV2,
    threadId: row.threadId ?? row.taskRunId, taskMetadata: metadata, admissionMetadata: stored.metadata };
}

export type PersistedReassessmentRequestAuthority = { authorityDecisionId: string; actingAgentId: string; tokenGrantScopes: readonly string[] };
/** Pre-Q readback selects the existing admitted authority context. It does not
 * grant execution: the normal authority factory must recheck current access. */
export async function loadPersistedReassessmentQualificationRoot(input: PersistedReassessmentExecutionInput,
  dependencies: { database?: ReassessmentCaptureDatabase } = {}): Promise<{
    seed: ReassessmentQualificationSeedV2; requestAuthority: PersistedReassessmentRequestAuthority;
  }> {
  const expected = object(input.a2aMetadata) ? input.a2aMetadata : {};
  const locator = parseReassessmentRootLocatorV2(expected.reassessmentExecution);
  if (!locator || !input.binding || !input.executionFence) refuse("reassessment-manifest-invalid", "The accepted qualification root is unproven.");
  return (dependencies.database ?? prisma).$transaction(async tx => {
    const current = await readQualificationRoot(tx, input, locator);
    const authority = current.taskMetadata.presentReviewAuthority, admitted = current.admissionMetadata;
    const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 500 && value.trim() === value;
    if (!object(authority) || Object.keys(authority).length !== 3
      || !["authorityDecisionId", "actingAgentId", "tokenGrantScopes"].every(key => Object.hasOwn(authority, key))
      || !text(authority.authorityDecisionId) || !text(authority.actingAgentId)
      || !Array.isArray(authority.tokenGrantScopes) || authority.tokenGrantScopes.length > 500 || !authority.tokenGrantScopes.every(text)
      || !equal(authority, expected.presentReviewAuthority) || !object(admitted)
      || admitted.authorityDecisionId !== authority.authorityDecisionId || admitted.actingAgentId !== authority.actingAgentId) {
      refuse("reassessment-request-authority-unproven", "The admitted request authority does not match its current task and root.");
    }
    return { seed: current.seed, requestAuthority: { authorityDecisionId: authority.authorityDecisionId,
      actingAgentId: authority.actingAgentId, tokenGrantScopes: Object.freeze([...authority.tokenGrantScopes]) } };
  });
}

async function phaseArtifact(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput, root: ReassessmentQualificationSeedV2,
  kind: string, data: unknown, key: unknown): Promise<void> {
  await tx.taskArtifact.create({ data: { id: randomUUID(), artifactId: `ta-reassessment-${hash({ taskRunId: root.taskRunId, manifestDigest: root.manifest.digest, kind, key })}`,
    taskRunId: input.taskRunRecordId, name: kind, parts: json([{ type: kind, mimeType: "application/json", data }]), producerAgentId: root.agentId,
    metadata: json({ schemaVersion: 2, requestDigest: root.requestDigest, manifestArtifactId: root.manifest.artifactId, manifestDigest: root.manifest.digest }) } });
}

/** Read both authoritative capture owners. Missing, duplicated, unknown or mismatched observations never count as zero. */
async function readPhaseObservations(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput, root: ReassessmentQualificationSeedV2) {
  const [executions, artifacts] = await Promise.all([
    tx.toolExecution.findMany({ where: { taskRunId: input.taskRunId, toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture",
      parameters: { path: ["manifestDigest"], equals: root.manifest.digest } }, orderBy: { createdAt: "asc" } }),
    tx.taskArtifact.findMany({ where: { taskRunId: input.taskRunRecordId, metadata: { path: ["manifestDigest"], equals: root.manifest.digest },
      name: { in: ["reassessment-effect-reservation-v1", "reassessment-effect-observed-v1", "reassessment-effect-uncertain-v1", "reassessment-execution-close-v1"] } } }),
  ]);
  const invalid = (): never => refuse("reassessment-qualification-prefix-unproven", "The persisted mirrored observation prefix is incomplete or inconsistent.");
  const bySequence = new Map<number, { event: ReassessmentCaptureEvent; reservationId: string; output: unknown }>();
  for (const row of executions) {
    const parameters = object(row.parameters) ? row.parameters : null, result = object(row.result) ? row.result : null;
    const event = object(parameters?.event) ? parameters.event : null;
    if (!event) return invalid();
    if (!parameters || parameters.schemaVersion !== 2 || parameters.manifestArtifactId !== root.manifest.artifactId || parameters.manifestDigest !== root.manifest.digest
      || parameters.requestDigest !== root.requestDigest || !sameTaskExecutionFence(parameters.executionFence, root.executionFence)
      || row.userId !== root.userId || row.agentId !== root.agentId || row.taskRunId !== root.taskRunId
      || !event || !Number.isSafeInteger(event.sequence) || Number(event.sequence) <= 0 || bySequence.has(Number(event.sequence))
      || !row.success || result?.executionStatus !== "observed" || !Object.hasOwn(result, "output")) invalid();
    bySequence.set(Number(event.sequence), { event: event as ReassessmentCaptureEvent, reservationId: row.id, output: result!.output });
  }
  const counts = new Map<string, number>();
  for (const row of artifacts) {
    const metadata = object(row.metadata) ? row.metadata : null;
    const part = Array.isArray(row.parts) && row.parts.length === 1 && object(row.parts[0]) ? row.parts[0] : null;
    const data = object(part?.data) ? part.data : null, event = object(data?.event) ? data.event : null;
    if (!data || !event) return invalid();
    if (row.producerAgentId !== root.agentId || !metadata || metadata.schemaVersion !== 2 || metadata.manifestArtifactId !== root.manifest.artifactId
      || metadata.manifestDigest !== root.manifest.digest || metadata.requestDigest !== root.requestDigest || !part || part.type !== row.name
      || !data || !event || !["reassessment-effect-reservation-v1", "reassessment-effect-observed-v1"].includes(row.name)) invalid();
    const observed = bySequence.get(Number(event.sequence)); if (!observed || !equal(event, observed.event)) return invalid();
    const key = `${row.name}:${event.sequence}`; counts.set(key, (counts.get(key) ?? 0) + 1);
    if (row.name === "reassessment-effect-reservation-v1") {
      if (data.executionStatus !== "reserved" || data.requestDigest !== root.requestDigest || !sameTaskExecutionFence(data.executionFence, root.executionFence)) invalid();
    } else if (!Object.hasOwn(data, "output") || !equal(data.reservation, { reservationId: observed.reservationId }) || !equal(data.output, observed.output)) invalid();
  }
  const observations: Array<{ event: ReassessmentCaptureEvent; reservationId: string; output: unknown }> = [];
  for (let sequence = 1; sequence <= bySequence.size; sequence++) {
    const entry = bySequence.get(sequence);
    if (!entry || counts.get(`reassessment-effect-reservation-v1:${sequence}`) !== 1 || counts.get(`reassessment-effect-observed-v1:${sequence}`) !== 1) invalid();
    observations.push(entry!);
  }
  return observations;
}

/** R3 calls this inside its TaskRun→subject transaction before producing the additive seal. */
export async function readPersistedReassessmentQualificationPrefix(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput,
  locator: ReassessmentRootLocatorV2, options: { requireSealAbsent?: boolean } = {}): Promise<ReassessmentQualificationPrefix> {
  const { seed } = await readQualificationRoot(tx, input, locator);
  if (options.requireSealAbsent && await tx.taskArtifact.findUnique({ where: { artifactId: sealId(input, locator) } })) {
    refuse("reassessment-qualification-already-sealed", "The root already has an execution seal.");
  }
  const observations = await readPhaseObservations(tx, input, seed);
  const urls = seed.nativeObservationUrls;
  if (!Array.isArray(urls) || observations.length < urls.length || !urls.length) refuse("reassessment-qualification-prefix-unproven", "The required observations are incomplete.");
  const prefix = observations.slice(0, urls.length);
  for (const [index, entry] of prefix.entries()) {
    if (entry.event.kind !== "provider" || entry.event.name !== "native-runtime-observation" || entry.event.sequence !== index + 1
      || entry.event.providerReservationOrdinal !== index + 1 || !equal(entry.event.input, { operation: "configuration", method: "GET", url: urls[index] })) {
      refuse("reassessment-qualification-prefix-unproven", "The observation prefix differs from the exact ordered GET inventory.");
    }
  }
  if (options.requireSealAbsent && observations.length !== urls.length) refuse("reassessment-qualification-prefix-unproven", "Qualification contains undeclared effects.");
  return reassessmentQualificationPrefix(prefix);
}

async function readExecutionSeal(tx: Prisma.TransactionClient, input: PersistedReassessmentExecutionInput, locator: ReassessmentRootLocatorV2,
  root: ReassessmentQualificationSeedV2, prefix: ReassessmentQualificationPrefix, authority?: QualificationAuthorityCheck,
  expectedSeal?: ReassessmentExecutionSealV2): Promise<ReassessmentExecutionSealV2> {
  const stored = await tx.taskArtifact.findUnique({ where: { artifactId: sealId(input, locator) } });
  const part = Array.isArray(stored?.parts) && stored.parts.length === 1 && object(stored.parts[0]) ? stored.parts[0] : null;
  const seal = parseReassessmentExecutionSealV2(part?.data);
  if (!authority || !stored || stored.taskRunId !== input.taskRunRecordId || stored.producerAgentId !== root.agentId || stored.name !== sealKind || part?.type !== sealKind
    || !seal || (expectedSeal && !equal(seal, expectedSeal)) || !equal(seal.root, locator) || !equal(seal.qualificationPrefix, prefix)
    || !equal(seal.binding, root.binding) || !sameTaskExecutionFence(seal.executionFence, root.executionFence)
    || ["taskRunId", "userId", "agentId", "requestDigest"].some(key => seal[key as keyof typeof seal] !== root[key as keyof typeof root])
    || !equal(seal.qualification.budgetConfiguration, root.budgetConfiguration) || !equal(seal.qualification.bounds, root.bounds)
    || Date.parse(seal.sealedAt) < Date.parse(root.startedAt) || Date.parse(seal.sealedAt) > Date.now() || Date.now() >= Date.parse(root.deadlineAt)) {
    refuse("reassessment-execution-seal-unproven", "The current authoritative additive execution seal is unproven.");
  }
  await authority(tx, root, seal);
  return seal;
}

function assertPhaseEventAccounting(root: ReassessmentQualificationSeedV2,
  observations: readonly { event: ReassessmentCaptureEvent }[], next: ReassessmentCaptureEvent): void {
  let providers = 0, tokens = 0; const ids = new Set<string>();
  const invalid = (): never => refuse("reassessment-token-accounting-unproven", "The immutable root accounting is malformed or exhausted.");
  for (const [index, event] of [...observations.map(entry => entry.event), next].entries()) {
    const details = object(event.input) ? event.input : null;
    if (!details) return invalid();
    if (event.sequence !== index + 1 || !Number.isFinite(Date.parse(event.observedAt))) invalid();
    if (event.kind === "tool") {
      if (event.providerReservationOrdinal !== null || !["read_source_at_version", root.binding.writerToolName].includes(event.name)) invalid();
      continue;
    }
    if (event.kind !== "provider" || event.providerReservationOrdinal !== ++providers || providers > root.bounds.maxProviderStarts
      || !["configuration", "count", "generation"].includes(String(details.operation))) invalid();
    if (details.operation !== "generation") { if (Object.hasOwn(details, "tokenReservation")) invalid(); continue; }
    if (root.budgetConfiguration.configuredPerTaskLimit === 0) continue;
    const reservation = parseReassessmentTokenReservation(details.tokenReservation);
    if (!reservation || ids.has(reservation.reservationId) || reservation.maxOutputTokens !== root.bounds.maxOutputTokens
      || typeof details.bodyUtf8 !== "string" || createHash("sha256").update(details.bodyUtf8, "utf8").digest("hex") !== reservation.bodySha256) invalid();
    ids.add(reservation!.reservationId); tokens += reservation!.reservedTokens;
    if (!Number.isSafeInteger(tokens) || tokens > root.budgetConfiguration.configuredPerTaskLimit) refuse("reassessment-token-limit", "The immutable whole-generation allowance is exhausted.");
  }
}

export async function withPersistedReassessmentQualification<T>(input: PersistedReassessmentExecutionInput, fn: () => Promise<T>,
  dependencies: QualificationDependencies = {}): Promise<T> {
  const metadata = object(input.a2aMetadata) ? input.a2aMetadata : {};
  const locator = parseReassessmentRootLocatorV2(metadata.reassessmentExecution);
  if (!locator || !input.binding || !input.executionFence) refuse("reassessment-manifest-invalid", "A qualification requires the exact accepted V2 root marker.");
  const database = dependencies.database ?? prisma;
  const { seed } = await database.$transaction(tx => readQualificationRoot(tx, input, locator));
  const hooks: ReassessmentQualificationHooks = {
    validateCommit: async (transaction, context, promotedSeal) => {
      // The writer already holds TaskRun then sorted subject/authorization
      // locks. Do not open a transaction or acquire another task lock here.
      const tx = transaction as Prisma.TransactionClient;
      const { seed: current } = await readQualificationRoot(tx, input, locator, false);
      if (!equal(current, context)) refuse("reassessment-manifest-changed", "The writer's qualification root changed.");
      // A writer reservation is deliberately still outstanding. Its original
      // complete Q prefix is sealed; rereading all observations would reject
      // the very canonical effect whose commit is being checked.
      await readExecutionSeal(tx, input, locator, current, promotedSeal.qualificationPrefix,
        dependencies.validateExecutionAuthority, promotedSeal);
    },
    open: context => database.$transaction(async tx => {
      const current = await readQualificationRoot(tx, input, locator);
      if (!equal(current.seed, context) || await tx.taskArtifact.findUnique({ where: { artifactId: sealId(input, locator) } })) refuse("reassessment-qualification-already-sealed", "Qualification cannot reopen a sealed root.");
      await phaseArtifact(tx, input, seed, "reassessment-execution-open-v1", context, "open");
    }),
    reserve: (context, event) => database.$transaction(async tx => {
      const { seed: current, threadId } = await readQualificationRoot(tx, input, locator);
      const observations = await readPhaseObservations(tx, input, current);
      if (event.sequence !== observations.length + 1) refuse("reassessment-capture-sequence-invalid", "The root capture sequence cannot reset or overlap.");
      if (context.schemaVersion === 2) {
        if (!equal(context, current) || await tx.taskArtifact.findUnique({ where: { artifactId: sealId(input, locator) } })
          || event.kind !== "provider" || event.name !== "native-runtime-observation" || !equal(event.input, { operation: "configuration", method: "GET", url: current.nativeObservationUrls[observations.length] })) {
          refuse("reassessment-qualification-phase-closed", "Qualification effects require the current unsealed GET-only root.");
        }
      } else {
        const prefix = await readPersistedReassessmentQualificationPrefix(tx, input, locator);
        const seal = await readExecutionSeal(tx, input, locator, current, prefix, dependencies.validateExecutionAuthority);
        const { phase: _phase, budgetConfiguration: _budget, bounds: _bounds, nativeObservationUrls: _urls, ...identity } = current;
        if (!equal(context, { ...identity, schemaVersion: 1, qualification: seal.qualification })) refuse("reassessment-execution-seal-unproven", "Execution differs from its exact persisted seal.");
      }
      assertPhaseEventAccounting(current, observations, event);
      const providers = observations.filter(entry => entry.event.kind === "provider").length;
      if (event.kind === "provider" && (event.providerReservationOrdinal !== providers + 1 || providers >= current.bounds.maxProviderStarts)) refuse("reassessment-provider-start-limit", "The immutable root provider allowance is exhausted.");
      await phaseArtifact(tx, input, seed, "reassessment-effect-reservation-v1", { executionStatus: "reserved", event, requestDigest: seed.requestDigest, executionFence: seed.executionFence }, event.sequence);
      const row = await tx.toolExecution.create({ data: { threadId, taskRunId: seed.taskRunId, userId: seed.userId, agentId: seed.agentId,
        toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture", auditClass: "restricted-reassessment",
        parameters: json({ schemaVersion: 2, manifestArtifactId: locator.manifestArtifactId, manifestDigest: locator.manifestDigest, requestDigest: seed.requestDigest, executionFence: seed.executionFence, event }),
        result: json({ executionStatus: "reserved", consumption: "unknown-until-observed" }), success: false }, select: { id: true } });
      return { reservationId: row.id };
    }),
    complete: (_context, event, reservation, output) => database.$transaction(async tx => {
      await phaseArtifact(tx, input, seed, "reassessment-effect-observed-v1", { event, reservation, output }, event.sequence);
      const updated = await tx.toolExecution.updateMany({ where: { id: reservation.reservationId, taskRunId: seed.taskRunId, userId: seed.userId, agentId: seed.agentId,
        toolName: "reassessment_capture", executionMode: "restricted-reassessment-capture", success: false }, data: { result: json({ executionStatus: "observed", output }), success: true } });
      if (updated.count !== 1) refuse("reassessment-capture-reservation-changed", "The original observation reservation changed.");
    }),
    uncertain: (_context, event, reservation, error) => database.$transaction(tx => phaseArtifact(tx, input, seed, "reassessment-effect-uncertain-v1", { event, reservation, error, consumption: "unknown", holdFurtherEffects: true }, event.sequence)),
    close: (_context, state) => database.$transaction(tx => phaseArtifact(tx, input, seed, "reassessment-execution-close-v1", state, "close")),
    readExecutionSeal: (_context, memoryPrefix) => database.$transaction(async tx => {
      const { seed: current } = await readQualificationRoot(tx, input, locator);
      const prefix = await readPersistedReassessmentQualificationPrefix(tx, input, locator);
      if (!equal(prefix, memoryPrefix)) refuse("reassessment-qualification-prefix-unproven", "The in-memory prefix differs from its complete persisted mirrors.");
      return readExecutionSeal(tx, input, locator, current, prefix, dependencies.validateExecutionAuthority);
    }),
  };
  return runReassessmentQualification(seed, hooks, fn);
}

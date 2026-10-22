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
} from "./routing/reassessment-execution-scope";
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

export const reassessmentExecutionManifestDigest = (manifest: ReassessmentExecutionManifest): string => hash(manifest);

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

import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { prisma, type Prisma } from "@dpf/db";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { sameTaskExecutionFence, taskExecutionEligible, type TaskExecutionFence } from "./shared/task-execution-fence";
import {
  ReassessmentExecutionError, reassessmentCaptureValue, runReassessmentExecution,
  hasPersistedReassessmentExecution, parseReassessmentExecutionLocator,
  type ReassessmentCaptureHooks, type ReassessmentExecutionContext,
  type ReassessmentExecutionManifest, type ReassessmentExecutionSeed, type ReassessmentExecutionLocator,
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
  if (lock) await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${input.taskRunId} FOR SHARE`;
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

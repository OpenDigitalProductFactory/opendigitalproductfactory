import type { Prisma } from "@dpf/db";

/** Shared TaskRun projection for the native semantic-review worker and its successor admission. */
export const json = (value: unknown) => value as Prisma.InputJsonValue;
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export const select = { id: true, taskRunId: true, userId: true, status: true, updatedAt: true,
  lastHeartbeatAt: true, progressPayload: true, a2aMetadata: true } satisfies Prisma.TaskRunSelect;
export type Run = Prisma.TaskRunGetPayload<{ select: typeof select }>;
export function native(row: Run): boolean { return object(row.a2aMetadata).gateKind === "semantic-review"; }
export function state(row: Run) { return object(object(row.progressPayload).semanticReview); }
export function progress(row: Run, patch: Record<string, unknown>) {
  return json({ ...object(row.progressPayload), semanticReview: { ...state(row), ...patch } });
}

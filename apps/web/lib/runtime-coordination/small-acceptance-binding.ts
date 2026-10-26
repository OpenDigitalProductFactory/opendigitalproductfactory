import { isRecord } from "@/lib/shared/coerce";
import type { RuntimeCoordinationActor, RuntimeVerificationInput } from "./types";

/** Reserved to the existing runtime-verification writer; never accepted from result JSON. */
export const SMALL_ACCEPTANCE_KEY = "smallRuntimeAcceptance";
export type RetainedSmallCheck = { state: "pass" | "fail" | "missing"; evidenceRefs: string[] };
export type SmallAcceptanceContext = {
  itemId: string; closureId: string; workCapsuleId: string;
  repositoryFullName: string; headSha: string; mergeCommitSha: string;
  servedSha: string; deploymentRunId: string; deploymentCompletedAt: string;
  effectiveShape: string; closureRecordedAt: string;
};
export type SmallAcceptanceBinding = SmallAcceptanceContext & {
  schemaVersion: 1; actor: { principalId: string; userId: string; agentId: string | null };
  startedAt: string; completedAt: string; recordedAt: string;
};
const sha = /^[a-f0-9]{40}$/i;
const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Parser shared by the writer and retained reader. Parsing does not confer provenance. */
export function readSmallAcceptanceBinding(value: unknown): SmallAcceptanceBinding | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.effectiveShape !== "small"
    || ![value.itemId, value.closureId, value.workCapsuleId, value.repositoryFullName, value.deploymentRunId].every(text)
    || ![value.headSha, value.mergeCommitSha, value.servedSha].every(v => typeof v === "string" && sha.test(v))
    || ![value.deploymentCompletedAt, value.closureRecordedAt, value.startedAt, value.completedAt, value.recordedAt].every(date)
    || !isRecord(value.actor) || !text(value.actor.principalId) || !text(value.actor.userId)
    || !(value.actor.agentId === null || text(value.actor.agentId))) return null;
  const start = Date.parse(value.startedAt as string), end = Date.parse(value.completedAt as string);
  if (start < Math.max(Date.parse(value.deploymentCompletedAt as string), Date.parse(value.closureRecordedAt as string))
    || end < start || end > Date.parse(value.recordedAt as string) || end - start > 2 * 60 * 60_000) return null;
  return value as SmallAcceptanceBinding;
}

export function createSmallAcceptanceBinding(args: {
  context: SmallAcceptanceContext;
  input: Pick<RuntimeVerificationInput, "startedAt" | "completedAt" | "command" | "result">;
  actor: RuntimeCoordinationActor; now: Date;
}): SmallAcceptanceBinding {
  if (args.context.effectiveShape !== "small") throw new Error("Only effective Small runtime acceptance is supported here.");
  if (!args.actor.principalId || !args.actor.userId) throw new Error("Authenticated runtime-check actor is required.");
  if (!args.input.command?.trim() || !args.input.result || Object.keys(args.input.result).length === 0
    || !args.input.startedAt || !args.input.completedAt) throw new Error("A real bounded runtime check and observations are required.");
  const binding: SmallAcceptanceBinding = { ...args.context, schemaVersion: 1,
    actor: { principalId: args.actor.principalId, userId: args.actor.userId, agentId: args.actor.agentId ?? null },
    startedAt: args.input.startedAt.toISOString(), completedAt: args.input.completedAt.toISOString(), recordedAt: args.now.toISOString() };
  if (!readSmallAcceptanceBinding(binding) || args.now.getTime() - args.input.completedAt.getTime() > 30 * 60_000) {
    throw new Error("Runtime check must be fresh, bounded, and after this closure and deployment.");
  }
  return binding;
}

export function sameSmallAcceptanceContext(binding: SmallAcceptanceBinding, context: SmallAcceptanceContext): boolean {
  return Object.entries(context).every(([key, value]) => binding[key as keyof SmallAcceptanceContext] === value);
}

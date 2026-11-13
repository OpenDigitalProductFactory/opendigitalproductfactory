import { isRecord } from "@/lib/shared/coerce";
import { isTerminalQuiescenceStatus } from "./quiescence-contract";

type Run = { runId: string; status: string; trigger: string; triggerRefId: string | null;
  targetVersion: string | null; targetBundleHash: string | null; budgetMs: number };
type RunData = Record<string, unknown> & { runId: string; trigger: string; triggerRefId?: string | null;
  targetVersion?: string | null; targetBundleHash?: string | null; budgetMs: number };
export interface QuiescenceReservationTx {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  platformConfig: { findUnique(args: unknown): Promise<{ value: unknown } | null>; upsert(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }> };
  quiescenceRun: { findUnique(args: unknown): Promise<Run | null>; findFirst(args: unknown): Promise<Run | null>; create(args: unknown): Promise<Run> };
}
export interface QuiescenceReservationDb {
  $transaction<T>(body: (tx: QuiescenceReservationTx) => Promise<T>): Promise<T>;
}
export class QuiescenceOwnershipError extends Error {
  constructor(readonly activeRunId: string | null) { super("A different active or unverified quiescence run owns admission."); }
}
export class QuiescenceStartUncertainError extends Error {
  constructor(readonly runId: string) { super("The original quiescence start acknowledgement is unknown; retain its run identity."); }
}
async function lock(tx: QuiescenceReservationTx, key: string): Promise<void> {
  if (typeof tx.$executeRaw !== "function") throw new Error("Quiescence reservation requires transactional serialization");
  const lockKey = `dpf:quiescence:${key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
export async function withQuiescenceStartSerialization<T>(db: QuiescenceReservationDb, key: string,
  body: (tx: QuiescenceReservationTx) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => { await lock(tx, key); return body(tx); });
}
function owner(value: unknown): { level: "normal" | "draining" | "swapping"; runId: string | null } {
  if (!isRecord(value) || !["normal", "draining", "swapping"].includes(String(value.level))
    || (value.runId !== null && (typeof value.runId !== "string" || !value.runId))) throw new QuiescenceOwnershipError(null);
  return { level: value.level as "normal" | "draining" | "swapping", runId: value.runId as string | null };
}
function compatible(run: Run, data: RunData): boolean {
  return run.trigger === data.trigger && run.triggerRefId === (data.triggerRefId ?? null)
    && run.targetVersion === (data.targetVersion ?? null) && run.targetBundleHash === (data.targetBundleHash ?? null);
}

/** Existing PlatformConfig is the single-flight reservation, including while
 * a durable coordinator parks and releases its job execution slot. A pending
 * reservation does not claim a closed/ready drain: level remains normal until
 * the owned coordinator captures blockers and advances it. */
export async function reserveQuiescenceStart(input: { db: QuiescenceReservationDb; configKey: string;
  runData: RunData; ifBusy: "join-active" | "refuse"; now: Date; requestNotAfter?: Date }): Promise<{ runId: string; budgetMs: number; created: boolean }> {
  return input.db.$transaction(async tx => {
    await lock(tx, input.configKey);
    if (input.requestNotAfter) {
      if (!Number.isFinite(+input.requestNotAfter) || Date.now() >= +input.requestNotAfter) throw new Error("Original request acceptance expired");
      const original = input.runData.triggerRefId ? await tx.quiescenceRun.findFirst({
        where: { trigger: input.runData.trigger, triggerRefId: input.runData.triggerRefId }, orderBy: { startedAt: "asc" },
      }) : null;
      if (original) throw new QuiescenceStartUncertainError(original.runId);
    }
    const config = await tx.platformConfig.findUnique({ where: { key: input.configKey } });
    const current = config ? owner(config.value) : { level: "normal", runId: null };
    let active = current.runId ? await tx.quiescenceRun.findUnique({ where: { runId: current.runId } }) : null;
    if (current.runId && !active) throw new QuiescenceOwnershipError(current.runId);
    if (active && isTerminalQuiescenceStatus(active.status)) {
      if (current.level !== "normal") throw new QuiescenceOwnershipError(active.runId);
      active = null;
    }
    // A historical nonterminal row alone is not current ownership. Legacy
    // workers must acquire the same current fence before advancing; they
    // cannot steal it from a newly reserved operation when they resume.
    if (active) {
      // Default join is idempotent only for the same operation/target. Joining
      // a foreign operation cannot silently confer ownership of its swap.
      if (input.ifBusy === "refuse" || !compatible(active, input.runData)) throw new QuiescenceOwnershipError(active.runId);
      return { runId: active.runId, budgetMs: active.budgetMs, created: false };
    }
    if (current.level !== "normal") throw new QuiescenceOwnershipError(current.runId);
    const created = await tx.quiescenceRun.create({ data: input.runData });
    const value = { level: "normal", runId: created.runId, enteredAt: input.now.toISOString() };
    await tx.platformConfig.upsert({ where: { key: input.configKey }, create: { key: input.configKey, value }, update: { value } });
    return { runId: created.runId, budgetMs: created.budgetMs, created: true };
  });
}

/** All coordinator advances and reassertions share the reservation lock.
 * An old worker may not replace another run even when the latter is pending
 * with level normal. Terminal owned clears retain their existing CAS API. */
export async function advanceOwnedQuiescenceLevel(input: { db: QuiescenceReservationDb; configKey: string;
  level: "normal" | "draining" | "swapping"; runId: string | null; now: Date }): Promise<void> {
  await input.db.$transaction(async tx => {
    await lock(tx, input.configKey);
    const row = await tx.platformConfig.findUnique({ where: { key: input.configKey } });
    const current = row ? owner(row.value) : { level: "normal", runId: null };
    if ((current.runId && current.runId !== input.runId) || (input.level !== "normal" && !input.runId)) throw new QuiescenceOwnershipError(current.runId);
    if (input.runId) {
      // A terminal transition updates this same row. Keep its validation and
      // our level write in one row-locked transaction, not a stale SELECT.
      await tx.$executeRaw`SELECT 1 FROM "QuiescenceRun" WHERE "runId" = ${input.runId} FOR UPDATE`;
      const run = await tx.quiescenceRun.findUnique({ where: { runId: input.runId } });
      if (!run || isTerminalQuiescenceStatus(run.status)) throw new QuiescenceOwnershipError(current.runId);
    }
    const value = { level: input.level, runId: input.runId, enteredAt: input.now.toISOString() };
    await tx.platformConfig.upsert({ where: { key: input.configKey }, create: { key: input.configKey, value }, update: { value } });
  });
}

/** Preserve the existing expected-owner CAS while serializing it with starts
 * and advances. A terminal+clear cannot be followed by a stale draining write. */
export async function clearOwnedQuiescenceLevel(input: { db: QuiescenceReservationDb; configKey: string;
  expectedRunId: string; now: Date }): Promise<void> {
  await withQuiescenceStartSerialization(input.db, input.configKey, async tx => {
    if (!tx.platformConfig.updateMany) throw new Error("Owned quiescence clear requires compare-and-set");
    await tx.platformConfig.updateMany({ where: { key: input.configKey, value: { path: ["runId"], equals: input.expectedRunId } },
      data: { value: { level: "normal", runId: null, enteredAt: input.now.toISOString() } } });
  });
}

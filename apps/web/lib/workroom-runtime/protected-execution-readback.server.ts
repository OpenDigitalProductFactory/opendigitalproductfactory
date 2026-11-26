import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { executionHostRef } from "@/lib/agent-toolchain/execution-host-registry";
import { commandPayloadBinding, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";

import { findProtectedExecutionBinding, protectedBindingIdentity, protectedObservation, protectedObservationCursor,
  readProtectedExecutionBindings, type ObservationCursor, type ProtectedObservation, type StoredProtectedExecutionBinding } from "./protected-execution-binding";
import type { ProtectedLaunchKey } from "./protected-execution-dispatch.server";
import { selectProtectedRoute, type ProtectedTransport } from "./protected-execution-transport.server";

export type { ObservationCursor, ProtectedObservation };
export type ProtectedReadbackReply = { key: ProtectedLaunchKey } & (ProtectedObservation |
  { kind: "unknown" | "uncertain" | "unknown-attempt" | "refused" | "cursor-reset" });
export type ProtectedReadbackPort = { read(input: { key: ProtectedLaunchKey; cursor: ObservationCursor | null; signal: AbortSignal }): Promise<ProtectedReadbackReply> };
export type ReadbackResult = { outcome: "held"; reachable: boolean } |
  { outcome: "observed"; reachable: true; observation: ProtectedObservation };

export async function observeProtectedAttempt(stored: StoredProtectedExecutionBinding, deps: {
  canReadExact: (binding: StoredProtectedExecutionBinding) => Promise<boolean>;
  transport: ProtectedTransport<ProtectedReadbackPort>;
  signal: AbortSignal;
  cursor?: ObservationCursor;
}): Promise<ReadbackResult> {
  const unreachable = { outcome: "held", reachable: false } as const;
  const hold = { outcome: "held", reachable: true } as const;
  if (stored.launch.phase !== "possibly-started" || deps.signal.aborted) return unreachable;
  let cursor = deps.cursor ?? (stored.observation?.kind === "nonterminal" ? stored.observation.cursor : undefined) ?? null;
  if (cursor && !protectedObservationCursor.safeParse(cursor).success) return unreachable;
  try { if (!await deps.canReadExact(stored) || deps.signal.aborted) return unreachable; } catch { return unreachable; }
  const selected = await selectProtectedRoute(protectedBindingIdentity(stored), deps.transport);
  if (selected.kind === "held" || deps.signal.aborted) return unreachable;
  const { installationRef, hostRef, sessionRef, stageAttemptRef, originRef } = stored;
  const expected = { installationRef, hostRef, sessionRef, stageAttemptRef, originRef };
  try {
    const read = () => selected.channel.port.read({ key: expected, cursor, signal: deps.signal });
    let reply = await read();
    if (deps.signal.aborted || canonicalJson(reply.key) !== canonicalJson(expected)) return hold;
    if (reply.kind === "cursor-reset" && cursor !== null) {
      // Reset observation only. Use the same authenticated receiver, not a new attempt or a newly chosen host.
      cursor = null;
      reply = await read();
      if (deps.signal.aborted || canonicalJson(reply.key) !== canonicalJson(expected)) return hold;
    }
    const { key: _key, ...observation } = reply;
    const parsed = protectedObservation.safeParse(observation);
    if (!parsed.success) return hold;
    if (cursor && parsed.data.kind === "nonterminal") {
      const next = parsed.data.cursor;
      if (!next || next.storeEpoch !== cursor.storeEpoch || BigInt(next.sequence) < BigInt(cursor.sequence) ||
        (next.sequence === cursor.sequence && next.ref !== cursor.ref)) return hold;
    }
    return { outcome: "observed", reachable: true, observation: parsed.data };
  } catch { return hold; }
}

export function decideProtectedObservationWrite(expected: StoredProtectedExecutionBinding, current: StoredProtectedExecutionBinding,
  observation: ProtectedObservation): "apply" | "unchanged" | "hold" {
  if (current.launch.phase !== "possibly-started" || expected.launch.phase !== "possibly-started" ||
    current.launch.projectionDigest !== expected.launch.projectionDigest ||
    canonicalJson(protectedBindingIdentity(current)) !== canonicalJson(protectedBindingIdentity(expected))) return "hold";
  if (current.observation && canonicalJson(current.observation) === canonicalJson(observation)) return "unchanged";
  if (current.observation?.kind === "final-matching" ||
    canonicalJson(current.observation ?? null) !== canonicalJson(expected.observation ?? null)) return "hold";
  return "apply";
}

type ReadbackSelector = { roomRef: string; sessionRef: string; stageAttemptRef: string; signal: AbortSignal };
type ObservationDb = ReceiptDb & { workroom: { findUnique(args: { where: { capsuleId: string };
  select: { id: true; workspaceState: true } }): Promise<{ id: string; workspaceState: unknown } | null> } };

/** Reattach from durable Workroom state after a portal restart. Only record a fresh, exact receiver observation. */
export function createProtectedAttemptReattacher(deps: {
  transport: ProtectedTransport<ProtectedReadbackPort>;
  canReadExact(binding: StoredProtectedExecutionBinding): Promise<boolean>;
  canRecordExact(tx: ReceiptDb, binding: StoredProtectedExecutionBinding): Promise<boolean>;
  db?: ObservationDb;
}) {
  const db = (deps.db ?? prisma) as ObservationDb;
  const load = (port: ObservationDb, roomRef: string) => port.workroom.findUnique({ where: { capsuleId: roomRef }, select: { id: true, workspaceState: true } });
  return async (input: ReadbackSelector): Promise<ReadbackResult> => {
    const { roomRef, sessionRef, stageAttemptRef, signal } = input;
    if (![roomRef, sessionRef, stageAttemptRef].every(value => executionHostRef.safeParse(value).success) || signal.aborted) {
      return { outcome: "held", reachable: false };
    }
    let reachable = false;
    try {
      const original = await load(db, roomRef);
      if (!original) return { outcome: "held", reachable };
      const record = readProtectedExecutionBindings(original.workspaceState);
      const expected = record && findProtectedExecutionBinding(record, input);
      if (!expected || expected.roomRef !== roomRef) return { outcome: "held", reachable };
      const result = await observeProtectedAttempt(expected, { ...deps, signal });
      reachable = result.reachable;
      if (result.outcome === "held") return result;
      const normalized = commandPayloadBinding({ expected, observation: result.observation });
      const written = await runReceiptedCommand({ db, authorityScopeKey: `workroom-protected-readback:${roomRef}`,
        commandId: `readback:${normalized.digest}`, commandType: "workroom-runtime.observe-protected-attempt",
        target: { kind: "workroom", id: roomRef }, expectedRoomRowId: original.id, payloadBinding: normalized,
        run: async tx => {
          const locked = await load(tx as ObservationDb, roomRef);
          const state = locked && readProtectedExecutionBindings(locked.workspaceState);
          const current = state && findProtectedExecutionBinding(state, input);
          if (!locked || !state || !current || !tx.$executeRaw || signal.aborted || !await deps.canRecordExact(tx, current) || signal.aborted) return false;
          const decision = decideProtectedObservationWrite(expected, current, result.observation);
          if (decision !== "apply") return decision === "unchanged";
          const next = { version: 1, bindings: state.bindings.map(entry => entry === current ? { ...entry, observation: result.observation } : entry) };
          await tx.$executeRaw`UPDATE "WorkCapsule" SET "workspaceState" = jsonb_set(COALESCE("workspaceState", '{}'::jsonb), '{protectedExecution}', ${JSON.stringify(next)}::jsonb, true) WHERE "id" = ${locked.id}`;
          return true;
        },
      });
      if (!written) return { outcome: "held", reachable };
      const verified = await load(db, roomRef);
      const latest = verified?.id === original.id && readProtectedExecutionBindings(verified.workspaceState);
      const observed = latest && findProtectedExecutionBinding(latest, input)?.observation;
      return observed && canonicalJson(observed) === canonicalJson(result.observation) ? result : { outcome: "held", reachable };
    } catch { return { outcome: "held", reachable }; }
  };
}

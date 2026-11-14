// Test fixture (BI-C64EDA33): the runtime commit and the room outbox over
// memory, with the same rules as runtime-commit.server.ts and
// workroom-effect-store.ts: one decision per command id (a repeat replays the
// stored reply), effects keyed by (command, ordinal), per-room order where an
// unsettled effect blocks the room's later ones, generation-bound claims, and
// settlements guarded by attempt. The SQL itself is proven against a real
// database in workroom-effect-store.pg.test.ts.

import type { WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";

import { StaleEffectSettlementError, type RuntimeCommitter } from "../runtime-commit.server";
import { decideRuntimeCommand, isProcessBound, type EffectKind, type RoomMessageWakeWrite } from "../runtime-decider";
import { readStoredRuntimeSession } from "../supervised-session";
import type { EffectStorePort } from "../supervisor";
import type { ClaimedEffect } from "../workroom-effect-store";

type Room = { id: string; capsuleId?: string; workspaceState: Record<string, unknown> };

export type MemoryEffect = ClaimedEffect & { sequence: number; ordinal: number; status: string; availableAt: number; leaseExpiresAt: number | null };
export type MemoryActivity = { kind: string; summary: string; payload: Record<string, unknown>; actor: WorkCapsuleActor };

export function createMemoryRuntimeStore(rooms: (capsuleId: string) => Room | null, now: () => number = () => Date.now()) {
  const receipts = new Map<string, Record<string, unknown>>();
  const effects: MemoryEffect[] = [];
  const activities: MemoryActivity[] = [];
  const messageWakes: RoomMessageWakeWrite[] = [];
  let sequence = 0;

  const commit: RuntimeCommitter = async ({ capsuleId, commandId, command, actor }) => {
    const room = rooms(capsuleId);
    if (!room) return null;
    const key = `${capsuleId}:${commandId}`;
    const replay = receipts.get(key);
    if (replay) return replay;
    const before = readStoredRuntimeSession(room.workspaceState);
    const decision = decideRuntimeCommand({ session: before }, commandId, command);
    if (decision.settle) {
      const s = decision.settle;
      const row = effects.find((e) => e.id === s.effectId && e.status === "running" && e.attemptCount === s.attempt);
      if (!row) throw new StaleEffectSettlementError(s.effectId);
      row.status = s.status;
      row.leaseExpiresAt = null;
      if (s.status === "pending") row.availableAt = now() + (s.retryAfterMs ?? 0);
    }
    const written = [...decision.activities];
    if (decision.retire) {
      const keep = decision.retire.keepGeneration;
      const retired = effects.filter((e) => e.workCapsuleId === room.id && e.processBound && ["pending", "running"].includes(e.status)
        && (keep === null || e.sessionGeneration !== keep));
      for (const e of retired) e.status = "retired";
      if (retired.length > 0) written.push({ kind: "effect-retired", as: "runtime", summary: `Retired ${retired.length} runtime step(s).`, payload: {} });
    }
    const after = decision.session ?? before;
    for (const a of written) {
      const starter = after?.actor;
      const by = a.as === "actor" ? actor : starter ? { ...starter, agentId: "workroom-runtime" } : { ...actor, agentId: "workroom-runtime" };
      activities.push({ kind: a.kind, summary: a.summary, payload: a.payload, actor: by });
    }
    if (decision.messageWake) messageWakes.push(decision.messageWake);
    if (decision.session !== undefined) room.workspaceState = { ...room.workspaceState, runtimeSession: JSON.parse(JSON.stringify(decision.session)) };
    decision.effects.forEach((effect, ordinal) => {
      if (effects.some((e) => e.workCapsuleId === room.id && e.commandKey === commandId && e.ordinal === ordinal)) return;
      const bound = isProcessBound(effect.kind);
      effects.push({
        id: `eff-${++sequence}`, sequence, ordinal, workCapsuleId: room.id, capsuleId, commandKey: commandId, kind: effect.kind as EffectKind,
        processBound: bound, sessionGeneration: bound ? after?.generation ?? null : null, payload: effect.payload,
        status: "pending", attemptCount: 0, maxAttempts: 5, availableAt: now(), leaseExpiresAt: null,
      });
    });
    receipts.set(key, decision.reply);
    return decision.reply;
  };

  const store: EffectStorePort = {
    async claim({ liveGenerations, limit, leaseMs }) {
      const claimed: MemoryEffect[] = [];
      for (const e of [...effects].sort((a, b) => a.sequence - b.sequence)) {
        if (claimed.length >= limit) break;
        if (e.status !== "pending" || e.availableAt > now()) continue;
        if (e.processBound && !liveGenerations.includes(e.sessionGeneration ?? "")) continue;
        const blocked = effects.some((p) => p.workCapsuleId === e.workCapsuleId && p.sequence < e.sequence && (p.status === "pending" || p.status === "running"));
        if (blocked) continue;
        e.status = "running";
        e.attemptCount += 1;
        e.leaseExpiresAt = now() + leaseMs;
        claimed.push(e);
      }
      return claimed.map((e) => ({ ...e }));
    },
    async retireOrphaned() {
      let retired = 0;
      for (const e of effects) {
        if (!e.processBound || !["pending", "running"].includes(e.status)) continue;
        const session = readStoredRuntimeSession(rooms(e.capsuleId)?.workspaceState);
        if (session?.status !== "supervised" || session.generation !== e.sessionGeneration) { e.status = "retired"; retired += 1; }
      }
      return retired;
    },
    async recoverExpired() {
      const expired = effects.filter((e) => e.status === "running" && e.leaseExpiresAt !== null && e.leaseExpiresAt < now());
      for (const e of expired) { e.status = "pending"; e.leaseExpiresAt = null; }
      return expired.length;
    },
  };

  return { commit, effects: store, effectRows: effects, activities, messageWakes, kinds: () => activities.map((a) => a.kind) };
}

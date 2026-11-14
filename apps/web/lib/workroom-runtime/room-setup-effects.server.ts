// BI-C64EDA33 PR 3 (AC-5, plan 2026-11-14-workroom-runtime-core): a room's
// setup steps that used to run after its claim or adoption committed, and
// could be lost to a crash in between (the WorkItem anchor every wake and
// dispatch needs), are committed as outbox effects in the same transaction as
// the room itself. The effect worker runs them, retries them, and they survive
// a restart: they are not process-bound, so the boot retirement leaves them.
// A room is therefore either not made at all, or made with its setup owed.

import type { ClaimedEffect, EffectSqlDb } from "./workroom-effect-store";
import { insertEffects } from "./workroom-effect-store";

/** Owe the room its WorkItem anchor, inside the transaction that made or bound the room. */
export async function oweRoomSetup(tx: EffectSqlDb, input: { roomRowId: string; capsuleId: string; backlogItemId: string | null; title: string; source: "claim" | "adopt"; now?: Date }): Promise<void> {
  await insertEffects(tx, {
    roomRowId: input.roomRowId,
    // One setup per room per source: a repeated claim or adoption owes nothing twice.
    commandId: `room-setup:${input.source}:${input.capsuleId}:${input.backlogItemId ?? "none"}`,
    generation: null,
    effects: [{ kind: "ensure-workitem-anchor", payload: { capsuleId: input.capsuleId, backlogItemId: input.backlogItemId, title: input.title } }],
    now: input.now ?? new Date(),
  });
}

/** Run one setup step; each is idempotent (resolve-or-create), so a retry is harmless. */
export async function executeRoomSetupEffect(effect: Pick<ClaimedEffect, "kind" | "payload">): Promise<Record<string, unknown>> {
  switch (effect.kind) {
    case "ensure-workitem-anchor": {
      const { ensureCapsuleWorkItemAnchorWithPrisma } = await import("@/lib/work-capsules/capsule-workitem-anchor.server");
      const result = await ensureCapsuleWorkItemAnchorWithPrisma({
        capsuleId: String(effect.payload["capsuleId"]),
        backlogItemId: (effect.payload["backlogItemId"] as string | null) ?? null,
        title: String(effect.payload["title"] ?? "Work Room"),
      });
      return { anchored: Boolean(result) };
    }
    default:
      throw new Error(`${effect.kind} is not a room setup step`);
  }
}

/** After the room's transaction commits: run what it owes now rather than at the next sweep. */
export function kickRoomSetup(): void {
  void import("./runtime-tools")
    .then(({ workroomRuntimeSupervisor }) => workroomRuntimeSupervisor().drainEffects())
    .catch((error: unknown) => {
      console.error("[workroom-runtime] room setup pass failed; the effect sweep retries it: %s", error instanceof Error ? error.message : "unknown");
    });
}

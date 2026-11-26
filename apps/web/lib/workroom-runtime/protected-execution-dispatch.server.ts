import { createHash } from "node:crypto";
import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { executionHostRef } from "@/lib/agent-toolchain/execution-host-registry";
import { isTerminalCapsuleStatus } from "@/lib/work-capsules/work-capsule-branch-identity";

import { createEffectWorker, RefuseEffectError } from "./effect-worker.server";
import { findProtectedExecutionBinding, protectedBindingIdentity, readProtectedExecutionBindings, type ProtectedExecutionBinding } from "./protected-execution-binding";
import { selectProtectedRoute, type ProtectedRouteSelection, type ProtectedTransport } from "./protected-execution-transport.server";
import { createProtectedLaunchReservation } from "./runtime-commit.server";
import { claimProtectedLaunchEffects, PROTECTED_LAUNCH_EFFECT_KIND, recoverExpiredProtectedLaunchLeases, settleEffect } from "./workroom-effect-store";

export type ProtectedLaunchKey = Pick<ProtectedExecutionBinding, "installationRef" | "hostRef" | "sessionRef" | "stageAttemptRef" | "originRef">;
export type ProtectedLaunchReply = { kind: "accepted" | "refused" | "unknown"; key: ProtectedLaunchKey };
export type ProtectedLaunchPort = { launch(input: { key: ProtectedLaunchKey; projection: Uint8Array; signal: AbortSignal }): Promise<ProtectedLaunchReply> };
export type ProtectedDispatchInput = { binding: ProtectedExecutionBinding; signal: AbortSignal };
export type ProtectedDispatchDeps = {
  transport: ProtectedTransport<ProtectedLaunchPort>;
  readAuthority(input: ProtectedDispatchInput): Promise<{ binding: ProtectedExecutionBinding; projection: Uint8Array } | null>;
  reserveOnce(input: { binding: ProtectedExecutionBinding; projectionDigest: string; signal: AbortSignal }): Promise<"reserved" | "readback-only" | "held">;
};

type RouteHold = Extract<ProtectedRouteSelection<never>, { kind: "held" }>["reason"];
export type ProtectedDispatchResult = { outcome: "accepted" | "readback-only" } | { outcome: "held"; reason: RouteHold | "authority-unverifiable" };

export function protectedLaunchKey(binding: ProtectedExecutionBinding): ProtectedLaunchKey {
  const { installationRef, hostRef, sessionRef, stageAttemptRef, originRef } = binding;
  return { installationRef, hostRef, sessionRef, stageAttemptRef, originRef };
}

/** The positive reservation is single-use. Anything after it is observation, including a clean launch refusal. */
export async function dispatchProtectedExecution(input: ProtectedDispatchInput, deps: ProtectedDispatchDeps): Promise<ProtectedDispatchResult> {
  const { binding, signal } = input;
  const hold = { outcome: "held", reason: "authority-unverifiable" } as const;
  const readback = { outcome: "readback-only" } as const;
  if (signal.aborted) return hold;
  let projection: Uint8Array;
  try {
    const authority = await deps.readAuthority(input);
    if (!authority || !(authority.projection instanceof Uint8Array) || !authority.projection.length ||
      canonicalJson(authority.binding) !== canonicalJson(binding) || signal.aborted) return hold;
    // Snapshot these exact, already admitted S5 bytes. Do not decode and re-encode a signed projection.
    projection = new Uint8Array(authority.projection);
  } catch { return hold; }
  const selected = await selectProtectedRoute(binding, deps.transport);
  if (selected.kind === "held") return { outcome: "held", reason: selected.reason };
  if (signal.aborted) return hold;
  let reservation: Awaited<ReturnType<ProtectedDispatchDeps["reserveOnce"]>>;
  try {
    reservation = await deps.reserveOnce({ binding, projectionDigest: createHash("sha256").update(projection).digest("hex"), signal });
  } catch {
    // A DB commit reply can be lost. Do not interpret it as permission or request a second launch.
    return readback;
  }
  if (reservation === "readback-only") return readback;
  if (reservation !== "reserved") return hold;
  if (signal.aborted) return readback;
  try {
    const key = protectedLaunchKey(binding);
    const reply = await selected.channel.port.launch({ key, projection, signal });
    return reply.kind === "accepted" && canonicalJson(reply.key) === canonicalJson(key) ? { outcome: "accepted" } : readback;
  } catch { return readback; }
}

/** This worker is composed only with a verified sender adapter. It is not started by local runtime boot. */
export function createProtectedDispatchWorker(deps: Omit<ProtectedDispatchDeps, "reserveOnce"> & {
  owner: string;
  rolloutReady: () => boolean;
  now?: () => Date;
  isCurrentAuthority: Parameters<typeof createProtectedLaunchReservation>[0]["isCurrentAuthority"];
}) {
  const now = deps.now ?? (() => new Date());
  const reserve = createProtectedLaunchReservation({ isCurrentAuthority: deps.isCurrentAuthority });
  return createEffectWorker<typeof PROTECTED_LAUNCH_EFFECT_KIND>({
    owner: deps.owner,
    liveGenerations: () => [],
    claim: async input => deps.rolloutReady() ? claimProtectedLaunchEffects(prisma, { ...input, now: now() }) : [],
    recoverExpired: async () => deps.rolloutReady() ? recoverExpiredProtectedLaunchLeases(prisma, now()) : 0,
    execute: async (effect, signal) => {
      if (!deps.rolloutReady()) throw new RefuseEffectError("protected-launch-unavailable");
      const room = await prisma.workroom.findUnique({ where: { id: effect.workCapsuleId },
        select: { capsuleId: true, workspaceState: true, archivedAt: true, status: true } });
      const sessionRef = executionHostRef.safeParse(effect.payload["sessionRef"]);
      const stageAttemptRef = executionHostRef.safeParse(effect.payload["stageAttemptRef"]);
      const record = room && readProtectedExecutionBindings(room.workspaceState);
      const stored = record && sessionRef.success && stageAttemptRef.success && findProtectedExecutionBinding(record,
        { sessionRef: sessionRef.data, stageAttemptRef: stageAttemptRef.data });
      if (!room || room.archivedAt || isTerminalCapsuleStatus(room.status) || !stored || stored.roomRef !== effect.capsuleId || stored.roomRef !== room.capsuleId) {
        throw new RefuseEffectError("protected-launch-binding-unavailable");
      }
      if (stored.launch.phase === "possibly-started") return { outcome: "readback-only" };
      const result = await dispatchProtectedExecution({ binding: protectedBindingIdentity(stored), signal }, {
        ...deps,
        reserveOnce: input => deps.rolloutReady()
          ? reserve({ ...input, effectId: effect.id, attempt: effect.attemptCount, leaseOwner: deps.owner }) : Promise.resolve("held"),
      });
      if (result.outcome === "held") throw new RefuseEffectError(result.reason);
      return result;
    },
    // Settle only the outbox delivery, never the Workroom attempt. A fresh exact readback owns any attempt settlement.
    report: async (effect, report) => {
      await settleEffect(prisma, { effectId: effect.id, attempt: effect.attemptCount, status: report.outcome,
        error: report.outcome === "failed" ? "protected-launch-held" : null }, now());
    },
  });
}

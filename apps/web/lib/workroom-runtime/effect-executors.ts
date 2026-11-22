// BI-EB4BB4A0: executors for outbox effects that belong to another domain
// (Build Studio's `dispatch-build`). The supervisor runs effects without
// importing the code that owns them. That code registers its executor here at
// boot (instrumentation.ts), so the Workroom runtime never joins the
// build/MCP import graph that already reaches back to the runtime.
//
// The registry lives on globalThis, like the supervisor itself, so a dev
// reload does not drop a registration made at boot.

import type { EffectKind } from "./runtime-decider";
import type { ClaimedEffect } from "./workroom-effect-store";

export type ExternalEffectExecutor = (effect: ClaimedEffect) => Promise<Record<string, unknown>>;

type Registry = Map<EffectKind, ExternalEffectExecutor>;
const globalRegistry = globalThis as typeof globalThis & {
  __dpfWorkroomEffectExecutors?: Registry;
  __dpfWorkroomRuntime?: { drainEffects(): Promise<number> };
};

function registry(): Registry {
  globalRegistry.__dpfWorkroomEffectExecutors ??= new Map();
  return globalRegistry.__dpfWorkroomEffectExecutors;
}

/** Register the executor for an effect kind another domain owns. A re-registration replaces it (dev reload). */
export function registerEffectExecutor(kind: EffectKind, executor: ExternalEffectExecutor): void {
  registry().set(kind, executor);
}

export function registeredEffectExecutor(kind: EffectKind): ExternalEffectExecutor | null {
  return registry().get(kind) ?? null;
}

/**
 * After a commit that owes effects, run them now if this process's effect
 * worker is up. If it is not up yet, the worker's sweep runs them once it
 * starts at boot. The committed effect is the guarantee; this call only
 * shortens the wait.
 */
export function kickWorkroomEffects(): void {
  const runtime = globalRegistry.__dpfWorkroomRuntime;
  if (!runtime) return;
  void runtime.drainEffects().catch((error: unknown) => {
    console.error("[workroom-runtime] effect pass failed; the sweep retries it: %s", error instanceof Error ? error.message : "unknown");
  });
}
